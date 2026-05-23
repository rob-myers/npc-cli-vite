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

- ✅ skins in spritesheet with hot reloading
  - ✅ vite-plugin-watch-assets generates skin/manifest.json
    - manifest meta defined via filename format `{namemc-uid}{key:'medic-0',tags:['foo','bar','baz']}.png`
  - ✅ script `gen-skin-sheets`
  - ✅ npcs draw skins from spritesheet

- ✅ support hmr onchange source skin PNGs

- ✅ support skin/lit-skin.default.svg
  - ✅ still use DataArrayTexture (TexArray) but higher res 256
  - ✅ create skin/lit-skin.default.svg 256x256
  - ✅ `w.texSkin` draws it ignoring svg underlay
  - ✅ hmr onchange file
  - ✅ improve lighting
  - ✅ improve lighting

- ✅ BUG e.g. g-301--bridge: door 4: unexpected adjacent rooms: []
  - room hit canvases are now also smaller

- ✅ another layer of lighting for floors
  - ❌ try project light spheres against doors
    - also it should account for open/close door
  - ✅ try project light spheres against walls
    - draw debug light spheres in world space
    - compute intersections as custom meshes and shown
- ✅ lighting applied to obstacles skirts

- ✅ restrict lights to rooms

- ✅ skin/{key}.svg will be used for skin with key
  - customised on per skin basis
  - ✅ manifest skinPath e.g. `skin/medic-0.svg`
  - ✅ apply as overlay
  - ✅ remove skin/lit-skin.default.svg afterwards
  - ✅ on create svg rebuild skin manifest and inform browser

- ✅ skin/{key}.svg overwrites skin/{key}.png if present
  - ✅ only draw it rather than draw as overlay
  - ✅ fix medic-0 and robot-0
  - ❌ on create spritesheet using svg if present

- ✅ BUG npc label should not move with animation

- ✅ BUG refresh assets breaks walk animation
  - repro in prod on switch tabs
  - repro in dev on save geomorph.ts
  - devHotReload not executed

- ✅ support `pick | spawn npc:rob-`
  - rob-0 etc.

- ✅ ceiling should ignore pick too

- ✅ BUG save DerivedGmsData breaks walls?

- ✅ finish 301
  - ✅ bridge has window
  - ✅ sink
  - ✅ toilet
  - ✅ finish bridge symbol

- ✅ MapEdit: internal path editor shows ambient image in background
  - ✅ show image
  - ✅ initialPaths should provide transform
  - ✅ take account of image node.offset
    - e.g. see main bridge curved table in bridge--042

- ✅ onchange obstacle can trigger `pnpm gen-starship-sheets` from UI
  - should trigger react-query refetches: sheets/images
  - currently triggered by commit/push which auto commits each `symbol.{id}.png`
  - fixed manually by refetching
    - `["world","world-0","sheets"]` (if added/removed)
    - `["world","world-0","obstacle-images"]`

- ✅ BUG packages/app/public/symbol/stateroom--036--2x4.thumbnail.png
  - node.baseRect is wrong for symbols extra--001 and extra--021
  - using width/height from packages/app/public/symbol/manifest.json which are too large
    - i.e. we didn't resize the width/height of individual symbols to almost match
  - but we probably shouldn't use that width/height anyway...

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

- ✅ script `gen-skin-sheets`
  - writes to sheets.json
  - generates sheet/skin.{i}.png

- ✅ improve basic "turn towards" behaviour
  - ✅ avoid sliding by playing walk animation
  - ✅ start using textured npc in blockbench
  - ✅ add animations
    - ✅ lie
    - ✅ sit
    - ✅ shuffle-back
  - ❌ try https://github.com/enfp-dev-studio/blockbench-mcp
  - ✅ try https://github.com/jasonjgardner/blockbench-mcp-plugin
    - before `claude` could run `claude mcp add blockbench --transport http http://localhost:3000/bb-mcp`
    - extend ~/.claude.json with
    ```json
    "mcpServers": {
      "blockbench": {
        "type": "http",
        "url": "http://localhost:3000/bb-mcp"
      }
    }
    ```
  - ✅ use "shuffle-back" during idle separation
  - ❌ try look towards target while separated
  - ✅ try prevent "slide back to pin"
    - idle separated npc has very low maxAcceleration
  - ✅ try avoid unnatural shuffle back animation
    - stop animating (timescale 0) under threshold speed

- ✅ `pick | move npc:rob along` should not slow down at each corner

- ✅ `move npc:rob to:$( pick 2 )`
  - ✅ command substitution only "uses spaces" when 1st emit is `string | number`
  - ✅ otherwise emits a jsStringified array
  - ✅ `move` command supports array value for `to`

- ✅ improve lie and sit
  - had loads of issues with blockbench mcp
  - need more interactive approach e.g. provide initial keyframe and talk through it

- `spawn npc:rob at:$( pick ) facing:$( pick )`

- specify lights in hull symbol

- start 101

- can spawn on chair
- can spawn on bed


- hot reloading of `pick | move npc:rob` while change `move`?
  - maybe just clarify current setup vs previsou
- doors have meaningful icons
- support `look`
- remove all suffices e.g. --0.25x0.25 from all symbols
- change lighting from "loop thru radii in shaders" to "multiply by texture"
- on idle should pin in front otherwise npc "slides back"
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

- 🚧 BUG cannot navigate into tile near origin?
  - unclear how to fix since nav mesh is correct
  - post bug?
- BUG npc animation out of sync after save npc.ts (?)
  - possibly fixed via `cfg clear-all` then respawn
- BUG on collapse/expand should persist pane dimensions
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
