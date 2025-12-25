import type { MvdanSh } from "./mvdan-sh.d";

/**
 * Types provides as input to our JavaScript interpreter.
 */
export declare namespace JSh {
  interface FileWithMeta extends File {
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
  interface BaseMeta {
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

  type ParsedSh =
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

  interface BaseNode {
    /** Single instance for entire parse tree */
    meta: BaseMeta;
    /** Reference to parent node  */
    parent: null | ParsedSh;
    /** Used for expansion */
    string?: string;
    /** Used to calculate actual exit codes */
    exitCode?: number;
  }

  interface Pos {
    Line: number;
    Col: number;
    Offset: number;
  }

  type ArithmCmd = MvdanSh.ArithmCmdGeneric<BaseNode, Pos, string>;
  type ArithmExp = MvdanSh.ArithmExpGeneric<BaseNode, Pos, string>;
  type ArrayElem = MvdanSh.ArrayElemGeneric<BaseNode, Pos, string>;
  type ArithmExpr = BinaryArithm | UnaryArithm | ParenArithm | Word;
  type ArrayExpr = MvdanSh.ArrayExprGeneric<BaseNode, Pos, string>;
  type Assign = MvdanSh.AssignGeneric<BaseNode, Pos, string>;

  type BinaryArithm = MvdanSh.BinaryArithmGeneric<BaseNode, Pos, string>;
  type BinaryCmd = MvdanSh.BinaryCmdGeneric<BaseNode, Pos, string>;
  type BinaryTest = MvdanSh.BinaryTestGeneric<BaseNode, Pos, string>;
  type Block = MvdanSh.BlockGeneric<BaseNode, Pos, string>;
  type CallExpr = MvdanSh.CallExprGeneric<BaseNode, Pos, string>;
  type CaseClause = MvdanSh.CaseClauseGeneric<BaseNode, Pos, string>;
  type CaseItem = MvdanSh.CaseItemGeneric<BaseNode, Pos, string>;
  type CmdSubst = MvdanSh.CmdSubstGeneric<BaseNode, Pos, string>;
  type Comment = MvdanSh.CommentGeneric<BaseNode, Pos, string>;
  type CStyleLoop = MvdanSh.CStyleLoopGeneric<BaseNode, Pos, string>;
  type Command =
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
  type CoprocClause = MvdanSh.CoprocClauseGeneric<BaseNode, Pos, string>;
  type DblQuoted = MvdanSh.DblQuotedGeneric<BaseNode, Pos, string>;
  /** syntax.LangBash only */
  type DeclClause = MvdanSh.DeclClauseGeneric<BaseNode, Pos, string>;
  type ExtGlob = MvdanSh.ExtGlobGeneric<BaseNode, Pos, string>;
  type File = MvdanSh.FileGeneric<BaseNode, Pos, string> & BaseNode;
  type ForClause = MvdanSh.ForClauseGeneric<BaseNode, Pos, string>;
  type FuncDecl = MvdanSh.FuncDeclGeneric<BaseNode, Pos, string>;
  type IfClause = MvdanSh.IfClauseGeneric<BaseNode, Pos, string>;
  type LetClause = MvdanSh.LetClauseGeneric<BaseNode, Pos, string>;
  type Lit<Values extends string = string> = MvdanSh.LitGeneric<BaseNode, Pos, number, Values>;
  type Loop = WordIter | CStyleLoop;
  type ParamExp = MvdanSh.ParamExpGeneric<BaseNode, Pos, string>;
  type ParenArithm = MvdanSh.ParenArithmGeneric<BaseNode, Pos, string>;
  type ParenTest = MvdanSh.ParenTestGeneric<BaseNode, Pos, string>;
  type ProcSubst = MvdanSh.ProcSubstGeneric<BaseNode, Pos, string>;
  type Redirect = MvdanSh.RedirectGeneric<BaseNode, Pos, string>;
  type SglQuoted = MvdanSh.SglQuotedGeneric<BaseNode, Pos, string>;
  type Stmt = MvdanSh.StmtGeneric<BaseNode, Pos, string>;
  type Subshell = MvdanSh.SubshellGeneric<BaseNode, Pos, string>;
  type TestClause = MvdanSh.TestClauseGeneric<BaseNode, Pos, string>;
  type TimeClause = MvdanSh.TimeClauseGeneric<BaseNode, Pos, string>;
  type TestExpr = BinaryTest | UnaryTest | ParenTest | Word;
  type UnaryArithm = MvdanSh.UnaryArithmGeneric<BaseNode, Pos, string>;
  type UnaryTest = MvdanSh.UnaryTestGeneric<BaseNode, Pos, string>;
  type WhileClause = MvdanSh.WhileClauseGeneric<BaseNode, Pos, string>;
  type Word = MvdanSh.WordGeneric<BaseNode, Pos, string>;
  type WordIter = MvdanSh.WordIterGeneric<BaseNode, Pos, string>;
  type WordPart =
    | Lit
    | SglQuoted
    | DblQuoted
    | ParamExp
    | CmdSubst
    | ArithmExp
    | ProcSubst
    | ExtGlob;
}
