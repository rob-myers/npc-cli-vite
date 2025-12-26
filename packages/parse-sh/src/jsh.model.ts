import { ExhaustiveError } from "@npc-cli/util";
import { last } from "@npc-cli/util/legacy/generic";
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
    Semicolon: Semicolon ? this.pos(Semicolon) : null,
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

class ComputeJShSource {
  private onOneLine = true;

  binaryCmds(cmd: JSh.BinaryCmd): JSh.BinaryCmd[] {
    const { X, Y, Op } = cmd;
    if (X.Cmd && X.Cmd.type === "BinaryCmd" && X.Cmd.Op === Op) {
      return [...this.binaryCmds(X.Cmd), cmd];
    } else if (Y.Cmd && Y.Cmd.type === "BinaryCmd" && Y.Cmd.Op === Op) {
      return [cmd, ...this.binaryCmds(Y.Cmd)];
    }
    return [cmd];
  }

  private isBackgroundNode(node: JSh.ParsedSh) {
    return node.type === "Stmt" && node.Background;
  }

  public multilineSrc = (node: JSh.ParsedSh | null) => {
    this.onOneLine = false;
    const src = this.src(node);
    this.onOneLine = true;
    return src;
  };

  private seqSrc = (nodes: JSh.ParsedSh[], trailing = false) => {
    if (this.onOneLine) {
      const srcs = [] as string[];
      nodes.forEach((c) => void srcs.push(this.src(c), this.isBackgroundNode(c) ? " " : "; "));
      return (trailing ? srcs : srcs.slice(0, -1)).join("");
    }
    return nodes.map((x) => this.src(x)).join("\n");
  };

  /**
   * Given parse tree compute source code.
   * We ensure the source code has no newlines so it can be used as history.
   */
  src = (node: JSh.ParsedSh | null): string => {
    if (!node) {
      return "";
    }
    switch (node.type) {
      case "ArithmCmd":
        return `(( ${this.src(node.X)} ))`;
      case "BinaryCmd": {
        const cmds = this.binaryCmds(node);
        const stmts = [cmds[0].X].concat(cmds.map(({ Y }) => Y));
        return stmts
          .map((c) => this.src(c))
          .join(` ${node.Op}${!this.onOneLine && node.Op !== "|" ? "\n" : ""} `);
      }

      case "BinaryArithm": {
        // if (typeof node.number === 'number') return `${node.number}`;
        return [node.X, node.Y].map((c) => this.src(c)).join(`${node.Op}`);
      }
      case "UnaryArithm": {
        // if (typeof node.number === 'number') return `${node.number}`;
        return node.Post ? `${this.src(node.X)}${node.Op}` : `${node.Op}${this.src(node.X)}`;
      }
      case "ParenArithm": {
        // if (typeof node.number === 'number') return `${node.number}`;
        return `(${this.src(node.X)})`;
      }
      case "Word": {
        if (typeof node.string === "string") return node.string;
        return node.Parts.map((c) => this.src(c)).join("");
      }

      case "ArrayExpr": {
        const contents = node.Elems.map(({ Index, Value }) =>
          Index ? `[${this.src(Index)}]=${this.src(Value)}` : this.src(Value),
        );
        return `(${contents.join(" ")})`;
      }
      case "Assign": {
        if (node.Name === null) {
          // ?
          return this.src(node.Value);
        }
        if (node.Value === null && node.parent?.type === "DeclClause") {
          return this.src(node.Name); // prefer "foo" over "foo="
        }

        const varName = node.Name.Value;
        if (node.Array !== null) {
          return `${varName}=${this.src(node.Array)}`;
        }
        if (node.Index !== null) {
          return `${varName}[${this.src(node.Index)}]${node.Append ? "+" : ""}=${this.src(
            node.Value,
          )}`;
        }
        return `${varName}${node.Append ? "+" : ""}=${this.src(node.Value || null)}`;
      }

      case "Block": {
        const { Stmts } = node;
        // Handle `{ echo foo & }`
        const terminal = Stmts.length && this.isBackgroundNode(last(Stmts)!) ? "" : ";";
        if (this.onOneLine) {
          return `{ ${this.seqSrc(Stmts)}${terminal} }`;
        } else {
          const lines = this.seqSrc(Stmts).split("\n");
          lines.length === 1 && !lines[0] && lines.pop(); // Avoid single blank line
          return `{\n${lines
            .map((x) => `  ${x}`)
            .concat(node.Last.map((x) => `  #${x.Text}`))
            .join("\n")}\n}`;
        }
      }

      case "CallExpr":
        return [
          node.Assigns.map((c) => this.src(c)).join(" "),
          node.Args.map((c) => this.src(c)).join(" "),
        ]
          .filter(Boolean)
          .join(" ");

      case "Stmt": {
        let output = [
          node.Negated && "!",
          this.src(node.Cmd),
          node.Redirs.map((c) => this.src(c)).join(" "),
          node.Background && "&",
        ]
          .filter(Boolean)
          .join(" ");

        if (!this.onOneLine && node.Comments.length) {
          const before = [] as string[];
          node.Comments.forEach(
            (x) =>
              void (x.Hash.Offset < node.Position.Offset
                ? before.push(`#${x.Text}`)
                : (output += ` #${x.Text}`)),
          );
          output = before.concat(output).join("\n");
        }
        return output;
      }

      case "CaseClause": {
        const cases = node.Items.map(({ Patterns, Op, Stmts }) => ({
          globs: Patterns,
          terminal: Op,
          child: Stmts,
        }));
        return [
          "case",
          this.src(node.Word),
          "in",
          cases
            .flatMap(({ child, globs, terminal }) => [
              `${globs.map((g) => this.src(g)).join(" | ")})`,
              this.seqSrc(child),
              terminal,
            ])
            .join(" "),
          "esac",
        ]
          .filter(Boolean)
          .join(" ");
      }

      case "CoprocClause":
        return ["coproc", node.Name?.Value, this.src(node.Stmt)].filter(Boolean).join(" ");

      case "DeclClause":
        return [node.Variant.Value, node.Args.map((c) => this.src(c)).join(" ")]
          .filter(Boolean)
          .join(" ");

      case "ArithmExp":
        return `${
          /**
           * TODO get type below correct
           * Have (( foo )) iff parent is 'compound'
           */
          node.parent?.type === "Stmt" ? "" : "$"
        }(( ${this.src(node.X)} ))`;

      case "CmdSubst":
        return `$( ${this.seqSrc(node.Stmts)} )`;

      case "DblQuoted":
        return `"${node.Parts.map((c) => this.src(c)).join("")}"`;

      case "ExtGlob":
        return node.Pattern.Value.replace(/\n/g, ""); // ignore newlines

      // Literals inside heredocs are handled earlier
      case "Lit": {
        // const value = node.Value.replace(/\\\n/g, '');
        // if (node.parent?.type === 'DblQuoted') {
        // return value.replace(/\n/g, '"$$\'\\n\'"'); // Need $$ for literal $
        // }
        return node.Value;
      }

      // Unhandled cases are viewed as vanilla case
      case "ParamExp": {
        if (node.Exp?.Op === ":-") {
          return `\${${node.Param.Value}:-${this.src(node.Exp.Word)}}`;
        } else if (node.Repl) {
          return `\${${reconstructReplParamExp(node.Repl)}}`;
        } else {
          return `\${${node.Param.Value}}`;
        }
      }

      case "ProcSubst": {
        const dir = node.Op === "<(" ? "<" : ">";
        return `${dir}( ${this.seqSrc(node.Stmts)} )`;
      }

      case "SglQuoted": {
        // const inner = node.Value.replace(/\n/g, '\'$$\'\\n\'\'');
        const inner = node.Value;
        return `${node.Dollar ? "$" : ""}'${inner}'`;
      }

      case "FuncDecl":
        return `${node.Name.Value}() ${this.src(node.Body)}`;

      case "IfClause": {
        return collectIfClauses(node)
          .map(({ Cond, Then }, i) =>
            Cond.length
              ? `${!i ? "if" : "elif"} ${this.seqSrc(Cond)}; then ${this.seqSrc(Then)}; `
              : `else ${this.seqSrc(Then)}; `,
          )
          .concat("fi")
          .join("");
      }

      case "LetClause":
        return `let ${node.Exprs.map((c) => this.src(c)).join(" ")}`;

      case "Redirect": {
        const fd = node.N ? Number(node.N.Value) : "";
        switch (node.Op) {
          case ">":
          case ">>":
          case "&>>":
          case ">&": {
            const [part] = node.Word.Parts;
            const move = part?.type === "Lit" && part.Value.endsWith("-");
            return `${fd}${node.Op}${this.src(node.Word)}${move ? "-" : ""}`;
          }
          default:
            return "";
        }
      }

      case "File":
        return this.seqSrc(node.Stmts);

      case "Subshell":
        return `( ${node.Stmts.map((c) => this.src(c)).join("; ")} )`;

      case "TestClause":
        return `[[ ${this.src(node.X)} ]]`;

      case "BinaryTest":
        return [node.X, node.Y].map((c) => this.src(c)).join(` ${node.Op} `);
      case "UnaryTest":
        return `${node.Op} ${this.src(node.X)}`;
      case "ParenTest":
        return `(${this.src(node.X)})`;

      case "TimeClause":
        return `time ${node.PosixFormat ? "-p " : ""}${this.src(node.Stmt)}`;

      case "ForClause": {
        const { Do, Loop } = node;
        if (Loop.type === "CStyleLoop") {
          return `for (( ${this.src(Loop.Init)}; ${this.src(Loop.Cond)}; ${this.src(
            Loop.Post,
          )} )); do ${this.seqSrc(Do, true)}done`;
        }
        return `for ${Loop.Name.Value} in ${Loop.Items.map((c) => this.src(c)).join(
          " ",
        )}; do ${this.seqSrc(Do, true)}done`;
      }

      case "WhileClause": {
        return `${node.Until ? "until" : "while"} ${
          node.Cond.length === 1 ? `${this.src(node.Cond[0])}; ` : this.seqSrc(node.Cond, true)
        }do${
          this.onOneLine
            ? ` ${this.seqSrc(node.Do, true)}`
            : `\n${this.seqSrc(node.Do, true)
                .split("\n")
                .map((x) => `  ${x}`)
                .join("\n")}\n`
        }done`;
      }

      // Unreachable
      case "CStyleLoop":
      case "Comment":
      case "WordIter":
      case "ArrayElem":
      case "CaseItem":
        return "";

      default:
        throw new ExhaustiveError(node);
    }
  };
}

export const computeJShSource = new ComputeJShSource();

/** Collect contiguous if-clauses. */
export function collectIfClauses(cmd: JSh.IfClause): JSh.IfClause[] {
  return cmd.Else ? [cmd, ...collectIfClauses(cmd.Else)] : [cmd];
}

/**
 * View "replace" as "_" i.e. last interactive non-string value
 */
export function reconstructReplParamExp(Repl: NonNullable<JSh.ParamExp["Repl"]>) {
  let origParam = "_";
  Repl.Orig.Parts.length &&
    (origParam += `/${Repl.Orig.Parts.map((x) => (x as JSh.Lit).Value).join("")}`);
  Repl.With?.Parts.length &&
    (origParam += `/${Repl.With.Parts.map((x) => (x as JSh.Lit).Value).join("")}`);
  return origParam;
}
