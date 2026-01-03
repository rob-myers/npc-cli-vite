# DONE

## By 3rd Jan 2016

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

- ✅ add react-grid-layout at root index
- ✅ add mdx
- ✅ can use tailwind typography styles in mdx

- ✅ dark theme
  - ✅ theme store
  - ✅ theme switch in react-grid-layout
  - ✅ fix dark mode colours


- ✅ start packages/cli
  - ✅ start migrating parse.ts
  - ✅ start extending `syntax.Command` parsing
    - extend structs.go, run `pnpm build:wasm`
  - ✅ does namespace `MvdanSh` still make sense?
  - ✅ start migrating tty.shell

- ✅ packages/cli has Terminal component
  - ✅ add BaseTty
  - ✅ add Tty
  - ✅ test mount Tty
  - ✅ fix issue `failed to expand word`

  - ✅ add react-query
  - ✅ packages/cli has getCached based on packages/util QueryCacheApi
  - ✅ initialize using app's queryClient
