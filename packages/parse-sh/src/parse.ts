// Based on https://github.com/un-ts/sh-syntax/blob/main/src/processor.ts
import "./vendors/wasm_exec.js";
import type { MvdanSh } from "./mvdan-sh.d";
import { LangVariant, ParseResultSchema, type ShOptions } from "./mvdan-sh.model.js";

/**
 * The one instance, made on first use and kept: a fresh instance per parse cost an instantiation
 * of the 2.6 MB module every time, several of them on the main thread whilst the tty ran its profile
 */
export function loadWasm(): Promise<WasmInstance> {
  return (wasm.instance ??= (async () => {
    try {
      console.log("Loading WASM from", wasm.url);
      // compiled while it downloads, rather than after
      const module = await (wasm.module ??= WebAssembly.compileStreaming(fetch(wasm.url)).catch(
        // e.g. server sent the wrong Content-Type, which makes streaming throw
        async () => WebAssembly.compile(await fetch(wasm.url).then((resp) => resp.arrayBuffer())),
      ));
      const go = new Go();
      const instance = (await WebAssembly.instantiate(module, go.importObject)) as WasmInstance;
      // runs `main` synchronously; the promise is for the program's exit, which needn't come
      void go.run(instance);
      return instance;
    } catch (e) {
      wasm.instance = null; // so a later parse can try again
      throw e;
    }
  })());
}

const wasm = {
  /** Compiled once */
  module: null as null | Promise<WebAssembly.Module>,
  instance: null as null | Promise<WasmInstance>,
  url: new URL("../main.wasm", import.meta.url).href,
};

type WasmInstance = WebAssembly.Instance & { exports: WasmInstanceExports };

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/**
 * Parse or interactive parse.
 */
export async function parse(
  text: string,
  {
    filepath,
    interactive = false,
    keepComments = true,
    variant = LangVariant.LangBash,
    stopAt = "",
    recoverErrors = 0,
  }: ShOptions = {},
): Promise<null | {
  text: string;
  file: MvdanSh.File;
  message: string;
}> {
  const {
    memory,
    wasmAlloc,
    wasmFree,
    parse: transpiledParse,
    interactiveParse: transpiledInteractiveParse,
  } = (await loadWasm()).exports;

  const filePath = encoder.encode(filepath);
  const textBuffer = encoder.encode(text);
  const uStopAt = encoder.encode(stopAt);

  const filePathPointer = wasmAlloc(filePath.byteLength);
  new Uint8Array(memory.buffer).set(filePath, filePathPointer);
  const textPointer = wasmAlloc(textBuffer.byteLength);
  new Uint8Array(memory.buffer).set(textBuffer, textPointer);
  const stopAtPointer = wasmAlloc(uStopAt.byteLength);
  new Uint8Array(memory.buffer).set(uStopAt, stopAtPointer);

  const resultPointer = (interactive === true ? transpiledInteractiveParse : transpiledParse)(
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

  if (resultPointer === 0) {
    if (interactive === true) {
      return null;
    }
    throw new Error("Non-interactive parse failed: resultPointer is 0");
  }

  const resultBuffer = new Uint8Array(memory.buffer).subarray(resultPointer);
  const end = resultBuffer.indexOf(0);
  const resultString = decoder.decode(resultBuffer.subarray(0, end));
  // console.log({ resultString });

  try {
    const { file, message, text, parseError } = ParseResultSchema.parse(resultString);
    if (parseError) {
      throw new ParseError(parseError);
    }

    return {
      text,
      file: {
        type: "File",
        Name: file.Name,
        Stmts: file.Stmts as MvdanSh.Stmt[],
      },
      message,
    };
  } catch (e) {
    if (e instanceof ParseError) {
      throw e;
    } else {
      console.error(e);
      throw new Error(`zod parse error: ${e}`);
    }
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
  interactiveParse: (
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

export class ParseError extends Error {
  Text: string;
  Filename?: string;
  Incomplete?: boolean;

  constructor({
    Filename,
    Incomplete,
    Text,
  }: {
    Text: string;
    Filename?: string;
    Incomplete?: boolean;
  }) {
    super(Text);
    this.Filename = Filename;
    this.Incomplete = Incomplete;
    this.Text = Text;
  }
}
