# TODO

- try web synth for background music
- apply phaser-action animations on hit
- improve psi animation e.g. no height steps
- restyle inventory icons e.g. darker
- walk animation legs needn't reset on stop
- predicates -> preds

## World

### Animation and Npc

- ✅ implement phaser action animations
  - minor pain
  - major pain
  - pacify (can control)

- improve `walk` animation: elbows should stick out more

- fix phaser going through a closed door
  - seen whilst idle in `breathe` with the phaser in hand: the rocking arms carry it through

- ✅ improve `phaser_aim` animation idle legs

- ✅ simplify psi animation
  - ✅ single hand animation (left arm)
  - ✅ do not turn towards target
  - ✅ can psi whilst sit or lie

- skin remapping
  - currently only have skinIndex
  - need example skin with a bunch of stuff in its overlays

- ✅ npc-outline offset, particularly noticeable in light-theme

### Camera

- improve fov based on dimension
- ✅ in follow mode zoomed-out seems closer so labels should be smaller

### Cleanliness

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

- ✅ improve gun box
- ❌ add shelves

- labels as decor point
  - ✅ already support room labels i.e. induced by decor point with label in room
  - provide example of label via dynamic decor
- ✅ separate dynamic/static decor into colliders and quads/points (2 more draw calls)
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

- ✅ refine drop inventory
  - can drop decor points on floor e.g. keycard
  - can only drop decor quads on meta.surface

### Navigation

### Performance

- consider pruning navcat of unused stuff
- ✅ try eliminate some draw calls

### Player

- ✅ long held r aims with pointer
- ✅ bug: sight mode: all hull doors showing

### Playground

- precompute tall obstacles by grKey (e.g. bunk beds) and avoid

- check mobile performance

### Sword and Psi

- ✅ sword/psi: cancel when do e.g. sit
- ✅ sword: no bodyPart defaults to head
- ✅ sword/psi: command for setting player's target
- ✅ psi: improve no-target animation

- ✅ sword -> phaser (only arms)
  - ✅ non-locked-on looks better: phaser
  - ✅ locked-on should look better
    - angle: (polar, azimuthal)
  - ✅ player psi/phaser targetting: `kamma`

- phaser action
  - arms, legs -> pain
  - head -> pacified, controlled
  - hips, stomach, chest -> stunned

### Unorganised Bugs

- ❌ npc labels should be invisible during object-pick

### Worker

- 🚧 consider using `npc.getSlideResult` instead of worker in `nudge` and `demo_back_off`
  - ✅ demo_back_off

### WorldSpeech

- ✅ can select text in WorldSpeech toast and modal

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

- ✅ inventory bar: psi, phaser, keys, carried items
- item textures and icons need an artist's eye

## HMR

- on hmr recreate tty session `move` stops working?
- hot reloading of `pick | move npc:rob` while change `move`?
  - maybe just clarify current setup vs previous "hot reloading"
- hmr `service/player-light.ts`: rebuild `w.view.playerLight` on its own hmr only
  - `reset.playerLight: true` does it on every `WorldView` hmr, rebuilding decor
  - e.g. a `playerLightEpoch` bumped via `import.meta.hot.data`, then re-apply theme uniforms, `syncWalls`, `w.update()`

## Jsh and Jobs

- ✅ Jobs: can be confusing whether process is paused due to World or explicitly
  - ✅ indicate process tags
  - ✅ put back process tag `always` and can set from ui

- ✅ support look at:angle
- ✅ Jobs uses allotment for 2 panes

- Jobs: indicate stale processes after hmr

## Manifest

- ✅ reskin Lore
  - room/door keys added as text directly and validated

- World applies a lore character's door keys on their npc's first spawn, whoever spawned them
  - today only the Decorator's spawn does: jsh `spawn` and the player's restore give none
  - move the lore schema and loader below both e.g. `packages/media` (`ui/manifest` depends on World)
  - first spawn per map only, so a `revoke` sticks


## MapEdit

- 🚧 extend existing symbols
- 🚧 finish geomorph 101
- 🚧 finish geomorph 302
- BUG MapEdit drafts fighting: with 2 instances open for same file
- ✅ MapEdit uses allotment for 2 panes

## Media

- ask Claude to create some sub-symbols of 101

## Shell

- js in a jsArg value, e.g. `aim rob at:(Math.PI)`, is a ParseError
  - mvdan/sh: "a command can only contain words and redirects; encountered (" (`parse.ts`)
  - workaround: quote it, `aim rob at:'(Math.PI)'` — `parseJsArg` evaluates a value starting `(`

## Site

## Testing

- ask Fable for playwright test suite

