import type { BaseMeta, FileWithMeta } from "./types";

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
