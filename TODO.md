# TODO

- new approach to todos i.e. current go into technical and start new section

- ✅ BUG decor hmr onchange decor/foo.svg

- ✅ clean fadeSpawn
- ✅ room labels represented as decor
  - `w decor.byRoom.0.1 | split | filter 'x => x.meta.label'`

- ✅ add "screen" as tilted decor quad
  - ✅ add decor image

- ❌ prevent bubble fade while paused
- ✅ clean MAX_DOORS_PER_GEOMORPH comment
  - can use e.g. 64 and no longer in sync with Doors.tsx

- ✅ fix npc bounds i.e. on Lie and complete animation recompute bounding sphere

- 🚧 replace `meta` by `decor` i.e. decor queries by rect

- fix npc final turn when ends near nav border

- can override edit g-301--playground.json in dev
  - currently can only save as draft
- obstacle resizing can be confusing
  - rotation is "determined" by the symbol's dimensions and the graphics appearance within it
  - we can forget to "update obstacles"
- ✅ BUG animation stops sometimes when go idle
- BUG assets.json decor orient changing for no apparent reason?
  - mostly in 101 so maybe needs re-save?
  - possibly related: remove symbol, save, undo, save (delta exists), save (delta removed)
- BUG npc arms through locked door
- ✅ go thru skins
  - ✅ fix medic-0 foot texturing
  - ❌ improve general-0
  - ✅ add a couple more
- ✅ remove shuffle-back animation
- ✅ npc: unify state.lookAtPoint and updateLookAt
  - now have `npc.look` and `npc.anim.lookTick`
- ❌ BUG locked door opens when npc close enough to nearby sensor
  - `w e.toggleLock g0d31`
- ✅ abstract npc animation logic into class
- BUG on save shell.ts terminal profile does not run
- idle-left with left-leg forward
- idle-right with right-leg forward
- `npc.setMoveType` walk, run, shuffle
- fetch gltf json so can cache-bust
- labels as decor point
  - add some labels to 301
  - Decor renders them
- hot reloading of `pick | move npc:rob` while change `move`?
  - maybe just clarify current setup vs previous "hot reloading"
- onchange map sealed doors are staying sealed
- ❌ change lighting from "loop thru radii in shaders" to "multiply by texture"
  - the lighting was already efficient i.e. precomputes two relative light sources per instance
- ✅ on idle should pin in front otherwise npc "slides back"
- skin remapping
  - currently only have skinIndex
- ❌ world context menu?
- try fix mobile persist issues via `visibilitychanged`
  - we'll wrap useBeforeunload and ensure callback only called once
- ❌ check glsl fallback e.g. incognito or force
  - Walls and Doors don't draw i.e. too many
- fix precision in `assets.json`
- start generating documentation in README.md
- ✅ support deleting maps from MapEdit
- improve hull symbol thumbnail e.g. add room outlines
- improve map thumbnail (🔔 currently blank)
- ℹ️ minecraft skin templates
  - https://minecraft.fandom.com/wiki/Skin#Templates
- MapEdit: on start drag should not select text
- MapEdit: pointer out not disposed somewhere
  - needs repro


## Bugs

- BUG npc animation out of sync after save npc.ts (?)
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

- ✅ extend existing symbols with missing decor
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
