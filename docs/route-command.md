# Routes

Everything about routes: what one is, where it lives, how it runs, and how it is drawn. Nothing
about them lives in another doc.

A route is a named script for one or more npcs: go here, wait, look there, meet the other npc, carry
on. It is **data** — so it can be drawn, recorded, reversed and edited — and one jsh command runs it.

| file | what it holds |
|---|---|
| `cli/src/jsh/world/route.ts` | the `Route`/`RouteStep` types, the `/shared/path` slot, `routes`, the commands, the drawing |
| `cli/src/jsh/world/route-ui.tsx` | `RouteNodeUi`, the card a clicked node shows — it exports only the component |
| `cli/src/jsh/world/shared.service.ts` | `sharedMapSlot`, the per-map `/shared` slot routes are kept in |
| `ui/world/src/components/Labels.tsx` | `w.labels`, keyed text billboards |
| `ui/world/src/components/WorldHtml.tsx` | `w.html`, keyed React content at a point or on an object |
| `ui/world/src/service/labels.ts` | `drawLabel`, `createLabelResources` — shared with `RoomLabels` |

## The data

Routes are jsh state, not the world's. They live at `/shared/map/{mapKey}/path`, aliased as
`/shared/path` for the current map, and persist with the rest of `/shared`. A route means nothing on
another map, so each map has its own.

```ts
type Route = {
  tracks: Record<string, RouteStep[]>; // by role
  loop?: "cycle" | "pingpong";
};
```

A **track** is one role's steps. Roles are just names (`guard`, `a`); they are bound to npcs only when
the route is run, so one route can be walked by anybody.

| step | fields | does |
|---|---|---|
| `move` | `at`, `grKey`, `anchor?` | walk to `at` — a bare `{ x, y }` |
| `do` | `decorKey` | move onto a doable decor point, e.g. sit |
| `wait` | `ms` | stand still |
| `look` | `at` — a point or an npcKey | turn to face |
| `open`, `close` | `gdKey` | a door |
| `say` | `words`, `secs?` | speech |
| `sync` | `code` | barrier: wait until every bound track with this code is here |
| `signal` | `code` | one-way: release whoever `await`s this code |
| `await` | `code` | wait for that `signal` |

Two rules shape everything else:

- **A `move` or `do` is a waypoint; every other step is done once there.** `groupByWaypoint` splits a
  track that way, and it is what the drawing, the node cards and reversal all work from. Steps before
  the first waypoint are done before setting off.
- **Tracks sync only through steps.** Nothing outside a track coordinates it with another. A `sync` is
  symmetric, so it reads the same walked backwards; a `signal`/`await` pair does not, and `route`
  warns when one would be reversed. A signal **stays given** for the run: an `await` that comes after
  it passes at once — including on the second lap of a loop.

Every `move` carries the `grKey` of the room it was made in, since an npc is always in some room.
`route` warns when the point has since ended up in another room. `anchor` (`{ gdKey }` or
`{ decorKey }`) is reserved for re-anchoring after map edits; nothing reads it yet.

`routes` is the module's side of the data, an object so that no shell command is made of it:
`all`, `get`, `set(w, name, def)`, `remove(w, name)`, `validate`, `reverse`. **`set` and `remove` are
the only way to change a route**: they validate, and emit `path-changed`, which is what redraws.
`/shared` is user-editable, so a restore only warns of a broken route and `route` refuses to run it.

## The commands

`route_init` must run first — the default profile does, after `predicates`. It restores the slot for
the map and registers the module's world-event listener, keyed `"path"`.

It is also the ONLY thing that puts routes on show. They are jsh state, so it takes a terminal to
bring them to life: a World with no terminal open draws none, whatever the **Routes** toggle says,
and they appear the moment one loads. The World says so: its menu reads an amber "connect tty"
until some session has got through `awaitWorld` — `w.isReady(sessionKey)` returning true sets
`w.ttyConnected`, for good — and a green "tty connected" after. A client of another World says
neither: its jsh state is the server's.

```sh
# build: points from picks become `move` steps, each in the room it lies in
pick 3 | route_add patrol guard
route_add patrol guard to:$( pick 1 )
route_add patrol guard step:'{ kind: "wait", ms: 2000 }'
route_add patrol guard step:'{ kind: "sync", code: "meet" }'
route_add patrol loop:pingpong          # or cycle, or null for none

# run: roles bound to npcs
route patrol guard:rob-0 medic:kate
route patrol npc:rob --reverse          # a one-track route takes any binding

# remove a track, or the whole route
route_rm patrol guard
route_rm patrol
```

Piped points are saved **one at a time**, so the track is drawn as it is picked; killing
`pick 3 | route_add …` takes back what that run added, down to the track or the route if that empties
them.

## Running

`route` runs one loop per bound track, in one process:

- **Kill** rejects every npc's pending move and every `wait`, `sync` and `await`, so ctrl-c ends it
  wherever each track is.
- **Pause** rejects the in-flight move or look with `"paused"`; the loop then awaits the resume and
  **re-issues the same step**, so the npc carries on from wherever it stopped. A fade is let finish
  first, as `move` lets it. `wait` is `api.sleep`, which stops its own clock whilst suspended.
- **A track that fails stops the others** — e.g. `not navigable` — and the command exits non-zero with
  its error. A locked door the npc may not pass counts: `w.npc.move` itself resolves, having stopped
  them at the door, so `route` reads `npc.last.unreachableResult` and throws.
- Consecutive `move`s glide through: only a waypoint with something to do there, or the last, is
  arrived at (`arrive`).
- `--reverse` walks every track backwards; `loop: "pingpong"` alternates; `loop: "cycle"` goes round to
  the first waypoint again. A looping route runs until killed.
- A `sync` counts only the **bound** tracks that use its code, so a route can be run with some roles
  left out.

## Drawing

The **Routes** item in the world menu's debug section — persisted per world as `routesShown`, on by
default — decides whether routes are drawn. The world knows nothing of routes: the toggle only emits
`path-changed` with `name: null`, and `drawRoutes` in `route.ts` does the rest, as it does on
`map-settled` and after every `routes.set`/`remove`.

- **Nodes and edges are runtime decor**, so picking already works. A node is a decor point
  (`number-zero`) keyed `route:<name>:<role>:<stepIndex>`; an edge is a thin rect at `atan2`, keyed
  `…-edge`. Each role is tinted its own colour. Their `meta` carries `route`, `role`, and
  `stepIndex` (or `edgeTo`), plus `shown` and **`noPersist`**, which `persistDecor` skips — a route is
  redrawn from `/shared/path`, never restored as decor.
- **Each node has a label** through `w.labels`: the kinds done there, e.g. `move · sync · wait`.
- **Clicking a node** toggles its card through `w.html`. `isDecorRouteNode` recognises the pick by its
  meta; `nodeUi` builds the card from the node's group of steps. Whilst the card is up it stands in
  for the label, which `onHide` puts back. A redraw re-renders open cards whose step survives and
  drops the rest.

## The two hosts

Both are generic — keyed content in the world, with nothing route-specific in them. Goals, points of
interest and the npc bubbles (`NpcBubbles`, under `bubble:<npcKey>`) use the same two.

**`w.labels`** — `add(key, { x, y, y3d?, text })`, `remove(...keys)`, `byKey`. Billboards like
`RoomLabels`, from its own texture array with one layer per DISTINCT text, never pickable and never
faded.

**`w.html`** — `show(key, at, node, opts?)`, `hide(...keys)`, `toggle(…)`, `setShown(key, shown)`,
`byKey`. `at` is a point, or a `TrackedObject3D` to follow. Each entry is an `Html3d` centred above its
anchor, and the host owns the chrome:

- a **close** button, which calls `opts.onHide`;
- a **lock** button. Locked, the content is dimmed and takes no pointer. Unlocked, it does, and a
  grip and a corner handle appear. It locks again after `unlockMs` (5s) unless something inside it
  has focus, in which case it looks again later; a drag or a resize starts the wait over;
- the **grip** drags it up and down in world space;
- the **corner handle** sets a width, not a scale: it writes `--html-width` on the frame, and the
  content flows into it — `w-(--html-width,40rem)` and `flex-wrap`, as `RouteNodeUi` does.

Text cannot be selected inside a frame, bar a focused field.

## Gotchas

- **`useStateRef` owns `set`, `update` and `ref`.** A state that names one is silently overwritten,
  which is why the hosts say `add`, `show` and `hide`. The hook's types now reject it.
- **A `.tsx` may export only components**, so shell commands cannot live beside JSX: hence
  `route-ui.tsx`, which `route.ts` reaches with `createElement`.
- **Exported functions become shell commands.** Helpers other modules need go on the `routes` object.
- `keys` of a `Map` is always `[]`: inspect a host with `w labels.byKey.size`.

## Not built yet

The panel UI (`packages/ui/route`) with its step list and transport; the recorder (`route_rec`);
resolved nav paths between waypoints, and flags for a waypoint off the navmesh or behind a door the
npc cannot pass; a timeline. Two events exist for them already: `stopped-moving { npcKey }` — arrived,
or the move was stopped, but not one cut short by the next move — and `path-changed { name }`.
