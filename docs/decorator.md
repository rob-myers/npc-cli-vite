# Decorator

The panel `@npc-cli/ui__decorator` (uiKey `Decorator`), and the World's side of it: placing and
configuring **dynamic decor** — runtime decor points (abstract or icon), rects, circles and quads.
Nothing about it lives in another doc.

Decor is made two ways, both ending in `w.decor.create(def)`: placed on the panel's 2D map, or placed
in the 3D World from the shell, at picked points. It is configured in the 3D World, which needs
neither the panel nor a terminal.

| file | what it holds |
|---|---|
| `ui/decorator/src/Decorator.tsx` | the panel: finds the World; the tools, selection, keys, npc picker |
| `ui/decorator/src/NavMap2d.tsx` | the map as SVG: pan/zoom, clicks and marquees on it, the npc dots |
| `ui/decorator/src/DecorLayer.tsx` | the decor drawn over the map, selectable and draggable |
| `ui/decorator/src/DecorMenu.tsx` | the map's context menu: add on empty map, edit a decor; `HeightInput` |
| `ui/decorator/src/DecorSidebar.tsx` | the map's decor as a list: select, rename, arrange, locate on the map |
| `ui/decorator/src/decor-edit.ts` | pure helpers over defs: `newDef`, `moved`, `nextKey`, `keysWithin`, `toMap` |
| `ui/decorator/src/schema.ts` | its meta: `worldKey`, `npcKeys`, `show`, the sidebar |
| `ui/decorator/src/storage.ts` | per World and map: where the map was left, how the list is arranged |
| `ui/decorator/src/history.ts` | undo/redo over the runtime defs |
| `util/src/hooks/use-svg-zoom.ts` | `useSvgZoom`, `preventPopupGestures` — shared with the World's debug modals |
| `ui/world/src/components/DecorInspector.tsx` | decorating in 3D: a label per runtime decor, a card per pick |
| `ui/world/src/components/DecorCard.tsx` | the card: a decor's fields, its `meta`, delete |
| `cli/src/jsh/world/decor.ts` | `decor_add`, `decor_rm`, `decor_ls` |

## It needs a live World

`meta.worldKey` names one (default `world-0`). A World puts its state in the query cache under its
key — `queryClientApi.set([worldKey], state)` — and REMOVES the query on unmount, setting a new one
on remount, e.g. over HMR. So the panel does not `useQuery` it: an observer of the removed query
would wait forever. `useWorld` reads `queryClientApi.get([worldKey])` off the cache's own events
(`useSyncExternalStore`), and the editor is keyed by the state OBJECT, so a remade World gets a
fresh editor. Until there is one with geomorphs, the panel says it is waiting — the snapshot is
`undefined` until then, since the state object is the same before and after its assets load, and
an unchanged snapshot does not re-render. Packages depend `ui/decorator → ui/world`, never the other
way.

## The map

An SVG in **world metres**: 2D `x/y` is world `x/z`. The viewBox is the union of every `gm.gridRect`,
panned and zoomed by `useSvgZoom`, which keeps the grabbed map point under the pointer (wheel about
the cursor, drag, pinch). Where the map was left is kept per World and map,
under one localStorage key `decorator:<world>:map:<map>` (`storage.ts`), and the map is remade per
`mapKey` so it starts from there.

It is drawn from each geomorph's own layout, not from the geomorph PNGs the debug "Graphs" modal
shows behind its graphs — so it is where things really are:

- per `w.gms[gmId]`, inside `<g transform="matrix(gm.transform)">`, path data in the geomorph's own
  space: `hullPoly`, `rooms`, `walls`, `windows`, and `obstacles` (each `origPoly` through its own
  `transform`, and each its OWN path — merged, two overlapping ones would cancel and cut a hole). Memoised on `w.gmsHash`;
- the **navigable area** from `w.nav.toNavTris[gmId]` — the same triangles the floor draws, local to
  their geomorph. Memoised on `w.nav`;
- **doors** from `w.door.byKey`, in world space, so they are live: amber closed, green dashed open,
  red locked;
- room labels from the labelled decor points.

`meta.show` toggles `nav`, `labels`, `obstacles`, `grid` (1.5m, on by default) and `static` — the map's
own decor, faint, for context (off by default). The sidebar's width and whether it is out (not by default)
are `meta.sidebarWidth` / `sidebarOpen`. The panel re-renders on
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
`w.decor.remove(...keys)`, `w.decor.rename(key, next)`. `create` copies the def's `meta` and finds
the room afresh, so a def made from an old decor — one the panel moved — does not carry that decor's
room along, and fades with the room it is now in. A rect or circle gets `meta.floor`. The defs are persisted per World and map
(`getWorldMapStore(w.key, w.mapKey).decor`) and replayed on boot. `use-world-events` now saves on
every `decor-created` / `decor-removed`, so whoever edits is saved; not whilst a map changes, which
removes the outgoing map's decor after saving it. `meta.noPersist` keeps a decor out of the save.

**Decorating** is the debug **Decorations** toggle (`w.debug.decorShown`, persisted, off by default):

- every runtime decor is drawn, whether or not `meta.shown` says so — `hasInstance` admits it, and
  the toggle rebuilds the runtime instances — so abstract decor can be seen and picked;
- `DecorInspector` labels each through `w.labels` (its key, or `meta.label`) — which draws a text
  once, keeps its layer, and redraws once per tick however many labels came and went — and a **right-click**
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
grip and the width handle. Where a frame was dragged to and how wide it was made are remembered by
key (per World, in memory), so a card reopens as it was left. The labels are occluded like any
thing — `createLabelResources(…, { occluded: true })` — unlike room labels, which draw over all.

`Html3d` appends its content INSIDE the r3f canvas's wrapper, whose `onPointerDown`/`onPointerUp`
are the World's — a press there would be picked as one, and on release the wrapper focuses itself,
so a clicked field lost focus at once. The frame therefore stops both.

## From the shell

`decor.ts` is sourced by the default profile. What is piped in says where:

```sh
pick 3 | decor_add type:point img:switch   # one at each pick
pick 1 | decor_add                         # an abstract point
pick 2 | decor_add type:rect               # each PAIR of picks is a rect's opposite corners
pick 1 | decor_add type:rect width:2 height:1
pick 1 | decor_add type:circle radius:1.5
pick 1 | decor_add type:point img:number-one scale:2
pick 1 | decor_add type:quad img:screen-0
decor_add to:[3,4.5] key:lamp meta:'{ label: "lamp" }'
decor_ls | map key | decor_rm
```

Keys are the next free `<type>-<n>` unless `key:` is given and free. `meta.shown` defaults on, so
what was placed can be seen. A pick's own meta is dropped: only its `{ x, y }` is kept, and `Decor`
finds the room. `decor_add` yields each key it makes.

## Placing decor on the map

`DecorLayer` draws the runtime decor over the map, each as its 2D footprint: a point as its image
turned by `orient`, or a ring with a tick for its facing when abstract; a rect from its `points`; a
circle; a quad's image through its `transform`, its top edge marked, since a tilt stands it up
along that edge. A `<title>` names each, with its type and room.

**Tools** are on the toolbar: *select*, or *add* a point, rect, circle or quad — a click on empty
map places one, with the next free key (`nextKey`, `<type>-<n>`), `meta.shown` on, centred on the
click; the point and quad tools take an image, the quad tool a **tilt**, which puts its top at
`tiltedQuadHeight`. Keys pick a tool — V select, P point, R rect, C circle, Q quad — and Escape
returns to *select*. The toolbar's **height** is `y3d` for an added point or quad, empty being its
default; with the select tool it is the selection's instead, shown when they agree, and setting it
sets theirs.

**The context menu** (`DecorMenu.tsx`, base-ui's `ContextMenu`; a long press on touch): on empty
map it adds a point, rect, circle or quad where it was opened, taking the toolbar's image, tilt and
height; on a decor it selects it and edits its image, a quad's tilt and scale, a rect or quad's angle, a point or quad's
height, or deletes it. A ctrl-click stays a fine-step press, and no menu opens whilst a press on the map is under way or
just after — `onPressing` sets `menuBlockedUntil` on the panel's state, never a window listener, and a
lost pointer capture or an unmount ends the press, so no block outlives it.

**Selecting**: click, shift-click to add or take away, shift-drag on empty map for a marquee
(`keysWithin`: decor whose bounds meet it), a click on empty map to clear, cmd/ctrl-A for all. A
press on a selected decor keeps the selection, so a drag moves it all; let go without dragging and
it narrows to that one. The
sidebar selects the same, and shows the same — there, cmd-click toggles one and shift-click takes
the run from the last plain click, as a file list would. Its rows are **dragged to arrange**
(pragmatic-drag-and-drop, as `MapEdit`'s inspector; a selected row brings the selection), the
`order` kept in the panel's store per World and map; a key not in it follows, by key. A `decor-removed` drops what went from the selection.

**Undo / redo** (cmd-Z, shift-cmd-Z or cmd-Y, the toolbar): `DecorHistory` keeps snapshots of the
runtime defs, one taken BEFORE each of the panel's edits — add, move, nudge, delete, rename — and
applies one back by touching only what differs. It knows nothing of edits made from the shell or a
card in between: undoing past one reverts it too. A number field's spinner or arrow keys commit each step at once, and
steps on one field of one decor within `mergeWithinMs` of each other join one snapshot (`mark(merge)`),
so one undo takes back the run; typing commits on Enter or blur.

**Moving**: drag any selected decor and the whole selection follows, through their `transform`s
rather than React, committed on release as one `w.decor.create` per decor (`moved`). Held during
the drag, shift puts the pressed decor's anchor on a 0.5m grid, ctrl or alt on a 0.1m one, the
rest keeping their places about it; a ctrl-press raises no context menu. A shift-press drags
too — it adds the decor at once, and only a shift-CLICK takes one away. Arrows nudge
by 0.1m, 0.5m with shift. Delete or Backspace deletes.

**Resizing**: a selected rect shows its four corners, a circle a point on its rim, a point with
an image the image's corner; dragging one redraws the def in place (`rectResized` keeps the
opposite corner put, in the rect's own turned frame; `circleResized` sets the radius;
`pointResized` sets the point's **`scale`**, a factor on its image's own size which the World
honours — `Decor` scales the instance and the bounds by it, and the card has it as a field); a quad's
bottom-right corner scales it from its top line's middle (`quadResized`), where a tilt stands it up, its **scale** living in its
`transform` — `quadScale` reads it back, taken as uniform) and
commits it on release — one edit, so one undo. A selected rect or quad also has a **rotate** handle
beyond its top edge: `rotated` turns it about its centre to face the pointer, by 15° with shift
held and 5° with ctrl or alt. The context menu sets its angle in degrees (`turned`). A rect's is
its `angle`; a quad's is where its top faces, and a turn composes a rotation onto its `transform`,
so a scale or flip in it is kept. With shift held the sides go by 0.5m, with ctrl or
alt by 0.1m — a scale by 0.5 or 0.1. Nothing is smaller than 0.1m, or scaled under 0.1.

A point or quad with an image draws the same raster the World's sheet is packed from,
`/decor/<img>.thumbnail.png`, so it looks as it does in 3D.

The map itself owns presses on it (`NavMap2d`): a plain press pans, a press let go within a few px
is a click, and a shift-press is a marquee. Decor opt out of panning with `data-no-pan`, which
`useSvgZoom` respects, and handle their own presses. Client coordinates become map ones through the
SVG's own screen transform (`toMap`), which letterboxing does not fool.

The sidebar's crosshair centres the MAP on the decor (`centreOn`, zooming in to at least
`locateZoom`) — never the World's camera, which is the player's.

## Not built yet

Rotate handles for points, snapping, duplicate, copy/paste.
