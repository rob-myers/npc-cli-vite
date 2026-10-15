# TODO

- ✅ psi raised shows breathing
- ❌ psi entrainment when target sleeps
  - Next I want to implement "turning" or "entrainment" in the case where the target npc is sleeping i.e.
- ❌ psi entrainment when target pacified
- ❌ player can place personal shield
- ❌ psi use cases
  - place shield, hide in room, distract onenter room, pacify
  - break stalemates e.g. believe player has moved elsewhere
- ❌ crouch needs justification
- ❌ instead of free-switch-player an endless supply of ancillaries?
  - maybe "isolated takedown" converts to ancillary
- ✅ hold e to raise and aim i.e. remove `r` key

- ✅ successful shots always pacify
- 🚧 shots can be unsuccessful
  - 🚧 repro target barely protruding
  - 🚧 repro target is running
  - simplify

- support shoot while sit or lie

- refine psi breathing
  - do lungs/diaphragm actually move like that?
- socialNorms

- ✅ "mcp testing" up until Claude's turn ends — see `docs/mcp.md`

## World

### Animation and Npc

- ✅ skin face eyes

- fix phaser going through a closed door
  - seen whilst idle in `breathe` with the phaser in hand: the rocking arms carry it through

- skin remapping
  - currently only have skinIndex
  - could support mix-and-match body parts

### Camera

- improve fov based on dimension

### Cleanliness

- @packages/app/src/dev-mcp-hooks.ts#249 btw this seems like a rather coarse approach?

- w.npc.npcToRoom -> w.npc.toRoom etc

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

## Manifest

- World applies a lore character's door keys on their npc's first spawn, whoever spawned them
  - today only the Decorator's spawn does: jsh `spawn` and the player's restore give none
  - move the lore schema and loader below both e.g. `packages/media` (`ui/manifest` depends on World)
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

