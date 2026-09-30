# Prolog

A spike: behaviour **nodes** as Prolog **terms** that Prolog reasons about but never runs (a world
side effect cannot be backtracked). See `docs/chats/DESIGN-storyline-and-ai.md` for where it heads.

## Engine: `packages/prolog`

SWI-Prolog (`swipl-wasm`) in its own worker, `prolog.worker.ts`, spawned by `client.ts` on first use,
so a page that never asks fetches none of its ~4 MB (`swipl-web.wasm` and `.data`, `?url` assets).

- **One op at a time**, all in the main engine, so an abort always means the running one.
  Queries run under `forEach`'s `heartbeat`, which yields every ~20 ms and lets `prolog.abort()`
  land. An abort not honoured within `abortGraceMs` replaces the worker.
- **All term conversion is Prolog's** (`prelude.pl`, `pl_*`), via `library(json)`: the worker passes
  JSON strings and shares no module with the main thread (`docs/workers.md`).
- `Term` (`types.ts`) is a number, an atom as a string, `{ v }` a variable, `{ s }` a string,
  `{ f, args }` a compound, or an array for a proper list.
- **Nodes keep their variables' names**: `node(Name, Body, ['R'=R, …])`. `node/2` drops them, and
  `node_named/2` binds each variable to `'$VAR'(Name)`, so distinct roles never unify.
- `prolog.subscribeKeyed(key, fn)` replaces any listener under `key` and survives HMR of the client.
  `changed` follows every mutating op and every query. `started` means an empty knowledge base: a
  first worker, or one replaced after an abort or HMR. It fires synchronously, so an owner's `reset`
  is queued before the op that spawned the worker.

## Persistence: `packages/cli/src/jsh/world/term.ts`

`/shared/term` (`sharedMapSlot`, so per map, like `pred.ts`) holds `rules` (program text, consulted
as `/rules.pl`) and `nodes` (a Map of name to body). **The engine is the live truth**: `terms`
(default profile) resets it from the slot on `map-settled` and on `started`, and snapshots
`nodes` back on `changed`. So an edit from the UI persists without the UI knowing jsh or the World.

## Commands: `demo_prolog.ts`

| command | does |
|---|---|
| `pl [--text] '<goal>'` | one `{ Var: Term }` per solution, or `X = …` lines; exit 1 on none; ctrl-c aborts |
| `pl_rules [text]` | print `/shared/term/rules`, or replace and reconsult them (also from stdin) |
| `pl_node name ['<term>']` | print a node, or set it |
| `pl_nodes` | each node's name |
| `demo_prolog_seed` | demo rules (`requires/2`, `provides/2`, `unmet/3`) and nodes `greet`, `patrol` |

```sh
demo_prolog_seed
pl --text 'unmet(N, Step, F)'  # N = greet, Step = say(G, hi), F = near(G, _G0)
```

## UI: `packages/ui/term-graph`

`TermGraph` (Tabs "+") shows one node as nested boxes, i.e. its series-parallel graph as flexbox:
`seq` a row, `par` a column, `alt` a column split by dashed rules; anything else is a leaf, with
variables coloured by name. Select a box to wrap it, unwrap, add after, remove or move it;
double-click a leaf to edit its text. The textarea below is the whole body as Prolog writes it:
edit it and blur to replace. Every edit is `prolog.setNode`, parsed by Prolog.
