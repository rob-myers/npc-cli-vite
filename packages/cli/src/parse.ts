import cloneWithRefs from "lodash.clonedeep";
import type { BaseMeta, FileWithMeta, ParsedSh } from "./types";

export class ParseShService {
  /** This is actually attached to parse trees, and then reset per-parse */
  private mockMeta!: BaseMeta;

  // 🚧 can we use these types going forwards?
  private mockPos: () => MvdanSh.Pos;

  private cache: { [src: string]: FileWithMeta } = {};

  constructor() {
    this.mockPos = () => ({ Line: 1, Col: 1, Offset: 0 }) as MvdanSh.Pos;
    this.resetMockMeta();
  }

  resetMockMeta() {
    this.mockMeta = {
      sessionKey: defaults.defaultSessionKey,
      pid: -1,
      ppid: -1,
      pgid: -1,
      fd: {
        0: defaults.defaultStdInOut,
        1: defaults.defaultStdInOut,
        2: defaults.defaultStdInOut,
      },
      stack: [],
    };
  }
}

export const defaults = {
  defaultSessionKey: "code-has-not-run",
  defaultProcessKey: "code-has-not-run",
  defaultStdInOut: "unassigned-tty",
};

/**
 * Clone creates completely fresh tree, sharing internal refs as before.
 * In particular, every node has the same node.meta.
 */
export function cloneParsed<T extends ParsedSh>(parsed: T): T {
  return cloneWithRefs(parsed);
}
