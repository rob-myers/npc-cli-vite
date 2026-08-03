/**
 * Example commands, provided via `./examples/*.md`.
 * One file per category, one `#` heading per section.
 */
import bundledExamples from "virtual:jobs-examples";
import { jobsExamplesApiPath } from "./const";
import { type TokenKind, tokenizeShell } from "./shell-highlight";

export const jobsLibraryQueryKey = ["jobs-library"];

/**
 * Markdown keyed by filename. Fetched during development, so that
 * adding or renaming a file need not trigger a full reload.
 */
export async function loadExamples(): Promise<Record<string, string>> {
  if (import.meta.env.DEV !== true) {
    return bundledExamples;
  }
  const response = await fetch(jobsExamplesApiPath);
  if (response.ok === false) {
    throw Error(`${jobsExamplesApiPath}: responded ${response.status}`);
  }
  return await response.json();
}

/** Tab order; unlisted files follow, alphabetically */
const categoryOrder = ["core", "shell"];

export function parseCategories(byPath: Record<string, string>): ExampleCategory[] {
  return Object.entries(byPath)
    .map(([path, md]) => {
      const key = path.replace(/^.*\//, "").replace(/\.md$/, "");
      return { key, label: key.replace(/[-_]/g, " "), sections: parseSections(key, md) };
    })
    .filter((x) => x.sections.length > 0)
    .sort((a, b) => rank(a.key) - rank(b.key) || (a.key < b.key ? -1 : 1));
}

function rank(key: string) {
  return categoryOrder.indexOf(key) + 1 || Number.POSITIVE_INFINITY;
}

function parseSections(categoryKey: string, md: string): ExampleSection[] {
  const sections: ExampleSection[] = [];
  let current: null | { title: string; prose: string[]; lines: string[] } = null;
  let mode: "idle" | "prose" | "fence" = "idle";
  /** Is the current fence one we take examples from? */
  let collecting = false;

  function flushSection() {
    if (current === null) {
      return;
    }
    const key = `${categoryKey}/${sections.length}`;
    const examples = splitExamples(key, current.lines);
    if (examples.length > 0) {
      sections.push({
        key,
        title: current.title,
        prose: current.prose.join(" ").replace(/\s+/g, " ").trim(),
        examples,
      });
    }
    current = null;
  }

  for (const line of md.split(/\r?\n/)) {
    const trimmed = line.trimStart();

    if (mode === "fence") {
      if (trimmed.startsWith("```")) {
        mode = "idle";
        collecting = false;
      } else if (collecting === true) {
        current?.lines.push(line);
      }
      continue;
    }

    if (mode === "prose") {
      const end = line.indexOf("-->");
      current?.prose.push(end === -1 ? line : line.slice(0, end));
      if (end !== -1) {
        mode = "idle";
      }
      continue;
    }

    if (line.startsWith("# ")) {
      flushSection();
      current = { title: line.slice(2).trim(), prose: [], lines: [] };
    } else if (trimmed.startsWith("<!--")) {
      const body = trimmed.slice(4);
      const end = body.indexOf("-->");
      current?.prose.push(end === -1 ? body : body.slice(0, end));
      mode = end === -1 ? "prose" : "idle";
    } else if (trimmed.startsWith("```")) {
      const info = trimmed.slice(3).trim();
      mode = "fence";
      collecting = info === "" || info === "sh" || info === "bash";
    }
  }

  flushSection();
  return sections;
}

/**
 * A new example starts at a blank line, or at a `#` comment following code.
 * Leading `#` lines become the example's comment.
 */
function splitExamples(sectionKey: string, lines: string[]): Example[] {
  const chunks: string[][] = [];
  let chunk: string[] = [];
  let sawCode = false;

  function flush() {
    if (chunk.some((x) => x.trim() !== "")) {
      chunks.push(chunk);
    }
    chunk = [];
    sawCode = false;
  }

  for (const line of lines) {
    if (line.trim() === "") {
      flush();
      continue;
    }
    const isComment = line.trimStart().startsWith("#");
    if (isComment === true && sawCode === true) {
      flush();
    }
    if (isComment === false) {
      sawCode = true;
    }
    chunk.push(line);
  }
  flush();

  return chunks.flatMap((ls, index) => {
    const at = ls.findIndex((x) => !x.trimStart().startsWith("#"));
    const src = (at === -1 ? [] : ls.slice(at)).join("\n").trim();
    if (src === "") {
      return [];
    }
    return {
      id: `${sectionKey}/${index}`,
      comment: (at === -1 ? ls : ls.slice(0, at)).map((x) => x.replace(/^\s*#\s?/, "")).join(" "),
      src,
      args: parseArgTokens(src),
    };
  });
}

const keyRe = /([A-Za-z_][\w-]*):/g;

/** Editable `key:value` args e.g. `npc:rob`, `at:$( pick 1 )` */
export function parseArgTokens(src: string): ArgToken[] {
  const tokens: ArgToken[] = [];
  keyRe.lastIndex = 0;

  for (let match = keyRe.exec(src); match !== null; match = keyRe.exec(src)) {
    const keyStart = match.index;
    if (keyStart > 0 && /[^\s;|&(]/.test(src[keyStart - 1])) {
      continue; // must start a word
    }
    const valueStart = keyStart + match[0].length;
    const valueEnd = readValueEnd(src, valueStart);
    keyRe.lastIndex = valueEnd; // skip nested `key:value` inside a subshell
    if (valueEnd === valueStart) {
      continue; // e.g. `{ foo: 42 }` is not an arg
    }
    tokens.push({ key: match[1], value: src.slice(valueStart, valueEnd), keyStart, valueStart, valueEnd });
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

export function getEditKey(example: Example, index: number) {
  return `${example.id}#${index}`;
}

/** Rebuild `src` with `edits` applied, tracking where each arg landed */
function toEditedSource(example: Example, edits: Record<string, string>) {
  const ranges: { keyStart: number; valueStart: number; valueEnd: number }[] = [];
  let src = "";
  let i = 0;

  example.args.forEach((token, index) => {
    src += example.src.slice(i, token.keyStart);
    const keyStart = src.length;
    src += `${token.key}:`;
    const valueStart = src.length;
    src += edits[getEditKey(example, index)] ?? token.value;
    ranges.push({ keyStart, valueStart, valueEnd: src.length });
    i = token.valueEnd;
  });

  return { src: src + example.src.slice(i), ranges };
}

export function toEditedSrc(example: Example, edits: Record<string, string>) {
  return toEditedSource(example, edits).src;
}

/** Shell tokens of the edited source, further split by arg key/value */
export function toSegments(example: Example, edits: Record<string, string>): SrcSegment[] {
  const { src, ranges } = toEditedSource(example, edits);

  const args = new Array<undefined | "key" | "value">(src.length);
  for (const { keyStart, valueStart, valueEnd } of ranges) {
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

export type ExampleCategory = {
  key: string;
  label: string;
  sections: ExampleSection[];
};

export type ExampleSection = {
  /** `${categoryKey}/${sectionIndex}` */
  key: string;
  title: string;
  /** From an html comment following the heading */
  prose: string;
  examples: Example[];
};

export type Example = {
  /** `${categoryKey}/${sectionIndex}/${exampleIndex}` */
  id: string;
  /** Leading `#` lines, joined */
  comment: string;
  /** Verbatim source, newlines preserved */
  src: string;
  args: ArgToken[];
};

export type ArgToken = {
  key: string;
  value: string;
  keyStart: number;
  valueStart: number;
  valueEnd: number;
};

export type SrcSegment = {
  text: string;
  kind: TokenKind;
  /** Set when inside an editable `key:value` arg */
  arg: undefined | "key" | "value";
};
