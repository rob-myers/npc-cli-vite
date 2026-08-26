# TODO

- 🚧 new approach to todos i.e. current go into technical and start new section
  - 🚧 final few before switch to blog
  - current -> docs/todo_engine.md

- ✅ easier to run scripts
  - ℹ️ e.g. spawn, focus, pick-to-move
  - ℹ️ will need to connect to a tty
  - ✅ create `packages/ui/jobs` via `pnpm gen-ui`
  - ✅ hook up to ui.store
  - ✅ copy over `PsList` from npc-cli-next and get it working
  - ✅ ensure messages are being sent by session
    - i.e. get it working again
  - ✅ spawning background process should auto-update `Jobs`
    - `pick | move npc:rob &`
  - ✅ ensure message send on kill
    - `sleep 3 &`
  - ✅ implement `reboot`
    - process.reboot not defined until after start so always show reset buttons
  - ✅ remove `reboot`
    - too complex yet not complex enough to handle future desires which should sit in JS world
  - ✅ avoid recompute `state.ordered`
  - ✅ clean component
  - ✅ extend component
    - ✅ tidy dead processes
    - ✅ historical record of source code

- ✅ Jobs: initial stability
  - ✅ indicate when tty-{i} is not mounted
  - ✅ can copy old scripts
  - ✅ BUG can kill `pick | move npc:abe along &` immediately in Jobs
    - ✅ try-catch every cleanup with logging
    - ✅ try-catch every pause with logging
    - ✅ try-catch every resume with logging
    - ✅ fix `move` cleanup/pause/resume
  - ✅ split `move` into `move_const`, `move_next`, `move_lazy`
    - ✅ `move` uses `moveHandlingFactory`
    - ✅ `moveHandlingFactory` preserves clones of "targets"
    - ✅ `move_const`
    - ✅ `move_next`
    - ✅ `move_lazy`
  - ✅ un/pausing tty should be reflected in processes
    - added button in header too
  - ✅ Jobs can send reset signal
  - ✅ improve `move` reset
  - ✅ clean event handling
    - ❌ reset handled at-process-level although can supply callback
      - e.g. `() => api.flush()` for `move_lazy`
    - ✅ reset by kill then re-reun
    - ✅ pause handled per move/look via `catch(handlePauseError)`
    - ✅ fade is not interrupted but pauses after resolve
      - fade can be rejected on respawn or remove npc
      - but in other cases we should wait for fade to complete
  
- ✅ Jobs has library of commands
  - provided via markdown
  - runnable
  - editable


- ✅ can pause/resume `move`
  - rewrite so that immediate pause/resume are possible
  - all variants use `pendings` which we can insert into

- ✅ remove `packages/ui/demo`

- ✅ refine unreachable nav via locked door
  - ✅ do not go right up to locked door
  - ✅ more robust: fallback to centroid
  - ✅ avoid jerky animation when immediately fail
  - ✅ also for very close target

- ✅ refactor WorldMenu lights submenu:
  - Rooms + 3 icons should be moved up-one-level, relabelling "Rooms" -> "Room lights"
  - Remove "Ambient" slider (already have at top-level)
  - Npc select + npc radius/lit go up-one-level, organized into "player" subsection
    - onchange select change the `w.player.key` to that npcKey and ensure dynamicLight target updated

- ✅ replace `meta` by `at` i.e. decor query against single point
  - `at $( pick 1 as:point )`
  - `at $( pick 1 as:point ) | map meta.y`

- ✅ doors can use any decor icon
  - technically restricted to list `doorIconKeys`

- ❌ cleanup door icons i.e. add decor, refine list, specify in maps
  - ❌ https://game-icons.net/1x1/delapouite/towel.html
  - ❌ try https://thenounproject.com/search/icons/?q=Psychology
  - ❌ door status
    - auto (auto open/closes for npcs)
    - manual (only auto opens when accessible by npc)
    - unlocked
      - public
      - free (unallocated)
      - emergency access
    - locked
      - private 
      - joined (locked open)
      - quarantine (lock down)
  - refine random list

- ✅ door meta.manual
  - ✅ forces door.auto false
  - ✅ does not open unless npc about to walk through it
  - ✅ does not auto-close
  - ✅ can be closed via `close g0d20`

- ✅ auto doors close when all nearby npcs are not moving
- ✅ manual door closes when no nearby npcs, unless locked
  - also closes when unlocked and closable
- ✅ manual door can be closed when all nearby npcs are idle
- ✅ manual door can be locked open
- ✅ locked door auto closes when no npc inside

- ✅ npc should not intersect locked door
  - use queryFilter
  - extend door areas in web worker

- ✅ BUG doors hmr
- should preserve locked doors on hmr
  - probably extend useWorldEvents

- ✅ remove door icons

- ✅ doors have `proximity` boolean
  - auto doors default true i.e. don't close until no npcs nearby
  - manual doors default false i.e. can close when npc nearby
  - can specify via `meta.proximity`
  - hull doors default true even when if not auto
- ✅ hull doors should not auto-open unless specify meta.auto

- ✅ BUG tty-0 run `pick` interactively then try to run job
  - launching `pick | move npc:rob` in background didn't resolve until interactive `pick` killed

- ✅ BUG reachable prefix not working
  - repro 301 g0r15
    - door locked
    - npc moves towards dst rather than doorway
  - related to locked door and window?

- ✅ on remove tty, Jobs should disconnect

- ✅ improve hidden pane ui
  - ✅ restore button more prominent
  - ❌ seeing stale entries in ui.store on mount
    - OK because they have `everSeen` false
  - ✅ uis should not mount when in hidden pane
    - repro: saw tabs-0 and children world-0, tty-0
  - ✅ pane size wrong on expand

- ❌ mobile extra zoom indicator only when extra-zoomed enough

- ✅ BUG rm: foo: only /home/* writable

- 🚧 improve between map consistency
  - ✅ wrongly persisted locked doors on 301
  - 🚧 door should be initially open if npc in doorway

- ✅ remove background color related code including stripes

- 🚧 unclear how to light npcs "behind the scenes"
  - ✅ can explicitly light npc via debug option + long-press
  - 🚧 try extend postFx circular cut out with "used rooms"


## Other

- on hmr recreate tty session `move` stops working?
- lock too small to pick?
- ❌ idle-left with left-leg forward
- ❌ idle-right with right-leg forward
- ❌ `npc.setMoveType` walk, run, shuffle
- fetch gltf json so can cache-bust
- labels as decor point
  - add some labels to 301
  - Decor renders them
- hot reloading of `pick | move npc:rob` while change `move`?
  - maybe just clarify current setup vs previous "hot reloading"
- onchange map sealed doors are staying sealed
- skin remapping
  - currently only have skinIndex
- try fix mobile persist issues via `visibilitychanged`
  - we'll wrap useBeforeunload and ensure callback only called once
- fix precision in `assets.json`
- start generating documentation in README.md
- improve hull symbol thumbnail e.g. add room outlines
- improve map thumbnail (🔔 currently blank)
- ℹ️ minecraft skin templates
  - https://minecraft.fandom.com/wiki/Skin#Templates
- MapEdit: on start drag should not select text
- MapEdit: pointer out not disposed somewhere
  - needs repro


## Bugs

- 🚧 BUG parsing?
  - mvdan-sh parse works
  - convertMvdanShToJsh.File works `withParents(convertMvdanShToJsh.File(parsed.file))`
  - 🚧 npm braces is crashing
```sh
expr {refinedOutline:[{x:11.12,y:2.91},{x:11.55,y:2.58},{x:11.99,y:2.31},{x:12.46,y:2.06},{x:12.95,y:1.86},{x:13.45,y:1.7},{x:13.97,y:1.59},{x:14.49,y:1.52},{x:15.01,y:1.5},{x:15.55,y:1.52},{x:15.55,y:1.52},{x:15.55,y:1.52},{x:16.07,y:1.59},{x:16.58,y:1.7},{x:17.09,y:1.86},{x:17.57,y:2.06},{x:18.04,y:2.31},{x:18.48,y:2.59},{x:18.9,y:2.92},{x:19.06,y:3.06},{x:17.68,y:3.06},{x:17.38,y:2.9},{x:17.12,y:2.9},{x:16.84,y:3.06},{x:16.15,y:3.06},{x:15.9,y:2.9},{x:15.63,y:2.9},{x:15.35,y:3.06},{x:14.66,y:3.06},{x:14.38,y:2.9},{x:14.16,y:2.9},{x:13.85,y:3.06},{x:13.16,y:3.06},{x:12.88,y:2.89},{x:12.66,y:2.89},{x:12.36,y:3.06},{x:10.95,y:3.06},{x:10.99,y:3.02}]}
```

- BUG change map to 301-101-301 and dynamicLight fails to propagate through some doors
  - fixed by saving texture.ts (hmr)
- BUG Jobs: sometimes interactive process 0 shows green although killed
  - need repro
- could cover up curved room raymarching woes
  - maybe `Walls` can vary opacity
  - provide additional Walls in MapEdit
- BUG npc position after change map
- BUG door open wrong way around during raycast of dynamicLight
  - sporadic due to hmr?
- improve transition dark-theme -> light-theme
- fix npc final turn when ends near nav border
- can override edit g-301--playground.json in dev
  - currently can only save as draft
- obstacle resizing can be confusing
  - rotation is "determined" by the symbol's dimensions and the graphics appearance within it
  - we can forget to "update obstacles"
- BUG assets.json decor orient changing for no apparent reason?
  - mostly in 101 so maybe needs re-save?
  - possibly related: remove symbol, save, undo, save (delta exists), save (delta removed)
- BUG npc arms through locked door
- BUG on save shell.ts terminal profile does not run
- BUG npc animation out of sync after save npc.ts (?)
- BUG on collapse/expand should persist pane dimensions
- BUG need two ctrl-c for while loop walk?
- BUG saw auto door close with nearby npc
  - maybe door was closing and didn't open quickly enough
- BUG on lock door and save Decor we lose switch tint
  - maybe just stale while paused
- BUG after hmr and `spawn` sometimes mesh not shown, yet can refetch query "template-gltf"
- BUG MapEdit asking to save draft changes onchange when there are no changes
- BUG MapEdit drafts fighting: with 2 instances open for same file
- BUG `drawGm` (Floor): "SWEEP" probably poly union issue

## Long running

- 🚧 extend existing symbols with missing obstacles
- ❌ move path parsing code out of vite plugin file, to support hmr
- ❌ warn if symbols "above" walls in symbol
