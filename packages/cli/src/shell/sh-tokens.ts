/**
 * A small shell tokenizer, for highlighting example commands.
 * Emitted tokens cover every character, in order.
 */

import { tokenize } from "sugar-high";

export function tokenizeShell(src: string): ShellToken[] {
  const tokens: ShellToken[] = [];
  /** Is the next word a command name? */
  let expectCommand = true;
  /** The current command's name, if it has begun */
  let command: null | string = null;
  /** The index of the command's next operand */
  let nextOperand = 0;
  /** The enclosing commands of each open `$(` */
  const outer: { command: null | string; nextOperand: number }[] = [];
  let i = 0;

  /** Does the word at `at` begin a new shell word? */
  function beginsWord(at: number) {
    return at === 0 || /[\s|&;()<>{}]/.test(src[at - 1]);
  }

  function push(start: number, end: number, kind: TokenKind) {
    if (end > start) {
      tokens.push({ start, end, kind });
    }
  }

  /** Counts a word beginning at `at` as the command's next operand */
  function countOperand(at: number) {
    if (command !== null && beginsWord(at) === true) nextOperand++;
  }

  /** Is the quoted string at `at` a javascript arg of its command? */
  function isJsArg(at: number) {
    const spec = command === null ? undefined : jsArgs[command];
    if (spec === undefined) {
      return false;
    }
    if (beginsWord(at) === false) {
      // e.g. `where:'e => e.key'`
      const key = keyBeforeRe.exec(src.slice(0, at))?.[1];
      return key !== undefined && spec.keys?.includes(key) === true;
    }
    return nextOperand >= spec.from && nextOperand <= (spec.to ?? spec.from);
  }

  /** Pushes javascript `code` starting at `from` */
  function pushJs(from: number, code: string) {
    for (const [type, value] of tokenize(code)) {
      push(from, from + value.length, jsTokenKinds[type] ?? "text");
      from += value.length;
    }
  }

  while (i < src.length) {
    const c = src[i];
    const start = i;

    if (/\s/.test(c)) {
      while (i < src.length && /\s/.test(src[i])) i++;
      if (src.slice(start, i).includes("\n")) {
        expectCommand = true;
        command = null;
      }
      push(start, i, "text");
      continue;
    }

    if (c === "#") {
      while (i < src.length && src[i] !== "\n") i++;
      push(start, i, "comment");
      continue;
    }

    if (c === "'" || c === '"') {
      for (i++; i < src.length && src[i] !== c; i++) {
        if (src[i] === "\\") i++;
      }
      const close = Math.min(i, src.length);
      i = Math.min(i + 1, src.length);
      const inner = src.slice(start + 1, close);
      const isJs = isJsArg(start);
      countOperand(start);
      // a double-quoted `$` is a shell expansion, so not javascript
      if (isJs === true && (c === "'" || inner.includes("$") === false)) {
        push(start, start + 1, "string");
        pushJs(start + 1, inner);
        push(close, i, "string");
      } else {
        push(start, i, "string");
      }
      continue;
    }

    if (c === "$") {
      i++;
      countOperand(start);
      if (src[i] === "(") {
        // a subshell, whose first word is a command
        outer.push({ command, nextOperand });
        i++;
        push(start, i, "operator");
        expectCommand = true;
        command = null;
      } else if (src[i] === "{") {
        while (i < src.length && src[i] !== "}") i++;
        i = Math.min(i + 1, src.length);
        push(start, i, "variable");
      } else {
        while (i < src.length && /[\w?@*!#]/.test(src[i])) i++;
        push(start, i, "variable");
      }
      continue;
    }

    if (operatorChars.includes(c)) {
      while (i < src.length && operatorChars.includes(src[i])) i++;
      push(start, i, "operator");
      const last = src[i - 1];
      // closers and redirects are not followed by a command,
      // and `{` may instead begin a brace expansion e.g. `{1..5}`
      expectCommand = "|&;(!{".includes(last) && !(last === "{" && /\S/.test(src[i] ?? ""));
      for (const x of src.slice(start, i)) {
        if (x === ")" && outer.length > 0) {
          ({ command, nextOperand } = outer.pop() as (typeof outer)[number]);
        } else if ("|&;(".includes(x)) {
          command = null;
        }
      }
      continue;
    }

    while (i < src.length && !/[\s|&;()<>{}'"$]/.test(src[i])) i++;
    const word = src.slice(start, i);

    const assign = word.match(/^([A-Za-z_]\w*)(\+?=)/);
    if (assign !== null) {
      const [, name, sign] = assign;
      push(start, start + name.length, "variable");
      push(start + name.length, start + name.length + sign.length, "operator");
      const rest = start + name.length + sign.length;
      push(rest, i, numberRe.test(src.slice(rest, i)) ? "number" : "text");
      expectCommand = false;
    } else if (keywords.has(word) && command === null) {
      push(start, i, "keyword");
      expectCommand = commandFollows.has(word);
    } else if (numberRe.test(word)) {
      push(start, i, "number");
      countOperand(start);
    } else if (word.startsWith("-")) {
      push(start, i, "flag");
    } else if (expectCommand === true) {
      push(start, i, "command");
      expectCommand = false;
      command = word;
      nextOperand = 0;
    } else {
      push(start, i, "text");
      if (keyArgRe.test(word) === false) countOperand(start);
    }
  }

  return tokens;
}

/** Which operands of a command are javascript: `from` to `to`, else `from` alone. Also its javascript `key:` args */
const jsArgs: Record<string, { from: number; to?: number; keys?: string[] }> = {
  call: { from: 0 },
  events: { from: 0, keys: ["where"] },
  expr: { from: 0, to: Infinity },
  filter: { from: 0 },
  flatMap: { from: 0 },
  map: { from: 0 },
  mapBasic: { from: 0 },
  pick: { from: 0, keys: ["as"] },
  reduce: { from: 0, to: 1 },
  w: { from: 1, to: Infinity },
};

/** A `key:` word, whose value is not an operand */
const keyArgRe = /^[A-Za-z_][\w-]*:/;
/** A `key:` word ending a source prefix */
const keyBeforeRe = /(?:^|[\s|&;()])([A-Za-z_][\w-]*):$/;

/** By sugar-high's token type */
const jsTokenKinds: TokenKind[] = [
  "variable", // identifier
  "keyword",
  "string",
  "number", // class, number, null
  "text", // property
  "command", // entity
  "text", // jsx literal
  "operator", // sign
  "comment",
  "text", // break
  "text", // space
];

const operatorChars = "|&;()<>{}!";
const numberRe = /^-?\d+(\.\d+)?$/;

const keywords = new Set([
  "case",
  "do",
  "done",
  "elif",
  "else",
  "esac",
  "fi",
  "for",
  "function",
  "if",
  "in",
  "local",
  "select",
  "then",
  "until",
  "while",
]);

/** Keywords directly followed by a command */
const commandFollows = new Set(["do", "elif", "else", "if", "then", "until", "while"]);

export type TokenKind =
  | "command"
  | "comment"
  | "flag"
  | "keyword"
  | "number"
  | "operator"
  | "string"
  | "text"
  | "variable";

export type ShellToken = {
  start: number;
  end: number;
  kind: TokenKind;
};

/** Muted, so the block reads as grey with only a hint of hue */
export const tokenCss: Record<TokenKind, string> = {
  command: "text-sh-command",
  comment: "text-sh-comment",
  flag: "text-sh-flag",
  keyword: "text-sh-keyword",
  number: "text-sh-number",
  operator: "text-sh-operator",
  string: "text-sh-string",
  text: "text-sh-text",
  variable: "text-sh-variable",
};
