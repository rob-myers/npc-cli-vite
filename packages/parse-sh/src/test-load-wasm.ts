import { parse } from "./parse";

/**
 * https://tinygo.org/docs/guides/webassembly/wasm/
 *
 * Supports interactive parse
 */
export async function testLoadWasm() {
  // const interactive = false;
  // const input = "foo bar baz"; // ✅
  // const input = "for bar baz"; // ❌ 1:1: "for foo" must be followed by "in", "do", ;, or a newline
  // const input = "for '"; // ❌ 1:5: reached EOF without closing quote '

  const interactive = true;
  // const input = "foo bar baz\n"; // ✅
  // const input = "foo bar baz"; // ✅ (null)
  // const input = "foo bar '\n"; // ✅ (null)
  const input = "foo bar '\n'\n"; // ✅

  // Can be `null` if interactive parse and not enough input yet
  const parseResult = await parse(input, { interactive });
  console.log({ parseResult });

  return parseResult;
}
