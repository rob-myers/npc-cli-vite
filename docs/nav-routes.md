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
| `ui/nav-routes/src/schema.ts` | its meta: `worldKey`, `npcKeys`, `show` |
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

## Not built yet

Routes drawn on the map with legs that follow the navmesh, and their problems flagged; editing —
add, select, move a whole path, copy/paste, undo; recording. See the plan's M2b–M2d.
