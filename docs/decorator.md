# Decorator

The panel `@npc-cli/ui__decorator` (uiKey `Decorator`), and the World's side of it: placing and
configuring **dynamic decor** — runtime decor points (abstract or icon), rects, circles and quads.
Nothing about it lives in another doc.

Decor is made three ways, all ending in `w.decor.create(def)`: placed on the panel's 2D map; placed
in the 3D World from the shell, at picked points; made from a query's answer. It is configured in
the 3D World, which needs neither the panel nor a terminal.

| file | what it holds |
|---|---|
| `ui/decorator/src/Decorator.tsx` | the panel: finds the World, the toolbar, the npc picker |
| `ui/decorator/src/NavMap2d.tsx` | the map as SVG, and the npc dots |
| `ui/decorator/src/schema.ts` | its meta: `worldKey`, `npcKeys`, `show` |
| `util/src/hooks/use-svg-zoom.ts` | `useSvgZoom`, `preventPopupGestures` — shared with the World's debug modals |
| `ui/world/src/components/DecorInspector.tsx` | decorating in 3D: a label per runtime decor, a card per pick |
| `ui/world/src/components/DecorCard.tsx` | the card: a decor's fields, its `meta`, delete |
| `cli/src/jsh/world/decor.ts` | `decor_add`, `decor_rm`, `decor_ls` |

## It needs a live World

`meta.worldKey` names one (default `world-0`). A World puts its state in the query cache under its
key — `queryClientApi.set([worldKey], state)` — so the panel reads it with
`useQuery({ queryKey: [worldKey], queryFn: skipToken })` and re-renders when it arrives or goes.
Until there is one with geomorphs, the panel says it is waiting. Packages depend
`ui/decorator → ui/world`, never the other way.

## The map

An SVG in **world metres**: 2D `x/y` is world `x/z`. The viewBox is the union of every `gm.gridRect`,
panned and zoomed by `useSvgZoom`, which keeps the grabbed map point under the pointer (wheel about
the cursor, drag, pinch; double-click resets).

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
`map-settled`, `nav-updated`, `decor-ready` and the door events.

## Npcs are opt-in

None is shown until chosen. The picker is an openable multiselect that reads `Object.keys(w.n)`
**when it is opened**, so the list needs no subscription; a chosen npc that has gone is dropped the
next time it opens, and draws nothing meanwhile. `meta.npcKeys` keeps the choice.

A chosen npc is a dot with its key, moved straight through its ref on the World's own frames
(`w.e.addFrameCallback`) rather than by rendering — and only whilst at least one is chosen.

## Type-checking

`ui/decorator/tsconfig.json` lists `../world/src` before `./src`. Every project re-checks the World's
sources, whose TSL types sit at TS2590's limit and pass or fail by the ORDER they are checked in;
this makes it the World's own. See the TODO on project references.

## The World's side

Runtime decor is the World's: `w.decor.create(def)` makes or REPLACES one — there is no update —
`w.decor.remove(...keys)`, `w.decor.rename(key, next)`. The defs are persisted per World and map
(`getWorldMapStore(w.key, w.mapKey).decor`) and replayed on boot. `use-world-events` now saves on
every `decor-created` / `decor-removed`, so whoever edits is saved; not whilst a map changes, which
removes the outgoing map's decor after saving it. `meta.noPersist` keeps a decor out of the save.

**Decorating** is the debug **Decorations** toggle (`w.debug.decorShown`, persisted, off by default):

- every runtime decor is drawn, whether or not `meta.shown` says so — `hasInstance` admits it, and
  the toggle rebuilds the runtime instances — so abstract decor can be seen and picked;
- `DecorInspector` labels each through `w.labels` (its key, or `meta.label`), and a **right-click**
  toggles its `DecorCard` through `w.html`, the label giving way whilst the card is up — so a plain
  click stays a pick for e.g. `pick | decor_add`. Touch has no right-click, so there any pick
  toggles. Its ids are `decor:<key>`. On desktop the card opens **focused**
  (`w.html.show(…, { focus: true })`), so **Escape** closes it — or, in a field with an edit under
  way, gives that up;
- the card edits the def's own fields by type, renames, edits `meta` as key/value rows — a value is
  JSON where it parses, else text — and deletes on a second press. Each commit is one
  `w.decor.create(def)`.

`create` removes the decor it replaces FIRST, so `decor-removed` arrives before `decor-created`. The
inspector tidies up after a removal in a microtask, else every edit would close the card being used.

It is rendered by `<Debug>`, so needs neither the panel nor a terminal.

`w.html` frames have no lock: they always take the pointer, and always show the close button, the
grip and the width handle. `Html3d` appends its content INSIDE the r3f canvas's wrapper, whose
`onPointerDown`/`onPointerUp` are the World's — a press there would be picked as one, and on release
the wrapper focuses itself, so a clicked field lost focus at once. The frame therefore stops both.

## From the shell

`decor.ts` is sourced by the default profile. What is piped in says where:

```sh
pick 3 | decor_add type:point img:switch   # one at each pick
pick 1 | decor_add                         # an abstract point
pick 2 | decor_add type:rect               # each PAIR of picks is a rect's opposite corners
pick 1 | decor_add type:rect width:2 height:1
pick 1 | decor_add type:circle radius:1.5
pick 1 | decor_add type:quad img:screen-0
decor_add to:[3,4.5] key:lamp meta:'{ label: "lamp" }'
decor_ls | map key | decor_rm
```

Keys are the next free `<type>-<n>` unless `key:` is given and free. `meta.shown` defaults on, so
what was placed can be seen. A pick's own meta is dropped: only its `{ x, y }` is kept, and `Decor`
finds the room. `decor_add` yields each key it makes.

## Not built yet

Placing and editing decor on the 2D map — add, select, move, rotate, resize, duplicate, copy/paste,
undo, and a sidebar; queries in `/shared/query`. See the plan's D2, D3.
