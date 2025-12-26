import { parseJsonArg } from "@npc-cli/util/legacy/generic";
import { ansi } from "./const";
import type { TtyLinkCtxt } from "./session";
import { stripAnsi } from "./util";

/**
 * Used by builtin `choice`.
 * - We'll compute text `textForTty` where each `[ foo ](bar)` is replaced by `[ foo ]`.
 * - The relationship between `foo` and `bar` is stored in a `TtyLinkCtxt`.
 * - We need `sessionKey` for special actions e.g. `href:#somewhere else`.
 */
export function computeChoiceTtyLinkFactory(text: string): {
  ttyText: string;
  /** `ttyText` with ansi colours stripped */
  ttyTextKey: string;
  linkCtxtsFactory?(resolve: (v: any) => void): TtyLinkCtxt[];
} {
  /**
   * - `match[1]` is either empty or the escape character (to support ansi special chars)
   * - `match[2]` is the link label e.g. "[ foo ]"
   * - `match[3]` is the link value e.g. "bar" (string 'bar') or "2" (number 2)
   */
  // const mdLinksRegex = /(^|[^\x1b])\[([^()]+?)\]\((.*?)\)/g;

  // biome-ignore lint/suspicious/noControlCharactersInRegex: <explanation>
  const mdLinksRegex = /(^|[^\x1b])\[ ([^()]+?) \]\((.*?)\)/g;
  const matches = Array.from(text.matchAll(mdLinksRegex));
  const boundaries = matches.flatMap((match) => [
    match.index! + match[1].length,
    match.index! + match[0].length,
  ]);
  // Ensure `boundaries` starts with `0`.
  // If added it then links occur at odd indices of `parts` (else even indices)
  const addedZero = boundaries[0] === 0 ? 0 : boundaries.unshift(0) && 1;
  const parts = boundaries
    .map((textIndex, i) => text.slice(textIndex, boundaries[i + 1] ?? text.length))
    .map((part, i) =>
      addedZero === i % 2
        ? formatLink(part.slice(1, part.indexOf("(") - 1))
        : `${ansi.White}${part}${ansi.Reset}`,
    );
  const ttyText = parts.join("");
  const ttyTextKey = stripAnsi(ttyText);

  if (matches.length > 0) {
    return {
      linkCtxtsFactory: (resolve: (value: any) => void): TtyLinkCtxt[] =>
        matches.map((match, i) => ({
          lineText: ttyTextKey,
          linkText: stripAnsi(match[2]),

          // 1 + ensures we're inside the square brackets:
          linkStartIndex: 1 + stripAnsi(parts.slice(0, 2 * i + addedZero).join("")).length,

          callback() {
            let value = /** @type {undefined | string} */ (undefined);

            if (match[3] === "") {
              // links [ foo ]() has value `JSON.parse("foo")` or `"foo"`
              // e.g. `choice '[ '{1..10}' ]()'` has 10 choices and outputs numbers 1 to 10
              value = parseJsonArg(match[2]);
            } else if (match[3] === "-") {
              // links [ foo ](-) has value `undefined` (nothing emitted)
              // e.g. "[ click to continue ](-)"
              value = undefined;
            } else {
              // links [ foo ](bar) have value `JSON.parse("bar")` or `"bar"`
              // e.g. `choice '[ foo ]( [{"bar":"baz"}] )'`
              // 🔔 parseJsArg would convert e.g. stop -> `window.stop`
              value = parseJsonArg(match[3]);
            }

            // 🤔 support special actions
            // if (typeof value === "string") {
            //   if (value.startsWith("href:")) {
            //     // `"href:{navigable}"`
            //     // location.href = value.slice("href:".length);
            //     navigate(value.slice("href:".length));
            //     return;
            //   }
            // }
            resolve(value);
          },

          // 🤔 `choice` could support refresh e.g. links change on pause
          // refresh() {},
        })),
      ttyText,
      ttyTextKey,
    };
  } else {
    return {
      ttyText,
      ttyTextKey,
    };
  }
}

/**
 * `linkText` is the entire text inside the square braces.
 */
export function formatLink(linkText: string) {
  return `${ansi.Reset}[${ansi.Bold}${ansi.White}${linkText}${ansi.Reset}]`;
  // return `${ansi.Reset}${ansi.DarkGreyBg}[${ansi.Bold}${linkText}${ansi.BoldReset}]${ansi.Reset}`;
}
