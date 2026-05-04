# TODO

- ✅ pick room should have roomId
  - ✅ doors have roomIds
  - ✅ gms data includes room canvas for refined object-pick
  - ✅ can debug display geomorph hit canvases
  - ✅ `w.npc.findGmIdContaining`
    - ✅ `w.gmGraph`
    - ✅ `w npc.findGmIdContaining $( pick 1 )`
    - ✅ can debug display the graph
  - ✅ `w.npc.findRoomContaining`
    - `w npc.findRoomContaining $( pick 1 )`
  - ✅ object-pick calls `w.findRoomContaining`
  - ✅ pick provides `gmRoomId`
- ✅ pick door should have doorId

- ✅ BUG tty: very first load incognito not running PROFILE

- ✅ gmRoomGraph
  - ✅ derived data has roomGraph per geomorph
    - `w gmsData.byKey.g-301--bridge.roomGraph`
  - ✅ `w.gmRoomGraph`
  - ✅ can debug i.e. show via WorldMenu
  - ✅ convert graphs to ts

- ✅ BUG gmGraph: not showing some localEdges inside 101
  - ✅ some hull doors in 101 have navRectId `-1`

- ✅ BUG ensure separate world instances
  - ✅ play/pause via Enter/Escape
  - ✅ per world object-pick

- ✅ Layout supports 2 row with 2:1 ratio

- ✅ mobile does not see 3 col or 2 col options

- ✅ npcs support multiple skins
  - ✅ media/src/skin and link app/public/skin with 3 skins
  - ✅ world loads skins into TexArray
  - ✅ WorldMenu has debug to see skins, tags and links
  - ✅ `w.npc.texture` should be replaced by the texture atlas `w.texSkin`
    - ✅ each npc material should support uniform to specify which skin
    - ✅ `npc.ts` should have a method `changeSkin` which changes the uniform
    - ✅ `npc.changeSkin` should support ids and keys
- ✅ spawn can specify skin

- ✅ can ignore walls while object-pick
  - ✅ support case objectPick.value = 0.5
  - ✅ can set `w.view.objectPickScale` as `0.5`
  - ✅ configure via `config pickWalls` or `config pickWalls 0`

- ✅ BUG fix debug geomorph graphs panzoom mobile

- ✅ efficient doors
  - ✅ door ratio set via numeric uniform aligned to instances
  - ✅ transform uniform is constant
  - ✅ all doors collapse and respect `meta.slideDirection`
  - ✅ doors has onTick

- ✅ can programmatically open doors
  - e.g. `w door.setOpen 0 21 true`

- ✅ doors should block npcs
  - ✅ can log/detect door areas in queryFilter
    - currently `node.area > 0`
  - ✅ can decode `(gmId, doorId)` from `node.area`
    - 🔔 import from worker file (possible hmr issues)
  - ✅ navigation query accounts for open doors
  - ✅ clean up shared code: spawn, respawn, dev-hot-reload

- ✅ `pick {n}` respects execution order; can override with `pick {n} --block`

- 🚧 queryFilter issues
  - wrong: should not head towards other side of wall when door closed
    
  - ✅ `w e.findPath` using src/dst grKeys and possessed keys
    - could search in our own `gm-room-graph` (efficient)
    - ✅ gm-room-graph supports `findPath`
      - closed doors represented via infinite edge weights
    - ✅ `w.e.doorOpen` tracks open/closed doors
    - ✅ extend gm-room-graph to include door nodes (so we can weight them when closed)
    - ✅ `w.e.findPath(src, dst)` wraps `w.gmRoomGraph.findPath`
      - `w e.findPath g0r2 g0r1`
    - ❌ update `node.astar` via events and do not clean on search
    - ✅ AStar.search provides longest prefix on fail
      - prefix based on node.h
    - ✅ can specify npc keys as `w.e.findPath(src, dst, keys)`
      - `w e.findPath g0r7 g0r1 '{ g0d15: true }' | json`

  - 🚧 if `move` and `w.e.findPath` unsuccessful and `pathOrPrefix` terminates adjacent to target room, goto a connecting door
    - 🚧 can track npc current room (can be `null` on bad spawn)

  - ❌ move a-star to worker
  - ❌ stale: open door after path requested beyond door
    - could store npc's blocking door area and listen for door open
    - ✅ npc has own queryFilter
    - no issue, we were changing target on click door

- ✅ support syntax `pick 1 meta.floor as:gmRoomId`
  - shortens `pick 1 meta.floor | map gmRoomId`

- ✅ doors have static sensors triggered by npcs
  - ✅ migrate worker request/response types
  - ✅ worker has rapier physics
  - ✅ provide assets for physics world creation
    - we prefer not to share ui/world code since hmr problems occur
  - ✅ create physics world with door sensors and test via `w worker.getPhysicsDebugData`
    - check devtool log
  - ✅ Debug can show physics bodies
    - `w debug.showStaticColliders true`
  - ✅ npcs have rigid kinematic bodies
  - ✅ npcs send position to worker (batched)
  - ✅ worker sends npc collision events
  - ✅ spawn into sensor should enter
  - ✅ physics should survive worker hmr i.e. npcs
  - ✅ object-pick should not show debug colliders

- ✅ track npc current room
  - ✅ on spawn
  - ✅ must be inside a room on spawn
  - ✅ remove on remove
  - ✅ detect npc `enter-room`

- ✅ doors have switches
  - e.g. stateroom--012
  - ✅ assets.json layout 301 should have decor
    - add decor to a sub-symbol of 301: stateroom--036
  - ✅ create `<Decor>` instancedMesh with cuboid geometry
    - ✅ ensure decor `meta.transform` and `transform` in world coords
    - ✅ ensure quads correctly transformed
  - ✅ switches auto have meta `{ y: 1, tilt: true }`
  - ✅ switches change image to switch image
  - ✅ tilt takes effect

- 🚧 decor follow up
  - 🚧 add switches to all extant doors
  - ✅ can pick decor
  - decor has gmRoomId
  - decor switches have gmDoorId
  - decor added to "grid" (may support more that just decor)

- ✅ BUG edit const `doorSwitchHeight` broke World
  - switched to `constructor.name` test to fix HMR

- BUG MapEdit shift-snap mismatch for distinct determinant sign

- 🚧 BUG after edit `const.ts` world worker physics broken
  - multiple `request-tiled-navmesh` received by worker
  - multiple `setup-physics` received by worker

- move debug colliders switch into WorldMenu

- pick should be pointerup

- script `gen-decor-sheets`
  - writes to sheets.json
  - generates sheet/decor.{i}.png
- script `gen-skin-sheets`
  - writes to sheets.json
  - generates sheet/skin.{i}.png

- skin remapping

- world.worker creates physics world based on decor
  - static sensors only using rapier

- ❌ support scale ui option (vertical or horizontal)
- ❌ on drag ui tab onto grid (desktop only) add a parent Tabs
- ✅ get demo /allotment page working
- ✅ /allotment -> /
- ✅ remove react-grid-layout
- ✅ remove uiClassName
- absorb split vert/horiz controls in Tabs
- change "collapsed panel" ui

- ensure onchange layout that portals are disposed
- world context menu?
- try fix mobile persist issues via `visibilitychanged`
  - we'll wrap useBeforeunload and ensure callback only called once
- 🚧 check glsl fallback e.g. incognito or force
  - Walls and Doors don't draw i.e. too many
- ✅ object-pick sometimes out of sync since upgrade three.js `0.183.2`
- fix precision in `assets.json`
- start generating documentation in README.md
- support deleting symbols/maps from MapEdit
- improve hull symbol thumbnail e.g. add room outlines
- improve map thumbnail (🔔 currently blank)
- symbols can have optional door supported by instantiateFlatSymbol
  - e.g. office--001--2x2
- symbol can have optional wall supported by instantiateFlatSymbol
  - need repro e.g. move stateroom inside 301
- ℹ️ minecraft skin templates
  - https://minecraft.fandom.com/wiki/Skin#Templates

- BUG after hmr and `spawn` sometimes mesh not shown, yet can refetch query "template-gltf"
- BUG MapEdit asking to save draft changes onchange when there are no changes
- BUG `drawGm` (Floor): "SWEEP" probably poly union issue

## Long running

- 🚧 extend existing symbols with missing obstacles

- 🚧 extend existing symbols with missing decor
  - ✅ stateroom-012 has decor key=switch
  - 🚧 ...
  - ✅ BUG thumbnail wrong for transformed decor: origin?
    - packages/app/public/symbol/stateroom--012--2x2.thumbnail.png

- 🚧 do not recompute all symbols when only edit a hull symbol (DEV)
  - done in prod for hull-symbols
  - ✅ use sub-stratification
  - could do client-side and ignore server update
  - createLayout optimization
    - saw `48ms`

- 🚧 ISSUE obstacle sprite-sheet when polygon aabb overlap
  - e.g. bridge--042: curved window vs. adjacent desk
    - when adjacent can fix via same height
  - technically can fix by creating an "extra symbol"

- saw mobile fail to load initially but works after "resize"
  - still happening

- drafts fighting: with 2 instances open for same file
- try deform limbs of blockbench model, saving as separate file
- move path parsing code out of vite plugin file, to support hmr
- warn if symbols "above" walls in symbol

- 🚧 shell refinement
  - ✅ finish migrating semantics
  - ✅ provide `modules` so can `import util`
  - ✅ fix ctrl-C for `poll`
  - ❌ BUG `echo foo | map 'x\n=>x'`
    - technically string does not define a valid js function so is interpreted as a string
  - ✅ Tty has /etc/{util.sh,util.js.sh}
  - 🚧 STOP bug: appears initially in e.g. 3rd tty
    - seen profile fail to load too
  - ❌ improve `[undefined, undefined, undefined]` output of `call '() => document.documentElement.childNodes' | map Array.from | log`
  - sometimes on hot reload need to ctrl-c
