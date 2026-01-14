# TODO

- ✅ follow a blockbench animation tutorial and export gltf
  - https://youtu.be/y0ees2j17AY?si=EmmdGiXTgI0_11V7&t=240
  - https://youtu.be/y0ees2j17AY?si=ch61BNtn0ErcaXI2&t=388
  - https://youtu.be/y0ees2j17AY?si=DaJvvW05wfqMOhH6&t=466
  - ✅ split legs into upper/lower
  - ✅ split arms into upper/lower
  - ✅ create first pose with upper/lower legs and upper arms
  - ✅ create 0.5s pose by
    - copy right arm @0 to left arm @0.5
    - copy left arm @0 to right arm @0.5
  - ✅ copy 0s pose to 1s
  - ✅ move 3 steps forwards (24fps) and adjust left leg down
    - lower, upper so that "foot" on floor
  - ✅ move 4 steps forwards and adjust hips up (so left foot on ground)
  - ✅ move 4 steps backwards and adjust hips down (so left foot on/in ground)
  - ✅ copy hip frames in `[0, 0.5)` to `0.5`
  - ✅ move 3 steps forwards from `0.5` and rotate left_leg_lower back
    - 🔔 important
  - ✅ copy all left_leg_lower keyframes and:
    - paste on right_leg_lower at `0.5`
    - copy final 3 and paste at `0`
    - remove final 2
    - adjust max time back to `1`
  - ✅ paste over "extra" left_leg_upper keyframe onto right_left_upper shifted +0.5

- ℹ️ Blockbench UI
  - Select all in Timeline:
    - Animation > "Bring up all animators"
  - Scale UI
    - Settings > Interface > Ensure Desktop, Choose UI Scale [0,100]
  - Loop animation
    - Right click > Loop Mode > Loop
  - Default 24 frames-per-second
  - Can also specify max FPS
    - Settings > Preview > e.g. 60fps
  - Shift for 0.25 unit translation

- ✅ responsive grid layout items as packages/ui/*
  - ✅ packages/ui/demo
  - ✅ packages/ui/demo -> packages/ui/template
  - ✅ scaffold-ui script
    - `pnpm exec scaffold-ui`
  - ✅ packages/ui/blog
    - renders mdx
  - ✅ packages/ui/jsh
  - ✅ packages/ui/global
    - e.g. theme button, layouts
  - ✅ registered somehow inside app
  - ✅ defined by layout

- ✅ theme provided by ui context to uis

- ✅ can lock uis via overlay ui
  - e.g. to fix TtyMenu open/close in mobile
  - ✅ rewrite layout so every item created "in same way"
  - ✅ move borders out of uis
  - ✅ add extra component using phosopher-icons

- ✅ move ui borders outside uis

- ✅ persist UiLayout as "ui-layout"
- ✅ persist UiLayout with itemIdToClientRect
- ✅ initial skeleton (ssg) on refresh via persisted data
- ✅ clean initial skeleton
- ✅ retreive persisted ui-layout

- 🚧 shell refinement
  - ✅ finish migrating semantics
  - ✅ provide `modules` so can `import util`
  - ✅ fix ctrl-C for `poll`
  - ❌ BUG `echo foo | map 'x\n=>x'`
    - technically string does not define a valid js function so is interpreted as a string

- ✅ normalize tsconfigs like bz-frontend
  - ✅ inherit from tsconfig.base.json

- ✅ avoid react-grid-layout initial animation
  - ✅ initialWidth window.clientWidth + positionStrategy={absoluteStrategy} works

- ✅ can right click add grid item
  - ✅ UiGridContextMenu component
  - ✅ create item creates grid item

- ✅ fix multiple ttys
  - need different session
- ✅ ui items receive props.id i.e. `itemId`
- can remove grid item

- 🚧 packages/ui/world
- 🚧 add react-three-fiber and import gltf
