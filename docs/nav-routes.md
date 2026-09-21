# NavRoutes

The panel `@npc-cli/ui__nav-routes` (uiKey `NavRoutes`): a 2D top-down view of a World's map, for
making and reshaping nav paths for one or more agents. Nothing about it lives in another doc; the
data it edits, and the `route` command that walks it, are in `docs/route-command.md`.

It is narrowly a **path editor**. A path is one ingredient of a behaviour, which jsh commands
compose; the panel neither manages nor runs behaviours.

| file | what it holds |
|---|---|
| `ui/nav-routes/src/NavRoutes.tsx` | the panel: finds the World, the toolbar, the npc picker |
| `ui/nav-routes/src/NavMap2d.tsx` | the map as SVG, and the npc dots |
| `ui/nav-routes/src/NavRoutesLayer.tsx` | the routes drawn over the map |
| `ui/nav-routes/src/RoutesSidebar.tsx` | the routes and tracks of the map: new, rename, duplicate, delete, show, lock |
| `ui/nav-routes/src/schema.ts` | its meta: `worldKey`, `npcKeys`, `show`, `selected`, `hidden`, `locked`; `trackId` |
| `util/src/hooks/use-svg-zoom.ts` | `useSvgZoom`, `preventPopupGestures` — shared with the World's debug modals |

## It needs a live World

`meta.worldKey` names one (default `world-0`). A World puts its state in the query cache under its
key — `queryClientApi.set([worldKey], state)` — so the panel reads it with
`useQuery({ queryKey: [worldKey], queryFn: skipToken })` and re-renders when it arrives or goes.
Until there is one with geomorphs, the panel says it is waiting.

The World is what gives the layout, the navmesh, door state, the npcs, and — once routes are drawn —
the `/shared/path` of the map on show. Packages depend `ui/nav-routes → ui/world`, and later
`→ cli → ui/world`; never the other way.

## The map

An SVG in **world metres**: 2D `x/y` is world `x/z`. The viewBox is the union of every `gm.gridRect`,
panned and zoomed by `useSvgZoom` (wheel about the cursor, drag, pinch; double-click resets).

It is drawn from each geomorph's own layout, not from the geomorph PNGs the debug "Graphs" modal
shows behind its graphs — so it is where things really are:

- per `w.gms[gmId]`, inside `<g transform="matrix(gm.transform)">`, path data in the geomorph's own
  space: `hullPoly`, `rooms`, `walls`, `windows`, and `obstacles` (each `origPoly` through its own
  `transform`). Memoised on `w.gmsHash`;
- the **navigable area** from `w.nav.toNavTris[gmId]` — the same triangles the floor draws, local to
  their geomorph. Memoised on `w.nav`;
- **doors** from `w.door.byKey`, in world space, so they are live: amber closed, green dashed open,
  red locked;
- room labels from the labelled decor points.

`meta.show` toggles `nav`, `labels`, `obstacles` and `grid` (1.5m). The panel re-renders on
`map-settled`, `nav-updated`, `decor-ready` and the door events — nothing else.

## Npcs are opt-in

None is shown until chosen. The picker is an openable multiselect that reads `Object.keys(w.n)`
**when it is opened**, so the list needs no subscription; a chosen npc that has gone is dropped the
next time it opens, and draws nothing meanwhile. `meta.npcKeys` keeps the choice.

A chosen npc is a dot with its key, moved straight through its ref on the World's own frames
(`w.e.addFrameCallback`) rather than by rendering — and only whilst at least one is chosen.

## But no terminal

Routes are jsh state at `/shared/path`, and the panel reads and writes them through `routes` from
`@npc-cli/cli/jsh/world/route` — with or without a tty. With none open nobody has pointed
`/shared/path` at the World's map, so the panel calls `routes.restore(w.mapKey)` itself, on
arrival and on `map-settled`. It registers no world listener and draws no decor: those stay
`route_init`'s, so the 3D view shows routes only once a terminal has connected.

Every edit is one `routes.set` or `routes.remove`, which emits `path-changed`; the panel redraws on
that, exactly as it would for a `route_add` typed in a shell.

## Routes on the map

`NavRoutesLayer` draws every track in its colour — `routes.colorOf(trackIndex)`, the same as in 3D.

- There is ONE kind of point. Whether it is a **stop** or a **pass-through** is derived, never
  stored: a point followed by another point is passed through; one with steps done there, a `do`,
  or the last of its track, is arrived at. "Stop here" is spelt `wait`, with `ms: 0` for no pause.
- A stop is a numbered disc with an icon per step done there (`routeStepIcon`); a pass-through is a
  small dot. The number is the point's place in the track.
- **Legs show order, not the journey**: straight lines with an arrowhead halfway. They are not
  resolved against the navmesh — the walk an agent really takes depends on other npcs, the query
  filter, doors and the crowd's steering. A pass-through point is how the author says "go this way".
- A nav point must be ON the navmesh and in the room its `grKey` names. One that is not gets a red
  dashed ring, and its tooltip says which: `w.npc.getClosestPoly(at, 0.5)`, the test `move` itself
  applies, and `w.e.findRoomContaining`. A `do` goes to a doable decor point, which may be off the
  mesh, so is never flagged. Nothing is ever said about a leg.

The sidebar lists the map's routes and their tracks. Selecting a track dims the others, and is where
new points will go; `hidden` and `locked` are per track, by `trackId(name, role)`, and kept in the
panel's meta. A track's colour is its place in the route, so renaming one rebuilds `tracks` in order.

## Not built yet

Editing — add, select, move a whole path, copy/paste, undo — and recording. See the plan's M2c, M2d.
