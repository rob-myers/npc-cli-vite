package processor

import (
	"mvdan.cc/sh/v3/syntax"
)

type ArithmCmd struct {
	Type string
	Unsigned bool // mksh's ((# expr))
	X interface{} // ArithmExpr
	Left Pos
	Right Pos
	Pos Pos
	End Pos
}

type ArithmExp struct {
	Type string
	Bracket bool
	Unsigned bool
	X interface{} // ArithmExpr
	Left Pos
	Right Pos
	Pos Pos
	End Pos
}

type ArithmExpr interface {
	arithmExprNode()
}
// 🚧
// func (BinaryArithm) arithmExprNode() {}
// func (UnaryArithm) arithmExprNode() {}
// func (ParenArithm) arithmExprNode() {}
func (Word) arithmExprNode() {}

type ArrayElem struct {
	Type string
	Index ArithmExp
	Value Word
	Comments []Comment
	Pos Pos
	End Pos
}

type ArrayExpr struct {
	Type string
	Elems []ArrayElem
	Lparen Pos
	Rparen Pos
	Last Comment
	Pos Pos
	End Pos
}

type Assign struct {
	Type string
	Append bool
	Naked bool
	Name Lit
	Index ArithmExp
	Value Word
	Array ArrayExpr
	Pos Pos
	End Pos
}

type BinaryCmd struct {
	Type string
	X Stmt
	Y Stmt
	Op string
	OpPos Pos
	Pos Pos
	End Pos
}

type BinaryTest struct {
	Type 	string
	Op 		string
	X  		interface{} // TestExpr
	Y  		interface{} // TestExpr
	OpPos Pos
	Pos   Pos
	End   Pos
}

type Block struct {
	Type string
	Stmts []Stmt
	Lbrace Pos
	Rbrace Pos
	Pos Pos
	End Pos
}

type CallExpr struct {
	Type string
	Assigns []Assign
	Args []Word
	Pos Pos
	End Pos
}

type CaseClause struct {
	Type string
	Word Word
	Items []CaseItem
	Case Pos
	Esac Pos
	Last []Comment
	Pos Pos
	End Pos
}

type CaseItem struct {
	Type string
	Op string
	Patterns []Word
	Stmts []Stmt
	OpPos Pos
	Comments []Comment
	Pos Pos
	End Pos
}

type CmdSubst struct {
	Type string
	TempFile bool
	ReplyVar bool
	Stmts []Stmt
	Pos Pos
	End Pos
}

// union type via common interface
type Command interface {
	commandNode()
}
func (ArithmCmd) commandNode() {}
func (BinaryCmd) commandNode() {}
func (Block) commandNode() {}
func (CallExpr) commandNode() {}
func (CaseClause) commandNode() {}
func (CaseItem) commandNode() {}
func (CoprocClause) commandNode() {}
func (DeclClause) commandNode() {}
func (ForClause) commandNode() {}
func (FuncDecl) commandNode() {}
func (IfClause) commandNode() {}
func (LetClause) commandNode() {}
func (SubShell) commandNode() {}
func (TestClause) commandNode() {}
func (TimeClause) commandNode() {}
func (Unhandled) commandNode() {}
func (WhileClause) commandNode() {}

type Comment struct {
	Text string
	Hash Pos
	Pos  Pos
	End  Pos
}

type CoprocClause struct {
	Type string
	Name Word
	Stmt Stmt
	Coproc Pos;
	Pos Pos
	End Pos
}

type CStyleLoop struct {
	Type string
	Init interface{} // ArithmExpr
	Cond interface{} // ArithmExpr
	Post interface{} // ArithmExpr
	Pos  Pos
	End  Pos
}

type DblQuoted struct {
	Type string
	Dollar bool
	Parts interface{} // WordPart
	Left Pos
	Right Pos
	Pos Pos
	End Pos
}

type DeclClause struct {
	Type string
	Variant Lit
	Args []Assign
	Pos Pos
	End Pos
}

type Expansion struct {
	Type string
	Op string
	Word Word
	Pos Pos
	End Pos
}

type File struct {
	Type string
	Name string
	Stmts []Stmt
	Last []Comment
	Pos  Pos
	End  Pos
}

type ForClause struct {
	Type string
	Select bool
	// interface type processor.Loop not supported: only interface{} and easyjson/json Unmarshaler are allowed
	Loop interface{} // Loop
	Do []Stmt
	Pos Pos
	End Pos
}

type FuncDecl struct {
	Type string
	RsrvWord bool
	Name Lit
	Body Stmt
	Pos Pos
	End Pos
}

type IfClause struct {
	Type string
	Then []Stmt;
	/* if non-nil an "elif" or an "else" */
	Else *IfClause;
	ThenPos Pos // Position of "then", empty if this is an "else"
	FiPos Pos // position of "fi", empty if Elif == true
	CondLast []Comment
	ThenLast []Comment
	Last []Comment
	Pos Pos
	End Pos
}

type LetClause struct {
	Type 	string
	Exprs interface{} // []ArithmExpr
	Let Pos
	Pos Pos
	End Pos
}

type Lit struct {
	Value    string
	ValuePos Pos
	ValueEnd Pos
	Pos      Pos
	End      Pos
}

type Loop interface {
	loopNode()
}
func (WordIter) loopNode() {}
func (CStyleLoop) loopNode()  {}

type Node struct {
	Pos Pos
	End Pos
}

type ParamExp struct {
	Type string
	Short bool
	Excl bool
	Length bool
	Width bool
	Param Lit
	Index interface{} // ArithmExpr
	Slice Slice
	Repl Replace
	Names string
	Exp Expansion
	Pos Pos
	End Pos
}

type ParenTest struct {
	Type string
	Op string
	X interface{}
	Lparen Pos
	Rparen Pos
	Pos Pos
	End Pos
}

type Pos struct {
	Offset uint
	Line   uint
	Col    uint
}

type Redirect struct {
	Op string
	N *Lit
	Word *Word
	Hdoc *Word
	OpPos Pos
	Pos Pos
	End Pos
}

type Replace struct {
	Type string
	All bool
	Orig Word
	Pos Pos
	End Pos
}

type SglQuoted struct {
	Type string
	Dollar bool
	Value string
	Left Pos
	Right Pos
	Pos Pos
	End Pos
}

type Slice struct {
	Type string
	// Offset ArithmExpr
	// Length ArithmExpr
	Offset interface{}
	Length interface{}
	Pos Pos
	End Pos
}

type Stmt struct {
	Comments []Comment
	// interface type processor.Command not supported: only interface{} and easyjson/json Unmarshaler are allowed
	Cmd        interface{} // Command
	Position   Pos
	Semicolon  Pos
	Negated    bool
	Background bool
	Coprocess  bool
	Redirs     []Redirect
	Pos        Pos
	End        Pos
}

type SubShell struct {
	Type string
	Stmts []Stmt
	Pos Pos
	End Pos
}

type TestClause struct {
	Type 	string
	X 		interface{} // TestExpr
	Pos 	Pos
	End 	Pos
}

type TestExpr interface {
	testExprNode()
}
func (BinaryTest) testExprNode() {}
func (UnaryTest) 	testExprNode() {}
func (ParenTest) 	testExprNode() {}
func (Word) testExprNode() {}

type TimeClause struct {
	Type string
	PosixFormat bool
	Stmt Stmt
	Pos   Pos
	End   Pos
}

type UnaryTest struct {
	Type 	string
	Op 		string
	// X  		TestExpr
	X  		interface{}
	Pos   Pos
	End   Pos
}

type Unhandled struct {
	Type string
	Pos Pos
	End Pos
}

type WhileClause struct {
	Type string
	Until bool
	/** if non-nil an "elif" or an "else" */
	Cond []Stmt;
	Do []Stmt;
	DonePos Pos
	DoPos Pos
	WhilePos Pos
	Pos Pos
	End Pos
}

type Word struct {
	Type string
	Parts interface{} // []WordPart
	// Lit   string
	Pos   Pos
	End   Pos
}

type WordIter struct {
	Type 	string
	Name  Lit
	Items []Word
	Pos   Pos
	End   Pos
}

// 🚧
type WordPart interface {
	wordPartNode()
}
func (CmdSubst) wordPartNode() {}
func (DblQuoted) wordPartNode() {}
func (Lit) wordPartNode() {}
func (ParamExp) wordPartNode() {}
func (SglQuoted) wordPartNode() {}

type ParseError struct {
	syntax.ParseError
	Pos Pos
}

type Result struct {
	File `json:"file"`
	Text string `json:"text"`
	*ParseError `json:"parseError"`
	Message string `json:"message"`
}

func MapParseError(err error) (*ParseError, string) {
	if err == nil {
		return nil, ""
	}

	parseError, ok := err.(syntax.ParseError)

	if ok {
		return &ParseError{
			ParseError: parseError,
			Pos:        mapPos(parseError.Pos),
		}, parseError.Error()
	}

	return nil, err.Error()
}

// func mapArithmExp(node syntax.ArithmExp) ArithmExp {
// 	return ArithmExp{
// 		Type: "ArithmExp",
// 		Bracket: node.Bracket,
// 		Unsigned: node.Unsigned,
// 		X: mapArithmExpr(node.X),
// 		Pos: mapPos(node.Pos()),
// 		End: mapPos(node.End()),
// 	}
// }

// 🚧
func mapArithmExpr(node syntax.ArithmExpr) ArithmExpr {
	if node == nil {
		return nil
	}
	switch node := node.(type) {
		// BinaryArithm
		// UnaryArithm
		// ParenArithm
		case *syntax.Word:
			return mapWord(node)
		}
	return nil;
}

func mapArithmExprs(arithmExprs []syntax.ArithmExpr) []ArithmExpr {
	outputsSize := len(arithmExprs)
	outputList := make([]ArithmExpr, outputsSize)
	for i := range outputsSize {
		outputList[i] = mapArithmExpr(arithmExprs[i])
	}
	return outputList
}

func mapAssigns(assigns []*syntax.Assign) []Assign {
	assignsSize := len(assigns)
	assignList := make([]Assign, assignsSize)
	for i := range assignsSize {
		curr := assigns[i]
		assignList[i] = Assign{
			Type:   "Assign",
			Append: curr.Append,
			Naked:  curr.Naked,
			Name:   *mapLit(curr.Name),
			Value:  *mapWord(curr.Value),
			Pos: mapPos(curr.Pos()),
			End: mapPos(curr.End()),
		}
	}
	return assignList
}

func mapCaseItems(caseItems []*syntax.CaseItem) []CaseItem {
	outputsSize := len(caseItems)
	outputs := make([]CaseItem, outputsSize)
	for i := range outputs {
		curr := caseItems[i]
		outputs[i] = CaseItem{
			Type: "CaseItem",
			Op: curr.Op.String(),
			Patterns: mapWords(curr.Patterns),
			Stmts: mapStmts(curr.Stmts),
			OpPos: mapPos(curr.OpPos),
			Comments: mapComments(curr.Comments),
			Pos:  mapPos(curr.Pos()),
			End:  mapPos(curr.End()),
		}
	}
	return outputs
}

func mapCommand(node syntax.Command) Command {
	if node == nil {
		return nil
	}
	
	// https://github.com/mvdan/sh/blob/b84a3905c4f978a4b0050711d9d38ec4f3a51bec/syntax/walk.go#L16
	switch node := node.(type) {
		case *syntax.ArithmCmd:
			return &ArithmCmd{
				Type: "ArithmCmd",
				Unsigned: node.Unsigned,
				X: mapArithmExpr(node.X),
				Left: mapPos(node.Left),
				Right: mapPos(node.Right),
				Pos: mapPos(node.Pos()),
				End: mapPos(node.End()),
			}
		case *syntax.BinaryCmd:
			return &BinaryCmd{
				Type: "BinaryCmd",
				Op: node.Op.String(),
				OpPos: mapPos(node.OpPos),
				X: mapStmt(node.X),
				Y: mapStmt(node.Y),
				Pos: mapPos(node.Pos()),
				End: mapPos(node.End()),
			}
		case *syntax.Block:
			return &Block{
				Type: "Block",
				Stmts: mapStmts(node.Stmts),
				Pos: mapPos(node.Pos()),
				End: mapPos(node.End()),
			}
		case *syntax.CallExpr:
			return &CallExpr{
				Type: "CallExpr",
				Assigns: mapAssigns(node.Assigns),
				Args: mapWords(node.Args),
				Pos: mapPos(node.Pos()),
				End: mapPos(node.End()),
			}
		case *syntax.CaseClause:
			return &CaseClause{
				Type: "CaseClause",
				Word: *mapWord(node.Word),
				Items: mapCaseItems(node.Items),
				Pos: mapPos(node.Pos()),
				End: mapPos(node.End()),
			}
		case *syntax.CoprocClause:
			return &CoprocClause{
				Type: "CoprocClause",
				Name: *mapWord(node.Name),
				Stmt: mapStmt(node.Stmt),
				Pos: mapPos(node.Pos()),
				End: mapPos(node.End()),
			}
		case *syntax.DeclClause:
			return &DeclClause{
				Type: "DeclClause",
				Variant: *mapLit(node.Variant),
				Args: mapAssigns(node.Args),
				Pos: mapPos(node.Pos()),
				End: mapPos(node.End()),
			}
		case *syntax.ForClause:
			return &ForClause{
				Type: "ForClause",
				Do: mapStmts((node.Do)),
				Select: node.Select,
				Loop: mapLoop(node.Loop),
				Pos: mapPos(node.Pos()),
				End: mapPos(node.End()),
			}
		case *syntax.FuncDecl:
			return &FuncDecl{
				Type: "FuncDecl",
				RsrvWord: node.RsrvWord,
				Name: *mapLit(node.Name),
				Body: mapStmt(node.Body),
				Pos: mapPos(node.Pos()),
				End: mapPos(node.End()),
			}
		case *syntax.IfClause:
			return &IfClause{
				Type: "IfClause",
				Then: mapStmts(node.Then),
				Else: mapCommand(node.Else).(*IfClause),
				ThenPos: mapPos(node.ThenPos),
				FiPos: mapPos(node.FiPos),
				CondLast: mapComments(node.CondLast),
				ThenLast: mapComments(node.ThenLast),
				Last: mapComments(node.Last),
				Pos: mapPos(node.Pos()),
				End: mapPos(node.End()),
			}
		case *syntax.LetClause:
			return &LetClause{
				Type: "LetClause",
				Exprs: mapArithmExprs(node.Exprs),
				Pos: mapPos(node.Pos()),
				End: mapPos(node.End()),
			}
		case *syntax.TestClause:
			return &TestClause{
				Type: "TestClause",
				X: mapTestExpr(node.X),
				Pos: mapPos(node.Pos()),
				End: mapPos(node.End()),
			}
		case *syntax.Subshell:
			return &SubShell{
				Type: "Subshell",
				Stmts: mapStmts(node.Stmts),
				Pos: mapPos(node.Pos()),
				End: mapPos(node.End()),
			}
		case *syntax.TimeClause:
			return &TimeClause{
				Type: "TimeClause",
				PosixFormat: node.PosixFormat,
				Stmt: mapStmt(node.Stmt),
				Pos: mapPos(node.Pos()),
				End: mapPos(node.End()),
			}
		case *syntax.WhileClause:
			return &WhileClause{
				Type: "WhileClause",
				Until: node.Until,
				Cond: mapStmts(node.Cond),
				Do: mapStmts(node.Do),
				Pos: mapPos(node.Pos()),
				End: mapPos(node.End()),
			}
		default:
			return &Unhandled{
				Type: "Unhandled",
				Pos: mapPos(node.Pos()),
				End: mapPos(node.End()),
			}
	}
}

func mapComment(curr syntax.Comment) Comment {
	return Comment{
		Hash: mapPos(curr.Hash),
		Text: curr.Text,
		Pos:  mapPos(curr.Pos()),
		End:  mapPos(curr.End()),
	};
}

// `mapComments` transforms a slice of syntax.Comment into a slice of Comment by converting each comment's hash, text, start, and end positions using mapPos. It preserves the order of the comments and returns an empty slice if the input is nil or empty.
func mapComments(comments []syntax.Comment) []Comment {
	commentsSize := len(comments)
	commentList := make([]Comment, commentsSize)
	for i := range commentsSize {
		commentList[i] = mapComment(comments[i])
	}
	return commentList
}

func mapLit(lit *syntax.Lit) *Lit {
	if lit == nil {
		return nil
	}
	return &Lit{
		Value:    lit.Value,
		ValuePos: mapPos(lit.ValuePos),
		ValueEnd: mapPos(lit.ValueEnd),
		Pos:      mapPos(lit.Pos()),
		End:      mapPos(lit.End()),
	}
}

func mapLoop(node syntax.Loop) Loop {
	if node == nil {
		return nil
	}
	switch node := node.(type) {
		case *syntax.WordIter:
			return &WordIter{
				Type: "WordIter",
				Name: *mapLit(node.Name),
				Items: mapWords(node.Items),
				Pos: mapPos(node.Pos()),
				End: mapPos(node.End()),
			}
		case *syntax.CStyleLoop:
			return &CStyleLoop{
				Type: "CStyleLoop",
				Init: mapArithmExpr(node.Init),
				Cond: mapArithmExpr(node.Cond),
				Post: mapArithmExpr(node.Post),
				Pos: mapPos(node.Pos()),
				End: mapPos(node.End()),
			}
		default:
			return nil;
	}
}

func mapPos(pos syntax.Pos) Pos {
	return Pos{
		Offset: pos.Offset(),
		Line:   pos.Line(),
		Col:    pos.Col(),
	}
}

// `mapRedirects` converts a slice of syntax.Redirect pointers into a slice of custom Redirect structures.
// It maps each redirect’s operator position, associated literal (if present), word, heredoc, and overall positional data using helper functions.
// If the literal component (N) is non-nil, it is transformed into a Lit structure that encapsulates both its value and positional information.
func mapRedirects(redirects []*syntax.Redirect) []Redirect {
	redirsSize := len(redirects)
	redirs := make([]Redirect, redirsSize)
	for i := range redirsSize {
		curr := redirects[i]
		redirs[i] = Redirect{
			OpPos: mapPos(curr.OpPos),
			Op:    curr.Op.String(),
			N:     mapLit(curr.N),
			Word:  mapWord(curr.Word),
			Hdoc:  mapWord(curr.Hdoc),
			Pos:   mapPos(curr.Pos()),
			End:   mapPos(curr.End()),
		}
	}
	return redirs
}

func mapStmt(stmt *syntax.Stmt) Stmt {
	return Stmt{
		Comments: mapComments(stmt.Comments),
		Cmd: mapCommand(stmt.Cmd),
		Position: mapPos(stmt.Position),
		Semicolon: mapPos(stmt.Semicolon),
		Negated: stmt.Negated,
		Background: stmt.Background,
		Coprocess: stmt.Coprocess,
		Redirs: mapRedirects(stmt.Redirs),
		Pos: mapPos(stmt.Pos()),
		End: mapPos(stmt.End()),
	}
}

// `mapStmts` converts a slice of *syntax.Stmt into a slice of Stmt by mapping each statement's components—including comments, command node, positional information, semicolon, redirections, and execution flags (negated, background, coprocess).
func mapStmts(stmts []*syntax.Stmt) []Stmt {
	stmtsSize := len(stmts)
	stmtList := make([]Stmt, stmtsSize)
	for i := range stmtsSize {
		stmtList[i] = mapStmt(stmts[i])
	}
	return stmtList
}

func mapTestExpr(node syntax.TestExpr) TestExpr {
	if node == nil {
		return nil
	}
	switch node := node.(type) {
		case *syntax.BinaryTest:
			return &BinaryTest{
				Type: "BinaryTest",
				Op: node.Op.String(),
				X: mapTestExpr(node.X),
				Y: mapTestExpr(node.Y),
				Pos: mapPos(node.Pos()),
				End: mapPos(node.End()),
			}
		case *syntax.UnaryTest:
			return &UnaryTest{
				Type: "UnaryTest",
				Op: node.Op.String(),
				X: mapTestExpr(node.X),
				Pos: mapPos(node.Pos()),
				End: mapPos(node.End()),
			}
		case *syntax.ParenTest:
			return &ParenTest{
				Type: "ParenTest",
				X: mapTestExpr(node.X),
				Pos: mapPos(node.Pos()),
				End: mapPos(node.End()),
			}
		default:
			return nil
	}	
}

// `mapWord` converts a *syntax.Word into a custom *Word structure. It maps each part of the syntax.Word using mapNode,
// extracts the literal via Lit(), and maps the start and end positions using mapPos. If the input word is nil, it returns nil.
func mapWord(word *syntax.Word) *Word {
	if word == nil {
		return nil
	}

	size := len(word.Parts)
	parts := make([]WordPart, size)
	for i := range size {
		parts[i] = mapWordPart(word.Parts[i])
	}

	return &Word{
		Type: "Word",
		Parts: parts,
		Pos:   mapPos(word.Pos()),
		End:   mapPos(word.End()),
	}
}

func mapWords(words []*syntax.Word) []Word {
	wordsSize := len(words)
	wordList := make([]Word, wordsSize)
	for i := range wordsSize {
		wordList[i] = *mapWord(words[i])
	}
	return wordList
}

func mapWordPart(part syntax.WordPart) WordPart {
	if part == nil {
		return nil
	}
	switch part := part.(type) {
		case *syntax.CmdSubst:
			return &CmdSubst{
				Type: "CmdSubst",
				TempFile: part.TempFile,
				ReplyVar: part.ReplyVar,
				Stmts: mapStmts(part.Stmts),
				Pos: mapPos(part.Pos()),
				End: mapPos(part.End()),
			}
		case *syntax.DblQuoted:
			return &DblQuoted{
				Type: "DblQuoted",
				Dollar: part.Dollar,
				Parts: mapWordParts(part.Parts),
				Left: mapPos(part.Left),
				Right: mapPos(part.Right),
				Pos: mapPos(part.Pos()),
				End: mapPos(part.End()),
			}
		case *syntax.Lit:
			return &Lit{
				ValuePos: mapPos(part.Pos()),
				ValueEnd: mapPos(part.End()),
				Value:    part.Value,
				Pos:      mapPos(part.Pos()),
				End:      mapPos(part.End()),
			}
		case *syntax.ParamExp:
			return &ParamExp{
				Type: "ParamExp",
				Short: part.Short,
				Excl: part.Excl,
				Length: part.Length,
				Width: part.Width,
				Param: *mapLit(part.Param),
				Index: mapArithmExpr(part.Index),
				// Slice: mapSlice(part.Slice),
				// Repl: mapReplace(part.Repl),
				Names: part.Names.String(),
				// Exp: mapExpansion(part.Exp),
				Pos: mapPos(part.Pos()),
				End: mapPos(part.End()),
			}
		case *syntax.SglQuoted:
			return &SglQuoted{
				Type: "SglQuoted",
				Dollar: part.Dollar,
				Value: part.Value,
				Pos: mapPos(part.Pos()),
				End: mapPos(part.End()),
			}
		default:
			return nil
	}
}

func mapWordParts(wordParts []syntax.WordPart) []WordPart {
	outputSize := len(wordParts)
	outputList := make([]WordPart, outputSize)
	for i := range outputSize {
		outputList[i] = mapWordPart(wordParts[i])
	}
	return outputList
}

func MapFile(file syntax.File) File {
	return File{
		Type: "File",
		Name: file.Name,
		Stmts: mapStmts(file.Stmts),
		Last: mapComments(file.Last),
		Pos:  mapPos(file.Pos()),
		End:  mapPos(file.End()),
	}
}
