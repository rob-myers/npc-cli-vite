# TODO

- 🚧 can connect Tty to World
  - ✅ namespace `JshCli`
  - ✅ cli/src/world/core.js exists
  - 🚧 can provide env.WORLD_KEY to `<Jsh>`
  - can provide PROFILE to `<Jsh>`
- can spawn npc in World

- change ui `Global` to `Layout`
  - remove theme toggle
  - can set one tab layout
  - can set two tab layout (vert or horizontal)
  - reset has layout, tty, world
  - responsive?
  - ❌ option to flatten layout (no Tabs)
  - layout schema and layouts.json
    - can CRUD in DEV

- import `crowd` from `navcat/blocks` and `crowd.update(agents, navMesh, clampedDeltaTime)`
- 🚧 check glsl fallback e.g. incognito or force
  - Walls and Doors don't draw i.e. too many
- object-pick sometimes out of sync since upgrade three.js `0.183.2`
- fix precision in `assets.json`
- start generating documentation in README.md
- support deleting symbols/maps from MapEdit
- improve hull symbol thumbnail e.g. add room outlines
- improve map thumbnail (🔔 currently blank)
- BUG MapEdit asking to save draft changes onchange when there are no changes
- symbols can have optional door supported by instantiateFlatSymbol
  - e.g. office--001--2x2
- symbol can have optional wall supported by instantiateFlatSymbol
- BUG `drawGm` (Floor): "SWEEP" probably poly union issue
  - need repro e.g. move stateroom inside 301
- minecraft skin templates
  - https://minecraft.fandom.com/wiki/Skin#Templates

## Long running

- 🚧 do not recompute all symbols when only edit a hull symbol (DEV)
  - done in prod for hull-symbols
  - ✅ use sub-stratification
  - could do client-side and ignore server update
  - createLayout optimization
    - saw `48ms`

- 🚧 extend existing symbols with missing decor/obstacle
  - ✅ stateroom-012 🚧 ...
  - ✅ BUG thumbnail wrong for transformed decor: origin?
    - packages/app/public/symbol/stateroom--012--2x2.thumbnail.png

- 🚧 ISSUE obstacle sprite-sheet when polygon aabb overlap
  - e.g. bridge--042: curved window vs. adjacent desk
    - when adjacent can fix via same height
  - technically can fix by creating an "extra symbol"

- saw mobile fail to load initially but works after "resize"
  - still happening

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
