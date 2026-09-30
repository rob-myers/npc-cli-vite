# TODO

## World

### Animation

- skin remapping
  - currently only have skinIndex


- ✅ merge `look` and `aim`
  - `look --strafe` is `aim`
- ✅ support `wasd_delta rob | look ... rob` smooth interrupt

### Bootstrap

- `awaitWorld` should wait for the npcs to be restored, not just `isReady()` (assets and navmesh)
  - else a command run straight after it sees none e.g. `npcs` prints `[]`
  - `map-settled` is too early: `restoreNpcs` runs off it, then emits `npcs-restored`
  - an event is missed by a later tty, so set a flag e.g. `restoredMapKey` before emitting it, and poll
    `isReady() && restoredMapKey === mapKey`

### Camera

- improve fov based on dimension

### Cleanliness

- fix precision in `assets.json`

- `npc.ts`: getters `navMesh` and `nodeRef` (`agent.corridor.path[0]`) instead of `this.w.nav.navMesh` / `this.w.npc.getNodeRef(agent)`
  - `docs/CLAUDE.md` already says "read `npc.nodeRef`", but it doesn't exist yet
  - getters, not stored copies: the navmesh is rebuilt on map change

- `nudge` and `demo_back_off` slide via the plan worker's `nudge` op; maybe `npc.getSlideResult` instead (check why it went via the worker)
  - ✅ demo_back_off

- NpcAnimation has too many properties

- clean up unused parts of WorldMenu theme (textarea)


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

### Navigation

### Performance

- consider pruning navcat of unused stuff

### Playground

- precompute tall obstacles by grKey (e.g. bunk beds) and avoid

- check mobile performance

### Sword and Psi

- ✅ sword: cancel when do e.g. sit
- ✅ sword: non-locked-on should look better
- ✅ sword: no bodyPart defaults to head
- ✅  psi: improve no-target animation
- 🚧 sword/psi: command for setting player's target
  - already have `psi npc-0` and `sword rob --lock:npc-0`
  - need ui for desktop/mobile

### Unorganised Bugs

- ❌ npc labels should be invisible during object-pick

### Worker

- 🚧 consider using `npc.getSlideResult` instead of worker in `nudge` and `demo_back_off`
  - ✅ demo_back_off

## Blockbench

## Blog

- 🚧 main image improvements
  - larger World
  - 🚧 larger tty text (120%) 
  - 🚧 brighter (1x global, 0.7x npc)

## HMR

- on hmr recreate tty session `move` stops working?
- hot reloading of `pick | move npc:rob` while change `move`?
  - maybe just clarify current setup vs previous "hot reloading"

## Jsh and Jobs

- 🚧 Jobs: can be confusing whether process is paused due to World or explicitly
  - indicate process tags
  - put back process tag `always` and can set from ui

- Jobs: indicate stale processes after hmr

## MapEdit

- 🚧 extend existing symbols
- 🚧 finish geomorph 101
- 🚧 finish geomorph 302
- BUG MapEdit drafts fighting: with 2 instances open for same file

## Decorator

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

- js in a jsArg value, e.g. `aim rob at:(Math.PI)`, is a ParseError
  - mvdan/sh: "a command can only contain words and redirects; encountered (" (`parse.ts`)
  - workaround: quote it, `aim rob at:'(Math.PI)'` — `parseJsArg` evaluates a value starting `(`

## Site

## Testing

- ask Fable for playwright test suite

