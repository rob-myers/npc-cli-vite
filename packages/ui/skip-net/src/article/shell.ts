import { type TokenKind, tokenizeShell } from "./shell-highlight";

/**
 * A new example starts at a blank line, or at a `#` comment following code — one at column 0,
 * an INDENTED comment being part of the command, e.g. inside a `while` body.
 * Leading `#` lines become the example's comment.
 */
export function splitExamples(blockKey: string, lines: string[]): Example[] {
  const chunks: { lines: string[]; blankBefore: number }[] = [];
  let chunk: string[] = [];
  let sawCode = false;
  /** Blank lines seen since the last chunk, so the preview can space them as the file does */
  let blankRun = 0;

  function flush() {
    if (chunk.some((x) => x.trim() !== "")) {
      // no leading gap for the first chunk, whose blanks merely follow the fence marker
      chunks.push({ lines: chunk, blankBefore: chunks.length === 0 ? 0 : blankRun });
      blankRun = 0;
    }
    chunk = [];
    sawCode = false;
  }

  for (const line of lines) {
    if (line.trim() === "") {
      flush();
      blankRun++;
      continue;
    }
    const isComment = line.startsWith("#");
    if (isComment === true && sawCode === true) {
      flush();
    }
    if (isComment === false) {
      sawCode = true;
    }
    chunk.push(line);
  }
  flush();

  return chunks.flatMap(({ lines: ls, blankBefore }, index) => {
    const at = ls.findIndex((x) => !x.startsWith("#"));
    const src = (at === -1 ? [] : ls.slice(at)).join("\n").trim();
    if (src === "") {
      return [];
    }
    const commentLines = at === -1 ? ls : ls.slice(0, at);
    return {
      id: `${blockKey}/${index}`,
      blankBefore,
      commentLines,
      src,
      args: parseArgTokens(src),
    };
  });
}

const keyRe = /([A-Za-z_][\w-]*):/g;
/** A line that is a comment, indented or not */
const commentLineRe = /^[ \t]*#.*$/gm;

/** `key:value` args e.g. `npc:rob`: literals only, and none inside a `#` comment line */
function parseArgTokens(src: string): ArgToken[] {
  const tokens: ArgToken[] = [];
  const comments = [...src.matchAll(commentLineRe)].map((m) => [m.index, m.index + m[0].length]);
  keyRe.lastIndex = 0;

  for (let match = keyRe.exec(src); match !== null; match = keyRe.exec(src)) {
    const keyStart = match.index;
    if (keyStart > 0 && /[^\s;|&(]/.test(src[keyStart - 1])) {
      continue; // must start a word
    }
    if (comments.some(([from, to]) => from <= keyStart && keyStart < to)) {
      continue; // commented out
    }
    const valueStart = keyStart + match[0].length;
    const valueEnd = readValueEnd(src, valueStart);
    keyRe.lastIndex = valueEnd; // skip nested `key:value` inside a subshell
    if (valueEnd === valueStart) {
      continue; // e.g. `{ foo: 42 }` is not an arg
    }
    if (src[valueStart] === "$" || src[valueStart] === "/") {
      continue;
    }
    tokens.push({ keyStart, valueStart, valueEnd });
  }

  return tokens;
}

/** Balanced parens and quotes, so `$( pick 1 )` is a single value */
function readValueEnd(src: string, from: number) {
  let depth = 0;
  let quote = "";
  let i = from;

  for (; i < src.length; i++) {
    const c = src[i];
    if (quote !== "") {
      if (c === quote) {
        quote = "";
      }
    } else if (c === "'" || c === '"') {
      quote = c;
    } else if (c === "(") {
      depth++;
    } else if (c === ")") {
      if (depth === 0) break;
      depth--;
    } else if (depth === 0 && /[\s;|&]/.test(c)) {
      break;
    }
  }

  return i;
}

/** Shell tokens of its source, further split by arg key and value */
export function toSegments(example: Example): SrcSegment[] {
  const { src } = example;
  const args = new Array<undefined | "key" | "value">(src.length);
  for (const { keyStart, valueStart, valueEnd } of example.args) {
    args.fill("key", keyStart, valueStart);
    args.fill("value", valueStart, valueEnd);
  }

  const segments: SrcSegment[] = [];
  for (const { start, end, kind } of tokenizeShell(src)) {
    let from = start;
    for (let i = start + 1; i <= end; i++) {
      if (i === end || args[i] !== args[from]) {
        segments.push({ text: src.slice(from, i), kind, arg: args[from] });
        from = i;
      }
    }
  }
  return segments;
}

export type Example = {
  /** `${blockKey}/${exampleIndex}` */
  id: string;
  /** Blank lines preceding it in the fence, which `ShellFence` spaces */
  blankBefore: number;
  /** Its leading `#` lines, verbatim */
  commentLines: string[];
  /** Verbatim source, newlines preserved */
  src: string;
  args: ArgToken[];
};

/** Where a `key:value` arg lies in its example's source */
export type ArgToken = {
  keyStart: number;
  valueStart: number;
  valueEnd: number;
};

export type SrcSegment = {
  text: string;
  kind: TokenKind;
  /** Set when inside a `key:value` arg */
  arg: undefined | "key" | "value";
};
