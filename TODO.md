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

- ✅ runtime decor
  - ✅ render runtime decor as separate instancedMesh
    - ✅ can remove `w decor.remove test-decor-point`
    - ❌ remove def.{x,y} and only use def.transform
      - instead def.transform overrides
    - ✅ can pick
  - ✅ remove instance via swap with last
  - ✅ more explicit hmr i.e. recompute gmRoomId
  - ✅ shell function for removing runtime decor
    - `remove` also replaces `clear`
  - ✅ show static/runtime decor rect/circle when meta.shown
    - ✅ fix initially white runtime decor rect/circle (saving Decor changes to green)
    - ✅ bug when `remove test-decor-rect` when `demo_add_decor` twice
      - auto remove extant on create
      - remove decor also removes from grid
    - ✅ simplify code in Decor
      - ✅ can tint static or runtime decor
        - `w e.toggleLock g0d23`
        - `w decor.tintDecor blue test-decor-rect`
      - ✅ simplify shader code
        - could pre-render circle/rects but won't like as good
        - for the moment we'll accept the complexity
  - ✅ can create colliders from decor rect/circle
    - ✅ can manually create a collider
      - `demo_add_colliders`
    - ✅ improve debug colliders
    - ✅ decor rects are being rendered wrong
    - ✅ runtime colliders should survive rebuild world
      - 🔔 saving physics.ts loses worker.store
      - 🔔 hot reload store trick does not work maybe because worker "self" destroyed?
      - ✅ instead, send the runtime decor defs in "rebuild payload"
        - ✅ aligned `demo_add_decor` and `demo_add_colliders` preserves colliders on hmr
        - ✅ align "colliders" with "decor" i.e. rect/circle collider created only via decor
          - w.decor.create
          - w.decor.remove
      - ✅ clean away old approach
    - ✅ hook into `w.decor.create`
    - ✅ verify events
      - `events /-collider/ | map meta`

- ✅ can log draw calls from WorldMenu
- ✅ reduce draw calls
  - avoid multiple materials where possible
  - avoid THREE.DoubleSide where possible

- ❌ npc has selector quad
  - restyle label instead

- ✅ npc labels should match animation e.g. sit, lie
- ✅ support `look`

- ✅ hide speech bubbles whilst looking down from above
  - two modes: "looking down" and not, based on camera polar angle
  - ✅ whilst "looking down" contract speech bubble
  - ✅ can indicate they're talking via ellipsis added to their unique label
    - `label npc:rob speaking`
  - ❌ whilst speech bubble contracted can temporarily view its contents
  - ✅ fix translate/resize on mobile
  - ✅ hide speech bubble whilst top down, after all
  - ✅ when `npc.labelStyle.speaking` show icon rather than ellipsis
    - icons should always be decor
    - ✅ `w.decor.imgForOtherText['speech-bubble']`
  - ✅ if top down and `say npc:foo bar` then see flicker
  - ✅ demo_log_speech outputs speech in terminal
  - ❌ initial (sans resize) bubble width based on text length

- ✅ speech bubble extras
  - ✅ fade in 
  - ✅ fade out and auto-delete
  - ✅ clean Html3d
  - ✅ clean NpcBubbles

- ✅ speech bubble pointer events redo
  - ✅ by default pointer-events-none except interactive toggle
  - ✅ interactive toggle permits resize when interactive
  - ✅ after timeout become non-interactive
  - ❌ does not fade when translating or resizing
    - can pause and translate/resize
  - ✅ clean

- ✅ remove w.bubble.topDown using w.view.topDown instead
- ✅ speech bubble remembers offset after dispose and re-create

- ✅ mobile camera changes
  - isolate pinch-zoom from rotation
  - pinch-zoom has more effect
- ❌ clean camera-controls
  - no need

- ✅ camera-controls snapAzimuth shows rotation until half-way then snaps
  - ✅ cameraMode is a CameraControls prop and persisted in WorldView
  - ✅ can change polar angle in cameraMode cardinal
  - ✅ cannot chain rotations in one gesture
  - ✅ snapping shows initial azimuthal rotation until half way
  - ✅ desktop polar angle control still wrong
  - ✅ verify mobile too

- ✅ BUG camera cardinal desktop got stuck on zoom on far and zoom back
- ❌ BUG cannot change polar angle sometimes when polar minimal

- ✅ support `lock` and `unlock`
- ✅ support `grant` and `revoke`
- ✅ BUG trigger nearby door on npc start-moving
  - covers case where previously revoked npc is provided key and is already nearby

- ✅ speech bubble remembers resize after dispose and re-create
- ✅ reduce npc draw calls
  - reduce multiple materials
  - ✅ front-sided
  - ✅ issue with overlapping shadow quads (depthWrite true)
- ✅ alphaTest looks better at 0.9 for robot-0

- ✅ avoid respawn when move to self or current doable
- ✅ BUG lie on bed, `say npc:rob zZZZzzZZZ`, click edit speech bubble => npc disappears
  - seems fixed
- ✅ can say for longer e.g. `say npc:rob zZZzzZZZZZ` stops too early
  - `say npc:rob zZZZzzZZZ secs:10`
  - `say npc:rob zZZZzzZZZ for:Infinity`


- ✅ BUG `pick | move npc:rob along` offmesh, onmesh, onmesh => walk animation not playing
  - REPRO (while unpaused) click navigable, chair, navigable, navigable
    - final navigation has no walk anim
  - we're setting `npc.arrive := false` as part of contiguous motion, however this prevents `startIdle` from reaching the assignment `npc.moving := false`
  - ✅ enforce `npc.moving = false` on `move` to doable

- ✅ clean animation logic using ai
  - ✅ NpcAnimation class
  - ✅ verify hmr
  - ✅ clean `npc.anim.startIdle`
  - ✅ clean `npc.anim.startMoving`
  - ✅ reorg npc separation
    - ✅ do not bother rotating idle npc as default separation behaviour
    - ✅ remove `updateLookAt` and `lookAtPoint`
    - ✅ updateIdle

- ✅ separation refinement
  - stuck example: idle npc on nav edge looking perp, other adjacent, target diametric
    - resolves on 2nd attempt i.e. npc velocity direction changes
  - stuck example: idle npc near (not on) nav edge looking along it, other behind and against nav edge
    - if on nav edge resolves on 2nd attempt
  - `agent.boundary.segments` of type `{ d: number; s: SixTuple<number> }`
  - ✅ idle npc "moves to closest segment" by default when other close

- ✅ rethink separation
  - ✅ no separation detection
  - ✅ after walk -> idle slow down, set small maxAcceleration
  - ✅ can `excuse_me npc:kate` (demo.js)
    - e.g case where other sandwiched against nav border
  - ✅ can move randomly `excuse_me again npc:kate`

- ✅ BUG move target too close to current position never arrives
  - bug was in playIdleAnim

- ✅ jerky idle transition on stuck  
  - `stand` seems better than `idle`
  - `idle -> breathe` and `stand -> idle` 

- ✅ hide shadows during pick so can spawn close
  - shame because it was preventing close moves

- ✅ nav helpers i.e. when block other
  - `nudge npc:kate src:rob`
  - `tweak npc:kate`
  - `park npc:kate`

- ✅ `tweak npc:kate by:1` -> `pad npc:kate by:1`
  - since we are providing "padding" relative to navmesh edge

- ✅ parseGroundPoint -> helper.parseGroundPoint

- ✅ `say` rethink
  - ✅ events "enter-topdown" and "exit-topdown"
  - ✅ fade in/out while paused too but no timer
  - ✅ clean opacity setting code
  - ✅ does not fade by default
    - ✅ `say npc:rob foo bar` does not fade, unless subsequent to timed
    - ✅ can `say npc:rob foo bar secs:3`
    - ✅ can `say npc:rob foo bar secs:Infinity`
    - ✅ can `say npc:rob` to fade out
  - ✅ separate resize ui from "active button"

- 🔔 useful commands
  - `pick | move npc:rob`
    - but moves to doors and non-doable obstacles too
  - `pick as:meta.gdKey`
    - get gdKey from door or switch
  - `pick meta.floor | move npc:rob`
    - but does not permit move to doable
  - `pick meta.{nav,do} | move npc:rob`
    - exactly the navigable or doables
  - `pick meta.{floor,do} | move npc:rob`
    - can pick floor points near nav 👈
  - `w decor.query $( pick 1 )`
  - `pick | w decor.query -`
  - `meta $( pick as:point 1 )`
  - `pick | w helper.parse3dHeight -`
  - `spawn npc:rob at:$( meta [4.5,4.5] )`

- ✅ how to handle npc blocking one door of a double door
  - lock the door (even with npc standing in it)

- ✅ can edit any symbol in prod but drafts must be manually restored
  - ✅ can edit any symbol in prod
  - ✅ verify recursive edit in local build
  - ✅ MapEdit readonly only for touch devices or when set in dev
  - ✅ drafts not auto-restored
  - ✅ can use-drafts use-originals reset all from MapEdit
  - ✅ can use-drafts use-originals from WorldMenu
  - ✅ in development in "use-drafts" in MapEdit, saving should not save to filesystem
    - should also clearly indicate this
  - ✅ improve MapEdit toasts
  - ✅ improve WorldMenu select
  - ℹ️ multiple drafts (needs grouping) is future work

- ✅ draft rethink and simplification
  - ✅ new hull symbol `g-301--playground` clone of `g-301--bridge`
    - ✅ `packages/media/src/starship-symbol/playground/g-301--playground`
    - ✅ `packages/media/src/starship-symbol/playground/extra` (prev output/extra)
    - ✅ adapt `starship-pngs-to-public`
  - ✅ new map `301-playground`
  - ✅ drafts only for: preserve unsaved, saving playground symbols
    - ✅ remove use-drafts use-originals controls
    - ✅ in playground symbols save to drafts only

- ✅ BUG World should update onchange playground map in MapEdit

- ✅ BUG MapEdit FileMenu on switch to map/symbol should not close

- 🚧 stress test i.e. spawnMany
  - ✅ refactor `spawn` into sub `rawSpawn`
  - 🚧 mount all at once

- ✅ `meta` extracts meta via decor grid
  - ℹ️ provides points with meta without using `pick`
    - `pick` object-picks with pointer and decodes pixel rgba
  - ✅ `meta at:$point`
    - e.g. `meta [1,1.5]`, `meta at:{x:1,y:1.5}`, `meta npc:rob`
    - ✅ outputs `{x,y,z,meta}`
    - ✅ add all obstacles as decor rects with an outline
      - `d.meta.refinedOutline?: Geom.VectJson[]`
    - ✅ d.meta.refinedOutline checked in `w.decor.queryPoint`
    - ✅ test angled rect point containment
    - ✅ test decor circle point containment
    - ✅ `meta all:$point`
    - ✅ most-relevant strategy
      - ✅ decor induced by obstacle needs aggregated `meta.y` which is available as `obstacle.height`
      - ✅ opts.desiredHeight restricts to ≤ 1

- ✅ w.decor.byRoom
  - recomputed on hmr

- ✅ clean `Npc` variable ordering

- ✅ on manually open locked door while npc close it is not auto-closing
  - because npcKey in `w.e.doorToNpcs.g0d25.inside`
  - do "refined inside doorway test"

- ✅ BUG door.closeTimeoutId not triggered when leave locked doorway
  - worked when left `nearby`, but now also triggered when leave `inside`

- ✅ BUG npc stuck when starts from locked doorway poly
  - try allow first 2 polygons encountered

- ✅ BUG navMeshHelper should not occlude object-pick

- ✅ BUG change geom-service should not restart world

- ✅ move "open door on click" to a script
  - WorldMenu has debug option "Toggle Doors"
  - `demo_toggle_doors`

- 🚧 BUG tile near origin?
  - 🚧 cannot navigate to it
  - ✅ pre flicker on spawn to shower
  - ✅ post move without walk
  - was referencing non-existent animKey `stand`

- BUG animation stops sometimes when go idle

- ✅ BUG speech bubble activate broken

- larger pause UI
- larger mobile UI

- BUG assets.json decor orient changing for no apparent reason?
  - mostly in 101 so maybe needs re-save?
  - possibly related: remove symbol, save, undo, save (delta exists), save (delta removed)
- BUG npc arms through locked door
- go thru skins
  - fix medic-0 foot texturing
  - improve general-0
  - add a couple more
- ✅ remove shuffle-back animation
- ✅ npc: unify state.lookAtPoint and updateLookAt
  - now have `npc.look` and `npc.anim.lookTick`
- BUG locked door opens when npc close enough to nearby sensor
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
