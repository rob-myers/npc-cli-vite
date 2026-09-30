import { type PrologEvent, prolog, type Term } from "@npc-cli/prolog";
import { sharedMapSlot } from "./shared.service";

type TermSlot = {
  /** Program text, consulted as `/rules.pl` */
  rules: string;
  /** Each behaviour node's body, by name */
  nodes: Map<string, Term>;
};

/** `/shared/term`, kept per map. Prolog's knowledge base is live; this is what it is reset from */
const term = sharedMapSlot<TermSlot>("term", () => ({ rules: "", nodes: new Map() }));

term.setHandler(function onWorldEvent(e, w) {
  if (e.key !== "map-settled") return;
  const t = restoreTerm(w.mapKey);
  if (prolog.started() === true) resetProlog(t);
});

prolog.subscribeKeyed("term", function onPrologEvent(e: PrologEvent) {
  const t = term.get() as TermSlot | undefined;
  if (t === undefined) return; // `terms` not yet run
  if (e.key === "started") {
    resetProlog(t);
  } else {
    // e.g. edited in the term-graph, or asserted by `pl`
    prolog.nodes().then((nodes) => (t.nodes = new Map(nodes.map((n) => [n.name, n.body]))));
  }
});

/** Ensure `/shared/term` has the right type in case user modified it */
function restoreTerm(mapKey: string) {
  const t = term.restore(mapKey);
  if (typeof t.rules !== "string") t.rules = "";
  if (t.nodes instanceof Map === false) t.nodes = new Map();
  return t;
}

function resetProlog(t: TermSlot) {
  return prolog.reset(
    t.rules,
    [...t.nodes].map(([name, body]) => ({ name, body })),
  );
}

/** `demo_prolog`'s side — an object, so no shell function is made of it */
export const termSlot = {
  get: () => term.get(),
  async setRules(rules: string) {
    term.get().rules = rules;
    await resetProlog(term.get());
  },
};

/**
 * `terms` is idempotent and must be invoked to keep Prolog's knowledge base per map.
 */
export function terms(ct: JshCli.RunArg) {
  const t = restoreTerm(ct.w.mapKey);
  if (prolog.started() === true) resetProlog(t);
  ct.w.e.addKeyedListener("term", term.handle);
}
