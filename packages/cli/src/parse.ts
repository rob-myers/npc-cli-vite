import type { MvdanSh } from "@npc-cli/parse-sh";
import { parse as parseSh } from "@npc-cli/parse-sh";
import cloneWithRefs from "lodash.clonedeep";
import type { BaseMeta, FileWithMeta, ParsedSh } from "./types";

export class ParseShService {
  /** This is actually attached to parse trees and then overwritten per-parse */
  //@ts-expect-error
  private mockMeta!: BaseMeta;

  // 🚧 can we use these types going forwards?
  //@ts-expect-error
  private mockPos: () => MvdanSh.Pos;

  private cache: { [src: string]: FileWithMeta } = {};

  constructor() {
    this.mockPos = () => ({ Line: 1, Col: 1, Offset: 0 }) as MvdanSh.Pos;
    this.resetMockMeta();
  }

  /**
   * Use `mvdan-sh` to parse shell code.
   */
  //@ts-expect-error
  async parse(src: string, cache = false): Promise<FileWithMeta> {
    if (src in this.cache) {
      return cloneParsed(this.cache[src]);
    }

    const parsed = await parseSh(src, { interactive: false });
    console.log({ parseShServiceDebug: parsed });

    // Fresh `this.mockMeta` required, else other session
    // will overwrite `meta.sessionKey`
    this.resetMockMeta();

    // 🚧
    // const output = withParents(this.File(parsed));

    return parsed as any; // 🚧
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

export const parseService = new ParseShService();

/**
 * Clone creates completely fresh tree, sharing internal refs as before.
 * In particular every node has the same `node.meta`
 */
export function cloneParsed<T extends ParsedSh>(parsed: T): T {
  return cloneWithRefs(parsed);
}
