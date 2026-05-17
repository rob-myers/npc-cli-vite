# TODO

- ✅ migrate npc bubble
  - ✅ Html3d
  - ✅ NpcBubbles
  - ✅ `w.bubble` and `w.b` 
  - ✅ zoom issue
  - `w bubble.ensure rob`
  - ✅ clean e.g. --speech-bubble-width
  - ✅ initial scale bug

- ✅ can trigger run animation
  - `w n.rob.setMoveAnim run`
  - hacky change `agent.maxSpeed` and `action.timeScale`

- ✅ clean packages/media/src/blockbench

- ✅ try thinner character
  - ✅ extra-root.thinner
  - ✅ try {left,right}arm size {x,z} 2.5
  - ✅ try {left,right}leg size x:2.75 z:2.5

- 🚧 skins in spritesheet with hot reloading
  - ✅ vite-plugin-watch-assets generates skin/manifest.json
    - manifest meta defined via filename format `{namemc-uid}{key:'medic-0',tags:['foo','bar','baz']}.png`
  - script `gen-skin-sheets`

- support skin-overlay svg for lighting
  - still use DataArrayTexture (TexArray) but higher res
  - skin-overlay.svg composited on top, watched by vite plugin

- doors have meaningful icons

- ✅ BUG save DerivedGmsData breaks walls?

- 🚧 finish 301
  - ✅ bridge has window
  - 🚧 finish bridge symbol

- onchange obstacle can trigger `pnpm gen-starship-sheets` from UI
  - should trigger react-query refetches: sheets/images

- on idle should pin in front otherwise npc "slides back"

- ✅ can override obstacle skirt height
  - `meta.h` interpreted as skirt height

- ✅ can override obstacle y (ignore accumulation)
  - `meta.force-y`

- ✅ simplify `gen-starship-sheets` i.e. remove `--prod`
  - fixes some cases e.g. symbol-bleed
  - can see error before prod

- ✅ try lower walls
- try thinner model
- shaded skin overlay

- ✅ BUG hmr: on save const Decor not updated until 2nd save?

- ✅ BUG transformed broad wall

- ✅ MapEdit: can create path from rect
- ✅ MapEdit: can edit path from rect
  - e.g. for table to avoid intersect with chair

- script `gen-skin-sheets`
  - writes to sheets.json
  - generates sheet/skin.{i}.png
- skin remapping
  - currently only have skinIndex
- world context menu?
- try fix mobile persist issues via `visibilitychanged`
  - we'll wrap useBeforeunload and ensure callback only called once
- 🚧 check glsl fallback e.g. incognito or force
  - Walls and Doors don't draw i.e. too many
- fix precision in `assets.json`
- start generating documentation in README.md
- support deleting symbols/maps from MapEdit
- improve hull symbol thumbnail e.g. add room outlines
- improve map thumbnail (🔔 currently blank)
- ℹ️ minecraft skin templates
  - https://minecraft.fandom.com/wiki/Skin#Templates

## Bugs

- BUG npc animation out of sync after save npc.ts (?)
  - possibly fixed via `cfg clear-all` then respawn
- BUG on collapse/expand should persist pane dimensions
- BUG on add new symbol and run `pnpm gen-starship-sheets` obstacle images do not update
  - fixed manually by refetching
    - `["world","world-0","sheets"]` (if added/removed)
    - `["world","world-0","obstacle-images"]`
- BUG need two ctrl-c for while loop walk?
- BUG saw auto door close with nearby npc
  - maybe door was closing and didn't open quickly enough
- BUG on lock door and save Decor we lose switch tint
  - maybe just stale while paused
- BUG after hmr and `spawn` sometimes mesh not shown, yet can refetch query "template-gltf"
- BUG MapEdit asking to save draft changes onchange when there are no changes
- BUG MapEdit drafts fighting: with 2 instances open for same file
- BUG `drawGm` (Floor): "SWEEP" probably poly union issue

## Long running

- 🚧 extend existing symbols with missing obstacles

- 🚧 extend existing symbols with missing decor
  - ✅ stateroom-012 has decor key=switch
  - ✅ BUG thumbnail wrong for transformed decor: origin?
    - packages/app/public/symbol/stateroom--012--2x2.thumbnail.png

- ✅ do not recompute all symbols when only edit a hull symbol (DEV)
  - ✅ done in prod for hull-symbols
  - ✅ use sub-stratification
  - ❌ could do client-side and ignore server update
  - ❌ createLayout optimization
    - saw `48ms`

- ✅ ISSUE obstacle sprite-sheet when polygon aabb overlap
  - e.g. bridge--042: curved window vs. adjacent desk
    - when adjacent can fix via same height
  - technically can fix by creating an "extra symbol"

- ❌ try deform limbs of blockbench model, saving as separate file

- move path parsing code out of vite plugin file, to support hmr
- warn if symbols "above" walls in symbol

- ✅ shell refinement
  - ✅ finish migrating semantics
  - ✅ provide `modules` so can `import util`
  - ✅ fix ctrl-C for `poll`
  - ❌ BUG `echo foo | map 'x\n=>x'`
    - technically string does not define a valid js function so is interpreted as a string
  - ✅ Tty has /etc/{util.sh,util.js.sh}
  - ✅ STOP bug: appears initially in e.g. 3rd tty
    - seen profile fail to load too
  - ❌ improve `[undefined, undefined, undefined]` output of `call '() => document.documentElement.childNodes' | map Array.from | log`
  - sometimes on hot reload need to ctrl-c
