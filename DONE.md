# DONE

# By Jun 17th 2026

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

- ✅ better approach to default tty profile
  - currently does not update onchange profiles.ts without remaking `tty-{n}`
  - ✅ terminals have PROFILE_KEY
  - ✅ PROFILE set via PROFILE_KEY
  - ✅ PROFILE_KEY can be persisted
  - ✅ hot-reload PROFILE via PROFILE_KEY onchange profiles.ts
    - we don't rerun the profile but we change the value
  - ✅ World bootstrap has selects for WORLD_KEY and PROFILE_KEY
    - currently, persisted PROFILE_KEY overrides the one provided in ui meta
      - desired when user manually changes value (so doesn't switch back)
      - but removing and re-adding the ui meta via bootstrap ignores chosen PROFILE_KEY
    - ✅ ui schema admits optional onRemoveUi function
    - ✅ on remove ui we try to invoke the method
    - ✅ Jsh adds method which removes PROFILE_KEY from persisted session
    - ✅ change onRemoveUi to onCreateUi to avoid persist race-conditon

- ✅ BUG on closePane in pane-service we're not removing tabs
  - similarly for directly remove tab

- ✅ remove all suffices e.g. --0.25x0.25 from all symbols
  - ✅ remove suffix from generating script `extract-starship-pngs`
  - ✅ remove suffices from extant files
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

- ✅ clean tty
  - ✅ type modules in packages/cli/src/tty/Tty.tsx
    - `call 'x => Object.keys(x.lib)''
  - ✅ clean Jsh props


# By Jun 6th 2026

- ✅ simplify decor
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

- ✅ extend decor structure inside symbol
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
  - ✅ example of multiple do-points on single obstacle
    - sofa
  - ✅ `<Decor>` does not render decor points with `meta.on === true`
  - ✅  can render all decor points inside `<Debug>`

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

- ✅ can spawn on bed
  - ✅ can spawn via pick decor point
  - ✅ can spawn via pick bed
    - `decor point do=lie on`

- ✅ start 101

- ✅ avoid AnimationMixer warns by play animation before skinnedMesh mount

- ✅ fix obstacle skirts: extra--001--fresher
  - seems `skirtCount` too small because createInset creates edges

- ✅ start 302
  - ✅ BUG hull doors not opening for larger-map

- ✅ BUG MapEdit map creation i.e. draft/new not appearing before refresh

- ✅ BUG obstacles should aggregate height
  - couch-and-chair--006

- ✅ doors have meaningful labels
  - ❌ normal convention for doors
  - ✅ `decor point label=foo` induces `door.meta.label` per door
    - must be before door
  - ✅ label stateroom -> stateroom related icon
  - 🔔 symbols should not be between `decor point label={label}` and doors
  - ✅ add labels to all rooms in 301
  - ✅ add labels to all rooms in 101 (only one atm)

- ✅ BUG MapEdit: on move multiple nodes their order changes


## By 24th May 2026

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

- ✅ `spawn npc:rob at:$( pick ) facing:$( pick )`
  - ✅ fix 1st spawn
  - ✅ `pick | spawn npc:rob facing`

- ✅ `move npc:rob to:$( pick 1 ) fast`


## By 14th May 2026

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

- ✅ queryFilter issues
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

  - ✅ npc queryFilter uses `w.e.npcCanAccess`

  - ✅ on `move` and dst room is adjacent and unreachable execute configurable npc function
    - ✅ console.log boolean `npcTargetUnreachable`
    - ✅ provide closest door as crow flies if unreachable
    - ✅ simply stop the npc
    - ✅ redirect to closest door instead

  - ❌ if `move` and `w.e.findPath` unsuccessful and `pathOrPrefix` terminates adjacent to target room, goto a connecting door
    - ✅ can track npc current room
    - ❌ on `move`
      - ✅ compute dst room
        - `w npc.npc.rob.last.dstGrId`
      - ❌ need inaccessible doors defined first (locked not just closed)
      - if dst room adjacent and unreachable fire event
      - default strategy for event is goto nearest door

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

- ✅ decor follow up
  - ✅ `w.pending` indicates assets/nav/decor pending
  - ✅ decor loads sequentially after nav
    - technically can also be triggered via HMR
  - ✅ can pick decor
  - ✅ Decor reloads on hmr 
  - ✅ script `gen-decor-sheets`
    - ✅ writes to sheets.json
    - ✅ generates sheet/decor.{i}.png
    - ✅ hook up to Decor

- ✅ BUG physics inside worker (HMR)
  - ✅ caused by saving const: shared between main thread and worker
    - `TypeError: Cannot read properties of undefined (reading 'createRigidBody')`
    - main thread receives "worker-hot-module-reload" from worker
    - observed two `request-tiled-navmesh` received by worker
    - presumably `w.gms` changes too, maybe check query status?
  - forcing HMR via save of `WorldWorker.tsx` fixes it
  
  - ✅ keep worker disjoint
    - ✅ custom-tiled-mesh
    - ✅ nav-util
    - ✅ generate-tiled-navmesh
    - ✅ worker.store
    - ✅ physics: avoid AssetsSchem
    - ✅ physics: avoid createLayoutInstance
    - ✅ world.worker
  
  - ✅ try putting worker reloads back
    - saving worker file triggers 1 reload
    - saving non-worker file triggers 1 reload

- ✅ add switches to all extant 301 doors

- ✅ BUG save other symbol then office--001 switch disappears

- ✅ BUG fix decor in 2nd gm instance
  - needed to fix tilt matrix

- ✅ door switches show green/red when unlocked/locked
  - ✅ doors have entry in `w.door.byKey`
  - ✅ track open/closed
  - ✅ can tint switches individually via `tint=#ff0`
  - ❌ can tint switches via `pick 1 as:meta.instanceId | w decor.tintInstances red -`
    - on hmr decor we'll lose the info unless we persist somehow
    - instead, we'll drive the green/red tinting via locked door
  - ✅ locked/unlocked tints respective switches
    - switch tint needs to survive decor hmr
  - ✅ track locked/unlocked
    - `w e.toggleLock g0d15`

- ✅ symbols can have optional door supported by instantiateFlatSymbol
  - e.g. `office--001--2x2 doors=['s']`
  - removed doors should have switches removed too
- ✅ symbol can have optional wall supported by instantiateFlatSymbol
  - need repro e.g. move stateroom inside 301

- ✅ meta.slideDirection -> meta.slide

- ❌ BUG dispose `move --force npc:rob to:$( pick meta.floor 1 ) &`
  - not a bug i.e. semantically should keep executing `move` without blocking
  - `while true; do; move --force npc:rob to:$( pick meta.floor 1 ) & done`

- ✅ `pick | move`
  - `pick | move`
  - `pick | move along`

- ✅ pick should be pointerup
- ✅ do not pick on drag

- ✅ `pick` lifo by default (blocks earlier)
  - can `pick --fifo 1` for other behaviour e.g. for two interleaving interactive while loops

- ✅ decor added to "grid"
  - ✅ decor instantiated when it comes from geomorph
  - ✅ decor.meta is gmRoomId
  - ✅ decor.meta is gmDoorId when has doorId
  - ✅ decor grid built

- ✅ BUG edit const `doorSwitchHeight` broke World
  - switched to `constructor.name` test to fix HMR

- ✅ BUG MapEdit shift-snap mismatch for distinct determinant sign

- ✅ move debug colliders switch into WorldMenu

- ✅ world.worker creates physics world based on decor
  - static sensors only using rapier

- ❌ support scale ui option (vertical or horizontal)
- ❌ on drag ui tab onto grid (desktop only) add a parent Tabs
- ✅ get demo /allotment page working
- ✅ /allotment -> /
- ✅ remove react-grid-layout
- ✅ remove uiClassName

- ✅ absorb split vert/horiz controls in Tabs
- ✅ change "collapsed panel" ui

- ✅ support flip adjacent panes

- ✅ ensure onchange layout that portals are disposed

- ✅ object-pick sometimes out of sync since upgrade three.js `0.183.2`

- ✅ saw mobile fail to load initially but works after "resize"
  - still happening

## By 25th Apr 2026

- ✅ can connect Tty to World
  - ✅ namespace `JshCli`
  - ✅ cli/src/world/core.js exists
  - ✅ can provide profile and env to `<Jsh>`
    - ✅ extend schema
    - ✅ extend bootstrap
  - ✅ complete `awaitWorld`
```sh
import core
awaitWorld
```

- ✅ can spawn npc via `w.npc.spawn({ npcKey, point })`
- ✅ tty supports `w` via `CACHE_SHORTCUTS`
- ✅ can spawn from tty
```sh
w npc.spawn '{ npcKey: "rob", point: [0, 0, 0] }'
w npc.remove rob && w update
expr '{ npcKey: "rob", point: [0, 0, 0] }' | w npc.spawn -
```

- ✅ fix disappearing WorldMenu on resize Tabs whilst other tab open
- ✅ can pick npcs
- ✅ npc has label quad
- ✅ on drag unseen tab onto grid it should mount
- ✅ `pick` event provides intersection

- ✅ `click` -> `pick` command
- ✅ `pick` command provides top-level distance, point, face (not in intersection)

- ✅ sh parse error `echo $( pick 1 | map point )`
- ✅ can programatically spawn
```sh
w npc.spawn "{ npcKey: 'foo-bar-baz', point: $( pick 1 | map point ) }"
```
- ✅ can await spawn

- ✅ spawn adds agent to crowd when `w.nav` exists
- ✅ BUG `npc.agentId` becomes `null` on HMR
- ✅ respawn compatible with crowd
- ✅ can `w npc.move "{ npcKey: 'rob', to: $( pick 1 ) }"`
  - no walk/run animation yet

- ✅ tweak walking until its cleaner
  - ✅ unify pinning as `w.npc.pinTo`
  - ✅ different idle/walk separation weight
  - ✅ walk loop shell script
```sh
# keep walking without throwing
spawn npc:rob at:$( pick 1 )
while true; do
  move --force npc:rob to:$( pick meta.floor 1 )
done
```
  - ✅ basic stuck detection

- ✅ can ignore throw inside while somehow
  - decided against `foo || true` because `foo` might write to stderr
  - ✅ support e.g. `move --force npc:rob to:$( pick 1 )`

- ✅ import `crowd` from `navcat/blocks` and `crowd.update(agents, navMesh, clampedDeltaTime)`
- ✅ change ui `Global` to `Layout`
  - ✅ remove theme toggle
  - ✅ rename `ui/global` -> `ui/layout` etc.
  - ✅ can set one tab layout
  - ✅ can set two tab layout (vert or horizontal)
  - ✅ responsive?
  - ✅ reset has layout, tty, world
  - ❌ option to flatten layout (no Tabs)
  - ❌ layout schema and layouts.json
    - can CRUD in DEV

- ✅ when resizing always show cancel button

## By 17th Apr 2026

- ✅ currently must re-run `pnpm gen-starship-sheets` per obstacle polygon change
  - 🔔 triangle in `console--019--2x2` whose rect extension exposes part of a chair
  - could automate this... we still avoid "changing spritesheet problem"
  - ✅ assets.json has number `hash.obstacles`
  - ❌ `pnpm gen-assets-json` triggers `pnpm gen-starship-sheets` onchange hash.obstacles
    - we'll keep `hash.obstacles` though
  - ✅ support `public/starship-symbol/masks`
    - used when drawing obstacle sprite-sheets
    - ✅ example of mask
    - ✅ in `pnpm gen-starship-sheets` we should account for masks
    - ✅ put restrict to obstacle polys under `--prod`
      - probably should run in a git hook
    - ✅ clean up gen code
    - ✅ run `pnpm gen-starship-sheets --prod` on commit or push
    - ✅ move invert colours to script
    - ✅ can trigger refresh in dev via tanstack query devtools

- ✅ avoid `<Obstacles>` flicker by only uploading to GPU once drawing finished

- ✅ try add shadow quad to skinnedMesh
  - ✅ can export quad as another SkinnedMesh and show
  - ✅ add parent root to Blockbench file: root -> skeleton-root -> ...
  - ✅ augment skinnedMesh geometry with quad so still only one mesh
  - ✅ clean

- ✅ ensure multiple worlds work
  - saw work on desktop
- ✅ can scroll through tabs on mobile
  - first attempt failed i.e. `overflow-x-auto` plus `shrink-0`
- ✅ can drop tab outside Tabs
- ✅ can move UIs inside Tabs
- ✅ unify menu styles
- ✅ default is not empty-map (although still exists)
  - defaultMapKey has value "small-map-0"

- ✅ support object-picking
  - ✅ read pixel on pointer down
  - ✅ mounting `<NPCs>` late seems to fix things?!
  - ✅ Putting `<Suspense>` directly around NPC component seems to fix it
    - `useTexture` took too long?
  - Delay MRT: may want different scene for object-pick e.g. no walls
    - MRT could still be useful for drag-select
  - ✅ Floor/Ceiling/Walls/Obstacles shader support objectPick uniform

- ✅ fix obstacles texture disappearing on remount stuff inside World.tsx
  - hot reload was resetting canvas width/height to 1

- ✅ navmesh should account for doors
  - https://github.com/isaac-mason/navcat/blob/9a8379e05cc28bf842405df214271885046833d8/examples/src/example-doors-and-keys.ts#L201
  - https://github.com/isaac-mason/navcat/blob/9a8379e05cc28bf842405df214271885046833d8/blocks/generators/generate-tiled-nav-mesh.ts
  - ✅ make our own `generateTiledNavMesh` with own `buildNavMeshTile` which "marks door areas"
  - ✅ saw working in untransformed but maybe not transformed geomorphs
  - ✅ better encoding of `(gmId, doorId)`
  - ✅ can run navQuery using queryFilter specifying door areas
    - ✅ `<Debug>` can show instanced navPaths using unit quad
    - ✅ can query navcat and show in `<Debug>`
    - can constrain doorways i.e. areas

- ✅ compute room polygons correctly i.e. need to include doors
  - seems ok already?

- ✅ BUG hull width mismatch
  - demo-map-0 had stale 101 symbol (no offset)

- ✅ show closed Doors using instancedMesh cubes
- ❌ show lintels above Doors

- ✅ some doors have no room to slide
  - ✅ mark them `meta.collapse`
  - ✅ when transform them also scale
  - ✅ adjust UVs so scale does not deform texture

- ❌ on add grid item to UiGrid can we try to use maximum available height and width?

- ✅ for doors try track "openess ratio" via persistent array on gpu
  - https://share.google/aimode/EreUiTQQkX01nIvv2

- ✅ why is boolean uniform `objectPick` being set as `0` after we drag world?
  - because onPointerDown we do another object pick
- ✅ fix remove bug i.e. next tab not set
  - need repro

- ✅ future tabs
  - ✅ try make basic tabs components with draggable tabs
    - https://atlassian.design/components/pragmatic-drag-and-drop/about
  - ✅ can drag between different tabs components
  - ✅ can drag out of tabs to outside (not another tabs)
  - ❌ can drag into tabs from outer ui
  - ✅ can move component into tabs from outer ui


## By 7th Apr 2026

- ✅ start using `navcat`
  - ✅ add to `ui__world`
  - ✅ create a webworker which can send/receive
  - ✅ generate demo tiled navmesh in webworker
  - ✅ send via serialization

- ✅ construct `w.nav` and show on floor
  - ✅ extract triangles and draw in floor
  - ✅ send event which can be awaited (`nav-updated`)

- ✅ fix hmr onchange geomorphs.ts, const.ts and many others
  - ✅ fix `vite:hmr circular imports detected` (`pnpm dev --debug`)
  - ✅ `@npc-cli/ui-sdk` root only exports types
  - 🔔 issue arises from newly added webworker i.e. it references world/src/const.ts
  - ✅ fix is to send "layout instances" to webworker so it doesn't know about const.ts

- ❌ on edit `geomorph.ts` should rebuild assets and trigger update
  - move request nav worker message to `<WorldWorker>`

- ✅ do not cut doors out of navmesh
- ✅ vite-plugin-watch-assets recomputes assets.json

- ✅ improve HMR onchange tiled-navmesh config
  - ❌ can send config override message
  - ✅ handle hmr in world.worker.ts and inform `<WorldWorker>`

- ✅ support hmr `DerivedGmsData` e.g. can change gmData.tops.nonHull

- ✅ generate spritesheets for symbols reachable by some MapEdit file
  - ✅ `gen-assets-json` stores `assets.stratifiedSymbolNodes`
  - ❌ script `gen-starship-sheets` restricts to leaves in `assets.stratifiedSymbolNodes`
    - we cannot restrict to leaves: we need every symbol containing an "obstacle" polygon
  - ✅ find every non-flattened symbol containing an "obstacle" polygon
  - ✅ script `gen-starship-sheets` generates spritesheet data using `maxrects-packer`
    - ✅ migrate legacy `npc-cli/service/rects-packer.js`
  - ✅ supports multiple sheets (0-based)
  - ✅ sheets.json schema
  - ✅ write sheets.json

- ✅ `pnpm gen-starship-sheets` should also draw the spritesheets
  - ✅ sheets.json entries have sheetId
  - ✅ draw the spritesheets
  - ❌ find a way to restrict bridge--042 image size
    - more obstacles from it will be added
  - ✅ can `pnpm gen-starship-sheets --prod`
    - produces alternative "optimized" texture `.prod.{texId}.png` only drawing obstacle-covered-parts
    - PROD only: smaller download and still have decor cuboid "obstacles"
    - still wastes texture space (memory)

- ✅ MapEdit provide triangle `<path>` for console--019

- ✅ layout.obstacles have
  - ✅ `symbolKey` (string) of original unflattened symbol parent
  - ✅ `transform` for instancedMesh transform
  - ✅ `origSubRect` used to compute UVs
    - `origPoly.rect` offset by `(-bounds.x, -bounds.y)`
    - to compute UVs we'll also need `meta.symbolKey` to lookup `(sheetId, symbolImageCoords)`

- ✅ BUG map origin is not aligned to world origin

- ✅ symbol asset bounds should come from "top image node"
  - ✅ transform.{e,f} should not include offset when snap
    - ✅ confusing (dx, dy) for console--019
    - ✅ console--019 should have transform.{e,f} 0

- ✅ go through existing symbols and fix
- ✅ need symbol `office--001--2x2` instead of `console--019--2x2`
  - "apparent" alignment issues related to some symbol underlays having doors

- ✅ sometimes `Floor` and `Ceiling` fail due to unassigned or mismatched buffer attributes

- ✅ investigate symbol bounds
  - 🔔 clipping to underlay image bounds means outer part of doors not drawn in thumbnail
    - however provides better thumbnail alignment when laying out geomorphs
    - could even consider further restriction to gridRect
  - 🔔 seen symbol alignment improve on re-add symbol to 301
  - ✅ reflection of symbol takes account of node.offset
    - on reflect y/x-axis we negate x/y-offset
  - ✅ `createSymbolFromSavedFile` should not apply `node.offset` to geometry
  - ✅ check other symbols

- ❌ obstacle polygons should be clipped to image node's bounds
  - otherwise they'll be overlap in symbol spritesheet

- ✅ floor/ceiling textures per gmId not per gmKey
  - 🔔 continuous navmesh: cannot assume same triangles for distinct gmKey instances
  - ✅ draw floor as before but per gmId (ceil still per gmKey)
  - ✅ change NavMesh tile triangle test from gridRect to worldBounds
  - ✅ correctly computing triangles in different instances
  - ✅ for the moment let's override hull doorways with a rect
  - ✅ ceilings per gmId too
    - since using same quad as ceiling would need special attribute/uniform

- ✅ MapEdit: map: geomorph symbol not aligned
  - ✅ keep "the space at top" of 301
  - ✅ remove `node.offset` for hull symbols
  - ✅ add offset to respective `<image>` in map
  - ✅ fix it by changing how we compute mapDefs

- ✅ refactor Ceiling
  - ✅ own quad and attributes (don't use w.floor)
  - ✅ texture indexed by gmKey (needs attribute)
  - ✅ test by supplying new hull symbol geomorph

- ✅ fix missing obstacles
  - ✅ related to reflection
  - ✅ can fix via THREE.DoubleSide
  - ❌ fix without using it by flipping based on determinant

- ✅ obstacles
  - ✅ propagate e.g. `meta.y` from symbol into obstacles
  - ✅ hide unused obstacle quads
  - ✅ use textures
  - ✅ issue with triangular part of console capturing nearby chair
    - console--019--2x2
    - ✅ remove `--prod` from `gen-starship-sheets` and always restrict symbols.{texId}.png to obstacles polygons
  - ✅ clean
    - DataArrayTexture
    - `worldToSguScale * 5`

- ✅ BUG webgpu scene sometimes flickers initially and disappears
  - horrendous prod-only 
  - seems fixed by wrapping everthing in `<Suspense>`

- ✅ fix sporadic lighter/darker floor
  - seems fixed via react-three-fiber `<Canvas flat>`
  - ✅ avoid async re-draw (nav could be ready midway)

## By 27th Mar 2026

- ❌ strategy for extending zod schemas
  - ✅ parse localStorage before load
  - ✅ vite plugin does not use stale schemas i.e. import cache bust
  - ❌ suppose we change schema of nodes, how to migrate saved file?
    - ask Jason
    - https://www.jcore.io/articles/schema-versioning-with-zod
    - `z.preprocess` with function

- ✅ demo-map-0
  - ✅ fix g-301-bridge width/height/thumbnail
  - ✅ issue with path node import i.e. baseRect has wrong size
  - ⚠️ path svg has viewBox `0 0 1200 600` but width `6040px` and height `3039px`
    - changing width/height to 1200/600 fixed it
    - ✅ viewBox `0 0 w h` should override though
  - ✅ draw hull thumbnails differently: polys and rects only
  - ✅ draw map thumbnails using hull thumbnails, not symbols

- ✅ graphical representation of path nodes in thumbnail

- ✅ `pnpm gen-pkg`

- ✅ script watches public/symbol/* and enriches/flattens symbols as `assets.json`
  - ✅ start script gen-symbols-json
  - ✅ start defining schema for `assets.json`
  - ✅ creates `public/assets.json` with symbol lookup
  - ✅ compute walls
  - ✅ compute obstacles
  - ✅ compute doors
  - ✅ towards symbol flattening
    - ✅ packages/graph migrated from npc-cli-next
      - base-graph and Graph namespace
    - ✅ assets.json symbols have sub-symbols
    - ✅ create stratified graph
    - ✅ migrate `instantiateFlatSymbol` ignoring optional doors/walls
      - should 1st store `transform` from decor image node in `decor.meta.transform`
      - decor quads will be transforms of sub-quads of textures
      - decor cuboids will be transforms of base instanced cuboid
    - ✅ can see flattened symbols in assets.json
  - ✅ script should be watching (currently manually running `pnpm gen-assets-json`)
  - ⚠️ some of it should run in browser
    - we'll permit hull symbols edits in prod

- ✅ support image nodes with names `decor key={decorKey}`
  - ✅ sources are svgs in media/src/decor
    - so far, some icons from https://github.com/phosphor-icons/core/tree/main/raw/duotone
  - ✅ vite plugin generates thumbnails
    - packages/media/src/decor/foo.svg -> packages/app/public/decor/foo.thumbnail.png
  - ✅ rename watch-symbols -> watch-assets
  - ✅ image node browser includes decor section
  - ✅ BUG watching decor outside packages/app
    - ✅ `public/decor` is a symlink to `media/src/decor`
    - ✅ vite plugin watches `public/decor/*.svg` and generates manifest
  - ✅ refine decor images
    - ✅ convention for decor image sizes: icons 60x60
    - ✅ can resize image nodes
  - will support e.g.
    - `decor quad key=switch` (textured quad)
    - `decor cuboid color=#ff0` (vanilla cuboid)
  - will generate spritesheets with meta json

- ✅ migrate geomorph.createLayout
  - ✅ implement postParseSymbol 
    - we don't support `removableDoors` or `addableWalls` yet
  - ✅ symbols also have hullWalls (sub of walls)

- ✅ World has mapKey which can be changed
  - ✅ World has meta.mapKey with default "empty-map"
  - ✅ World has WorldContextMenu reading public/map/manifest and can change mapKey

- ✅ move map-node-api schemas into separate files
  - ✅ util/src/geom/schema
  - ✅ ui/map-edit/src/editor.schema
  - ✅ ui/world/src/decor.schema
  - ✅ ui/world/src/assets.schema

- ✅ can see floors in World
  - ✅ start service/geometry.ts
  - ✅ start service/shader.ts
  - ✅ Floor uses instancedMesh demo
    - i.e. some instances with different colours
  - ✅ draw a demo texture atlas and apply it to floor instancedMesh
  - ✅ migrate positionInstances -> transformInstances
    - ✅ demo-map-0 should have at least two geomorphs
    - ✅ LayoutInstance schema
    - ✅ start migrating World query
      - ✅ assets.json has mapDefs in `map` lookup
      - ✅ migrate geomorph.computeLayoutInstance
    - ✅ transform instances
  - ✅ migrate state.addUvs
  - ✅ clean

- ✅ fix start with empty map

- ✅ support recomputing layouts in prod
  - can only edit hull symbols
  - technically re-flatten and re-stratify so could support arbitrary symbol edits

- ✅ assets.json is in world coords
  - public/symbol/*.json are in sgu coords (1grid ~ 60 x 60)
  - we scale by `1/60 * 1.5` i.e. `0.025` so 1grid ~ 1.5m x 1.5m

- ✅ use zod codec for points
- ✅ use zod codec for rects

- ✅ gen-assets-json triggers hot-reload

- ✅ fix misaligned demo-map-0
  - try take `offset`s into account
  - check symbol snapping preserves offset

- ✅ can see walls in World

- ✅ replace dummy gltf with model from fiverr
  - ✅ can see template.gltf
  - ✅ use gltf to jsx for refined import
    - ✅ Blockbench: gltf export: `Export Groups as Armature`
    - ✅ migrate "uncloned" gltfjsx i.e. `pnpx gltfjsx template.gltf`
    - ✅ use a clone like generated jsx
  - ✅ remove walkingRobotGuyGltf, testBlockBench5Gltf
  - ✅ try convert minecraft texture to format
    - fiverr third-party did a great job
  - ✅ try add basic shader i.e. shade by dot product of normal with camera view direction
  - ✅ fix hmr when cloning

- ✅ can "reset file" in dev/prod, cannot delete file in prod
- ✅ remove MainMenu > Open


- ❌ sync navmesh recomputation with MapEdit
  - DEV edit symbol -> recompute assets.json -> refetch + change `w.hash` -> floor redraw
  - ❌ try await nav recomputation in world query
  - ✅ BUG: PROD webworker is refetching assets without changing it
    - need to send the localStorage drafts to webworker

- ✅ sync symbols in other instances
  - symbol thumbnails driven by meta.localVersion updated on `assetsJsonChanged`

- ✅ migrate to `node:util` parseArgs i.e. discard `getopts`
  - keep it for `@npc-cli/cli`


## By 11th Mar 2026

- ❌ migrate existing character to Blockbench
  - head 128x128 (1x1) body 384x128 (3x1)
  - ✅ copy over npc texture svgs
  - ✅ head has texture
  - ✅ head and body have correct texture dimensions
    - body should probably be thinner
  - ✅ body has texture
  - ❌ has arms
    - can dup and flip
- ✅ request third-party
  - https://www.fiverr.com/seanencabo/do-blockbench-models-and-animations

- ✅ can render UiInstanceMenu inside ui e.g. for Tabs

- ✅ towards MapEdit 1
  - ❌ try convert our SVG symbols into GLTF importable by Blockbench GLTF import plugin
    - Migrating from SVG symbols to Blockbench (free as opposed to BoxySVG)
    - ❌ test generate some valid Blockbench file
      - unclear format
      - https://github.com/JannisX11/blockbench-plugins/tree/master/plugins
        - gltf import plugin didn't work
    - ❌ try generate OBJ file and import manually
      - import ignores groups i.e. flat
    - ✅ try programmatically generate gltf and import into blockbench
      - https://gltf-transform.dev/
      - ✅ one cuboid inside a group
      - `pnpm test-gltf-transform`
    - ❌ generate gltf with a texture
      - seem pretty hard if we follow gtlf-transform i.e. weird winding-order
      - instead, try to understand the format exported by blockbench i.e. `cube-exported-from-blockbench`
      - seems everything is stored in a base64-encoded buffer
      - ❌ try to decode that buffer
      - decided against this approach
  - ❌ try create a starship symbol in blockbench
    - inability to support references
  - ✅ add placeholder MapEdit ui
  - ✅ start migrating scripts for "extracting" and renaming starship symbols
    - ✅ towards get-pngs
    - ✅ `pnpm get-pngs root Symbols symbol-root` worked
  - ❌ sketch script to convert an SVG symbol e.g. capture some stuff
  - ❌ parse gltf into e.g. floor, walls, ceiling, cuboids, quads
    - 🤔 maybe can avoid by directly parsing Blockbench JSON
  - ✅ can add group ui
  - ✅ can edit group name
  - ✅ cannot drag node into descendent
  - ✅ when group selected added group should be child
  - ✅ adding group adds a respective <g>
  - ✅ can add rect
  - ✅ can edit group/rect/path name
  - ✅ selected rect has outline
  - ✅ can drag a rect
  - ✅ can resize a rect
  - ❌ can convert a rect into a path
  - ❌ unions of rects/paths is another path
  - ✅ in-browser SVG-based replacement of Boxy SVG editor
    - ℹ️ implement via svg
    - ℹ️ easier to import current files
    - ✅ mock up "tree + svg"
    - ✅ @atlaskit/pragmatic-drag-and-drop for inspector dragging
    - ✅ symbols tree (groups, rects) works properly

- ✅ migrate script to convert png to webp

- ✅ MapEdit has image node
  - ✅ provide some images
    - ✅ symbolByGroup
    - ✅ ensure-asset-pngs script copies files to public
  - ✅ can create node type "image"
  - ✅ can choose image
    - uses imageKey to get image
  - ✅ can restore after rect/image resize

- ✅ MapEdit improvements
  - ✅ fix borders of symbols e.g. zealous trim
    - ✅ apply to cargo
    - ✅ apply to others
  - ✅ scaling snaps to grid but uniform scaling preserves aspect ratio
  - ✅ only one selection rectangle e.g. so visible when object occluded
  - ✅ duplicated object should inherit name prefix
  - ✅ on add rect or image should appear in current viewport

- ✅ figure out correct scaling based on geomorph input files
  - 1x1 sgu (starship geomorph units) ~ 300x300 PNG pixels
  - we scale by 1/5 so 1x1 sgu ~ 60x60 SVG units

- ✅ fix diagonal resize: now covered by absolute?
- ✅ fix disabled toggle inside Tabs

- ✅ more MapEdit
  - ✅ can choose filename to save
  - ✅ can save to file system in dev
  - ✅ try align source PNGs to grid
    - ✅ apply `transform` to rect and image instead of changes x, y, width, height
  - ✅ fix align PNG on scale
    - we prohibit scale of PNG (never scaled them in npc-cli-next)
  - ✅ move dx, dy into image node only
  - ✅ can manually adjust image node offset
  - ✅ can choose save directory `"symbol" | "map"`
    - we won't save svgs but rather "flat symbols" or "maps"
  - ✅ on close image modal without choosing delete image node
  - ✅ dx/dy ui is at top-level
  - ✅ can scroll inspector properly
  - ✅ fix editing id preventing e.g. create rect via `r`
    - seem to happen when select via rectangular area
    - can see node because it remains italic

- ✅ towards type `symbol`
  - need to creates thumbnail for each symbol
  - ✅ organise script into `watch-symbol-thumbs.ts`, `restart-on-fail.sh` and `pnpm -F scripts watch-symbol-thumbs  forever script watches public/symbol`
  - ✅ script watches public/symbol and executes on change
  - ✅ make generic watch-files script i.e.
    > `pnpm restart-on-fail watch-files --globs='[\"packages/app/public/symbol/*.json\"]' --pnpmBin=noop`
  - ❌ try render SVG preview on MapEdit save
    - ✅ use dev endpoint POST /api/map-edit/on-save receives SVG text
    - ❌ symbol/map manifest created on start dev server
      - ✅ server-side svg render
      - ✅ can set width/height in MapEdit
      - ✅ save width/height in file
      - ❌ store svg markup in manifest
  - ✅ /api/map-edit/file/symbol/:filename renders a PNG preview
  
  - ✅ node of type `symbol`
    - ✅ POST /api/map-edit/file/:type/:filename updates public/symbol/manifest.json
    - ✅ PNG preview should include full bounds, manifest needs bounds too for "offset"
    - ✅ modal with symbol thumbnails
    - ✅ clean
      - ✅ symbolKey should be typed
      - ✅ `rect | image | symbol` e.g. "draggable"

- ✅ can lock nodes
- ✅ locked image/symbol nodes have 25% opacity

- ✅ list files via manifest not dev server
- ✅ generate/get maps manifest too
- ✅ on delete file switch to another file
- ✅ on delete symbol/map update manifest and remove thumbnail
- ✅ map needs thumbnail too


- ✅ 1st "extra" symbol `extra--004--desk--0.5x1`
  - i.e. a symbol that does not comes from starship-symbol PNGs
  - ✅ manually add to packages/media/src/starship-symbol/output/extra
    - npc-cli-next svg -> copy data url
  - ✅ `pnpm starship-pngs-to-public` ensures and extends manifest
  - ✅ can add image to MapEdit

- ✅ renaming imports from process-symbol breaks vite plugin
  - should work now using `server.ssrLoadModule`

- ✅ make symbol for `extra--004--desk--0.5x1`
- ✅ hull symbols "image" should not be scaled down

- ✅ can extend symbol lookup without restarting vite plugin

- ✅ can copy/paste nodes between instances
- ❌ sync files in other instances?
  - can load again in other instance

- ✅ change manifests from byFilename -> byKey
- ✅ manifest entries have `key`
- ✅ increment is `10` by default
  - increment is `1` when press shift (translate) or ctrl (select)

- ✅ align sub-symbol of hull symbol
  - ✅ for symbols need their bounds.width and height
  - dimensions of symbol is wrong
  - e.g. 120x120 originally but thumbnail is larger i.e. use `bounds`

- ❌ restart vite onchange map-edit plugin
  - but we do cache bust imports

## By 7th Feb 2026

- ✅ follow a blockbench animation tutorial and export gltf
  - https://youtu.be/y0ees2j17AY?si=EmmdGiXTgI0_11V7&t=240
  - https://youtu.be/y0ees2j17AY?si=ch61BNtn0ErcaXI2&t=388
  - https://youtu.be/y0ees2j17AY?si=DaJvvW05wfqMOhH6&t=466
  - ✅ split legs into upper/lower
  - ✅ split arms into upper/lower
  - ✅ create first pose with upper/lower legs and upper arms
  - ✅ create 0.5s pose by
    - copy right arm @0 to left arm @0.5
    - copy left arm @0 to right arm @0.5
  - ✅ copy 0s pose to 1s
  - ✅ move 3 steps forwards (24fps) and adjust left leg down
    - lower, upper so that "foot" on floor
  - ✅ move 4 steps forwards and adjust hips up (so left foot on ground)
  - ✅ move 4 steps backwards and adjust hips down (so left foot on/in ground)
  - ✅ copy hip frames in `[0, 0.5)` to `0.5`
  - ✅ move 3 steps forwards from `0.5` and rotate left_leg_lower back
    - 🔔 important
  - ✅ copy all left_leg_lower keyframes and:
    - paste on right_leg_lower at `0.5`
    - copy final 3 and paste at `0`
    - remove final 2
    - adjust max time back to `1`
  - ✅ paste over "extra" left_leg_upper keyframe onto right_left_upper shifted +0.5

- ℹ️ Blockbench UI
  - Select all in Timeline:
    - Animation > "Bring up all animators"
  - Scale UI
    - Settings > Interface > Ensure Desktop, Choose UI Scale [0,100]
  - Loop animation
    - Right click > Loop Mode > Loop
  - Default 24 frames-per-second
  - Can also specify max FPS
    - Settings > Preview > e.g. 60fps
  - Shift for 0.25 unit translation

- ✅ responsive grid layout items as packages/ui/*
  - ✅ packages/ui/demo
  - ✅ packages/ui/demo -> packages/ui/template
  - ✅ scaffold-ui script
    - `pnpm exec scaffold-ui`
  - ✅ packages/ui/blog
    - renders mdx
  - ✅ packages/ui/jsh
  - ✅ packages/ui/global
    - e.g. theme button, layouts
  - ✅ registered somehow inside app
  - ✅ defined by layout

- ✅ theme provided by ui context to uis

- ✅ can lock uis via overlay ui
  - e.g. to fix TtyMenu open/close in mobile
  - ✅ rewrite layout so every item created "in same way"
  - ✅ move borders out of uis
  - ✅ add extra component using phosopher-icons

- ✅ move ui borders outside uis

- ✅ persist UiLayout as "ui-layout"
- ✅ persist UiLayout with itemIdToClientRect
- ✅ initial skeleton (ssg) on refresh via persisted data
- ✅ clean initial skeleton
- ✅ retreive persisted ui-layout

- ✅ normalize tsconfigs like bz-frontend
  - ✅ inherit from tsconfig.base.json

- ✅ avoid react-grid-layout initial animation
  - ✅ initialWidth window.clientWidth + positionStrategy={absoluteStrategy} works

- ✅ can right click add grid item
  - ✅ UiGridContextMenu component
  - ✅ create item creates grid item

- ✅ fix multiple ttys
  - need different session
- ✅ ui items receive props.id i.e. `itemId`

- ✅ can remove grid item
- ✅ fix remove grid item bug
  - fix mobile via onPointerUp -> onPointerDown

- ✅ can reset layout from global
- ✅ force grid height full

- ✅ tty should use sessionKey not layoutId
  - ✅ ui context provides uiStore
  - ✅ every ui has respective meta `{ layoutId, uiKey }`
  - ✅ contextmenu can specify sessionKey
    - ✅ ui has optional uiInstantatiorRegistry
    - ✅ Jsh has entry in uiInstantatiorRegistry
    - ✅ contextmenu shows respective ui
    - ✅ bootstrap ui enforces non-existing sessionKey `tty-{n}`
  - ✅ unmount should remove uiConfig
  - ✅ persisted layout can contain partial ui instance meta

- ✅ avoid pinchzoom opening contextmenu

- ✅ popover confirm for ui close
- ✅ popover confirm for Global reset

- ✅ uis have schema validated in `<UiInstance>` inducing type of `props.meta`

- ✅ UiGrid supports tabs
  - motivation: hide Global on mobile; grouping; improve mobile layouts
  - ✅ basic instantiable ui/tabs with layout in schema
  - ✅ show contextmenu on click add tab
    - ❌ tried via external `Menu.trigger` but it broke main `ContextMenu.trigger`
  - ✅ can specify other uis in tab slots
  - ✅ clicking add tab adds ui to new tab
    - ✅ alerts mock
    - ✅ render ui's meta inside tab
  - ✅ ui.layoutId -> ui.id
  - ✅ by default uis have lowercased title `${uiKey}-${firstNaturalNumber}`
    - could change per ui but e.g. tty sessionKey already matches
  - ✅ tab has "break-out" button
    - in future replace with "drag outside"
    - ✅ can break out
    - ✅ issue maybe with stale layoutApi e.g. lack tabs ui?
      - works after hard-refresh
      - happens from empty tabs if add two Jsh tabs
      - seems fixed after  `id := meta.id` and use as dep
  - ✅ try use react-reverse-portal in each grid item
    - reparenting
    - ✅ defineUi ui takes optional portalNode and renders into it
    - all uis (ones in tabs too) have a portal in ui.store
    - ✅ UiInstance provides portalNode and renders out portal
  - ✅ break out tab should preserve portal
    - might need store after all
    - ✅ UiInstance stores in ui.store on mount, but does not remove on unmount
    - ✅ Delete tab removes portal
    - ✅ Delete UI removes portal
    - ✅ Delete tabs removes all sub-portals
    - ✅ re implement break out tabs
  - ✅ ui break out is still broken for Jsh and World
    - still fixed by refreshing
    - probably related to stale layoutApi
  - ✅ delete tab should delete portal too
  - wrap uiStore.setState inside uiStoreApi 

- ✅ redo portals
  - ✅ remove portal code
  - ✅ `uiStore.byId` with values `{portal,meta}`
  - ✅ move UiGrid's `toUi` to uiStore `toInitMeta`
    - initially provided meta pre-zod-parse
    - try use to initiate portals
  - ✅ mount uis in external portal container
    - ✅ listen to toInitMeta
    - ✅ ensure byId rather than in defineUi
    - ✅ fix initial rect
  - ✅ remove toInitMeta using byId only
    - initial meta should be parsed
    - unify `byId` and `toInitMeta`
  - ✅ On add item should parse meta and provide parsed or original to store.
  - ✅ uiStoreApi.addUis
  - ❌ UI has no props except id.
    - avoids need to refine UI props type.
    - ❌ too much bloat in each ui
  - ✅ UI in portal should parse meta too.
  - ✅ fix Tabs
    - need to create portal which is not auto-added to grid
    - ✅ `byId.meta.parentId` is undefined or tabsId
    - ✅ UiGrid does not render portals with parentId
  - ✅ fix overwrite uis on hmr
    - previously the last persisted uis were reverted to
    - currently continually tracking ui.store in layout.store uiLayout.toUi
    - alternatively could use a state variable in routes/index.tsx

- ✅ refactor layoutApi e.g. remove addItem

- ✅ merge layout.store into ui.store + persist (?)
  - ✅ ui.layout uses persist middleware
  - ✅ restore layout from ui.store
  - ✅ migrate rest of layout.store e.g. ready
  - ✅ remove layout.store

- ✅ packages/ui/world
  - ✅ create dummy package
  - ✅ add react-three-fiber
  - ✅ import and view gltf
    - debug via gltfjsx i.e. `pnpx gltfjsx TestBlockbench5.gltf`

- hmr issues
  - ✅ onchange ui.store sometimes lose layout
  - ✅ ui.store issue with context...
    - editing Tabs caused it to disappear
    - seems related to zustand ui.store hmr behaviour
      - even when only imported, not fed thru context
    - apparently fixed via preservation over hmr using `import.meta.hot.data.__ZUSTAND_STORE__`
  - ✅ can we avoid remount on edit ui.store?
    - preserve uiRegistry on hmr (similar to ui.store fix)

- ✅ move uiStoreApi.uiGrid to ref
- ❌ addUis supports opts.layoutItems
  - appendLayoutItems is now inside UiContext, not uiStoreApi
- ✅ uis have play/pause button tied to meta.disabled


## By 3rd Jan 2026

- ✅ initial setup (thanks Jason Yu)
  - vite
  - pnpm
  - tailwind
  - biome
  - tanstack router
  - nested tsconfigs
  - monorepo with catalog
  - package.json exports

- ✅ packages/parse-sh
  - https://github.com/un-ts/sh-syntax
  - ✅ build main.wasm
  - ✅ can instantiate main.wasm
  - ✅ wrap main.wasm i.e. `parse` returns pointer and need "return value" instead
    - https://github.com/un-ts/sh-syntax/blob/d90f699c02b802adde9c32555de56b5fec695cc6/src/processor.ts#L219
  - ✅ validate using zod
  - ✅ extend underlying structs somehow
  - ✅ test at http://localhost:5173/test-wasm/
  - ✅ cli -> parse-sh

- ✅ upgrade to mvdan-sh go version 
- ❌ upgrade to latest mvdan-sh
  - not yet
- ✅ interactive parsing works!

- ✅ follow blockbench rigging tutorial
  - ✅ start using desktop app for better save functionality
  - cube at center; move right 3; scale uniform +1 (option/alt + drag)
  - dup: cmd + d, undo: cmd + z, redo (rebound): cmd + shift + z

- ✅ add react-grid-layout at root index
- ✅ add mdx
- ✅ can use tailwind typography styles in mdx

- ✅ dark theme
  - ✅ theme store
  - ✅ theme switch in react-grid-layout
  - ✅ fix dark mode colours


- ✅ start packages/cli
  - ✅ start migrating parse.ts
  - ✅ start extending `syntax.Command` parsing
    - extend structs.go, run `pnpm build:wasm`
  - ✅ does namespace `MvdanSh` still make sense?
  - ✅ start migrating tty.shell

- ✅ packages/cli has Terminal component
  - ✅ add BaseTty
  - ✅ add Tty
  - ✅ test mount Tty
  - ✅ fix issue `failed to expand word`

  - ✅ add react-query
  - ✅ packages/cli has getCached based on packages/util QueryCacheApi
  - ✅ initialize using app's queryClient
