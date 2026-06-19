# TODO

- new todos i.e. current go into technical and start new section

- ✅ custom decor preserved on hmr

```sh
# repro
source /etc/demo.js.sh
demo_add_decor
w decor.byKey | keys | split
w decor.byKey.test-decor-point
# save Decor.tsx
w decor.byKey.test-decor-point
# w: selector not found: decor.byKey.test-decor-point
```

- ✅ decor fixes
  - ✅ fix custom decor quad
    - no issue we need to use respective decor image
  - ✅ fix flipped decor
  - ✅ can specify decor quad height via meta.h
  - ✅ can pick decor quad
    - 🔔 cuboid MUST not intersect other geometry else pick can be occluded
  - ✅ can render decor point via meta.shown
    - ✅ can pick
    - ✅ fix rotation
    - ✅ decor point has transform
    - ✅ fix flip
    - ✅ scale/position now wrong
  - ✅ icons should be "filled in" so we needn't rely on "cuboid" for pick
    - for number-zero, number-one, arrow-boxed
  - ✅ Debug points can be picked
  - can remove custom decor
    - ❌ track gaps

- 🚧 runtime decor
  - 🚧 render runtime decor as separate instancedMesh
    - ✅ can remove `w decor.remove test-decor-point`
    - ❌ remove def.{x,y} and only use def.transform
      - instead def.transform overrides
    - 🚧 can pick
  - handle hmr e.g. recompute gmRoomId
  - ✅ remove instance via swap with last
  - demo shell function
  - show static/runtime decor rect/circle when meta.shown
  - can create colliders from decor rect/circle

- ❌ npc has selector quad
  - restyle label instead

- ✅ npc labels should match animation e.g. sit, lie
- ✅ support `look`

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
- on idle should pin in front otherwise npc "slides back"
- skin remapping
  - currently only have skinIndex
- world context menu?
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
