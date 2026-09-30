import dataUrl from "swipl-wasm/dist/swipl/swipl-web.data?url";
import SWIPL from "swipl-wasm/dist/swipl/swipl-web.js";
import wasmUrl from "swipl-wasm/dist/swipl/swipl-web.wasm?url";
import prelude from "./prelude.pl?raw";
import type { Bindings, MsgFromPrologWorker, MsgToPrologWorker, PrologOp } from "./types";

/** What we use of swipl-wasm's `prolog`, whose own typing of `forEach` is wrong */
type Prolog = {
  forEach(
    goal: string,
    input: object,
    onAnswer: (answer: unknown) => void,
    opts: { heartbeat: number },
  ): Promise<unknown>;
  abort(): void;
  load_string(text: string, id: string): Promise<unknown>;
};

/** Inferences between yields, so an abort lands */
const heartbeat = 10_000;

const ready = (async () => {
  const swipl = await SWIPL({
    arguments: ["-q"],
    locateFile: (file: string) => (file.endsWith(".wasm") ? wasmUrl : file.endsWith(".data") ? dataUrl : file),
  });
  const prolog = swipl.prolog as unknown as Prolog;
  await prolog.load_string(prelude, "/prelude.pl");
  return prolog;
})();

/** One op at a time: they share the main engine, and an abort then means the running one */
let chain = Promise.resolve();
let running: null | number = null;
const aborted = new Set<number>();

self.addEventListener("message", (e: MessageEvent<MsgToPrologWorker>) => {
  const msg = e.data;
  if (msg.type === "prolog-abort") {
    aborted.add(msg.uid);
    if (running === msg.uid) ready.then((prolog) => prolog.abort());
  } else if (msg.type === "prolog") {
    chain = chain.then(() => runOp(msg.uid, msg.op));
  }
});

async function runOp(uid: number, op: PrologOp) {
  if (aborted.delete(uid)) return post({ type: "prolog-error", uid, error: "aborted" });
  running = uid;
  try {
    const prolog = await ready;
    const output = await dispatch(prolog, uid, op);
    post({ type: "prolog-done", uid, output });
  } catch (e) {
    post({ type: "prolog-error", uid, error: aborted.has(uid) ? "aborted" : errorText(e) });
  } finally {
    running = null;
    aborted.delete(uid);
  }
}

async function dispatch(prolog: Prolog, uid: number, op: PrologOp): Promise<unknown> {
  switch (op.key) {
    case "query":
      await each(prolog, "pl_answer(Goal, S)", { Goal: op.goal }, (s) =>
        post({ type: "prolog-answer", uid, answer: JSON.parse(s) as Bindings }),
      );
      return;
    case "consult":
      await prolog.load_string(op.text, op.id);
      return;
    case "parse":
      return JSON.parse(await one(prolog, "pl_parse(Text, S)", { Text: op.text }));
    case "write":
      return one(prolog, "pl_write(Json, S)", { Json: JSON.stringify(op.term) });
    case "nodes":
      return JSON.parse(await one(prolog, "pl_nodes(S)", {}));
    case "set-node":
      await each(prolog, "pl_set_node(Name, Json)", { Name: op.name, Json: JSON.stringify(op.body) });
      return;
    case "remove-node":
      await each(prolog, "pl_remove_node(Name)", { Name: op.name });
      return;
    case "reset":
      await prolog.load_string(op.rules, "/rules.pl");
      await each(prolog, "pl_reset_nodes(Json)", { Json: JSON.stringify(op.nodes) });
      return;
    default:
      throw Error(`unknown op: ${JSON.stringify(op satisfies never)}`);
  }
}

/** Runs `goal` to exhaustion, handing each solution's `S` (a JSON string) to `onS` */
async function each(prolog: Prolog, goal: string, input: Record<string, string>, onS?: (s: string) => void) {
  await prolog.forEach(goal, input, (answer) => onS?.(stringOf((answer as { S: unknown }).S)), { heartbeat });
}

async function one(prolog: Prolog, goal: string, input: Record<string, string>) {
  let s: null | string = null;
  await each(prolog, `once((${goal}))`, input, (x) => (s = x));
  if (s === null) throw Error(`failed: ${goal}`);
  return s as string;
}

/** A Prolog string arrives wrapped, an atom as is */
function stringOf(x: unknown) {
  return typeof x === "string" ? x : String((x as { v: string }).v);
}

function errorText(e: unknown) {
  return typeof e === "string" ? e : e instanceof Error ? e.message : JSON.stringify(e);
}

function post(msg: MsgFromPrologWorker) {
  self.postMessage(msg);
}

if (import.meta.hot) {
  import.meta.hot.accept(() => post({ type: "prolog-hmr" }));
}
