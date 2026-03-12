# DONE

## By 11th Mar 2016

- ❌ migrate existing character to Blockbench
  - head 128x128 (1x1) body 384x128 (3x1)
  - ✅ copy over npc texture svgs
  - ✅ head has texture
  - ✅ head and body have correct texture dimensions
    - body should probably be thinner
  - ✅ body has texture
  - ❌ has arms
    - can dup and flip
- ✅ request third-party
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

- ✅ towards type `symbol`
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
  
  - ✅ node of type `symbol`
    - ✅ POST /api/map-edit/file/:type/:filename updates public/symbol/manifest.json
    - ✅ PNG preview should include full bounds, manifest needs bounds too for "offset"
    - ✅ modal with symbol thumbnails
    - ✅ clean
      - ✅ symbolKey should be typed
      - ✅ `rect | image | symbol` e.g. "draggable"

- ✅ can lock nodes
- ✅ locked image/symbol nodes have 25% opacity

- ✅ list files via manifest not dev server
- ✅ generate/get maps manifest too
- ✅ on delete file switch to another file
- ✅ on delete symbol/map update manifest and remove thumbnail
- ✅ map needs thumbnail too


- ✅ 1st "extra" symbol `extra--004--desk--0.5x1`
  - i.e. a symbol that does not comes from starship-symbol PNGs
  - ✅ manually add to packages/media/src/starship-symbol/output/extra
    - npc-cli-next svg -> copy data url
  - ✅ `pnpm starship-pngs-to-public` ensures and extends manifest
  - ✅ can add image to MapEdit

- ✅ renaming imports from process-symbol breaks vite plugin
  - should work now using `server.ssrLoadModule`

- ✅ make symbol for `extra--004--desk--0.5x1`
- ✅ hull symbols "image" should not be scaled down

- ✅ can extend symbol lookup without restarting vite plugin

- ✅ can copy/paste nodes between instances
- ❌ sync files in other instances?
  - can load again in other instance

- ✅ change manifests from byFilename -> byKey
- ✅ manifest entries have `key`
- ✅ increment is `10` by default
  - increment is `1` when press shift (translate) or ctrl (select)

- ✅ align sub-symbol of hull symbol
  - ✅ for symbols need their bounds.width and height
  - dimensions of symbol is wrong
  - e.g. 120x120 originally but thumbnail is larger i.e. use `bounds`

- ❌ restart vite onchange map-edit plugin
  - but we do cache bust imports

## By 7th Feb 2016

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

- ✅ can remove grid item
- ✅ fix remove grid item bug
  - fix mobile via onPointerUp -> onPointerDown

- ✅ can reset layout from global
- ✅ force grid height full

- ✅ tty should use sessionKey not layoutId
  - ✅ ui context provides uiStore
  - ✅ every ui has respective meta `{ layoutId, uiKey }`
  - ✅ contextmenu can specify sessionKey
    - ✅ ui has optional uiInstantatiorRegistry
    - ✅ Jsh has entry in uiInstantatiorRegistry
    - ✅ contextmenu shows respective ui
    - ✅ bootstrap ui enforces non-existing sessionKey `tty-{n}`
  - ✅ unmount should remove uiConfig
  - ✅ persisted layout can contain partial ui instance meta

- ✅ avoid pinchzoom opening contextmenu

- ✅ popover confirm for ui close
- ✅ popover confirm for Global reset

- ✅ uis have schema validated in `<UiInstance>` inducing type of `props.meta`

- ✅ UiGrid supports tabs
  - motivation: hide Global on mobile; grouping; improve mobile layouts
  - ✅ basic instantiable ui/tabs with layout in schema
  - ✅ show contextmenu on click add tab
    - ❌ tried via external `Menu.trigger` but it broke main `ContextMenu.trigger`
  - ✅ can specify other uis in tab slots
  - ✅ clicking add tab adds ui to new tab
    - ✅ alerts mock
    - ✅ render ui's meta inside tab
  - ✅ ui.layoutId -> ui.id
  - ✅ by default uis have lowercased title `${uiKey}-${firstNaturalNumber}`
    - could change per ui but e.g. tty sessionKey already matches
  - ✅ tab has "break-out" button
    - in future replace with "drag outside"
    - ✅ can break out
    - ✅ issue maybe with stale layoutApi e.g. lack tabs ui?
      - works after hard-refresh
      - happens from empty tabs if add two Jsh tabs
      - seems fixed after  `id := meta.id` and use as dep
  - ✅ try use react-reverse-portal in each grid item
    - reparenting
    - ✅ defineUi ui takes optional portalNode and renders into it
    - all uis (ones in tabs too) have a portal in ui.store
    - ✅ UiInstance provides portalNode and renders out portal
  - ✅ break out tab should preserve portal
    - might need store after all
    - ✅ UiInstance stores in ui.store on mount, but does not remove on unmount
    - ✅ Delete tab removes portal
    - ✅ Delete UI removes portal
    - ✅ Delete tabs removes all sub-portals
    - ✅ re implement break out tabs
  - ✅ ui break out is still broken for Jsh and World
    - still fixed by refreshing
    - probably related to stale layoutApi
  - ✅ delete tab should delete portal too
  - wrap uiStore.setState inside uiStoreApi 

- ✅ redo portals
  - ✅ remove portal code
  - ✅ `uiStore.byId` with values `{portal,meta}`
  - ✅ move UiGrid's `toUi` to uiStore `toInitMeta`
    - initially provided meta pre-zod-parse
    - try use to initiate portals
  - ✅ mount uis in external portal container
    - ✅ listen to toInitMeta
    - ✅ ensure byId rather than in defineUi
    - ✅ fix initial rect
  - ✅ remove toInitMeta using byId only
    - initial meta should be parsed
    - unify `byId` and `toInitMeta`
  - ✅ On add item should parse meta and provide parsed or original to store.
  - ✅ uiStoreApi.addUis
  - ❌ UI has no props except id.
    - avoids need to refine UI props type.
    - ❌ too much bloat in each ui
  - ✅ UI in portal should parse meta too.
  - ✅ fix Tabs
    - need to create portal which is not auto-added to grid
    - ✅ `byId.meta.parentId` is undefined or tabsId
    - ✅ UiGrid does not render portals with parentId
  - ✅ fix overwrite uis on hmr
    - previously the last persisted uis were reverted to
    - currently continually tracking ui.store in layout.store uiLayout.toUi
    - alternatively could use a state variable in routes/index.tsx

- ✅ refactor layoutApi e.g. remove addItem

- ✅ merge layout.store into ui.store + persist (?)
  - ✅ ui.layout uses persist middleware
  - ✅ restore layout from ui.store
  - ✅ migrate rest of layout.store e.g. ready
  - ✅ remove layout.store

- ✅ packages/ui/world
  - ✅ create dummy package
  - ✅ add react-three-fiber
  - ✅ import and view gltf
    - debug via gltfjsx i.e. `pnpx gltfjsx TestBlockbench5.gltf`

- hmr issues
  - ✅ onchange ui.store sometimes lose layout
  - ✅ ui.store issue with context...
    - editing Tabs caused it to disappear
    - seems related to zustand ui.store hmr behaviour
      - even when only imported, not fed thru context
    - apparently fixed via preservation over hmr using `import.meta.hot.data.__ZUSTAND_STORE__`
  - ✅ can we avoid remount on edit ui.store?
    - preserve uiRegistry on hmr (similar to ui.store fix)

- ✅ move uiStoreApi.uiGrid to ref
- ❌ addUis supports opts.layoutItems
  - appendLayoutItems is now inside UiContext, not uiStoreApi
- ✅ uis have play/pause button tied to meta.disabled


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
