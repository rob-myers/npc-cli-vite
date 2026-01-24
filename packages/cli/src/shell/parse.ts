import type { JSh } from "@npc-cli/parse-sh";
import { convertMvdanShToJsh, parse as parseSh, withParents } from "@npc-cli/parse-sh";
import { error } from "@npc-cli/util/legacy/generic";
import cloneWithRefs from "lodash.clonedeep";

export class ParseShService {
  private cache: { [src: string]: JSh.FileWithMeta } = {};

  async interactiveParse(partialSrc: string): Promise<InteractiveParseResult> {
    const parsed = await parseSh(partialSrc, { interactive: true });
    if (parsed === null) {
      return { incomplete: true, parsed: null };
    } else {
      // Need to re-parse to convert to jsh
      return {
        incomplete: false,
        // 🚧 with cache saw incorrect `echo {a..e}` history `echo a b c d e`
        // parsed: await this.parse(partialSrc, true),
        parsed: await this.parse(partialSrc, false),
      };
    }
  }

  /** Use `mvdan-sh` to parse shell code. */
  async parse(src: string, cache = false): Promise<JSh.FileWithMeta> {
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
    try {
      // mvdan-sh `Parser.Interactive` expects terminal newline
      const src = `${buffer.join("\n")}\n`;
      const { parsed } = await this.interactiveParse(src);

      return parsed === null
        ? ({ key: "incomplete" } as const)
        : ({ key: "complete", parsed, src } as const);
    } catch (e) {
      error(e);
      return { key: "failed", error: `${(e as any).Error()}` } as const;
    }
  }
}

export const parseService = new ParseShService();

/**
 * Create completely fresh tree but share internal refs as before.
 * In particular every node has the same `node.meta`.
 */
export function cloneParsed<T extends JSh.ParsedSh>(parsed: T): T {
  return cloneWithRefs(parsed);
}

export type InteractiveParseResult = {
  incomplete: boolean;
  parsed: null | JSh.FileWithMeta;
};

export type NamedFunction = {
  /** Function name. */
  key: string;
  /** The source code of the body of the function, e.g. `{ echo foo; }` */
  src: null | string;
  node: JSh.FileWithMeta;
};
