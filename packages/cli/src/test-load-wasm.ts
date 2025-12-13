// Based on https://github.com/un-ts/sh-syntax/blob/main/src/processor.ts
import "../vendors/wasm_exec";
import type { LangVariant } from "./mvdan-sh.model.js";

/**
 * https://tinygo.org/docs/guides/webassembly/wasm/
 */
export async function testLoadWasm() {
  const { go, wasm } = await loadWasm();

  /**
   * Do not await this promise, because it only resolves once the go main()
   * function has exited. But we need the main function to stay alive to be
   * able to call the `parse` function.
   */
  void go.run(wasm);

  const { memory, wasmAlloc, wasmFree, parse } = wasm.exports;

  // 🚧
  console.log({ wasm });
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
  const wasmArrayBuffer = wasm.ready
    ? wasm.buffer
    : await // biome-ignore lint/suspicious/noAssignInExpressions: I wanna!
      (wasm.promise ??= fetch(wasm.url).then((resp) => resp.arrayBuffer()));
  wasm.ready = true;

  const wasmInstance = await WebAssembly.instantiate(wasmArrayBuffer, go.importObject).then(
    (obj) => {
      go.run(obj.instance);
      return obj.instance;
    },
  );

  return {
    go,
    wasm: wasmInstance as WebAssembly.Instance & { exports: WasmInstanceExports },
  };
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function parse(
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
) {
  // 🚧
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
