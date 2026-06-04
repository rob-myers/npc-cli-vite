# TODO

- 🚧 simplify decor
  - ❌ sensors should be decor rects in grid
    - inside/nearby door sensors needn't have corresponding decor rects
  - ✅ decor has `key`
  - ✅ decor quad does not need x/y/width/height
  - ✅ `w decor.create` infers decor entry from `decor.img`
  - ✅ can create decor rect/circle/point
    - `demo_add_decor`
  - ✅ lights as decor circle
    - ✅ decor image `circle-1` (sgu)
    - ✅ can uniformly scale image node around its center
    - ✅ uniform scale picked up by decor
    - ✅ replace lights with `decor circle light`
    - ✅ fix init and hmr
    - ✅ clean
    - ✅ verify light radius respected
  - ✅ do-points as decor point
    - ✅ add some do-points (arrows) to 301
    - ✅ Decor renders them
    - ✅ apply decor.orient
    - ✅ do-points have `meta.do` true
  - ✅ fix lights in transformed geomorphs instances
  - 🚧 can remove decor rect/circle
    - track runtime decor so preserve on hmr
    - ❌ track gaps

- ✅ clean path for extra--005--chair

- ✅ can spawn on chair
  - ✅ npc.idleClip
  - ✅ offmesh spawn to do-point should trigger idle animation
  - ✅ sit should be at seat height
  - ✅ apply decor.orient to npc
  - ✅ fix "clamp to navmesh" when too close
  - ✅ legs should not intersect chair
    - ✅ decor points have meta.groundPoint
    - ✅ spawn snaps onto `meta.groundPoint`
  - ❌ improve sit icon
    - will only show icon during debug

- 🚧 extend decor structure inside symbol
  - ✅ `decor point do sit` -> `decor point do=sit` 
  - ✅ decor `meta.on === true` extended with `obstacleId`
  - ✅ also induces numeric array `obstacle.meta.decorIds`
  - ✅ translated correctly on flatten (and layout)
    - 🔔 complex because we may also remove decor (switches)
    - ✅ array `meta.decorIds` was being shared due to shallow clone
      - poly.clone now takes deepClone of meta
    - ✅ only compute `obstacle.meta.decorIds` in layout
    - ✅ deepClone obstacles[i].meta
  - ❌ on pick decor `instanceId` should match `gm.decor[instanceId]`
    - `w.decor.instanceIdToDecorId` needn't be aligned to gms[0].decor + gms[1].decor + ...
    - ✅ provide `meta.decorId` to all instantiated decor
  - ✅ decor point meta should inherit gmRoomId\
    - e.g. `w gms.0.decor.68.meta`
  - ✅ `w.npc.spawn` checks `pick.meta` and `gm.decors[decorId].meta` for `decorId in pick.meta.decorIds`
    - e.g. a do-point extends to a whole chair
  - ✅ npc can be at doable
    - w.e.doableToNpc and w.e.npcToDoable
  - 🚧 example of multiple do-points on single obstacle
    - sofa
  - 🚧 `<Decor>` does not render decor points
  - 🚧  can render all decor points inside `<Debug>`

- ✅ BUG pre-existing spawn on-mesh -> on-mesh
  - off-mesh <--> on-mesh seems fine
  - force remove/add agent fixed it

- ✅ default-theme -> dark-theme
- ✅ default theme is light-theme

- ✅ can peek-zoom when zoomed to "standard maximum"
  - ✅ greyed zoom icon appears in WorldMenu when close enough
  - ✅ can do temp peek zoom
  - ✅ clean up approach: break into subclass

- ✅ fix walk -> idle animation i.e. should be fast

- 🚧 can spawn on bed
  - ✅ can spawn via pick decor point
  - can spawn via pick bed

- start 101

- ✅ avoid AnimationMixer warns by play animation before skinnedMesh mount

- ✅ fix obstacle skirts: extra--001--fresher
  - seems `skirtCount` too small because createInset creates edges

- fetch gltf json so can cache-bust
- doors have meaningful icons
- labels as decor point
  - add some labels to 301
  - Decor renders them
- better approach to default tty profile
  - e.g. currently won't update onchange profiles.ts without remaking `tty-{n}`
- can create colliders from decor rect/circle
- hot reloading of `pick | move npc:rob` while change `move`?
  - maybe just clarify current setup vs previous "hot reloading"
- support `look`
- remove all suffices e.g. --0.25x0.25 from all symbols
- ❌ change lighting from "loop thru radii in shaders" to "multiply by texture"
  - the lighting was already efficient i.e. precomputes two relative light sources per instance
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
