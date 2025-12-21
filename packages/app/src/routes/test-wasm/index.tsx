import { testLoadWasm } from "@npc-cli/parse-sh";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";

export const Route = createFileRoute("/test-wasm/")({
  component: RouteComponent,
});

function RouteComponent() {
  const [parseResponse, setParseResponse] = useState("");

  return (
    <div className="bg-background text-on-background flex flex-col items-center gap-4 m-4">
      <button
        type="button"
        className=" border rounded-xl px-4 py-2  cursor-pointer hover:brightness-125"
        onClick={async () => setParseResponse(JSON.stringify(await testLoadWasm(), null, "  "))}
      >
        Test load wasm
      </button>
      <pre className="whitespace-break-spaces border rounded-2xl p-8">
        <div className="max-h-[500px]  overflow-auto">{parseResponse}</div>
      </pre>
    </div>
  );
}
