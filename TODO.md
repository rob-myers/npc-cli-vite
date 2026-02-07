# TODO

- 🚧 migrate existing character to Blockbench
  - head 128x128 (1x1) body 384x128 (3x1)
  - ✅ copy over npc texture svgs
  - ✅ head has texture
  - ✅ head and body have correct texture dimensions
    - body should probably be thinner
  - ✅ body has texture
  - has arms

- 🚧 investigate blockbench texture conventions
  - can select model face
  - can drag uv square area (not diagonal)

- towards MapEdit 1
  - some Blockbench symbols e.g. staterooms
  - parse gltf into e.g. floor, walls, ceiling, cuboids, quads

- towards MapEdit 2
  - MapEdit with react-resizable allows symbol placement
  - induces composite symbol e.g. hull symbol

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


- future tabs
  - try make basic tabs components with draggable tabs
    - https://atlassian.design/components/pragmatic-drag-and-drop/about
  - can drag between different tabs components

- detect responsive tabs change and revert on return (?)