import { ExhaustiveError } from "@npc-cli/util";
import type { JSh } from "./jsh.d";
import type { MvdanSh } from "./mvdan-sh";

export function withParents<T extends JSh.ParsedSh>(root: T) {
  traverseParsed(root, (node) => {
    getChildren(node).forEach((child) => void ((child as JSh.BaseNode).parent = node));
  });
  return root;
}

function getChildren(node: JSh.ParsedSh): JSh.ParsedSh[] {
  switch (node.type) {
    case "ArithmCmd":
      return [node.X];
    case "ArithmExp":
      return [node.X];
    case "ArrayElem":
      return [...(node.Index ? [node.Index] : []), node.Value];
    case "ArrayExpr":
      return node.Elems;
    case "Assign":
      return [
        ...(node.Array ? [node.Array] : []),
        ...(node.Index ? [node.Index] : []),
        ...(node.Value ? [node.Value] : []),
      ];
    case "BinaryArithm":
    case "BinaryCmd":
    case "BinaryTest":
      return [node.X, node.Y];
    case "Block":
      return node.Stmts;
    case "CStyleLoop":
      return [node.Cond, node.Init, node.Post];
    case "CallExpr":
      return ([] as JSh.ParsedSh[]).concat(node.Args, node.Assigns);
    case "CaseClause":
      return ([] as JSh.ParsedSh[]).concat(node.Items, node.Word);
    case "CaseItem":
      return ([] as JSh.ParsedSh[]).concat(node.Patterns, node.Stmts);
    case "CmdSubst":
      return node.Stmts;
    case "Comment":
      return [];
    case "CoprocClause":
      return [node.Stmt];
    case "DblQuoted":
      return node.Parts;
    case "DeclClause":
      return ([] as JSh.ParsedSh[]).concat(node.Args, node.Variant);
    case "ExtGlob":
      return [];
    case "File":
      return node.Stmts;
    case "ForClause":
      return [...node.Do, node.Loop];
    case "FuncDecl":
      return [node.Body, node.Name];
    case "IfClause":
      return [...node.Cond, ...node.Then, ...(node.Else ? [node.Else] : [])];
    case "LetClause":
      return node.Exprs;
    case "Lit":
      return [];
    case "ParamExp":
      return [
        ...(node.Exp?.Word ? [node.Exp.Word] : []),
        ...(node.Index ? [node.Index] : []),
        node.Param,
        ...(node.Repl ? [node.Repl.Orig] : []),
        ...(node.Repl?.With ? [node.Repl.With] : []),
        ...(node.Slice ? [node.Slice.Offset] : []),
        ...(node.Slice?.Length ? [node.Slice.Length] : []),
      ];
    case "ParenArithm":
      return [node.X];
    case "ParenTest":
      return [node.X];
    case "ProcSubst":
      return node.Stmts;
    case "Redirect":
      return [...(node.Hdoc ? [node.Hdoc] : []), ...(node.N ? [node.N] : []), node.Word];
    case "SglQuoted":
      return [];
    case "Stmt":
      return [...(node.Cmd ? [node.Cmd] : []), ...node.Redirs];
    case "Subshell":
      return node.Stmts;
    case "TestClause":
      return [node.X];
    case "TimeClause":
      return [...(node.Stmt ? [node.Stmt] : [])];
    case "UnaryArithm":
    case "UnaryTest":
      return [node.X];
    case "WhileClause":
      return node.Cond.concat(node.Do);
    case "Word":
      return node.Parts;
    case "WordIter":
      return node.Items;
    default:
      throw new ExhaustiveError(node);
  }
}

/** Traverse descendents including `node` itself */
export function traverseParsed(node: JSh.ParsedSh, act: (node: JSh.ParsedSh) => void) {
  act(node);
  getChildren(node).forEach((child) => void traverseParsed(child, act));
}

export class ConvertMvdanShToJsh {
  /** This is actually attached to parse trees and then overwritten per-parse */
  private mockMeta!: JSh.BaseMeta;

  /**
   * Convert to a source-code position in our format.
   * It may be invalid e.g. `CallExpr.Semicolon`.
   * This can be inferred because 1-based `Line` will equal `0`.
   */
  private pos = (input: MvdanSh.Pos): JSh.Pos => ({
    Line: input.Line,
    Col: input.Col,
    Offset: input.Offset,
  });

  // Legacy: GopherJS used numeric representation
  private op(opRep: string) {
    return opRep;
  }

  /** Convert to our notion of base parsed node. */
  private base = ({ Pos: _, End: __ }: MvdanSh.BaseNode): JSh.BaseNode => {
    // console.log({ Pos, End });
    return {
      // Pos: this.pos(Pos()),
      // End: this.pos(End()),
      meta: this.mockMeta, // Gets mutated
      parent: null, // Gets overwritten
    };
  };

  public resetMockMeta() {
    this.mockMeta = {
      sessionKey: defaults.defaultSessionKey,
      pid: -1,
      ppid: -1,
      pgid: -1,
      fd: {
        0: defaults.defaultStdInOut,
        1: defaults.defaultStdInOut,
        2: defaults.defaultStdInOut,
      },
      stack: [],
    };
  }

  //#region parse-node conversions

  private ArithmCmd = ({
    Pos,
    End,
    Left,
    Right,
    Unsigned,
    X,
  }: MvdanSh.ArithmCmd): JSh.ArithmCmd => ({
    ...this.base({ Pos, End }),
    type: "ArithmCmd",
    Left: this.pos(Left),
    Right: this.pos(Right),
    Unsigned,
    X: this.ArithmExpr(X),
  });

  private ArithmExp = ({
    Pos,
    End,
    Bracket,
    Left,
    Right,
    Unsigned,
    X,
  }: MvdanSh.ArithmExp): JSh.ArithmExp => ({
    ...this.base({ Pos, End }),
    type: "ArithmExp",
    Bracket,
    Left: this.pos(Left),
    Right: this.pos(Right),
    Unsigned,
    X: this.ArithmExpr(X),
  });

  private ArrayElem = ({ Pos, End, Comments, Index, Value }: MvdanSh.ArrayElem): JSh.ArrayElem => ({
    ...this.base({ Pos, End }),
    type: "ArrayElem",
    Comments: Comments.map(this.Comment),
    Index: Index ? this.ArithmExpr(Index) : null,
    Value: this.Word(Value),
  });

  private ArithmExpr = (node: MvdanSh.ArithmExpr): JSh.ArithmExpr => {
    if ("Y" in node) {
      return this.BinaryArithm(node);
    } else if ("Post" in node) {
      return this.UnaryArithm(node);
    } else if ("Lparen" in node) {
      return this.ParenArithm(node);
    }
    return this.Word(node);
  };

  private ArrayExpr = ({
    Pos,
    End,
    Elems,
    Last,
    Lparen,
    Rparen,
  }: MvdanSh.ArrayExpr): JSh.ArrayExpr => ({
    ...this.base({ Pos, End }),
    type: "ArrayExpr",
    Elems: Elems.map(this.ArrayElem),
    Last: Last.map(this.Comment),
    Lparen: this.pos(Lparen),
    Rparen: this.pos(Rparen),
  });

  private Assign = ({
    Pos,
    End,
    Append,
    // biome-ignore lint/suspicious/noShadowRestrictedNames: too strict
    Array,
    Index,
    Naked,
    Name,
    Value,
  }: MvdanSh.Assign): JSh.Assign => ({
    ...this.base({ Pos, End }),
    type: "Assign",
    Append,
    Array: Array ? this.ArrayExpr(Array) : null,
    Index: Index ? this.ArithmExpr(Index) : null,
    Naked,
    Name: Name === null ? null : this.Lit(Name),
    Value: Value === null ? null : this.Word(Value),
    // declOpts: {},
  });

  private BinaryArithm = ({
    Pos,
    End,
    Op,
    OpPos,
    X,
    Y,
  }: MvdanSh.BinaryArithm): JSh.BinaryArithm => ({
    ...this.base({ Pos, End }),
    type: "BinaryArithm",
    Op: this.op(Op),
    OpPos: this.pos(OpPos),
    X: this.ArithmExpr(X),
    Y: this.ArithmExpr(Y),
  });

  private BinaryCmd = ({ Pos, End, Op, OpPos, X, Y }: MvdanSh.BinaryCmd): JSh.BinaryCmd => ({
    ...this.base({ Pos, End }),
    type: "BinaryCmd",
    Op: this.op(Op),
    OpPos: this.pos(OpPos),
    X: this.Stmt(X),
    Y: this.Stmt(Y),
  });

  private BinaryTest = ({ Pos, End, Op, OpPos, X, Y }: MvdanSh.BinaryTest): JSh.BinaryTest => ({
    ...this.base({ Pos, End }),
    type: "BinaryTest",
    Op: this.op(Op),
    OpPos: this.pos(OpPos),
    X: this.TestExpr(X),
    Y: this.TestExpr(Y),
  });

  private Block = ({ Pos, End, Lbrace, Rbrace, Stmts, Last }: MvdanSh.Block): JSh.Block => ({
    ...this.base({ Pos, End }),
    type: "Block",
    Lbrace: this.pos(Lbrace),
    Rbrace: this.pos(Rbrace),
    Stmts: Stmts.map((Stmt) => this.Stmt(Stmt)),
    Last: Last.map(this.Comment),
  });

  private CallExpr = ({ Pos, End, Args, Assigns }: MvdanSh.CallExpr): JSh.CallExpr => ({
    ...this.base({ Pos, End }),
    type: "CallExpr",
    Args: Args.map(this.Word),
    Assigns: Assigns.map(this.Assign),
  });

  private CaseClause = ({
    Pos,
    End,
    Case,
    Esac,
    Items,
    Last,
    Word,
  }: MvdanSh.CaseClause): JSh.CaseClause => ({
    ...this.base({ Pos, End }),
    type: "CaseClause",
    Case: this.pos(Case),
    Esac: this.pos(Esac),
    Items: Items.map(this.CaseItem),
    Last: Last.map(this.Comment),
    Word: this.Word(Word),
  });

  private CaseItem = ({
    Pos,
    End,
    Comments,
    Op,
    OpPos,
    Patterns,
    Stmts,
  }: MvdanSh.CaseItem): JSh.CaseItem => ({
    ...this.base({ Pos, End }),
    type: "CaseItem",
    Comments: Comments.map(this.Comment),
    Op: this.op(Op),
    OpPos: this.pos(OpPos),
    Patterns: Patterns.map(this.Word),
    Stmts: Stmts.map((Stmt) => this.Stmt(Stmt)),
  });

  private CmdSubst = ({
    Pos,
    End,
    Left,
    ReplyVar,
    Right,
    Stmts,
    TempFile,
  }: MvdanSh.CmdSubst): JSh.CmdSubst => ({
    ...this.base({ Pos, End }),
    type: "CmdSubst",
    Left: this.pos(Left),
    ReplyVar,
    Right: this.pos(Right),
    Stmts: Stmts.map((Stmt) => this.Stmt(Stmt)),
    TempFile,
  });

  private Comment = ({ Pos, End, Hash, Text }: MvdanSh.Comment): JSh.Comment => ({
    ...this.base({ Pos, End }),
    type: "Comment",
    Hash: this.pos(Hash),
    Text,
  });

  private CStyleLoop = ({
    Pos,
    End,
    Cond,
    Init,
    Lparen,
    Post,
    Rparen,
  }: MvdanSh.CStyleLoop): JSh.CStyleLoop => ({
    ...this.base({ Pos, End }),
    type: "CStyleLoop",
    Cond: this.ArithmExpr(Cond),
    Init: this.ArithmExpr(Init),
    Lparen: this.pos(Lparen),
    Post: this.ArithmExpr(Post),
    Rparen: this.pos(Rparen),
  });

  private Command = (node: MvdanSh.Command): JSh.Command => {
    if ("Args" in node && !("Variant" in node)) {
      return this.CallExpr(node);
    } else if ("FiPos" in node) {
      return this.IfClause(node);
    } else if ("WhilePos" in node) {
      return this.WhileClause(node);
    } else if ("ForPos" in node) {
      return this.ForClause(node);
    } else if ("Case" in node) {
      return this.CaseClause(node);
    } else if ("Lbrace" in node) {
      return this.Block(node);
    } else if ("Lparen" in node) {
      return this.Subshell(node);
    } else if ("Y" in node) {
      return this.BinaryCmd(node);
    } else if ("Body" in node) {
      return this.FuncDecl(node);
    } else if ("Unsigned" in node) {
      return this.ArithmCmd(node);
    } else if ("X" in node) {
      return this.TestClause(node);
    } else if ("Variant" in node) {
      return this.DeclClause(node);
    } else if ("Let" in node) {
      return this.LetClause(node);
    } else if ("Time" in node) {
      return this.TimeClause(node);
    }
    return this.CoprocClause(node);
  };

  private CoprocClause = ({
    Pos,
    End,
    Coproc,
    Name,
    Stmt,
  }: MvdanSh.CoprocClause): JSh.CoprocClause => ({
    ...this.base({ Pos, End }),
    type: "CoprocClause",
    Coproc: this.pos(Coproc),
    Name: Name ? this.Lit(Name) : null,
    Stmt: this.Stmt(Stmt),
  });

  private DblQuoted = ({
    Pos,
    End,
    Dollar,
    Parts,
    Left,
    Right,
  }: MvdanSh.DblQuoted): JSh.DblQuoted => ({
    ...this.base({ Pos, End }),
    type: "DblQuoted",
    Dollar,
    Parts: Parts.map(this.WordPart),
    Left: this.pos(Left),
    Right: this.pos(Right),
  });

  private DeclClause = ({ Pos, End, Args, Variant }: MvdanSh.DeclClause): JSh.DeclClause => {
    return {
      ...this.base({ Pos, End }),
      type: "DeclClause",
      Args: Args.map(this.Assign),
      Variant: this.Lit(Variant),
    };
  };

  private ExtGlob = ({ Pos, End, Op, OpPos, Pattern }: MvdanSh.ExtGlob): JSh.ExtGlob => ({
    ...this.base({ Pos, End }),
    type: "ExtGlob",
    Op: this.op(Op),
    OpPos: this.pos(OpPos),
    Pattern: this.Lit(Pattern),
  });

  /**
   * Previously arg had functions {Pos} and {End}.
   */
  public File = ({ Name, Stmts }: MvdanSh.File): JSh.FileWithMeta => ({
    ...this.base({ Pos: mockPos, End: mockPos }),
    type: "File",
    Name,
    Stmts: Stmts.map((x) => this.Stmt(x)),
    meta: this.mockMeta,
  });
  // ): FileWithMeta => ({
  //   ...this.base({ Pos: this.mockPos, End: this.mockPos }),
  //   type: 'File',
  //   Name,
  //   StmtList: this.StmtList(StmtList),
  //   meta: this.mockMeta,
  // });

  private ForClause = ({
    Pos,
    End,
    Do,
    DonePos,
    DoPos,
    ForPos,
    Loop,
    Select,
  }: MvdanSh.ForClause): JSh.ForClause => ({
    ...this.base({ Pos, End }),
    type: "ForClause",
    Do: Do.map((Stmt) => this.Stmt(Stmt)),
    DonePos: this.pos(DonePos),
    DoPos: this.pos(DoPos),
    ForPos: this.pos(ForPos),
    Loop: this.Loop(Loop),
    Select,
  });

  private FuncDecl = ({
    Pos,
    End,
    Body,
    Name,
    Position,
    RsrvWord,
  }: MvdanSh.FuncDecl): JSh.FuncDecl => ({
    ...this.base({ Pos, End }),
    type: "FuncDecl",
    Body: this.Stmt(Body),
    Name: this.Lit(Name),
    Position: this.pos(Position),
    RsrvWord,
  });

  private IfClause = ({
    Pos,
    End,
    Cond,
    CondLast,
    Else,
    FiPos,
    Then,
    ThenLast,
    ThenPos,
    Last,
  }: MvdanSh.IfClause): JSh.IfClause => ({
    ...this.base({ Pos, End }),
    type: "IfClause",
    ThenPos: this.pos(ThenPos),
    FiPos: this.pos(FiPos),

    Cond: Cond.map((Stmt) => this.Stmt(Stmt)),
    CondLast: (CondLast || []).map(this.Comment),
    Then: Then.map((Stmt) => this.Stmt(Stmt)),
    ThenLast: (ThenLast || []).map(this.Comment),

    Else: Else ? this.IfClause(Else) : null,
    Last: Last.map(this.Comment),
  });

  private LetClause = ({ Pos, End, Exprs, Let }: MvdanSh.LetClause): JSh.LetClause => ({
    ...this.base({ Pos, End }),
    type: "LetClause",
    Exprs: Exprs.map(this.ArithmExpr),
    Let: this.pos(Let),
  });

  private Lit = <Values extends string = string>({
    Pos,
    End,
    Value,
    ValueEnd,
    ValuePos,
  }: MvdanSh.Lit): JSh.Lit<Values> => ({
    ...this.base({ Pos, End }),
    type: "Lit",
    Value: Value as Values,
    ValueEnd: this.pos(ValueEnd),
    ValuePos: this.pos(ValuePos),
  });

  private Loop = (node: MvdanSh.Loop): JSh.Loop => {
    if ("Name" in node) {
      return this.WordIter(node);
    }
    return this.CStyleLoop(node);
  };

  private ParamExp = ({
    Pos,
    End,
    Dollar,
    Excl,
    Exp,
    Index,
    Length,
    Names,
    Param,
    Rbrace,
    Repl,
    Short,
    Slice,
    Width,
  }: MvdanSh.ParamExp): JSh.ParamExp => ({
    ...this.base({ Pos, End }),
    type: "ParamExp",
    Dollar: this.pos(Dollar),
    Excl,
    Exp: Exp
      ? {
          type: "Expansion",
          Op: this.op(Exp.Op),
          Word: Exp.Word ? this.Word(Exp.Word) : null,
        }
      : null,
    Index: Index ? this.ArithmExpr(Index) : null,
    Length,
    Names: Names ? this.op(Names) : null,
    Param: this.Lit(Param),
    Rbrace: this.pos(Rbrace),
    Repl: Repl
      ? {
          type: "Replace",
          All: Repl.All,
          Orig: this.Word(Repl.Orig),
          With: Repl.With ? this.Word(Repl.With) : null,
        }
      : null,
    Short,
    Slice: Slice
      ? {
          type: "Slice",
          Length: Slice.Length ? this.ArithmExpr(Slice.Length) : null,
          Offset: this.ArithmExpr(Slice.Offset),
        }
      : null,
    Width,
  });

  private ParenArithm = ({
    Pos,
    End,
    Lparen,
    Rparen,
    X,
  }: MvdanSh.ParenArithm): JSh.ParenArithm => ({
    ...this.base({ Pos, End }),
    type: "ParenArithm",
    Lparen: this.pos(Lparen),
    Rparen: this.pos(Rparen),
    X: this.ArithmExpr(X),
  });

  private ParenTest = ({ Pos, End, Lparen, Rparen, X }: MvdanSh.ParenTest): JSh.ParenTest => ({
    ...this.base({ Pos, End }),
    type: "ParenTest",
    Lparen: this.pos(Lparen),
    Rparen: this.pos(Rparen),
    X: this.TestExpr(X),
  });

  private ProcSubst = ({
    Pos,
    End,
    Op,
    OpPos,
    Rparen,
    Stmts,
  }: MvdanSh.ProcSubst): JSh.ProcSubst => ({
    ...this.base({ Pos, End }),
    type: "ProcSubst",
    Op: this.op(Op),
    OpPos: this.pos(OpPos),
    Rparen: this.pos(Rparen),
    Stmts: Stmts.map((Stmt) => this.Stmt(Stmt)),
  });

  private Redirect = ({ Pos, End, Hdoc, N, Op, OpPos, Word }: MvdanSh.Redirect): JSh.Redirect => ({
    ...this.base({ Pos, End }),
    type: "Redirect",
    Hdoc: Hdoc ? this.Word(Hdoc) : null,
    N: N ? this.Lit(N) : null,
    Op: this.op(Op),
    OpPos: this.pos(OpPos),
    Word: this.Word(Word),
  });

  private SglQuoted = ({
    Pos,
    End,
    Dollar,
    Left,
    Right,
    Value,
  }: MvdanSh.SglQuoted): JSh.SglQuoted => ({
    ...this.base({ Pos, End }),
    type: "SglQuoted",
    Dollar,
    Left: this.pos(Left),
    Right: this.pos(Right),
    Value,
  });

  private Stmt = ({
    Pos,
    End,
    Background,
    Cmd,
    Comments,
    Coprocess,
    Negated,
    Position,
    Redirs,
    Semicolon,
  }: MvdanSh.Stmt): JSh.Stmt => ({
    ...this.base({ Pos, End }),
    type: "Stmt",
    Background,
    Cmd: Cmd ? this.Command(Cmd) : null,
    Comments: Comments.map(this.Comment),
    Coprocess,
    Negated,
    Position: this.pos(Position),
    Redirs: Redirs.map(this.Redirect),
    Semicolon: this.pos(Semicolon),
  });

  private Subshell = ({ Pos, End, Lparen, Rparen, Stmts }: MvdanSh.Subshell): JSh.Subshell => ({
    ...this.base({ Pos, End }),
    type: "Subshell",
    Lparen: this.pos(Lparen),
    Rparen: this.pos(Rparen),
    Stmts: Stmts.map(this.Stmt),
  });

  private TestClause = ({ Pos, End, Left, Right, X }: MvdanSh.TestClause): JSh.TestClause => ({
    ...this.base({ Pos, End }),
    type: "TestClause",
    Left: this.pos(Left),
    Right: this.pos(Right),
    X: this.TestExpr(X),
  });

  private TestExpr = (node: MvdanSh.TestExpr): JSh.TestExpr => {
    if ("Y" in node) {
      return this.BinaryTest(node);
    } else if ("Op" in node) {
      return this.UnaryTest(node);
    } else if ("X" in node) {
      return this.ParenTest(node);
    }
    return this.Word(node);
  };

  private TimeClause = ({
    Pos,
    End,
    PosixFormat,
    Stmt,
    Time,
  }: MvdanSh.TimeClause): JSh.TimeClause => ({
    ...this.base({ Pos, End }),
    type: "TimeClause",
    PosixFormat,
    Stmt: Stmt ? this.Stmt(Stmt) : null,
    Time: this.pos(Time),
  });

  private UnaryArithm = ({
    Pos,
    End,
    Op,
    OpPos,
    Post,
    X,
  }: MvdanSh.UnaryArithm): JSh.UnaryArithm => ({
    ...this.base({ Pos, End }),
    type: "UnaryArithm",
    Op: this.op(Op),
    OpPos: this.pos(OpPos),
    Post,
    X: this.ArithmExpr(X),
  });

  private UnaryTest = ({ Pos, End, Op, OpPos, X }: MvdanSh.UnaryTest): JSh.UnaryTest => ({
    ...this.base({ Pos, End }),
    type: "UnaryTest",
    Op: this.op(Op),
    OpPos: this.pos(OpPos),
    X: this.TestExpr(X),
  });

  private WhileClause = ({
    Pos,
    End,
    Cond,
    Do,
    DonePos,
    DoPos,
    Until,
    WhilePos,
  }: MvdanSh.WhileClause): JSh.WhileClause => ({
    ...this.base({ Pos, End }),
    type: "WhileClause",
    Cond: Cond.map((Stmt) => this.Stmt(Stmt)),
    Do: Do.map((Stmt) => this.Stmt(Stmt)),
    DonePos: this.pos(DonePos),
    DoPos: this.pos(DoPos),
    Until,
    WhilePos: this.pos(WhilePos),
  });

  private Word = ({ Pos, End, Parts }: MvdanSh.Word): JSh.Word => ({
    ...this.base({ Pos, End }),
    type: "Word",
    Parts: Parts.map(this.WordPart),
  });

  private WordIter = ({ Pos, End, Items, Name }: MvdanSh.WordIter): JSh.WordIter => ({
    ...this.base({ Pos, End }),
    type: "WordIter",
    Items: Items.map(this.Word),
    Name: this.Lit(Name),
  });

  private WordPart = (node: MvdanSh.WordPart): JSh.WordPart => {
    if ("ValuePos" in node) {
      return this.Lit(node);
    } else if ("Value" in node) {
      return this.SglQuoted(node);
    } else if ("Parts" in node) {
      return this.DblQuoted(node);
    } else if ("Slice" in node) {
      return this.ParamExp(node);
    } else if ("TempFile" in node) {
      return this.CmdSubst(node);
    } else if ("X" in node) {
      return this.ArithmExp(node);
    } else if ("Stmts" in node) {
      return this.ProcSubst(node);
    }
    return this.ExtGlob(node);
  };
  //#endregion
}

export const convertMvdanShToJsh = new ConvertMvdanShToJsh();

export const defaults = {
  defaultSessionKey: "code-has-not-run",
  defaultProcessKey: "code-has-not-run",
  defaultStdInOut: "unassigned-tty",
};

const mockPos: MvdanSh.Pos = { type: "Pos", Line: -1, Col: -1, Offset: -1 };
