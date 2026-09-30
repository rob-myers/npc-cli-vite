import type { Term } from "@npc-cli/prolog/types";

/** Arg indices from a node's body down to a subterm */
export type Path = number[];

export type Compound = { f: string; args: Term[] };
export type Combinator = Compound & { f: CombinatorKey };
export type CombinatorKey = "seq" | "par" | "alt";

export const combinatorKeys: CombinatorKey[] = ["seq", "par", "alt"];

export function isCompound(t: Term): t is Compound {
  return typeof t === "object" && !Array.isArray(t) && "f" in t;
}

export function isCombinator(t: Term): t is Combinator {
  return isCompound(t) && (combinatorKeys as string[]).includes(t.f);
}

export function isVar(t: Term): t is { v: string } {
  return typeof t === "object" && !Array.isArray(t) && "v" in t;
}

export function getAt(t: Term, path: Path): Term {
  return path.reduce((sub, i) => (sub as Compound).args[i], t);
}

export function setAt(t: Term, path: Path, sub: Term): Term {
  if (path.length === 0) return sub;
  const c = t as Compound;
  const [i, ...rest] = path;
  return { f: c.f, args: c.args.map((a, j) => (j === i ? setAt(a, rest, sub) : a)) };
}

/** The combinator holding `path`, if any, and `path`'s index in it */
export function parentOf(t: Term, path: Path): null | { path: Path; parent: Combinator; index: number } {
  if (path.length === 0) return null;
  const parentPath = path.slice(0, -1);
  const parent = getAt(t, parentPath);
  return isCombinator(parent) ? { path: parentPath, parent, index: path[path.length - 1] } : null;
}

export function wrapAt(t: Term, path: Path, f: CombinatorKey): Term {
  return setAt(t, path, { f, args: [getAt(t, path)] });
}

/** A combinator gives way to its parts: spliced into a parent combinator, else only if just one */
export function unwrapAt(t: Term, path: Path): null | Term {
  const sub = getAt(t, path);
  if (!isCombinator(sub)) return null;
  const p = parentOf(t, path);
  if (p !== null) return setAt(t, p.path, splice(p.parent, p.index, 1, ...sub.args));
  return sub.args.length === 1 ? setAt(t, path, sub.args[0]) : null;
}

/** After `path` in its combinator, else `seq(it, leaf)` */
export function insertAfter(t: Term, path: Path, leaf: Term): { term: Term; path: Path } {
  const p = parentOf(t, path);
  if (p !== null) {
    return { term: setAt(t, p.path, splice(p.parent, p.index + 1, 0, leaf)), path: [...p.path, p.index + 1] };
  }
  return { term: setAt(t, path, { f: "seq", args: [getAt(t, path), leaf] }), path: [...path, 1] };
}

/** Out of its combinator; a combinator left with one part becomes it */
export function removeAt(t: Term, path: Path): null | Term {
  const p = parentOf(t, path);
  if (p === null) return null;
  const next = splice(p.parent, p.index, 1);
  return setAt(t, p.path, next.args.length === 1 ? next.args[0] : next);
}

export function moveAt(t: Term, path: Path, delta: -1 | 1): null | { term: Term; path: Path } {
  const p = parentOf(t, path);
  const to = (p?.index ?? -1) + delta;
  if (p === null || to < 0 || to >= p.parent.args.length) return null;
  const args = [...p.parent.args];
  [args[p.index], args[to]] = [args[to], args[p.index]];
  return { term: setAt(t, p.path, { f: p.parent.f, args }), path: [...p.path, to] };
}

function splice(c: Combinator, start: number, deleteCount: number, ...items: Term[]): Combinator {
  const args = [...c.args];
  args.splice(start, deleteCount, ...items);
  return { f: c.f, args };
}

/** For display only: Prolog's own `write` is the source of truth */
export function termText(t: Term): string {
  if (typeof t === "number") return String(t);
  if (typeof t === "string") return /^[a-z][a-zA-Z0-9_]*$/.test(t) ? t : `'${t.replace(/'/g, "\\'")}'`;
  if (Array.isArray(t)) return `[${t.map(termText).join(", ")}]`;
  if ("v" in t) return t.v;
  if ("s" in t) return JSON.stringify(t.s);
  return `${termText(t.f)}(${t.args.map(termText).join(", ")})`;
}

export function samePath(a: null | Path, b: null | Path) {
  return a !== null && b !== null && a.length === b.length && a.every((x, i) => x === b[i]);
}
