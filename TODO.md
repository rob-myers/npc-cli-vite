# TODO

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

- fix precision in `assets.json`
- start generating documentation in README.md
- check glsl fallback e.g. incognito or force
- support deleting symbols/maps from MapEdit
- improve thumbnails
  - generate map thumbnails (🔔 currently blank)
  - clean symbol thumbnails
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

- 🚧 extend existing symbols with missing decor/obstacle
  - ✅ stateroom-012 🚧 ...
  - ✅ BUG thumbnail wrong for transformed decor: origin?
    - packages/app/public/symbol/stateroom--012--2x2.thumbnail.png

- saw mobile fail to load initially but works after component update
- fix remove bug i.e. next tab not set
  - need repro
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

- ✅ future tabs
  - ✅ try make basic tabs components with draggable tabs
    - https://atlassian.design/components/pragmatic-drag-and-drop/about
  - ✅ can drag between different tabs components
  - can drag into tabs from outer ui
  - can drag out of tabs to outside (not another tabs)
