# TODO

- can expand/collapse all SkipNet code-fences

- 🚧 extend SkipNet articles
  - ✅ support multipart articles
  - 🚧 npc-controls

After vid:

- improve hmr on edit tty related files e.g. BaseTty theme and const
  - currently the component remounts, losing all state
- tethered mode
  - double-r to turn off too
  - can tether to other npc
- crouch strafes by default
- saw phaser lowered through closed door when nearly entered
- initial World load slowdown so allotment responsive
- sidestep responsiveness?
- decorator inspector toggles off/on on world pause via escape?
- experiment with WebMCP + WebMCP Tools Chrome Extension
  - https://aistudio.google.com/api-keys
- phaser also shown in sense-mode
- improve `phaser` command readability
- might be nice idea for the command `jobs` to toggle open the jobs panel in Jsh
  - this could go in jsh/util.js

## World

### Animation and Npc

### Camera

- improve fov based on dimension

### Cleanliness

- fix precision in `assets.json`

- w.npc.npcToRoom -> w.npc.toRoom etc

- `npc.ts`: getters `navMesh` and `nodeRef` (`agent.corridor.path[0]`) instead of `this.w.nav.navMesh` / `this.w.npc.getNodeRef(agent)`
  - `docs/CLAUDE.md` already says "read `npc.nodeRef`", but it doesn't exist yet
  - getters, not stored copies: the navmesh is rebuilt on map change

- `nudge` and `demo_back_off` slide via the plan worker's `nudge` op; maybe `npc.getSlideResult` instead (check why it went via the worker)
  - ✅ demo_back_off

- NpcAnimation has too many properties

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

### Net

- BUG when world connected to a hidden tab
  - should probably always pause client when server paused
  - could show toast in client too
  - ensure World pauses on hide tab

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

### Worker

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

