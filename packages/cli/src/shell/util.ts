import type { JSh } from "@npc-cli/parse-sh";
import { toProcessStatus } from "./const";
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
