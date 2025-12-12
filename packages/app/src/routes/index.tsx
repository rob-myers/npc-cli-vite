import { testLoadWasm } from "@npc-cli/cli/src/test-load-wasm";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  component: Index,
});

function Index() {
  return (
    <>
      <h1 className="text-3xl">My App</h1>
      <div>Hello, world!</div>
      <button
        type="button"
        className="border rounded-xl px-4 py-2 bg-gray-100 cursor-pointer hover:brightness-125"
        onClick={testLoadWasm}
      >
        Test load wasm
      </button>
    </>
  );
}
