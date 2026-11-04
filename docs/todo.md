# TODO

- ✅ `spots --show` -> `spots shown`
- ✅ can hold space for more powerful phaser shot
- ✅ while fully crouched c should totally un-crouch
- ✅ improve keychain icon e.g. lock
- ✅ tab selected GlobalMenu should open on enter
- ❌ consider improve turning animation
  - now have `pose rob head:kate` though
- ✅ shade npcs by camera normal
- ✅ option to flush old versions in netlify build
  - ✅ try ASSET_HISTORY_RETAIN=1 in netlify ui
  - ✅ verify https://lastredoubt.co/asset-history.json
  - ✅ set ASSET_HISTORY_RETAIN=10

- ✅ no park-teleport on collapse
  - ✅ collapse slow-move
- ✅ simplify `npc.agent`

- ✅ can run in look-mode
- ✅ ensure phaser does not jiggle whilst raised

- ✅ combat mode on phaser raised
  - force top-down with polar detent
  - detent off during pause

- ✅ mobile look and fire
  - ✅ remove large fire thumb press
  - ❌ follow-mode look via one-touch drag
  - ✅ raised phaser ui: 1st touch + 300ms + 2nd touch charge + fire/cancel
- ✅ clarify why saw old decor.0.png on mobile
  - built sheets.json now has content hashes so can fetch images using `?v={hash}`
- ❌ camera framing: continuous fov change

- ✅ remove aim-mode but keep axes-locked-camera while phaser raised
- ✅ try 0.2 slower/faster via down/up

- ✅ improve run strafe: make more steady
  - saw raised hand intersect wall

- ✅ sound fx
  - ✅ phaser raise/lower/charge/charged-fire/cool
  - ✅ open/close/lock/hold door
  - ✅ sit/stand/lie
  - ✅ psi sounds
  - ✅ change phaser fire
  - ✅ BUG footsteps in bed
  - ✅ put-down/pick-up item

- ✅ phaser beam -> electricity

- ✅ inventory toasts -> toasts at top
- ✅ mobile inventory obscures player with phaser raised

- 🚧 return to Scenario and start acting them out
  - ✅ support `act {npcKey}` format
    - `act kate count:3 down` or `act count kate from:3`
    - `act kate avoid:rob`
  - ✅ hide-and-seek sketch
    - can `act hide kate from:rob` fails if dst has nearby (1.5m) spot visible by room
    - can `act kate avoid:rob` fails if dst's nearest spot may be seen by rob
    - can `act kate count:3 down`
    - can `act count kate from:3 to:0`
  - 🚧 guard-and-intruder sketch
    - 🚧 `act guard room:{grKey}`
    - 🚧 try provide structure via dfas with synchronising words

- muted by default
- narrator
- simplify JobsLibrary
  - tldr only contains most common
  - better layout for others
- clarify Blog component
- npc context menu close button on right
- npc key thin font flickers

- rmb/2-tap look can be held e.g. for phaser aim
- hide external spots in sense-mode
- BUG world connected to a hidden tab
  - should probably always pause client when server paused
  - could show toast in client too
  - ensure World pauses on hide tab
- armour integrity indicator
- avoid initial sharp camera motion after change map and unpause
- avoid phaser through wall when walk into wall
- avoid psi-arm through wall when next to wall

## World

### Animation and Npc

- fix lowered phaser going through a closed door
  - seen whilst idle in `breathe` with the phaser in hand: the rocking arms carry it through

- ❌ refine psi breathing
  - do lungs/diaphragm actually move like that?
- ❌ skin remapping
  - currently only have skinIndex
  - could support mix-and-match body parts

### Camera

- improve fov based on dimension

### Cleanliness

- assets.json efficient sub-json
- fix precision in `assets.json`

- w.npc.npcToRoom -> w.npc.toRoom etc

- `npc.ts`: getters `navMesh` and `nodeRef` (`agent.corridor.path[0]`) instead of `this.w.nav.navMesh` / `this.w.npc.getNodeRef(agent)`
  - `docs/CLAUDE.md` already says "read `npc.nodeRef`", but it doesn't exist yet
  - getters, not stored copies: the navmesh is rebuilt on map change

- `nudge` and `demo_back_off` slide via the plan worker's `nudge` op; maybe `npc.getSlideResult` instead (check why it went via the worker)
  - ✅ demo_back_off

- NpcAnimation has too many properties

- ❌ clean up unused parts of WorldMenu theme (textarea)

### Decor

- labels as decor point
  - ✅ already support room labels i.e. induced by decor point with label in room
  - provide example of label via dynamic decor
  - add docs/decor

### DevX

- improve hull symbol thumbnail e.g. add room outlines
- improve map thumbnail (🔔 currently blank)
- tsconfig project references with declaration output, so World is type-checked once
  - dependents re-check its sources; TSL types then hit TS2590 depending on file order
  - workaround: `ui/decorator/tsconfig.json` includes `../world/src` first
- improve hmr (avoid full page reload): packages/util/src/index.ts into individual barrels
  - e.g. for QueryClientApi

### Inventory

### Navigation

### Performance

- consider pruning navcat of unused stuff

### Player

### Playground

- precompute tall obstacles by grKey (e.g. bunk beds) and avoid

- check mobile performance

### Shield

### Phaser and Psi

- psi: doppler effect?
  - arms, legs -> pain
  - head -> pacified, controlled
  - hips, stomach, chest -> stunned

### Unorganised Bugs

- ❌ npc labels should be invisible during object-pick

### Worker

- 🚧 consider using `npc.getSlideResult` instead of worker in `nudge` and `demo_back_off`
  - ✅ demo_back_off

### WorldSpeech

## Audio

## Blockbench

- dev scripts for `current.gltf`
  - (a) watch it, and refetch the browser's `skins-and-gltf` query on change (as `__devMcp.refetch` does)
  - (b) run gltf-transform on it to write a smaller `current.glb`: binary, `resample`, `prune`, `dedup`, maybe meshopt
    - measured: 857KB raw, 175KB gzipped; half of that is base64 and per-accessor JSON, and resampling keeps ~1/3 of the keys
    - after `gen-clip-keys`, which writes into the gltf
  - prod loads the glb; dev can load either, to test the glb
  - pre-commit hook runs (b) too, if quick enough

## Blog

- 🚧 main image improvements
  - larger World
  - 🚧 larger tty text (120%) 
  - 🚧 brighter (1x global, 0.7x npc)

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
    - ✅ `book`, `box`, `keycard`, `phaser` decor, carried via `meta.item`

## Inventory

- item textures and icons need an artist's eye

## HMR

- on hmr recreate tty session `move` stops working?
- hot reloading of `pick | move npc:rob` while change `move`?
  - maybe just clarify current setup vs previous "hot reloading"
- hmr `service/player-light.ts`: rebuild `w.view.playerLight` on its own hmr only
  - `reset.playerLight: true` does it on every `WorldView` hmr, rebuilding decor
  - e.g. a `playerLightEpoch` bumped via `import.meta.hot.data`, then re-apply theme uniforms, `syncWalls`, `w.update()`

## Jsh and Jobs

- Jobs: indicate stale processes after hmr

## Scenario panel

- World applies a character's door keys on their npc's first spawn, whoever spawned them
  - today only the Decorator's spawn does: jsh `spawn` and the player's restore give none
  - first spawn per map only, so a `revoke` sticks


## MapEdit

- 🚧 extend existing symbols
- BUG MapEdit drafts fighting: with 2 instances open for same file

## Media

## Shell

- js in a jsArg value, e.g. `aim rob at:(Math.PI)`, is a ParseError
  - mvdan/sh: "a command can only contain words and redirects; encountered (" (`parse.ts`)
  - workaround: quote it, `aim rob at:'(Math.PI)'` — `parseJsArg` evaluates a value starting `(`

## Site

## Testing

- ask Claude for playwright test suite

