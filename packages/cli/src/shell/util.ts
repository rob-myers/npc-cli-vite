import type { JSh } from "@npc-cli/parse-sh";
import { last } from "@npc-cli/util/legacy/generic";
import type * as GetOpts from "getopts";
import { ansi, toProcessStatus } from "./const";
import type { ProcessMeta, Ptags } from "./session.store";

export class ShError extends Error {
  exitCode: number;
  original?: Error;
  constructor(message: string, exitCode: number, original?: Error) {
    super(message);
    this.exitCode = exitCode;
    this.original = original;
  }
}

export class SigKillError extends Error {
  pid: number;
  sessionKey: string;
  exitCode?: number;
  /** If defined, the number of ancestral processes to terminate */
  depth?: number;
  /** If true, skip current iteration */
  skip?: boolean;
  constructor(opts: {
    pid: number;
    sessionKey: string;
    exitCode?: number;
    depth?: number;
    skip?: boolean;
  }) {
    super("SIGKILL");
    this.pid = opts.pid;
    this.sessionKey = opts.sessionKey;
    this.exitCode = opts.exitCode;
    this.depth = opts.depth;
    this.skip = opts.skip;
  }
}

export function addStdinToArgs(dataFromStdin: any, args: any[]): any[] {
  const index = args.indexOf("-");
  args = args.slice();
  index >= 0 ? args.splice(index, 1, dataFromStdin) : args.push(dataFromStdin);
  return args;
}

/**
 * Mutates `ptags`.
 * - A process has tag `key` iff `key in process.ptags`.
 * - An updates value of `undefined` or `null` deletes the tag.
 */
export function applyPtagUpdates(ptags: Ptags, updates: Ptags) {
  for (const [k, v] of Object.entries(updates)) {
    if (v == null) delete ptags[k];
    else ptags[k] = v;
  }
  return ptags;
}

export function computeNormalizedParts(varPath: string, pwd: string): string[] {
  // basic tilde expansion
  if (varPath === "~") varPath = "/home";
  if (varPath.startsWith("~/")) varPath = `/home/${varPath.slice(2)}`;

  const absParts = varPath.startsWith("/")
    ? varPath.split("/")
    : pwd.split("/").concat(varPath.split("/"));
  return normalizeAbsParts(absParts);
}

export function formatMessage(msg: string, level: "info" | "error") {
  return level === "info" ? `${ansi.Cyan}${msg}${ansi.Reset}` : `${ansi.Red}${msg}${ansi.Reset}`;
}

export function handleProcessError(node: JSh.ParsedSh, e: SigKillError) {
  node.exitCode = e.exitCode ?? node.exitCode ?? 137;
  if (e.depth === undefined || e.depth--) {
    throw e; // Propagate signal (KILL)
  }
}

export function killError(
  meta: Pick<JSh.BaseMeta, "sessionKey" | "pid"> | ProcessMeta,
  exitCode?: number,
  depth?: number,
  skip?: boolean,
) {
  return new SigKillError({
    pid: "pid" in meta ? meta.pid : meta.key,
    sessionKey: meta.sessionKey,
    exitCode: exitCode ?? 130,
    depth,
    skip,
  });
}

export function killProcess(p: ProcessMeta, SIGINT?: boolean) {
  // console.log('KILLING', p.key, p.src);
  p.status = toProcessStatus.Killed;
  for (const cleanup of p.cleanups) {
    cleanup(SIGINT);
  }
  p.cleanups.length = 0;
}

export function interpretEscapeSequences(input: string): string {
  return JSON.parse(
    JSON.stringify(input)
      .replace(/\\\\'/g, "\\u0027")
      // '\\e' -> '\\u001b'.
      .replace(/\\\\e/g, "\\u001b")
      // Hex escape-code (0-255) e.g. '\\\\x1b' -> '\\u001b'.
      .replace(/\\\\x([0-9a-f]{2})/g, "\\u00$1")
      // e.g. '\\\\n' -> '\\n'.
      .replace(/\\\\([bfnrt])/g, "\\$1"),
  );
}

export function matchFuncFormat(pathComponent: string) {
  return pathComponent.match(/\(([^)]*)\)$/);
}

export function normalizeAbsParts(absParts: string[]) {
  return absParts.reduce((agg, item) => {
    if (!item || item === ".") return agg;
    if (item === "..") return agg.slice(0, -1);
    return agg.concat(item);
  }, [] as string[]);
}

export function normalizeWhitespace(word: string, trim = true): string[] {
  if (word.trim() === "") {
    // Prevent [''].
    return [];
  } else if (trim === true) {
    return word.trim().replace(/[\s]+/g, " ").split(" ");
  }

  // Otherwise preserve single leading/trailing space
  const words = word.replace(/[\s]+/g, " ").split(" ");
  if (!words[0]) {
    // ['', 'foo'] -> [' foo']
    words.shift();
    words[0] = " " + words[0];
  }
  if (!last(words)) {
    // ['foo', ''] -> ['foo ']
    words.pop();
    words.push(words.pop() + " ");
  }
  return words;
}

/**
 * Parse function or regexp, with string fallback.
 */
export function parseFnOrStr(input: string) {
  try {
    const parsed = Function(`return ${input}`)();
    // 🤔 avoid 'toString' -> window.toString
    // 🤔 permit 'String'  -> window.String
    if (typeof parsed === "function" && !(input in window && parsed.length === 0)) {
      return parsed;
    }
    if (parsed instanceof RegExp) {
      return parsed;
    }
  } catch {}
  return input;
}

export function resolvePath(path: string, root: any, pwd: string) {
  const absParts = path.startsWith("/") ? path.split("/") : pwd.split("/").concat(path.split("/"));
  return resolveAbsParts(absParts, root);
}

/**
 * 🔔 now throws on non-existent path
 */
export function resolveNormalized(parts: string[], root: any) {
  return parts.reduce((agg, item) => {
    // Support invocation of functions, where
    // args assumed valid JSON when []-wrapped,
    // e.g. myFunc("foo", 42) -> myFunc(...["foo", 42])
    if (item.endsWith(")")) {
      const matched = matchFuncFormat(item);
      if (matched) {
        const args = JSON.parse(`[${matched[1]}]`);
        return agg[item.slice(0, -(matched[1].length + 2))](...args);
      }
    }
    // return agg[item];
    if (item in agg) {
      return agg[item];
    } else {
      throw new ShError(`not found: /${parts.join("/")}`, 1);
    }
  }, root);
}

export function resolveAbsParts(absParts: string[], root: any): any {
  return resolveNormalized(normalizeAbsParts(absParts), root);
}

/**
 * `getopts` handles dup options by providing an array.
 * We restrict it to the final item. We also store list
 * of extant option names as value of key `__optKeys`.
 */
export function simplifyGetOpts(parsed: GetOpts.ParsedOptions) {
  const output = parsed as GetOpts.ParsedOptions & { operands: string[] };
  Object.keys(parsed).forEach((key) => {
    output.__optKeys = [];
    if (key !== "_") {
      Array.isArray(parsed[key]) && (output[key] = last(parsed[key]) as any);
      output.__optKeys.push(key);
    }
  });
  return output;
}

export function stripAnsi(input: string) {
  return input.replace(ansiRegex, "");
}

/** Source: https://www.npmjs.com/package/ansi-regex */
const ansiRegex = (function ansiRegex({ onlyFirst = false } = {}) {
  const pattern = [
    "[\\u001B\\u009B][[\\]()#;?]*(?:(?:(?:(?:;[-a-zA-Z\\d\\/#&.:=?%@~_]+)*|[a-zA-Z\\d]+(?:;[-a-zA-Z\\d\\/#&.:=?%@~_]*)*)?\\u0007)",
    "(?:(?:\\d{1,4}(?:;\\d{0,4})*)?[\\dA-PR-TZcf-nq-uy=><~]))",
  ].join("|");

  return new RegExp(pattern, onlyFirst ? undefined : "g");
})();
