# TODO

- ❌ migrate existing character to Blockbench
  - head 128x128 (1x1) body 384x128 (3x1)
  - ✅ copy over npc texture svgs
  - ✅ head has texture
  - ✅ head and body have correct texture dimensions
    - body should probably be thinner
  - ✅ body has texture
  - ❌ has arms
    - can dup and flip
- 🚧 request third-party
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

- 🚧 towards type `symbol`
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
  - 🚧 node of type `symbol`
    - ✅ POST /api/map-edit/file/:type/:filename updates public/symbol/manifest.json
    - PNG preview should include full bounds, manifest needs "offset"
    - modal with symbol thumbnails

- ✅ can lock nodes
- ✅ locked image/symbol nodes have 25% opacity

- ✅ list files via manifest not dev server
- ✅ generate/get maps manifest too
- ✅ on delete file switch to another file
- ✅ on delete symbol/map update manifest and remove thumbnail
- ✅ map needs thumbnail too

- strategy for extending MapEditSavedFile schemas
  - ✅ parse localStorage before load
  - ✅ vite plugin does not use stale schemas i.e. import cache bust

- ❌ restart vite onchange map-edit plugin
  - but we do cache bust imports
- script watches public/symbol and "flattens" symbols
  - extend saved symbol first e.g. walls, doors
- in production, delete file should be "reset file"

- 🚧 shell refinement
  - ✅ finish migrating semantics
  - ✅ provide `modules` so can `import util`
  - ✅ fix ctrl-C for `poll`
  - ❌ BUG `echo foo | map 'x\n=>x'`
    - technically string does not define a valid js function so is interpreted as a string
  - ✅ Tty has /etc/{util.sh,util.js.sh}
  - 🚧 STOP bug: appears initially in e.g. 3rd tty
    - seen profile fail to load too
  - 🚧 improve `[undefined, undefined, undefined]` output of `call '() => document.documentElement.childNodes' | map Array.from | log`
  - sometimes on hot reload need to ctrl-c

- 🚧 future tabs
  - ✅ try make basic tabs components with draggable tabs
    - https://atlassian.design/components/pragmatic-drag-and-drop/about
  - ✅ can drag between different tabs components
  - can drag into tabs from outer ui
  - can drag out of tabs to outside (not another tabs)
  - detect responsive tabs change and revert on return (?)
