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

- rewrite README.md

- improve hull symbol thumbnail e.g. add room outlines
- improve map thumbnail (🔔 currently blank)

### Performance

- consider pruning navcat of unused stuff

### Playground

- ✅ playground preserve npc position
  - an edit keeps `mapKey`, so no `onChangeMap`: nothing re-seated the crowd — see `w.npc.reseatAll`
  - ✅ should also work in other maps
  - ✅ saw npc walking in place
  - ✅ fix error on remove room containing player
    - TypeError: Cannot read properties of null (reading 'type')
    - `w.gmRoomGraph.getReachableUpTo(gmRoomId.grKey, (node) => node.type === "door" && w.d[node.gdKey]?.open !== true)`
  - ✅ fix `door-opening` TypeError reading 'hull' on save

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

## MapEdit

- 🚧 extend existing symbols with missing obstacles

## Testing

- ask Fable for playwright test suite


## UNSORTED

### Bugs 🚧

- ❌ can override edit g-301--playground.json in dev
  - currently can only save as draft
  - manually created, mentioned in [./map-edit.md](map-edit.md)
- obstacle resizing can be confusing
  - rotation is "determined" by the symbol's dimensions and the graphics appearance within it
  - we can forget to "update obstacles"
- ✅ BUG assets.json decor orient changing for no apparent reason?
  - mostly in 101 so maybe needs re-save?
  - possibly related: remove symbol, save, undo, save (delta exists), save (delta removed)
  - used normalizeDegrees
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

