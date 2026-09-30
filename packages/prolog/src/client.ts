import type {
  Bindings,
  MsgFromPrologWorker,
  MsgToPrologWorker,
  PrologEvent,
  PrologNode,
  PrologOp,
  PrologOutput,
  Term,
} from "./types";

export type * from "./types";

type Pending = {
  onAnswer?: (answer: Bindings) => void;
  resolve: (output: unknown) => void;
  reject: (error: Error) => void;
};

/** How long an aborted op may take to stop before the worker is replaced */
const abortGraceMs = 500;
const mutating = new Set<PrologOp["key"]>(["consult", "set-node", "remove-node", "reset"]);

/** Survives HMR of this module, so subscribers need not resubscribe */
const listeners: Map<string, (e: PrologEvent) => void> = import.meta.hot?.data.listeners ?? new Map();
const pending = new Map<number, Pending>();
const aborting = new Map<number, ReturnType<typeof setTimeout>>();
let worker: null | Worker = null;
let nextUid = 0;

function ensureWorker() {
  if (worker !== null) return worker;
  worker = new Worker(new URL("./prolog.worker.ts", import.meta.url), { type: "module" });
  worker.addEventListener("message", onMessage);
  // synchronous, so an owner's `reset` is queued before the op that spawned it
  emit({ key: "started" });
  return worker;
}

function onMessage(e: MessageEvent<MsgFromPrologWorker>) {
  const msg = e.data;
  if (msg.type === "prolog-hmr") return restart();
  clearTimeout(aborting.get(msg.uid));
  if (msg.type !== "prolog-answer") aborting.delete(msg.uid);
  const p = pending.get(msg.uid);
  if (p === undefined) return;
  if (msg.type === "prolog-answer") return p.onAnswer?.(msg.answer);
  pending.delete(msg.uid);
  if (msg.type === "prolog-done") p.resolve(msg.output);
  else p.reject(Error(msg.error));
}

function restart() {
  worker?.terminate();
  worker = null;
  aborting.forEach(clearTimeout);
  aborting.clear();
  pending.forEach((p) => p.reject(Error("prolog restarted")));
  pending.clear();
  ensureWorker();
}

function send(uid: number, op: PrologOp) {
  ensureWorker().postMessage({ type: "prolog", uid, op } satisfies MsgToPrologWorker);
}

function request<K extends Exclude<PrologOp["key"], "query">>(op: PrologOp & { key: K }): Promise<PrologOutput[K]> {
  const uid = nextUid++;
  return new Promise<unknown>((resolve, reject) => {
    pending.set(uid, { resolve, reject });
    send(uid, op);
  }).finally(() => mutating.has(op.key) && emit({ key: "changed" })) as Promise<PrologOutput[K]>;
}

/** Stop `uid` now; if the worker is not done with it soon, replace the worker */
function abort(uid: number) {
  pending.delete(uid);
  worker?.postMessage({ type: "prolog-abort", uid } satisfies MsgToPrologWorker);
  aborting.set(
    uid,
    setTimeout(() => aborting.has(uid) && restart(), abortGraceMs),
  );
}

function emit(e: PrologEvent) {
  listeners.forEach((fn) => fn(e));
}

/** Each solution of `goal`, until exhausted, aborted, or the consumer stops */
export async function* query(goal: string, signal?: AbortSignal): AsyncGenerator<Bindings> {
  const uid = nextUid++;
  const st = { answers: [] as Bindings[], end: null as null | { error?: Error }, wake: () => {} };
  pending.set(uid, {
    onAnswer: (answer) => (st.answers.push(answer), st.wake()),
    resolve: () => ((st.end = {}), st.wake()),
    reject: (error) => ((st.end = { error }), st.wake()),
  });
  const onAbort = () => ((st.end ??= {}), abort(uid), st.wake());
  signal?.addEventListener("abort", onAbort, { once: true });
  send(uid, { key: "query", goal });

  try {
    while (true) {
      const answer = st.answers.shift();
      if (answer !== undefined) {
        yield answer;
      } else if (st.end !== null) {
        if (st.end.error !== undefined) throw st.end.error;
        return;
      } else {
        await new Promise<void>((resolve) => (st.wake = resolve));
      }
    }
  } finally {
    signal?.removeEventListener("abort", onAbort);
    if (st.end === null) abort(uid);
    emit({ key: "changed" });
  }
}

export const prolog = {
  query,
  consult: (id: string, text: string) => request({ key: "consult", id, text }),
  parse: (text: string) => request({ key: "parse", text }),
  write: (term: Term) => request({ key: "write", term }),
  nodes: () => request({ key: "nodes" }),
  setNode: (name: string, body: Term) => request({ key: "set-node", name, body }),
  removeNode: (name: string) => request({ key: "remove-node", name }),
  /** Has a worker been spawned, i.e. is there a knowledge base to keep in sync */
  started: () => worker !== null,
  reset: (rules: string, nodes: PrologNode[]) => request({ key: "reset", rules, nodes }),
  /** Replaces any listener under `key`, so a hot-reloaded caller does not stack them */
  subscribeKeyed(key: string, fn: (e: PrologEvent) => void) {
    listeners.set(key, fn);
    return () => {
      if (listeners.get(key) === fn) listeners.delete(key);
    };
  },
};

if (import.meta.hot) {
  import.meta.hot.dispose((data) => {
    data.listeners = listeners;
    worker?.terminate();
  });
}
