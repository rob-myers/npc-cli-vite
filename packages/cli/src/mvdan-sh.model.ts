import z from "zod";
import { jsonParser } from "../../util/src/json-parser";

export const ParseResultSchema = jsonParser.pipe(
  z.object({
    // 🚧 extend
    file: z.looseObject({
      Type: z.literal("File"), // added into structs.go
      Name: z.string(),
    }),
    text: z.string(),
    parseError: z
      .object({
        Filename: z.string().optional(),
        Incomplete: z.boolean(),
        Text: z.string(),
        Pos: z.unknown().optional(),
      })
      .nullish(),
    message: z.string(),
  }),
);

export type LangVariant = (typeof LangVariant)[keyof typeof LangVariant];

export const LangVariant = {
  /**
   * LangBash corresponds to the GNU Bash language, as described in its manual
   * at https://www.gnu.org/software/bash/manual/bash.html.
   *
   * We currently follow Bash version 5.2.
   *
   * Its string representation is "bash".
   */
  LangBash: 0,
  /**
   * LangPOSIX corresponds to the POSIX Shell language, as described at
   * https://pubs.opengroup.org/onlinepubs/9699919799/utilities/V3_chap02.html.
   *
   * Its string representation is "posix" or "sh".
   */
  LangPOSIX: 1,
  /**
   * LangMirBSDKorn corresponds to the MirBSD Korn Shell, also known as mksh, as
   * described at http://www.mirbsd.org/htman/i386/man1/mksh.htm. Note that it
   * shares some features with Bash, due to the shared ancestry that is ksh.
   *
   * We currently follow mksh version 59.
   *
   * Its string representation is "mksh".
   */
  LangMirBSDKorn: 2,
  /**
   * LangBats corresponds to the Bash Automated Testing System language, as
   * described at https://github.com/bats-core/bats-core. Note that it's just a
   * small extension of the Bash language.
   *
   * Its string representation is "bats".
   */
  LangBats: 3,
  /**
   * LangAuto corresponds to automatic language detection, commonly used by
   * end-user applications like shfmt, which can guess a file's language variant
   * given its filename or shebang.
   *
   * At this time, [Variant] does not support LangAuto.
   */
  LangAuto: 4,
} as const;

export interface ShParserOptions {
  /**
   * KeepComments makes the parser parse comments and attach them to nodes, as
   * opposed to discarding them.
   */
  keepComments?: boolean;
  /**
   * LangVariant describes a shell language variant to use when tokenizing and
   * parsing shell code. The zero value is [LangBash].
   */
  variant?: LangVariant;
  /**
   * StopAt configures the lexer to stop at an arbitrary word, treating it as if
   * it were the end of the input. It can contain any characters except
   * whitespace, and cannot be over four bytes in size.
   *
   * This can be useful to embed shell code within another language, as one can
   * use a special word to mark the delimiters between the two.
   *
   * As a word, it will only apply when following whitespace or a separating
   * token. For example, StopAt("$$") will act on the inputs "foo $$" and
   * "foo;$$", but not on "foo '$$'".
   *
   * The match is done by prefix, so the example above will also act on "foo
   * $$bar".
   */
  stopAt?: string;
  /**
   * RecoverErrors allows the parser to skip up to a maximum number of errors in
   * the given input on a best-effort basis. This can be useful to tab-complete
   * an interactive shell prompt, or when providing diagnostics on slightly
   * incomplete shell source.
   *
   * Currently, this only helps with mandatory tokens from the shell grammar
   * which are not present in the input. They result in position fields or nodes
   * whose position report [Pos.IsRecovered] as true.
   *
   * For example, given the input
   *
   *     (foo |
   *
   * The result will contain two recovered positions; first, the pipe requires a
   * statement to follow, and as [Stmt.Pos] reports, the entire node is
   * recovered. Second, the subshell needs to be closed, so [Subshell.Rparen] is
   * recovered.
   */
  recoverErrors?: number;
}

export interface ShOptions extends ShParserOptions {
  filepath?: string;
  interactive?: boolean;
}

export interface IParseError {
  Filename?: string;
  Incomplete: boolean;
  Text: string;
  Pos?: Pos;
}

// 🚧 transform types from npc-cli-next

/**
 * Pos is a position within a shell source file.
 */
type Pos = {
  type: "Pos";
  /**
   * After reports whether this position p is after p2. It is a more expressive version of p.Offset() > p2.Offset().
   */
  // After(p2: Pos): boolean;
  /**
   * Col returns the column number of the position, starting at 1. It counts in bytes.
   */
  Col: number;
  /**
   * IsValid reports whether the position is valid. All positions in nodes returned by Parse are valid.
   */
  IsValid: boolean;
  /**
   * Line returns the line number of the position, starting at 1.
   */
  Line: number;
  /**
   * Offset returns the byte offset of the position in the original source file. Byte offsets start at 0.
   */
  Offset: number;
  String: string;
};
