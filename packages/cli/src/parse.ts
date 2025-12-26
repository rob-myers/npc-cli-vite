import { convertMvdanShToJsh, parse as parseSh, withParents } from "@npc-cli/parse-sh";
import { error } from "@npc-cli/util/legacy/generic";
import cloneWithRefs from "lodash.clonedeep";
import type { FileWithMeta, ParsedSh } from "./types";

export class ParseShService {
  private cache: { [src: string]: FileWithMeta } = {};

  async interactiveParse(partialSrc: string): Promise<InteractiveParseResult> {
    const parsed = await parseSh(partialSrc, { interactive: true });
    if (parsed === null) {
      return { incomplete: true, parsed: null };
    } else {
      return {
        incomplete: false,
        parsed: await this.parse(partialSrc, true),
      };
    }
  }

  /** Use `mvdan-sh` to parse shell code. */
  async parse(src: string, cache = false): Promise<FileWithMeta> {
    if (src in this.cache) {
      return cloneParsed(this.cache[src]);
    }

    const parsed = await parseSh(src, { interactive: false });
    console.debug({ parseShService: parsed });

    if (parsed === null) {
      throw new Error("Non-interactive parse should not have result `null`");
    }

    // Avoid other session overwrite `meta.sessionKey`
    convertMvdanShToJsh.resetMockMeta();

    // - transform parse tree to have "our notion" of BaseNode
    // - ensure parents
    const file = withParents(convertMvdanShToJsh.File(parsed.file));

    return cache === true ? (this.cache[src] = file) : file;
  }

  async tryParseBuffer(buffer: string[]) {
    // console.log('parsing shell code', buffer.slice());
    try {
      // mvdan-sh `Parser.Interactive` expects terminal newline.
      const src = `${buffer.join("\n")}\n`;
      const { parsed } = await this.interactiveParse(src);

      return parsed === null
        ? ({ key: "incomplete" } as const)
        : ({ key: "complete", parsed, src } as const);
    } catch (e) {
      error(e);
      return { key: "failed" as "failed", error: `${(e as any).Error()}` };
    }
  }
}

export const parseService = new ParseShService();

/**
 * Create completely fresh tree but share internal refs as before.
 * In particular every node has the same `node.meta`.
 */
export function cloneParsed<T extends ParsedSh>(parsed: T): T {
  return cloneWithRefs(parsed);
}

export interface InteractiveParseResult {
  /**
   * `parser.Interactive` callback appears to
   * run synchronously. Permit null just in case.
   */
  incomplete: boolean | null;
  /** If `incomplete` is false, this is the cleaned parse. */
  parsed: null | FileWithMeta;
}

export type NamedFunction = {
  /** Function name. */
  key: string;
  /** The source code of the body of the function, e.g. `{ echo foo; }` */
  src: null | string;
  node: FileWithMeta;
};
