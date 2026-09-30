/** A Prolog term as JSON: an atom is a string, a proper list an array */
export type Term = number | string | { v: string } | { s: string } | { f: string; args: Term[] } | Term[];

/** One solution: a named variable of the goal to its value */
export type Bindings = Record<string, Term>;

/** A behaviour node, stored as `node(Name, Body, VarNames)` so its variables keep their names */
export type PrologNode = { name: string; body: Term };

export type PrologOp =
  | { key: "query"; goal: string }
  | { key: "consult"; id: string; text: string }
  | { key: "parse"; text: string }
  | { key: "write"; term: Term }
  | { key: "nodes" }
  | { key: "set-node"; name: string; body: Term }
  | { key: "remove-node"; name: string }
  | { key: "reset"; rules: string; nodes: PrologNode[] };

export type PrologOutput = {
  query: undefined;
  consult: undefined;
  parse: Term;
  write: string;
  nodes: PrologNode[];
  "set-node": undefined;
  "remove-node": undefined;
  reset: undefined;
};

export type MsgToPrologWorker = { type: "prolog"; uid: number; op: PrologOp } | { type: "prolog-abort"; uid: number };

export type MsgFromPrologWorker =
  | { type: "prolog-answer"; uid: number; answer: Bindings }
  | { type: "prolog-done"; uid: number; output: unknown }
  | { type: "prolog-error"; uid: number; error: string }
  | { type: "prolog-hmr" };

/** `started` means an empty knowledge base: a first worker, or one replaced after an abort or HMR */
export type PrologEvent = { key: "changed" } | { key: "started" };
