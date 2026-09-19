# TODO

## Blog

- blog initial layout
  - some text
  - demo video
  - comments

## World

### Animation

- try use strafe left/right animations
- skin remapping
  - currently only have skinIndex

### Cleanliness

- fix precision in `assets.json`

### Decor

- labels as decor point
  - ✅ already support room labels i.e. induced by decor point with label in room
  - provide example of label via dynamic decor

### DevX

- improve hull symbol thumbnail e.g. add room outlines
- improve map thumbnail (🔔 currently blank)

### Performance

- consider pruning navcat of unused stuff

### Playground

- 🚧 playground preserve npc position
  - should also work in other maps
  - saw npc walking in place
  - fix error on remove room containing player
    - TypeError: Cannot read properties of null (reading 'type')
    - `w.gmRoomGraph.getReachableUpTo(gmRoomId.grKey, (node) => node.type === "door" && w.d[node.gdKey]?.open !== true)`

## Documentation

- 🚧 new approach to todos i.e. current go into technical and start new section
  - ✅ final few before switch to blog
  - 🚧 current -> sections

- start generating documentation in README.md

## HMR

- on hmr recreate tty session `move` stops working?
- hot reloading of `pick | move npc:rob` while change `move`?
  - maybe just clarify current setup vs previous "hot reloading"

## Jsh

- Jobs: indicate stale processes after hmr

## Testing

- ask Fable for playwright test suite


## UNSORTED 🚧

- ❌ investigate larger walk around params with fallback to params permitting free motion around parked
  - try tween collisionQueryRange between 1 and 0.7
    - useful when two parked npcs face each other ~ 1 npc apart
    - could ping neighbours and reduce when two are close
- ❌ idle-left with left-leg forward
- ❌ idle-right with right-leg forward
- ❌ `npc.setMoveType` walk, run, shuffle
- ❌ fetch gltf json so can cache-bust
  - we hmr gltf now
- ✅ onchange map sealed doors are staying sealed
- ✅ try fix mobile persist issues via `visibilitychanged`
  - we'll wrap useBeforeunload and ensure callback only called once
- ℹ️ minecraft skin templates
  - https://minecraft.fandom.com/wiki/Skin#Templates
- ✅ MapEdit: on start drag should not select text
- ✅ MapEdit: pointer out not disposed somewhere
  - needs repro


### Bugs

- ✅ BUG parsing?
  - mvdan-sh parse works
  - convertMvdanShToJsh.File works `withParents(convertMvdanShToJsh.File(parsed.file))`
  - ✅ npm braces is crashing
```sh
expr {refinedOutline:[{x:11.12,y:2.91},{x:11.55,y:2.58},{x:11.99,y:2.31},{x:12.46,y:2.06},{x:12.95,y:1.86},{x:13.45,y:1.7},{x:13.97,y:1.59},{x:14.49,y:1.52},{x:15.01,y:1.5},{x:15.55,y:1.52},{x:15.55,y:1.52},{x:15.55,y:1.52},{x:16.07,y:1.59},{x:16.58,y:1.7},{x:17.09,y:1.86},{x:17.57,y:2.06},{x:18.04,y:2.31},{x:18.48,y:2.59},{x:18.9,y:2.92},{x:19.06,y:3.06},{x:17.68,y:3.06},{x:17.38,y:2.9},{x:17.12,y:2.9},{x:16.84,y:3.06},{x:16.15,y:3.06},{x:15.9,y:2.9},{x:15.63,y:2.9},{x:15.35,y:3.06},{x:14.66,y:3.06},{x:14.38,y:2.9},{x:14.16,y:2.9},{x:13.85,y:3.06},{x:13.16,y:3.06},{x:12.88,y:2.89},{x:12.66,y:2.89},{x:12.36,y:3.06},{x:10.95,y:3.06},{x:10.99,y:3.02}]}
```

- BUG change map to 301-101-301 and dynamicLight fails to propagate through some doors
  - fixed by saving texture.ts (hmr)
- BUG Jobs: sometimes interactive process 0 shows green although killed
  - need repro
- could cover up curved room raymarching woes
  - maybe `Walls` can vary opacity
  - provide additional Walls in MapEdit
- BUG npc position after change map
- BUG door open wrong way around during raycast of dynamicLight
  - sporadic due to hmr?
- improve transition dark-theme -> light-theme
- fix npc final turn when ends near nav border
- can override edit g-301--playground.json in dev
  - currently can only save as draft
- obstacle resizing can be confusing
  - rotation is "determined" by the symbol's dimensions and the graphics appearance within it
  - we can forget to "update obstacles"
- BUG assets.json decor orient changing for no apparent reason?
  - mostly in 101 so maybe needs re-save?
  - possibly related: remove symbol, save, undo, save (delta exists), save (delta removed)
- BUG npc arms through locked door
- BUG on save shell.ts terminal profile does not run
- BUG npc animation out of sync after save npc.ts (?)
- BUG on collapse/expand should persist pane dimensions
- BUG need two ctrl-c for while loop walk?
- ❌ BUG saw auto door close with nearby npc
  - maybe door was closing and didn't open quickly enough
- ✅ BUG on lock door and save Decor we lose switch tint
  - maybe just stale while paused
- BUG after hmr and `spawn` sometimes mesh not shown, yet can refetch query "template-gltf"
- BUG MapEdit asking to save draft changes onchange when there are no changes
- BUG MapEdit drafts fighting: with 2 instances open for same file
- ❌ BUG `drawGm` (Floor): "SWEEP" probably poly union issue

### Long running

- 🚧 extend existing symbols with missing obstacles
- ❌ move path parsing code out of vite plugin file, to support hmr
- ❌ warn if symbols "above" walls in symbol
