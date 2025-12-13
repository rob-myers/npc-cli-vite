import { testLoadWasm } from "@npc-cli/cli/src/test-load-wasm";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";

export const Route = createFileRoute("/test-wasm/")({
  component: RouteComponent,
});

function RouteComponent() {
  const [parseResponse, setParseResponse] = useState("");

  return (
    <div>
      <button
        type="button"
        className="border rounded-xl px-4 py-2 bg-gray-100 cursor-pointer hover:brightness-125"
        onClick={async () => setParseResponse(JSON.stringify(await testLoadWasm(), null, "  "))}
      >
        Test load wasm
      </button>
      <pre className="w-full max-h-[500px] overflow-auto whitespace-break-spaces">
        {parseResponse}
      </pre>
    </div>
  );
}
