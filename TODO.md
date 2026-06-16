# TODO

- ✅ door normals determined by slide direction
  - ✅ debug draw normals
  - ✅ createLayout connector has normal derived from `meta.slide`
    - weirdly the angled-rect convention "works" most of the time
    - normal should point "from larger to smaller" if possible
    - ✅ hull door normal should point outwards
    - ✅ account for flipping of symbol instances
      - ✅ `door.meta.det` in -1, +1
  - ✅ migrate doors

- ✅ can specify per-side door labels
  - ✅ Doors applies `label` to "front" of door only
  - support `door.meta.backLabel`
    - ✅ attribute `doorBackLabelLayer`
    - ✅ literals e.g. for non-hull doors in hull symbols
    - ❌ `$leftDoorLabel` e.g. for bridge--046 and can specify `leftDoorLabel='sector-b'`

- ✅ speech bubble improvements
  - ✅ exists i.e. `w bubble.ensure rob`
  - ✅ draggable
  - ✅ connector from npc to bubble
  - ✅ consider intersection with npc label
  - ✅ clean

- ✅ on canvas resize speech bubbles updated

- ✅ improve speech bubble
  - ✅ improve position
  - ✅ can change text

- ✅ improve label/bubble position for sit, lie
  - ✅ by default offset is 0, 0, 0
  - ✅ fix hmr i.e. preserve label height
  - ✅ fix label whilst moving
  - ❌ set height on respawn
  - ✅ fix bubble while scale
  - ✅ hide label when bubble exists
  - ❌ slight height adjustments for idle/stand too
  - ❌ clarify implementation

- ✅ can fade to/from black
  - ✅ npc has `colorScale` and `opacityScale` uniforms
- ✅ can fade in/out
  - fade out: fade to black, depthWrite false, fade opacity to 0
  - fade in: fade opacity to 1, depthWrite true, fade from black

- ✅ overload `move` to fade spawn
  - no need for nav then spawn
  - ✅ `npc.fadeSpawn`
  - ✅ change `w.npc.move`
    - can move to doable
    - can move from doable

- ✅ cli syntax to set value directly?
  - currently can `w n.rob.colorScale | assign '{ value: 0.5 }'`
  - ✅ would like `expr 0.5 > w/n/rob/colorScale/value`
    - this uses the existing cli deep set functionality

- ✅ strategy for `move` to doable whilst moving

- ✅ can `spawn npc:rob at:$( pick 1 )` and pick self whilst sitting down
- ✅ clean up animated spawn attempts
- ✅ relax `move` close poly half extents
  - ✅ to doable should override navigable
  - ✅ spawn to navigable should use result.position

- ✅ `npc.lookAt`
- ✅ BUG: doable -> navigable then re-nav quickly -> walk animation doesn't play

- ✅ BUG if 1st spawn failed while paused then next valid spawn is at failed position
  - on play position is updated
  - seems during failed spawn npc still exists!
- ✅ on kill `pick | move npc:rob along` with two picks it should stop 
  - can force idle overriding

- ✅ scale from center while lie

- ✅ migrate basic raycast
  - ✅ worker is not starting
  - ✅ can do `ray from:$( pick 1 ) to:$( pick 1 )`
  - ✅ can we refine by door open amount?

- ✅ change tint npc label e.g. for selection
  - `label npc:rob color:#33f`
  - `label npc:rob` to reset

- ✅ on kill `move` npc should not slide back

- ✅ fix npc moves through door
  - ✅ faster door open/close
  - ✅ exit-collider not firing when `spawn` or `fadeSpawn` from doorway to non-navigable
    - ✅ should remove physics body from worker
    - ✅ removal of body should trigger exit
    - ✅ `w.npc.remove` --> `w.e.removeNpcs`
    - ✅ `w.npc.removeAgents`
  - ✅ can still happen if enter just as being closed

- ✅ BUG npc transparency issues
  - repro: on 1st spawn into doorway then `pick | move npc:rob` to chair 
  - fixed by saving NPCs i.e. hmr

- ✅ look
  - ✅ play animation once angle is over threshold
  - ✅ walk-on-spot animation
  - ✅ can `look npc:rob at:kate`

- ✅ preserve npc reference across hmr
  - ✅ move code out of constructor into `npc.init`
  - ✅ `npc.devHotReload` uses "old approach"

- ✅ on hmr `move` should continue

- ✅ draw buddhist icons on back of doors
  - ✅ randomly
  - ✅ clean buildDoorWithLabelTextures
  - ❌ meaningfully

- ✅ hull door opening/closing should trigger other
  - ✅ hull doors in same geomorph should not intersect
    - ✅ 101
    - ✅ 301
    - ✅ 302

- ✅ small-map-0 -> 301-only
  - also clean up other map names

- better approach to default tty profile
  - e.g. currently won't update onchange profiles.ts without remaking `tty-{n}`

- 🚧 remove all suffices e.g. --0.25x0.25 from all symbols
  - ✅ remove suffix from generating script `extract-starship-pngs`
  - 🚧 remove suffices from extant files
    - output/symbol-{foo} pngs except symbol-root, symbol-small-craft
    - assets.json
    - sheets.json
    - starship-symbol/manifest.json
    - mask/{symbol}.svg
    - {symbol}.json
    - {other_symbol}.json
    - symbol/manifest.json
    - const.ts
      - `symbolByGroup`
      - `extraSymbols`
  - ✅ migrate starship-symbol/fuel 1st
    - ✅ please rename files with basename `fuel--\d{3}--\d+x\d+` with basename `fuel--\d{3}`
    - ✅ find replace `fuel--(\d{3})--\d+x\d+` with `fuel--$1`
  - ✅ migrate batch
    - ✅ please rename files with basename `{x}--\d{3}--\S+x\S+` with basename `{x}--\d{3}` where `x` in `battery|bridge|cargo|empty-room`
    - ✅ find replace `(battery|bridge|cargo|empty-room)--(\d{3})--[\d\.]+x[\d\.]*\d` with `$1--$2`
  - ✅ migrate next batch
    - ✅ furniture-consoles-equipment has many different prefixes
      - delete folder
      - `pnpm extract-starship-pngs symbol 'Symbols/Furniture, Consoles, & Equipment' symbol-furniture-consoles-equipment`
    - ✅ please rename files with basename `{x}--\d{3}--[\d\.]+x[\d\.]*\d` with basename `{x}--\d{3}` where `x` in `engineering|fresher|furniture-consoles-equipment|bed|console|couch-and-chairs|counter|desk|fresher|medical-bed|table`
    - ✅ find replace `"(engineering|fresher|furniture-consoles-equipment|bed|console|couch-and-chairs|counter|desk|fresher|medical-bed|table)--(\d{3})--[\d\.]+x[\d\.]*\d` with `"$1--$2`
      - want to exclude cases `-fresher--`
    - ✅ `pnpm gen-starship-sheets` before dev server
  - ✅ migrate finalish batch
    - ✅ delete then `pnpm extract-starship-pngs symbol 'Symbols/Galley & Mess' symbol-galley-and-mess`
    - ✅ delete then `pnpm extract-starship-pngs symbol 'Symbols/Misc' symbol-misc`
    - ✅ delete then `pnpm extract-starship-pngs symbol 'Symbols/Staterooms' symbol-stateroom`
    - ✅ delete then `pnpm extract-starship-pngs symbol 'Symbols/Shop & Repair Area' symbol-shop-repair-area`
    - ✅ please rename files with basename `{x}--\d{3}--[\d\.]+x[\d\.]*\d` with basename `{x}--\d{3}` where `x` in `lab|lounge|low-berth|machinery|medical|iris-valves|window|office|ships-locker|shop-repair-area|stateroom`
    - ✅ find replace `"(lab|lounge|low-berth|machinery|medical|iris-valves|window|office|ships-locker|shop-repair-area|stateroom)--(\d{3})--[\d\.]+x[\d\.]*\d` with `"$1--$2`
    - ✅ `pnpm gen-starship-sheets` before dev server
  - ✅ leftovers
    - ✅ please rename files with basename `extra--\d{3}--{x}--[\d\.]+x[\d\.]*\d` with basename `extra--\d{3}--{x}`
    - ✅ find replace `"extra--(\d{3})--(\S+)--[\d\.]+x[\d\.]*\d` with `"extra--$1--$2`
    - ✅ please rename files with basename `{x}--\d{3}--[\d\.]+x[\d\.]*\d` with basename `{x}--\d{3}` where `x` in `table|misc-stellar-cartography|shop`
    - ✅ find replace `"(table|misc-stellar-cartography|shop)--(\d{3})--[\d\.]+x[\d\.]*\d` with `"$1--$2`

- new todos i.e. current go into technical and start new section

- track runtime decor so preserve on hmr
- can remove decor rect/circle
  - ❌ track gaps
- can create colliders from decor rect/circle

- ❌ npc has selector quad
  - restyle label instead

- ✅ npc labels should match animation e.g. sit, lie
- ✅ support `look`

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
