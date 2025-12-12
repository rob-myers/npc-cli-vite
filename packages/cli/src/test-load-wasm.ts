import "../vendors/wasm_exec";

/**
 * https://tinygo.org/docs/guides/webassembly/wasm/
 */
export async function testLoadWasm() {
  alert("loading...");

  const go = new Go();

  const WASM_URL = new URL("../main.wasm", import.meta.url).href;

  const wasm = await (async () =>
    "instantiateStreaming" in WebAssembly
      ? WebAssembly.instantiateStreaming(fetch(WASM_URL), go.importObject).then((obj) => {
          go.run(obj.instance);
          return obj.instance;
        })
      : fetch(WASM_URL)
          .then((resp) => resp.arrayBuffer())
          .then((bytes) =>
            WebAssembly.instantiate(bytes, go.importObject).then((obj) => {
              go.run(obj.instance);
              return obj.instance;
            }),
          ))();

  // 🚧
  console.log({ wasm });
}
