# TODO

- 🚧 JobsLibrary -> Scenarios -> SkipNet
  - ✅ `SkipNet` has own customisable layout (sub-allotment)
  - ✅ move sidestep debug ui here
  - ✅ move JobsLibrary into SkipNet
  - ✅ can instantiate Jobs in SkipNet
  - 🚧 start npc-docs
    - 🚧 use mdx
    - 🚧 e.g. npc-controls, npc-player, npc-inventory
    - 🚧 e.g. npc-hide-n-seek, npc-patrol, npc-sidestep
    - restyle SkipNet to look separate
      - https://scipnet-terminal.web.app/
  - ❌ tldr only contains most common
    - label only (code viewable by running)
    - individual persisted params with history
  - ❌ return to Scenario and start acting them out
    - ✅ support `act {npcKey}` format
      - `act kate count:3 down` or `act count kate from:3`
      - `act kate avoid:rob`
    - ✅ hide-and-seek sketch
      - can `act hide kate from:rob` fails if dst has nearby (1.5m) spot visible by rob
      - can `act kate avoid:rob` fails if dst's nearest spot may be seen by rob
      - can `act kate count:3 down`
      - can `act count kate from:3 to:0`
    - 🚧 guard-and-intruder sketch
      - ✅ `act guard room:{grKey}`
      - ❌ try provide structure via dfas with synchronising words
      - ✅ `sc save patrol/patrol-route path:[[17.5,10.4],[17.5,11.4],[16.5,10.4]] npc:guard-0`
      - `act patrol test-patrol`
      - `act patrol path:[[17.5,10.4],[17.5,11.4],[16.5,10.2]] g1,g2 watch:nobody`
      - ✅ patrols -> graphs
        - `sc save graph/test ...`
    - meeting-in-secret sketch
    - breach-and-clear sketch
  - narrator ui
  - change command `sc`

- Blog component is list of videos

After vid:

- improve hmr on edit tty related files e.g. BaseTty theme and const
  - currently the component remounts, losing all state
- tethered mode
  - double-r to turn off too
  - can tether to other npc
- directional wasd: l , . /
  - overrides existing keys , . /
  - easier approach to phaser
- crouch strafes by default
- saw phaser lowered through closed door when nearly entered
- initial World load slowdown so allotment responsive
- sidestep responsiveness?
- decorator inspector toggles off/on on world pause via escape?
- experiment with WebMCP + WebMCP Tools Chrome Extension
  - https://aistudio.google.com/api-keys
- phaser also shown in sense-mode

## World

### Animation and Npc

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

