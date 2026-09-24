# TODO

## World

### Animation

- ✅ remove strafe left/right animations
- ✅ rename psychic-attack -> influence

- skin remapping
  - currently only have skinIndex

### Camera

- improve fov based on dimension

### Cleanliness

- fix precision in `assets.json`

### Decor

- labels as decor point
  - ✅ already support room labels i.e. induced by decor point with label in room
  - provide example of label via dynamic decor

### DevX

- improve hull symbol thumbnail e.g. add room outlines
- improve map thumbnail (🔔 currently blank)
- tsconfig project references with declaration output, so World is type-checked once
  - dependents re-check its sources; TSL types then hit TS2590 depending on file order
  - workaround: `ui/decorator/tsconfig.json` includes `../world/src` first
- improve hmr (avoid full page reload): packages/util/src/index.ts into individual barrels
  - e.g. for QueryClientApi

### Performance

- consider pruning navcat of unused stuff

### Playground

- ✅ playground preserve npc position
  - an edit keeps `mapKey`, so no `onChangeMap`: nothing re-seated the crowd — see `w.npc.reseatAll`
  - ✅ should also work in other maps
  - ✅ saw npc walking in place
  - ✅ fix error on remove room containing player
    - TypeError: Cannot read properties of null (reading 'type')
    - `w.gmRoomGraph.getReachableUpTo(gmRoomId.grKey, (node) => node.type === "door" && w.d[node.gdKey]?.open !== true)`
  - ✅ fix `door-opening` TypeError reading 'hull' on save

### Psi

- ✅ new component `<Comms>` can draw reactive contour-like smooth lines around npcs
- ✅ restrict to player vs one other with transition for previous
  - draws contours from an npc towards another
- ✅ Comms -> Psi
  - only for player
  - `pick | demo_psi`
- ✅ reaches further distance
- ✅ pair with animation "influence"
  - ✅ influence -> psi-begin, psi-end
  - ✅ `psi-begin`: both hands touch temples
  - ✅ `psi-end`:  only right hand touches temple
  - ✅ `demo_psi` plays animations
  - ✅ remove `psi-end`, `psi-start` -> `psi`
  - ✅ tidy
- 🚧 clarify as weapon
  - ✅ debug toggle "npc contextmenu" shows npc bubble on right-click
  - ✅ can modulate reach/speed/gap/fade/colour
    - ideally with controls
  - 🚧 listen to their thoughts in WorldSpeech
  - player can think in WorldSpeech
    - can suggest anger, lethargy, restless
- check mobile performance

### Gauntlet

- animation `aim`

### Unorganised Bugs

- 🚧 BUG only some room labels shown when change to map 301-101-301
- npc labels should be invisible during object-pick

## Blockbench

- ✅ clean filenames
- ✅ add psychic attack animation (1st attempt)
- ✅ lie/sie animation head should rotate less

## Blog

- ✅ blog initial layout
  - ✅ can switch between pages
  - ✅ demo video
  - ✅ comments

- ✅ rewrite README.md

- 🚧 main image improvements
  - larger World
  - 🚧 larger tty text (120%) 
  - 🚧 brighter (1x global, 0.7x npc)

## HMR

- on hmr recreate tty session `move` stops working?
- hot reloading of `pick | move npc:rob` while change `move`?
  - maybe just clarify current setup vs previous "hot reloading"

## Jsh

- Jobs: indicate stale processes after hmr

## MapEdit

- 🚧 extend existing symbols
- 🚧 finish geomorph 101
- 🚧 finish geomorph 302
- BUG MapEdit drafts fighting: with 2 instances open for same file

## Decorator

- ✅ route commands (jsh) `route_add` `route_rm` `route_init`
  - ✅ stored in `/shared/map/{mapKey}/path` alias `/shared/path`
  - ✅ `route_add` creates dynamic decor points as it builds
    - e.g. `pick 3 | route_add demo guard`
    - edges are decor too i.e. degenerate rects
    - omitted from dynamic decor persist, use `route_init` instead
    - cleans up on kill
  - ✅ debug option to show possibly partial routes
  - ✅ debug shows RouteStep label with value kind above nodes
  - ✅ can click route nodes (decor points) to toggle rich ui Html3d
  - ✅ refine Html3d UI
- ✅ NpcBubbles should use `w.html`
- ✅ new ui NavRoutes in packages/ui/nav-routes

- ✅ ui/nav-routes --> ui/decorator
  - decorate world map with dynamic points, rects, circles, icons, screens etc.
  - keep quad-label <-> html3d toggle
  - keep editor
  - discard notion of path
  - ❌ can group points/rects/circles etc.

- ✅ w.label should fade with rooms
- ✅ decor rect/circle should have meta.floor

- 🚧 Decorator refinements
  - ✅ can tilt e.g. screen, switch
  - ✅ Decorator can resize rect/circle/points
  - ✅ Decorator has better icon for points
  - ✅ Decorator dynamic decor has meta.shown
  - ✅ improve default decor point icon (not warn)
  - ✅ contextmenu
    - ✅ for background (create)
    - ✅ decor (edit)
  - ✅ key to select tool: Esc, p, r, c, q
  - ✅ can set 3d height 
    - live update of control
  - 🚧 book, box, key

## Site

- ✅ deploy on https://staging.lastredoubt.co/
- ✅ deploy on https://lastredoubt.co/
- ✅ remove https://staging.lastredoubt.co/
- ✅ setup umami analytics on https://lastredoubt.co/
  - https://cloud.umami.is/analytics/eu/websites
  - ✅ add script to head
  - ✅ witness page load
  - ✅ add some ui tracking for localhost/production
    - dev has toggle in GlobalMenu
    - uis-loaded event fires once
    - exit-or-hide event has at least 60s between firing

## Testing

- ask Fable for playwright test suite

