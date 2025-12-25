import { parseService } from "@npc-cli/cli";
import { testLoadWasm } from "@npc-cli/parse-sh";
import { createFileRoute } from "@tanstack/react-router";
import { stringify as jsStringify } from "javascript-stringify";
import { useState } from "react";

export const Route = createFileRoute("/test-wasm/")({
  component: RouteComponent,
});

function RouteComponent() {
  const [parseShResponse, setParseShResponse] = useState<undefined | string>();
  const [cliResponse, setCliResponse] = useState<undefined | string>();

  return (
    <div className="bg-background text-on-background flex flex-col items-center gap-4 m-4">
      <button
        type="button"
        className="flex gap-2 border rounded-xl px-4 py-2 cursor-pointer hover:brightness-125"
        onClick={async () => {
          const testLoadWasmParsed = await testLoadWasm();
          setParseShResponse((x) => (x ? undefined : jsStringify(testLoadWasmParsed, null, 2)));
        }}
      >
        Test wasm
        <span className="text-emerald-200">@npc-cli/parse-sh</span>
      </button>
      {parseShResponse && (
        <pre className="w-full text-sm whitespace-break-spaces border rounded-2xl p-8">
          <div className="max-h-[500px] overflow-auto">{parseShResponse}</div>
        </pre>
      )}

      <button
        type="button"
        className="flex gap-2 border rounded-xl px-4 py-2 cursor-pointer hover:brightness-125"
        onClick={async () => {
          const demoCommandParsed = await parseService.parse(demoCommandToParse);
          const prettyParsed = jsStringify(demoCommandParsed, null, 2);
          console.log({ demoCommandParsed });
          setCliResponse((x) => (x === prettyParsed ? undefined : prettyParsed));
        }}
      >
        Test wasm
        <span className="text-emerald-200">@npc-cli/cli</span>
      </button>
      {cliResponse && (
        <pre className="w-full text-sm whitespace-break-spaces border rounded-2xl p-8">
          <div className="max-h-[500px] overflow-auto">{cliResponse}</div>
        </pre>
      )}
    </div>
  );
}

const demoCommandToParse = `echo {1..5} && sleep 2 && echo "Done"`;
// const demoCommandToParse = `while true; do echo foo; done`;
// const demoCommandToParse = `echo "hello"`;
