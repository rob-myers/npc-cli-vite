# TODO

## Blog

- ✅ blog initial layout
  - ✅ can switch between pages
  - ✅ demo video
  - ✅ comments

- ✅ support mdx code-fences: tsx and sh

## World

### Animation

- try use strafe left/right animations
- skin remapping
  - currently only have skinIndex

### Camera

- improve fov based on dimension

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

- ✅ playground preserve npc position
  - an edit keeps `mapKey`, so no `onChangeMap`: nothing re-seated the crowd — see `w.npc.reseatAll`
  - ✅ should also work in other maps
  - ✅ saw npc walking in place
  - ✅ fix error on remove room containing player
    - TypeError: Cannot read properties of null (reading 'type')
    - `w.gmRoomGraph.getReachableUpTo(gmRoomId.grKey, (node) => node.type === "door" && w.d[node.gdKey]?.open !== true)`
  - ✅ fix `door-opening` TypeError reading 'hull' on save

## Documentation

- ✅ new approach to todos i.e. current go into technical and start new section
  - ✅ final few before switch to blog
  - ✅ current -> sections

- rewrite README.md

## HMR

- on hmr recreate tty session `move` stops working?
- hot reloading of `pick | move npc:rob` while change `move`?
  - maybe just clarify current setup vs previous "hot reloading"

## Jsh

- Jobs: indicate stale processes after hmr

## MapEdit

- 🚧 extend existing symbols with missing obstacles
- BUG MapEdit drafts fighting: with 2 instances open for same file

## Site

- ✅ deploy on https://staging.lastredoubt.co/
- ✅ deploy on https://lastredoubt.co/
- ✅ remove https://staging.lastredoubt.co/
- 🚧 setup umami analytics on https://lastredoubt.co/
  - https://cloud.umami.is/analytics/eu/websites

## Testing

- ask Fable for playwright test suite

