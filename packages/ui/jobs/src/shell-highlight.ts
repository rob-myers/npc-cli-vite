/**
 * A small shell tokenizer, for highlighting example commands.
 * Emitted tokens cover every character, in order.
 */

export function tokenizeShell(src: string): ShellToken[] {
  const tokens: ShellToken[] = [];
  /** Is the next word a command name? */
  let expectCommand = true;
  let i = 0;

  function push(start: number, end: number, kind: TokenKind) {
    if (end > start) {
      tokens.push({ start, end, kind });
    }
  }

  while (i < src.length) {
    const c = src[i];
    const start = i;

    if (/\s/.test(c)) {
      while (i < src.length && /\s/.test(src[i])) i++;
      if (src.slice(start, i).includes("\n")) {
        expectCommand = true;
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
      push(start, Math.min(i + 1, src.length), "string");
      i = Math.min(i + 1, src.length);
      continue;
    }

    if (c === "$") {
      i++;
      if (src[i] === "(") {
        // a subshell, whose first word is a command
        i++;
        push(start, i, "operator");
        expectCommand = true;
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
    } else if (keywords.has(word)) {
      push(start, i, "keyword");
      expectCommand = commandFollows.has(word);
    } else if (numberRe.test(word)) {
      push(start, i, "number");
    } else if (word.startsWith("-")) {
      push(start, i, "flag");
    } else if (expectCommand === true) {
      push(start, i, "command");
      expectCommand = false;
    } else {
      push(start, i, "text");
    }
  }

  return tokens;
}

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
