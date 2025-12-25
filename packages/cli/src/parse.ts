import { convertMvdanShToJsh, parse as parseSh, withParents } from "@npc-cli/parse-sh";
import cloneWithRefs from "lodash.clonedeep";
import type { FileWithMeta, ParsedSh } from "./types";

export class ParseShService {
  private cache: { [src: string]: FileWithMeta } = {};

  /**
   * Use `mvdan-sh` to parse shell code.
   */
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
}

export const parseService = new ParseShService();

/**
 * Clone creates completely fresh tree, sharing internal refs as before.
 * In particular every node has the same `node.meta`
 */
export function cloneParsed<T extends ParsedSh>(parsed: T): T {
  return cloneWithRefs(parsed);
}
