import z from "zod";
// Based on https://github.com/un-ts/sh-syntax/blob/main/src/processor.ts
import "../vendors/wasm_exec";
import { jsonParser } from "../../util/src/json-parser.js";
import { type IParseError, LangVariant, type ShOptions } from "./mvdan-sh.model.js";

/**
 * https://tinygo.org/docs/guides/webassembly/wasm/
 * 🚧 support interactive parse
 */
export async function testLoadWasm() {
  // const result = await parse("for bar baz"); // ❌ 1:1: "for foo" must be followed by "in", "do", ;, or a newline
  const parseResult = await parse("foo bar baz"); // ✅
  // const result = await parse("foo '"); // ❌ 1:5: reached EOF without closing quote '
  console.log({ parseResult });
}

const wasm = {
  buffer: new ArrayBuffer(),
  promise: null as null | Promise<ArrayBuffer>,
  ready: false,
  url: new URL("../main.wasm", import.meta.url).href,
};

export async function loadWasm() {
  const go = new Go();

  // source https://github.com/un-ts/sh-syntax/blob/d90f699c02b802adde9c32555de56b5fec695cc6/src/processor.ts#L156
  // doesn't use instantiateStreaming
  if (!wasm.ready) {
    wasm.buffer = await (wasm.promise ??= fetch(wasm.url).then((resp) => resp.arrayBuffer()));
    wasm.ready = true;
  }

  const wasmInstance = await WebAssembly.instantiate(wasm.buffer, go.importObject).then((obj) => {
    go.run(obj.instance);
    return obj.instance;
  });

  return {
    go,
    wasm: wasmInstance as WebAssembly.Instance & { exports: WasmInstanceExports },
  };
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

async function parse(
  text: string,
  {
    filepath,
    keepComments = true,
    variant = LangVariant.LangBash,
    stopAt = "",
    recoverErrors = 0,
  }: ShOptions = {},
) {
  const { go, wasm } = await loadWasm();

  /**
   * Do not await this promise, because it only resolves once the go main()
   * function has exited. But we need the main function to stay alive to be
   * able to call the `parse` function.
   */
  void go.run(wasm);

  const { memory, wasmAlloc, wasmFree, parse: wasmParse } = wasm.exports;

  const filePath = encoder.encode(filepath);
  const textBuffer = encoder.encode(text);
  const uStopAt = encoder.encode(stopAt);

  const filePathPointer = wasmAlloc(filePath.byteLength);
  new Uint8Array(memory.buffer).set(filePath, filePathPointer);
  const textPointer = wasmAlloc(textBuffer.byteLength);
  new Uint8Array(memory.buffer).set(textBuffer, textPointer);
  const stopAtPointer = wasmAlloc(uStopAt.byteLength);
  new Uint8Array(memory.buffer).set(uStopAt, stopAtPointer);

  const resultPointer = wasmParse(
    filePathPointer,
    filePath.byteLength,
    filePath.byteLength,

    textPointer,
    textBuffer.byteLength,
    textBuffer.byteLength,

    keepComments,
    variant,
    stopAtPointer,
    uStopAt.byteLength,
    uStopAt.byteLength,
    recoverErrors,
  );

  wasmFree(filePathPointer);
  wasmFree(textPointer);
  wasmFree(stopAtPointer);

  const resultBuffer = new Uint8Array(memory.buffer).subarray(resultPointer);
  const end = resultBuffer.indexOf(0);
  const resultString = decoder.decode(resultBuffer.subarray(0, end));
  // console.log({ resultString });

  try {
    // const resultObj = JSON.parse(resultString);
    const resultObj = ParseResultSchema.parse(resultString);
    return resultObj;
  } catch (e) {
    console.error(e);
    throw new ParseError({
      Filename: filepath,
      Text: resultString,
      Incomplete: true,
    });
  }
}

type WasmInstanceExports = {
  memory: WebAssembly.Memory;
  wasmAlloc: (size: number) => number;
  wasmFree: (pointer: number) => void;
  parse: (
    filePathPointer: number,
    filePath0: number,
    filePath1: number,

    textPointer: number,
    text0: number,
    text1: number,

    keepComments: boolean,
    variant: LangVariant,
    stopAtPointer: number,
    stopAt0: number,
    stopAt1: number,
    recoverErrors: number,
  ) => number;
};

const ParseResultSchema = jsonParser.pipe(
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
export class ParseError extends Error implements IParseError {
  Filename?: string;
  Incomplete: boolean;
  Text: string;

  constructor({ Filename, Incomplete, Text }: IParseError) {
    super(Text);
    this.Filename = Filename;
    this.Incomplete = Incomplete;
    this.Text = Text;
  }
}
