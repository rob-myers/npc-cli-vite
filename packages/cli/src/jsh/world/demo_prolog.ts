import { type Bindings, prolog } from "@npc-cli/prolog";
import { termSlot } from "./term";

/**
 * Each solution of a Prolog goal as `{ Var: Term }`, or with `--text` as `X = …`
 * ```sh
 * pl 'member(X, [a, b])'
 * pl --text 'unmet(greet, Step, F)'
 * ```
 */
export async function* pl({ api, args }: JshCli.RunArg) {
  const { operands, opts } = api.getOpts(args, { boolean: ["text"] });
  const goal = operands.join(" ");
  if (goal === "") throw Error("usage: pl [--text] '{goal}'");
  api.setPausable("world", false); // pure computation

  const abort = new AbortController();
  const handlers = api.handleStatus({ cleanup: () => abort.abort() });
  let count = 0;
  try {
    for await (const answer of prolog.query(goal, abort.signal)) {
      count++;
      yield opts.text === true ? await toText(answer) : answer;
    }
  } finally {
    handlers.dispose();
  }
  if (abort.signal.aborted === true) throw api.getKillError();
  if (count === 0) throw api.getShError("false");
}

/**
 * Print `/shared/term/rules`, or replace them and reconsult
 * ```sh
 * pl_rules
 * pl_rules 'foo(bar).'
 * ```
 */
export async function pl_rules({ api, args }: JshCli.RunArg) {
  const lines = [args.join(" ")];
  if (api.isTtyAt(0) === false) {
    let datum: unknown;
    while ((datum = await api.read()) !== api.eof) lines.push(String(datum));
  }
  const text = lines.join("\n").trim();
  if (text === "") return ensureTerms().rules;
  ensureTerms();
  await termSlot.setRules(text);
}

/**
 * Print a behaviour node, or set it
 * ```sh
 * pl_node greet
 * pl_node greet 'seq(move(R, P), say(R, hi))'
 * ```
 */
export async function pl_node({ args: [name, ...rest] }: JshCli.RunArg) {
  if (!name) throw Error("usage: pl_node {name} ['{term}']");
  const text = rest.join(" ");
  if (text !== "") return void (await prolog.setNode(name, await prolog.parse(text)));
  const node = (await prolog.nodes()).find((n) => n.name === name);
  if (node === undefined) throw Error(`no node: ${name}`);
  return prolog.write(node.body);
}

/** Each behaviour node's name */
export async function* pl_nodes(_ct: JshCli.RunArg) {
  for (const node of await prolog.nodes()) yield node.name;
}

/** Replace this map's rules and nodes with a small demo: `pl --text 'unmet(N, Step, F)'` */
export async function demo_prolog_seed(_ct: JshCli.RunArg) {
  ensureTerms();
  await termSlot.setRules(demoRules);
  for (const node of await prolog.nodes()) await prolog.removeNode(node.name);
  for (const [name, text] of Object.entries(demoNodes)) {
    await prolog.setNode(name, await prolog.parse(text));
  }
}

function ensureTerms() {
  const t = termSlot.get();
  if (t === undefined) throw Error("run `terms` first");
  return t;
}

async function toText(answer: Bindings) {
  const parts = await Promise.all(
    Object.entries(answer).map(async ([key, term]) => `${key} = ${await prolog.write(term)}`),
  );
  return parts.length === 0 ? "true" : parts.join(", ");
}

const demoRules = `
% What each intent needs beforehand, and what it brings about
requires(move(_, _), []).
provides(move(N, P), [at(N, P), near(N, P)]).
requires(open(D), [near(_, D)]).
provides(open(D), [open(D)]).
requires(say(N, _), [near(N, _)]).
provides(say(N, M), [told(N, M)]).
requires(wait(_), []).
provides(wait(_), []).

% Step of node Name requires F, yet no step surely before it provides F
unmet(Name, Step, F) :-
    node_named(Name, Body),
    before(Body, Step, Earlier),
    requires(Step, Fs), member(F, Fs),
    \\+ ( member(E, Earlier), provides(E, Ps), member(P, Ps), subsumes_term(F, P) ).

% Step is a leaf of T, and Earlier the leaves that surely run before it
before(T, Step, Earlier) :-
    compound(T), compound_name_arguments(T, seq, Args), !,
    seq_before(Args, [], Step, Earlier).
before(T, Step, Earlier) :-
    compound(T), compound_name_arguments(T, F, Args), ( F == par ; F == alt ), !,
    member(A, Args), before(A, Step, Earlier).
before(Step, Step, []).

seq_before([A|As], Acc, Step, Earlier) :-
    (   before(A, Step, E0), append(Acc, E0, Earlier)
    ;   leaves(A, L), append(Acc, L, Acc1), seq_before(As, Acc1, Step, Earlier)
    ).

% The leaves surely run by T: every branch of seq and par, no branch of alt
leaves(T, L) :-
    compound(T), compound_name_arguments(T, F, Args), ( F == seq ; F == par ), !,
    maplist(leaves, Args, Ls), append(Ls, L).
leaves(T, []) :- compound(T), compound_name_arguments(T, alt, _), !.
leaves(L, [L]).
`.trim();

const demoNodes = {
  greet: "seq(move(R, door(A, B)), open(door(A, B)), par(move(R, B), seq(wait(arrived(R)), say(G, hi))))",
  patrol: "seq(move(R, P), alt(say(R, clear), seq(wait(alarm), say(R, alarm))))",
};
