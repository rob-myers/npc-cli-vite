import { jsFunctionToShellFunction } from "@npc-cli/cli";

import * as modules from "@npc-cli/cli/jsh/modules";
/** Each keyed value is a string i.e. shell code. */
import * as scripts from "@npc-cli/cli/jsh/scripts";

export type TtyJsModules = typeof modules;

type TtyJsModuleKey = keyof TtyJsModules;

/**
 * Keys of basenames of files in /etc.
 */
export type EtcBasename = FileKeyToEtcBasename<keyof typeof scripts | TtyJsModuleKey>;

type FileKeyToEtcBasename<S extends string> = S extends `${infer T}Sh` ? `${T}.sh` : `${S}.js.sh`;

export const shellFunctionFiles = {
  ...Object.entries(scripts).reduce(
    (agg, [key, rawModule]) => ({ ...agg, [`${key.slice(0, -"Sh".length)}.sh`]: rawModule }),
    {} as Record<EtcBasename, string>,
  ),

  ...Object.entries(modules).reduce(
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
