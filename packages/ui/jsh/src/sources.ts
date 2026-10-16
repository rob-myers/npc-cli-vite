import * as modules from "@npc-cli/cli/jsh/modules";
/** Each keyed value is a string i.e. shell code. */
import * as scripts from "@npc-cli/cli/jsh/scripts";
import { jsFunctionToShellFunction } from "@npc-cli/cli/shell/js-to-shell";

export type TtyJsModules = typeof modules;

type TtyJsModuleKey = Exclude<keyof TtyJsModules, "modulePtags">;

/**
 * Keys of basenames of files in /etc.
 */
export type EtcBasename = FileKeyToEtcBasename<keyof typeof scripts | TtyJsModuleKey>;

type FileKeyToEtcBasename<S extends string> = S extends `${infer T}Sh` ? `${Kebab<T>}.sh` : `${S}.js.sh`;

/** e.g. `jshDefault` is `jsh-default` */
type Kebab<S extends string> = S extends `${infer H}${infer T}`
  ? `${H extends Lowercase<H> ? H : `-${Lowercase<H>}`}${Kebab<T>}`
  : S;

export const shellFunctionFiles = {
  ...Object.entries(scripts).reduce(
    (agg, [key, rawModule]) => ({ ...agg, [`${toKebab(key.slice(0, -"Sh".length))}.sh`]: rawModule }),
    {} as Record<EtcBasename, string>,
  ),

  ...Object.entries(modules)
    .filter(([moduleKey]) => moduleKey !== "modulePtags")
    .reduce(
      (agg, [moduleKey, module]) => ({
        ...agg,
        [`${moduleKey}.js.sh`]: Object.entries(module)
          .flatMap(
            // exclude non-function exports
            ([fnKey, fn]) =>
              typeof fn === "function"
                ? jsFunctionToShellFunction({
                    modules,
                    moduleKey,
                    fnKey,
                    fn,
                  })
                : [],
          )
          .join("\n\n"),
      }),
      {} as Record<EtcBasename, string>,
    ),
};

function toKebab(key: string) {
  return key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
}
