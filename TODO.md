# TODO

- ✅ migrate npc bubble
  - ✅ Html3d
  - ✅ NpcBubbles
  - ✅ `w.bubble` and `w.b` 
  - ✅ zoom issue
  - `w bubble.ensure rob`
  - ✅ clean e.g. --speech-bubble-width
  - ✅ initial scale bug

- doors have meaningful icons

- BUG added window symbol to bridge and chair symbols went wonky

- 🚧 finish 301
  - 🚧 finish bridge symbol

- ✅ can override obstacle skirt height
  - `meta.h` interpreted as skirt height

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
