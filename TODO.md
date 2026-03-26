# TODO

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

- 🚧 script watches public/symbol/* and enriches/flattens symbols as `assets.json`
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
  - 🚧 script should be watching (currently manually running `pnpm gen-assets-json`)
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

- 🚧 can see floors in World
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
  - 🚧 clean

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

- can see walls in World
- symbols can have optional door supported by instantiateFlatSymbol
  - e.g. office--001--2x2
- symbol can have optional wall supported by instantiateFlatSymbol

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


## Long running

- 🚧 extend existing symbols with missing decor/obstacle
  - ✅ stateroom-012 🚧 ...
  - ✅ BUG thumbnail wrong for transformed decor: origin?
    - packages/app/public/symbol/stateroom--012--2x2.thumbnail.png

- can sync symbols in other instances?
- with 2 instances open for same file, drafts will fight?
- ✅ can "reset file" in dev/prod, cannot delete file in prod
- ✅ remove MainMenu > Open
- try deform limbs of blockbench model, saving as separate file
- move path parsing code out of vite plugin file, to support hmr
- warn if symbols "above" walls in symbol

- 🚧 migrate to `node:util` parseArgs i.e. discard `getopts`

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

- 🚧 future tabs
  - ✅ try make basic tabs components with draggable tabs
    - https://atlassian.design/components/pragmatic-drag-and-drop/about
  - ✅ can drag between different tabs components
  - can drag into tabs from outer ui
  - can drag out of tabs to outside (not another tabs)
  - detect responsive tabs change and revert on return (?)
