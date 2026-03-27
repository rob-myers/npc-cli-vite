# TODO

- 🚧 start using `navcat`
  - ✅ add to `ui__world`
  - ✅ create a webworker which can send/receive
  - 🚧 generate demo tiled navmesh in webworker
  - send via serialization

- DEV: do not recompute all symbols when only edit a hull symbol
  - already done in prod in case of hull-symbols
  - more generally could use stratification sub-graph

- BUG MapEdit asking to save draft changes onchange when there are no changes

- symbols can have optional door supported by instantiateFlatSymbol
  - e.g. office--001--2x2
- symbol can have optional wall supported by instantiateFlatSymbol

## Long running

- 🚧 extend existing symbols with missing decor/obstacle
  - ✅ stateroom-012 🚧 ...
  - ✅ BUG thumbnail wrong for transformed decor: origin?
    - packages/app/public/symbol/stateroom--012--2x2.thumbnail.png

- can sync symbols in other instances?
- drafts fight: with 2 instances open for same file
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
