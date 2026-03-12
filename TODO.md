# TODO

- ❌ strategy for extending zod schemas
  - ✅ parse localStorage before load
  - ✅ vite plugin does not use stale schemas i.e. import cache bust
  - ❌ suppose we change schema of nodes, how to migrate saved file?
    - ask Jason
    - https://www.jcore.io/articles/schema-versioning-with-zod
    - `z.preprocess` with function

- can sync symbols in other instances?
- with 2 instances open for same file, drafts will fight?
- in production, delete file should be "reset file"

- 🚧 script watches public/symbol/* and enriches/flattens symbols as `assets.json`
  - ✅ start script gen-symbols-json
  - ✅ start defining schema for `assets.json`
  - 🚧 creates `public/assets.json` with symbol lookup
  - ⚠️ some of it should run in browser
    - we'll permit hull symbols edits in prod

- 🚧 replace dummy gltf with model from fiverr
  - ✅ can see template.gltf
  - ✅ use gltf to jsx for refined import
    - ✅ Blockbench: gltf export: `Export Groups as Armature`
    - ✅ migrate "uncloned" gltfjsx i.e. `pnpx gltfjsx template.gltf`
    - ✅ use a clone like generated jsx
  - 🚧 remove walkingRobotGuyGltf, testBlockBench5Gltf
  - try convert minecraft texture to format
  - try deform limbs

## Long running

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
