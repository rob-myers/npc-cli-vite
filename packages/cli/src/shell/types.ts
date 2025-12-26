import type { MvdanSh } from "@npc-cli/parse-sh";

export interface BaseMeta {
  sessionKey: string;
  pid: number;
  ppid: number;
  pgid: number;
  fd: Record<number, string>;
  stack: string[];
  /**
   * Is this a background process?
   * This should be inherited.
   */
  background?: boolean;
  /** Log extra info? */
  verbose?: boolean;
}

export interface Expanded {
  key: "expanded";
  values: any[];
  /** This is values.join(' ') */
  value: string;
}

export type FifoStatus = "Initial" | "Connected" | "Disconnected";

export interface FileWithMeta extends File {
  meta: BaseMeta;
}

//#region model

/** Our notion of position, as opposed to `MvdanSh.Pos`. */
export interface Pos {
  Line: number;
  Col: number;
  Offset: number;
}

/** Our notion of base node, as opposed to `MvdanSh.BaseNode`. */
export interface BaseNode {
  /** Single instance for entire parse tree */
  meta: BaseMeta;
  /** Reference to parent node  */
  parent: null | ParsedSh;
  /** Used for expansion */
  string?: string;
  /** Used to calculate actual exit codes */
  exitCode?: number;
}

export type ParsedSh =
  | ArithmCmd
  | ArithmExp
  | ArrayElem
  | ArithmExpr
  | ArrayExpr
  | Assign
  | BinaryArithm
  | BinaryCmd
  | BinaryTest
  | Block
  | CallExpr
  | CaseClause
  | CaseItem
  | CmdSubst
  | Comment
  | CStyleLoop
  | Command
  | CoprocClause
  | DblQuoted
  | DeclClause
  | ExtGlob
  | File
  | ForClause
  | FuncDecl
  | IfClause
  | LetClause
  | Lit
  | Loop
  | ParamExp
  | ParenArithm
  | ParenTest
  | ProcSubst
  | Redirect
  | SglQuoted
  | Stmt
  | Subshell
  | TestClause
  | TimeClause
  | TestExpr
  | UnaryArithm
  | UnaryTest
  | WhileClause
  | Word
  | WordIter
  | WordPart;

export type ExpandType =
  | ArithmExpr
  | Word // i.e. parts
  | Exclude<WordPart, ArithmExp>;

export type ArithmCmd = MvdanSh.ArithmCmdGeneric<BaseNode, Pos, string>;
export type ArithmExp = MvdanSh.ArithmExpGeneric<BaseNode, Pos, string>;
export type ArrayElem = MvdanSh.ArrayElemGeneric<BaseNode, Pos, string>;
export type ArithmExpr = BinaryArithm | UnaryArithm | ParenArithm | Word;
export type ArrayExpr = MvdanSh.ArrayExprGeneric<BaseNode, Pos, string>;
export type Assign = MvdanSh.AssignGeneric<BaseNode, Pos, string>;

export type BinaryArithm = MvdanSh.BinaryArithmGeneric<BaseNode, Pos, string>;
export type BinaryCmd = MvdanSh.BinaryCmdGeneric<BaseNode, Pos, string>;
export type BinaryTest = MvdanSh.BinaryTestGeneric<BaseNode, Pos, string>;
export type Block = MvdanSh.BlockGeneric<BaseNode, Pos, string>;
export type CallExpr = MvdanSh.CallExprGeneric<BaseNode, Pos, string>;
export type CaseClause = MvdanSh.CaseClauseGeneric<BaseNode, Pos, string>;
export type CaseItem = MvdanSh.CaseItemGeneric<BaseNode, Pos, string>;
export type CmdSubst = MvdanSh.CmdSubstGeneric<BaseNode, Pos, string>;
export type Comment = MvdanSh.CommentGeneric<BaseNode, Pos, string>;
export type CStyleLoop = MvdanSh.CStyleLoopGeneric<BaseNode, Pos, string>;
export type Command =
  | CallExpr
  | IfClause
  | WhileClause
  | ForClause
  | CaseClause
  | Block
  | Subshell
  | BinaryCmd
  | FuncDecl
  | ArithmCmd
  | TestClause
  | DeclClause
  | LetClause
  | TimeClause
  | CoprocClause;
export type CoprocClause = MvdanSh.CoprocClauseGeneric<BaseNode, Pos, string>;
export type DblQuoted = MvdanSh.DblQuotedGeneric<BaseNode, Pos, string>;
/** syntax.LangBash only */
export type DeclClause = MvdanSh.DeclClauseGeneric<BaseNode, Pos, string>;
export type ExtGlob = MvdanSh.ExtGlobGeneric<BaseNode, Pos, string>;
export type File = MvdanSh.FileGeneric<BaseNode, Pos, string> & BaseNode;
export type ForClause = MvdanSh.ForClauseGeneric<BaseNode, Pos, string>;
export type FuncDecl = MvdanSh.FuncDeclGeneric<BaseNode, Pos, string>;
export type IfClause = MvdanSh.IfClauseGeneric<BaseNode, Pos, string>;
export type LetClause = MvdanSh.LetClauseGeneric<BaseNode, Pos, string>;
export type Lit<Values extends string = string> = MvdanSh.LitGeneric<BaseNode, Pos, number, Values>;
export type Loop = WordIter | CStyleLoop;
export type ParamExp = MvdanSh.ParamExpGeneric<BaseNode, Pos, string>;
export type ParenArithm = MvdanSh.ParenArithmGeneric<BaseNode, Pos, string>;
export type ParenTest = MvdanSh.ParenTestGeneric<BaseNode, Pos, string>;
export type ProcSubst = MvdanSh.ProcSubstGeneric<BaseNode, Pos, string>;
export type Redirect = MvdanSh.RedirectGeneric<BaseNode, Pos, string>;
export type SglQuoted = MvdanSh.SglQuotedGeneric<BaseNode, Pos, string>;
export type Stmt = MvdanSh.StmtGeneric<BaseNode, Pos, string>;
export type Subshell = MvdanSh.SubshellGeneric<BaseNode, Pos, string>;
export type TestClause = MvdanSh.TestClauseGeneric<BaseNode, Pos, string>;
export type TimeClause = MvdanSh.TimeClauseGeneric<BaseNode, Pos, string>;
export type TestExpr = BinaryTest | UnaryTest | ParenTest | Word;
export type UnaryArithm = MvdanSh.UnaryArithmGeneric<BaseNode, Pos, string>;
export type UnaryTest = MvdanSh.UnaryTestGeneric<BaseNode, Pos, string>;
export type WhileClause = MvdanSh.WhileClauseGeneric<BaseNode, Pos, string>;
export type Word = MvdanSh.WordGeneric<BaseNode, Pos, string>;
export type WordIter = MvdanSh.WordIterGeneric<BaseNode, Pos, string>;
export type WordPart =
  | Lit
  | SglQuoted
  | DblQuoted
  | ParamExp
  | CmdSubst
  | ArithmExp
  | ProcSubst
  | ExtGlob;

export interface InteractiveParseResult {
  /**
   * `parser.Interactive` callback appears to
   * run synchronously. Permit null just in case.
   */
  incomplete: boolean | null;
  /** If `incomplete` is false, this is the cleaned parse. */
  parsed: null | FileWithMeta;
}

export interface FileWithMeta extends File {
  meta: BaseMeta;
}

/**
 * `mvdan-sh` receives a string and outputs a parse tree.
 * We transform it into our own format in `parse.service`.
 * Each node in our parse tree has a `meta` (see `BaseNode`).
 * By default they share the same reference, although that may change.
 *
 * It tracks contextual information:
 * - `sessionKey`: which session we are running the code in,
 *   - links the code to a table.
 *   - has value `${defaultSessionKey}` if code not run.
 * - `fd`: mapping from file descriptor to device
 */
export interface BaseMeta {
  sessionKey: string;
  pid: number;
  ppid: number;
  pgid: number;
  fd: Record<number, string>;
  stack: string[];
  /**
   * Is this a background process?
   * This should be inherited.
   */
  background?: boolean;
  /** Log extra info? */
  verbose?: boolean;
}

export const defaultSessionKey = "code-has-not-run";
export const defaultProcessKey = "code-has-not-run";
export const defaultStdInOut = "unassigned-tty";

//#endregion
