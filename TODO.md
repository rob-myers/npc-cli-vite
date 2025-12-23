# TODO

- ✅ initial setup (thanks Jason Yu)
  - vite
  - pnpm
  - tailwind
  - biome
  - tanstack router
  - nested tsconfigs
  - monorepo with catalog
  - package.json exports

- ✅ packages/parse-sh
  - https://github.com/un-ts/sh-syntax
  - ✅ build main.wasm
  - ✅ can instantiate main.wasm
  - ✅ wrap main.wasm i.e. `parse` returns pointer and need "return value" instead
    - https://github.com/un-ts/sh-syntax/blob/d90f699c02b802adde9c32555de56b5fec695cc6/src/processor.ts#L219
  - ✅ validate using zod
  - ✅ extend underlying structs somehow
  - ✅ test at http://localhost:5173/test-wasm/
  - ✅ cli -> parse-sh

- ✅ upgrade to mvdan-sh go version 
- ❌ upgrade to latest mvdan-sh
  - not yet
- ✅ interactive parsing works!

- ✅ follow blockbench rigging tutorial
  - ✅ start using desktop app for better save functionality
  - cube at center; move right 3; scale uniform +1 (option/alt + drag)
  - dup: cmd + d, undo: cmd + z, redo (rebound): cmd + shift + z

- 🚧 follow a blockbench animation tutorial and export gltf
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

- Blockbench UI
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

- ✅ add react-grid-layout at root index
- ✅ add mdx
- ✅ can use tailwind typography styles in mdx

- ✅ dark theme
  - ✅ theme store
  - ✅ theme switch in react-grid-layout
  - ✅ fix dark mode colours

- 🚧 responsive grid layout items as packages/ui/*
  - scaffold script
  - registered somehow inside app
  - packages/ui/demo
  - packages/ui/mdx
  - packages/ui/themer
  - packages/ui/cli
  - packages/ui/world

- 🚧 start packages/cli
  - 🚧 start migrating parse.ts
  - 🚧 does namespace `MvdanSh` still make sense?
  - start migrating tty.shell

- 🚧 normalize tsconfigs like bz-frontend
  - ✅ inherit from tsconfig.base.json
- add react-query
- add react-three-fiber and import gltf
