package processor

import (
	"bytes"

	"mvdan.cc/sh/v3/syntax"
)

var parser  *syntax.Parser;

var incomplete = true;

// 🚧 store arg when complete for usage elsewhere
func TrackIncomplete(arg []*syntax.Stmt) bool {
	incomplete = parser.Incomplete();
	return false;
}


type ParserOptions struct {
	KeepComments  bool
	Variant       syntax.LangVariant
	StopAt        string
	RecoverErrors int
}

type SyntaxOptions struct {
	ParserOptions
}

// `Parse` converts shell script text into a structured syntax tree.
// It assembles parser options based on the provided configuration—such as whether to keep comments,
// the shell syntax variant to use, an optional stopping point, and the desired error recovery level.
// The supplied file path is used for contextual error reporting.
// It returns a syntax.File representing the parsed script, or an error if parsing fails.
func Parse(text string, filepath string, parserOptions ParserOptions) (*syntax.File, error) {
	var options []syntax.ParserOption

	options = append(options, syntax.KeepComments(parserOptions.KeepComments), syntax.Variant(parserOptions.Variant))

	if parserOptions.StopAt != "" {
		options = append(options, syntax.StopAt(parserOptions.StopAt))
	}

	if parserOptions.RecoverErrors != 0 {
		options = append(options, syntax.RecoverErrors(parserOptions.RecoverErrors))
	}

	parser = syntax.NewParser(options...)

	return parser.Parse(bytes.NewReader([]byte(text)), filepath)
}

func InteractiveParse(text string, filepath string, parserOptions ParserOptions) (*syntax.File, error) {
	var options []syntax.ParserOption

	options = append(options, syntax.KeepComments(parserOptions.KeepComments), syntax.Variant(parserOptions.Variant))

	parser = syntax.NewParser(options...)
	parser.Interactive(bytes.NewReader([]byte(text)), TrackIncomplete);

	if (incomplete) {
		return nil, nil;
	} else {
		return parser.Parse(bytes.NewReader([]byte(text)), filepath);
	}
}
