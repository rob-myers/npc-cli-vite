# TODO

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

- 🚧 symbol asset bounds should come from "top image node"
  - polygons should be clipped to bounds e.g. obstacles,
    otherwise they'll be overlap in symbol spritesheet

- start generating documentation in README.md

- do not recompute all symbols when only edit a hull symbol (DEV)
  - done in prod for hull-symbols
  - more generally use sub-stratification
- import `crowd` from `navcat/blocks` and `crowd.update(agents, navMesh, clampedDeltaTime)`
- can connect Tty to World
- BUG MapEdit asking to save draft changes onchange when there are no changes
- symbols can have optional door supported by instantiateFlatSymbol
  - e.g. office--001--2x2
- symbol can have optional wall supported by instantiateFlatSymbol
- BUG `drawGm` (Floor): "SWEEP" probably poly union issue
  - need repro e.g. move stateroom inside 301

## Long running

- ❌ sync navmesh recomputation with MapEdit
  - DEV edit symbol -> recompute assets.json -> refetch + change `w.hash` -> floor redraw
  - ❌ try await nav recomputation in world query
  - ✅ BUG: PROD webworker is refetching assets without changing it
    - need to send the localStorage drafts to webworker
  - transition needs thought


- 🚧 extend existing symbols with missing decor/obstacle
  - ✅ stateroom-012 🚧 ...
  - ✅ BUG thumbnail wrong for transformed decor: origin?
    - packages/app/public/symbol/stateroom--012--2x2.thumbnail.png

- sync symbols in other instances?
- drafts fighting: with 2 instances open for same file
- try deform limbs of blockbench model, saving as separate file
- move path parsing code out of vite plugin file, to support hmr
- warn if symbols "above" walls in symbol

- ✅ migrate to `node:util` parseArgs i.e. discard `getopts`
  - keep it for `@npc-cli/cli`

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
