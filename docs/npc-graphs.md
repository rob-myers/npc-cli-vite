# Graphs

A graph is nodes and edges on one map, with free-form `meta` on the graph, each node and each edge. It knows nothing of behaviour. jsh commands read graphs and act on them, e.g. `act patrol`. Graphs are made and edited in the Decorator, or by jsh `sc`.

## The data

A scenario entry of kind `graph`, one JSON file each: `packages/media/src/scenario/graph/{slug}.json`, keyed `graph/{slug}`. It is saved and served as characters are (`docs/scenarios.md`, Characters). The schema is `GraphEntrySchema` in `ui/world/src/scenario.schema.ts`.

| Field | Default | |
| --- | --- | --- |
| `mapKey` | | The map its nodes are on |
| `directed` | `false` | Edges go one way, `from` to `to` |
| `meta` | `{}` | The graph's own |
| `nodes` | | At least one: `{ id, at, spot?, meta }` |
| `edges` | `[]` | `{ from, to, meta }`, by node id |

- **A node's id** is stable, e.g. `n3`, so edges survive edits. A new node takes the next free number.
- **A node's point** is `at`, `[x, y]` in metres, on the navmesh to the cm.
- **A node on a spot** has `spot`, its alias or key, e.g. `g0r12-3`. Readers take the spot's point over `at`, so it follows the spot as spots are remade. A spot gone, they fall back to `at`. `at` is its point when last saved.
- **Edges** must join two different nodes that exist. Two edges may not join the same pair, either way unless directed.
- **Meta** is any JSON object. Behaviours read the keys they know, e.g. `secs` on a node for `act patrol`. Nothing checks them.

## jsh `sc`

`packages/cli/src/jsh/world/scenario.ts`. Saving and removing need the dev server.

| | |
| --- | --- |
| `sc ls graph` | This map's graphs, a line each. `--all` for every map's |
| `sc get graph/my-path` | The entry, as a value |
| `sc save graph/my-path path:$( pick 3 ) [directed] [name:…]` | Nodes `n0`… through the points, joined in turn. `cycle:<points>` joins the last to the first too. A pair is joined once, unless directed. Points are pick events, `[x, y]` or spot keys, which the nodes keep as `spot` |
| `sc walk graph/my-path` | Its closed walk, e.g. `n0 n1 n2 n1` |
| `sc rm graph/my-path` | |

Saved over, a graph keeps what is not given. Its nodes and edges are replaced only when points are given, and its meta is always kept.

## In the Decorator

The sidebar's **graph** tab (`GraphSidebar.tsx`) lists this map's graphs: name, node and edge counts, and ⇢ if directed. Choosing one draws it on the map (`GraphLayer.tsx`) and centres the map on it. A node on a spot is ringed, and drawn at the spot. Edges have arrows only when directed. The spots are fetched whilst a graph is chosen.

In DEV each edit saves its file (`saveScenarioEntry`). The pure edits are in `graph-edit.ts`.

- **New graph** makes `graph/graph-N`: two nodes joined, at the centre of the map shown.
- **Drag a node** to move it, off its spot. Shift or ctrl/alt snap it, as for decor. On release it is snapped onto the navmesh. Off it, the node springs back.
- **Drag an edge** to move the whole graph, every node off its spot. If any node would be off the navmesh, it all springs back.
- **Click** a node or an edge to select it. The sidebar then edits its meta, else the graph's meta and name. The meta is JSON, saved on blur or ctrl+enter, and red whilst it is not an object.
- **Right-click** (`DecorMenu`):

  | On | Items |
  | --- | --- |
  | Empty map | add node here |
  | A node | connect to…, attach to the nearest spot within 0.5 m (or detach from it), delete node and its edges (one is kept) |
  | An edge | insert node here, reverse (directed), delete edge |
  | Either | directed. Turned off, one edge of each pair is kept |

- **Connect to…** draws a dashed line from the node to the pointer. A click on another node joins them. Escape or a click elsewhere cancels.
- The trash beside the graph's key deletes it, on a second click.

Until the reload has the save, the edited graph is drawn from a draft, so the old one never flashes back. Graph edits share the decor's undo and redo (cmd-Z, shift-cmd-Z), in one timeline: each keeps the graph as it was, or that it did not exist. An undo saves it back, or removes it, and shows it. Making and deleting a graph undo too.

## Behaviours

A behaviour is jsh code reading a graph. `graphs` in `packages/cli/src/jsh/world/graph.ts` is what they share:

| | |
| --- | --- |
| `graphs.find(ct, nameOrValue)` | A saved graph by `{slug}` or `graph/{slug}`, else a graph value, on this map |
| `graphs.resolve(ct, graph)` | Each node's point by id: its spot's, else `at`, saying so if its spot is gone |
| `graphs.closedWalk(graph)` | Node ids walked round and round, crossing every edge |
| `graphs.toNodes(ct, points)`, `graphs.edgesThrough(nodes, cycle)` | Nodes and edges from points, as `sc save` makes them |

Route strategies are written in jsh, beside the behaviour that uses them. As yet there is one, `closedWalk`:

- **Every node balanced** (an even number of edges, or as many in as out if directed): an Euler circuit, crossing each edge once. A cycle is walked round.
- **Else, undirected:** a depth-first walk crossing each edge there and back. A path is walked back and forth, and a tree is toured.
- **Else, directed:** an error, as is a graph not connected. It starts at the first node.

### Patrolling: `act patrol`

```sh
act patrol test-patrol npc:guard-0 watch:rob
act patrol test-patrol npcs:$( [] guard-{0..1} ) watch:$( [] rob kate ) say:Stop!
act patrol cycle:$( pick 4 ) npcs:$( [] guard-{0..2} ) say:""
```

`act patrol <graph> [npc:<key>] [npcs:<keys>] [watch:<keys>] [say:…] [secs:2] [lookSecs:2] [lookDeg:60]` (`act.ts`). Its guards walk the graph's closed walk, else an unsaved `path:` or `cycle:` of points. Who walks it, whom they watch and what they say are given here only, never in the graph.

- **Guards** are `npc:` or `npcs:`, an array or `a,b`, else `guard-0`. Those absent are spawned at their start in an `mtf` skin. Several start as far apart in a straight line as the walk allows: its farthest pair of points first, then each point farthest from those chosen (`startsOf`). On a path they pass each other.
- **Watch** is `watch:`, an array or `a,b`, else the player.
- **At each node** they stop `secs`, then look `lookDeg` either side for `lookSecs` each. Where the walk turns straight back, e.g. a path's end, they stop without looking. A node's meta `secs`, `lookSecs` or `lookDeg` overrides the command's there.

One loop (`walkPatrol`) ticks every 0.25 game seconds for all of them, so a kill or a pause holds them together. Each guard is in a phase:

| Phase | |
| --- | --- |
| `walk` | To their next node. A stall is given up: they skip that node, saying so |
| `stop` | `secs` facing the way they came. At a turn back, nothing more |
| `left`, `right` | `lookSecs` each, `lookDeg` either side of that way |
| `halt` | Facing whom they saw, until 3 s unseen. Then they walk to the nearest node of the walk and go on |

A psi distract ends a guard's `stop`, `left` or `right` early.

Each tick they look for whom they watch with `perceive`, as `sees` does. A sighting emits `guard-spotted` (`npcKey`, `seen`, `graph`), again only after 3 s unseen. Then they halt and say `say` (default `Halt!`) for 3 s. With `say:""` they walk on silent, leaving the sighting to a script: `events 'e => e.key === "guard-spotted"' | …`.

#### Future work

- **Follow edits.** A running `act patrol` reads its graph once. It could re-read it on `scenario-changed`, and re-aim each guard.
- **Other walks.** e.g. the longest simple cycle or path, or the least recently visited neighbour, chosen by `route:`.
- **A halt that ends.** A guard halts until 3 s after losing sight, so someone always in view holds them for good. Give it a limit, or step closer.
- **Spacing kept.** Several guards drift together after a halt or a stall. They could slow or wait to keep their spacing.
- **An in-World overlay** of graphs, as the spots overlay.
