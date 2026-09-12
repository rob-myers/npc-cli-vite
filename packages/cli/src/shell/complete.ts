import { computeNormalizedParts, resolveNormalized } from "./util";

/**
 * Tab completion: a pure function of the input line, the cursor, and what the session knows.
 * The shell answers `req-completion` with it — see `TtyShell.onMessage` — and it is switched off
 * by the shell variable `COMPLETE` being `false` or `"0"`.
 */
export function complete(input: string, cursor: number, ctxt: CompletionContext): Completion {
  const { start, word, isCommand } = wordAt(input, cursor);
  // a bare path is a command too: `PWD` in `/home`, or `~/PWD` anywhere, is a `get`. With nothing
  // typed every command would match, and the listing is the directory alone — see `commandsOmitted`
  const commandsOmitted = isCommand === true && word === "";
  const paths = completePath(word, ctxt);
  const candidates = [
    ...(isCommand === true && commandsOmitted === false ? completeCommand(word, ctxt) : []),
    ...paths.map((x) => x.text),
  ];

  candidates.sort();
  if (candidates.length === 0) {
    return { input, cursor, candidates, commandsOmitted };
  }
  // one match is taken whole, with a space after a command or a leaf — not a directory, which is
  // left for a `/` to go on into; several give their common prefix
  const replacement =
    candidates.length === 1
      ? paths.some((x) => x.text === candidates[0] && x.isDir === true)
        ? candidates[0]
        : `${candidates[0]} `
      : commonPrefix(candidates);
  return {
    input: input.slice(0, start) + replacement + input.slice(cursor),
    cursor: start + replacement.length,
    candidates,
    commandsOmitted,
  };
}

/**
 * The word under the cursor: the run of non-whitespace before it. It is a command when nothing
 * but whitespace precedes it since the start of the line, or the last `;`, `|`, `&`, `(` or
 * newline. Quoting is not understood: this is a first version
 */
function wordAt(input: string, cursor: number) {
  const before = input.slice(0, cursor);
  const start = before.search(/\S*$/);
  const word = before.slice(start);
  const isCommand = /(^|[;|&(\n])\s*$/.test(before.slice(0, start));
  return { start, word, isCommand };
}

function completeCommand(word: string, ctxt: CompletionContext) {
  return [...new Set(ctxt.commands)].filter((x) => x.startsWith(word));
}

/** A path splits at its last `/` into the directory to list and the prefix to match within it */
function completePath(word: string, ctxt: CompletionContext) {
  const split = word.lastIndexOf("/") + 1;
  const [dir, base] = [word.slice(0, split), word.slice(split)];
  let dirObj: unknown;
  try {
    dirObj = resolveNormalized(computeNormalizedParts(dir || ".", ctxt.pwd), ctxt.root);
  } catch {
    return []; // no such directory
  }
  if (dirObj === null || typeof dirObj !== "object") {
    return [];
  }
  return Object.entries(dirObj)
    .filter(([key]) => key.startsWith(base))
    .map(([key, value]) => ({ text: `${dir}${key}`, isDir: value !== null && typeof value === "object" }));
}

function commonPrefix(words: string[]) {
  let prefix = words[0];
  for (const word of words) {
    while (word.startsWith(prefix) === false) prefix = prefix.slice(0, -1);
  }
  return prefix;
}

export type CompletionContext = {
  /** Builtins and shell functions */
  commands: string[];
  /** The virtual filesystem's root e.g. `{ home, etc, shared, lib }` */
  root: Record<string, any>;
  pwd: string;
};

export type Completion = {
  /** `input` with the word under the cursor replaced, and the cursor after it */
  input: string;
  cursor: number;
  /** Every match — more than one means the replacement was only their common prefix */
  candidates: string[];
  /** Whether the commands were left out of an empty word's matches, so a listing can say where they are */
  commandsOmitted: boolean;
};
