# TODO

## World

### Animation

- ✅ remove strafe left/right animations
- ✅ rename psychic-attack -> influence

- ✅ `backwards` animation
- ✅ `move rob --back to:$( pick 1 )`
- ✅ `demo_back_off kate`

- skin remapping
  - currently only have skinIndex

### Camera

- improve fov based on dimension

### Cleanliness

- fix precision in `assets.json`
- `npc.ts`: getters `navMesh` and `nodeRef` (`agent.corridor.path[0]`) instead of `this.w.nav.navMesh` / `this.w.npc.getNodeRef(agent)`
  - `docs/CLAUDE.md` already says "read `npc.nodeRef`", but it doesn't exist yet
  - getters, not stored copies: the navmesh is rebuilt on map change
- `nudge` and `demo_back_off` slide via the plan worker's `nudge` op; maybe `npc.getSlideResult` instead (check why it went via the worker)

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

- ✅ play `psi_avoid` nearby npcs
- precompute tall obstacles by grKey (e.g. bunk beds) and play `psi_avoid` nearby

- 🚧 clarify as ability
  - ✅ debug toggle "npc contextmenu" shows npc bubble on right-click
  - ✅ can modulate reach/speed/gap/fade/colour
    - ideally with controls
  - listen to their thoughts in WorldSpeech
  - player can think in WorldSpeech
    - can suggest anger, lethargy, restless
- check mobile performance

### Sword and Strafe

- ✅ remove animation `idle-avoid`
- ✅ animation `gauntlet`
- ✅ add animation `primed` `attack`
- ✅ remove `primed` `attack`
- ✅ `gauntlet` -> `point`
- ✅ `demo_sword` (was `demo_attack`) plays `point` with `defensive` fallback near others
- ✅ `point` played into upper body was pointing upwards a bit
- ✅ strafe walking
  - Blockbench animations strafe_left strafe_right
  - `w.npc.move` supports `opts.strafe`
  - npc supports `npc.anim.face.aim` (point or angle); a look whilst strafing aims rather than stopping
    - forces `opts.strafe` i.e. need these animations
  - `move rob --strafe to:$( pick 1 )`
  - `pick | move rob --strafe`
  - `wasd_delta rob | move rob --strafe`

- 🚧 investigate shooting effects
  - ✅ `demo_sword` has beam effect via `<Sword>` (from src hand to dst head, curving)
  - 🚧 refine...

- handle `demo_psi` vs `demo_sword` blend fighting

### Unorganised Bugs

- ✅ pause World while `move` then resume is jerky

- ✅ BUG only some room labels shown when change to map 301-101-301
- npc labels should be invisible during object-pick

### Worker

- consider using `npc.getSlideResult` instead of worker in `nudge` and `demo_back_off`

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

## Jsh and Jobs

- Jobs: can be confusing whether process is paused due to World or explicitly
  - indicate process tags?
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

## Shell

- 🚧 js in a jsArg value, e.g. `aim rob at:(Math.PI)`, is a ParseError
  - mvdan/sh: "a command can only contain words and redirects; encountered (" (`parse.ts`)
  - workaround: quote it, `aim rob at:'(Math.PI)'` — `parseJsArg` evaluates a value starting `(`

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

