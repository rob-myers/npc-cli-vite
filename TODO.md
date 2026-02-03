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
  - ✅ Tty has /etc/{util.sh,util.js.sh}
  - 🚧 STOP bug: appears initially in e.g. 3rd tty
    - seen profile fail to load too
  - 🚧 improve `[undefined, undefined, undefined]` output of `call '() => document.documentElement.childNodes' | map Array.from | log`

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

- 🚧 UiGrid supports tabs
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
  - 🚧 try use react-reverse-portal in each grid item
    - reparenting
    - ✅ defineUi ui takes optional portalNode and renders into it
    - all uis (ones in tabs too) have a portal in ui.store
    - ✅ UiInstance provides portalNode and renders out portal
    - 🚧 break out tab should preserve portal
      - might need store after all
      - ✅ UiInstance stores in ui.store on mount, but does not remove on unmount
      - ✅ Delete tab removes portal
      - ✅ Delete UI removes portal
      - ✅ Delete tabs removes all sub-portals
    - 🚧 ui break out is still broken for Jsh and World
      - still fixed by refreshing
      - probably related to stale layoutApi
  - try make basic tabs components with draggable tabs
    - https://atlassian.design/components/pragmatic-drag-and-drop/about
  - can drag between different tabs components

- 🚧 redo portals
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
  - UI has no props except id.
    - avoids need to refine UI props type.
  - UI in portal should parse meta too.
  - fix Tabs
    - need to create portal which is not auto-added to grid
    - `byId.parentId` is null or tabs id


- 🚧 packages/ui/world
  - ✅ create dummy package
  - ✅ add react-three-fiber
  - 🚧 import and view gltf

- hmr issues
  - onchange ui.store sometimes lose layout