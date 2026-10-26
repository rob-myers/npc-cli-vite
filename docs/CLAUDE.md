# npc-cli-vite — Claude notes

## Working rules

- **Never stage** (`git add`). Leave the index alone, even after editing a file that was already staged. Staging and committing are the user's.
- **Make every edit whole.** The dev page hot-reloads every save, so a name used before it is imported or declared breaks the render at once.
  - Write a new file FIRST, then add its import and its use (e.g. a JSX mount) to the importer in ONE write.
  - Then run `npx biome lint --only=correctness/noUndeclaredVariables <files>` on what was touched. It takes milliseconds; `pnpm typecheck` takes minutes.
- **Comments are TERSE and sparing.**
  - One short line, never a paragraph, and only what the code doesn't already say. Prefer none to a restatement.
  - Attach one to the syntax it explains: a JSDoc on the `const` (or field, or function) beats a trailing or free-floating `//`.
  - A JSDoc is two lines at most. Give the "why" in a clause. Never recap a mechanism the reader can see.
- **Comments are CLEAR.**
  - A plain statement, subject first, one idea to a sentence. Say what the thing is or returns before why.
  - No stream of consciousness: no clauses strung together on commas, dashes and colons, no "X, so Y — unless Z: W".
  - A second idea is a second short sentence, or left out.
- **Clipboard markdown is plain ASCII** (e.g. a PR body via `pbcopy`). No typographic dashes, arrows, `±`, `°`, `§`, no emoji such as 🤖. Check with `grep -P '[^\x00-\x7F]'` first.

## Project structure

Pnpm monorepo. Key packages:

| Package | What |
| --- | --- |
| `packages/app` | Vite app entry, public assets (sheets, symbols, maps, decor, skins) |
| `packages/ui/world` | main 3D world: React Three Fiber components, camera, NPCs, lighting |
| `packages/cli` | terminal/shell (tty, jsh commands) |
| `packages/media` | static asset keys, symbol metadata, source images e.g. starship geomorphs |
| `packages/util` | shared geometry (`Mat`, `Vect`, `Rect`), services, TSL helpers |
| `scripts/src` | Vite plugins, map-edit API, asset processing (skia-canvas thumbnails) |

## Conventions

**Code**
- TSX/TS for almost everything. `camera-controls.js` and `CameraControls.jsx` are plain JS by design.
- A selector is a base-ui `Select`, never a native `<select>`. Its trigger is only as wide as what is chosen. Use `Picker`, from `@npc-cli/util/picker`.
- A modal opened from a ui panel stays inside that panel, never over the whole page. Portal it into the panel's root (base-ui `Dialog.Portal container`) and position it `absolute`, not `fixed`.
- `useStateRef` (from `@npc-cli/util`) makes a stable ref-backed state object. Treat it like a class instance, not React state. Its methods go in alphabetical order.
- A frame loop (`useFrame`, `w.e.addFrameCallback`) never drives a React render: no `state.update()` from one, even on a change. Write to the DOM instead, e.g. `el.style`, as `NpcFocus` places and fades its marks.
- Geometry in 2D uses `x/y` on the xz world plane: `y` in 2D is `z` in 3D. `parseGroundPoint` / `groudPointToTuple` (note the typo) convert.

**World**
- `w.n` is `null` until `<NPCs>` mounts, after every other `<World>` child. Anything run from their own mount (e.g. `w.e.setPsi`) must guard it.
- To find npcs near one, go through those in their room or the rooms they can reach (`w.e.getNpcsInReach(npcKey)`, over `w.npc.roomToNpcs`). Don't scan every npc in `w.n` without good reason. That way a wall is never between the two.
- `const.env.ts` and `const.npc.ts` hold constants only, no methods.
  - The npc tuning is split off so editing it doesn't rebuild the World. `World.tsx` refetches on its own HMR, and so does every importer of `const.env`, its hooks included.
  - So only npc modules import `const.npc`, including those drawing npcs or what surrounds them, e.g. `NpcRings`, `NpcBreath`. Never `World`, `WorldView` or their hooks.
  - What the World builds around an npc, `npcDims`, is in `const.env`.

**Decor**
- Never scale a decor quad non-uniformly. To reshape one, e.g. a shallower shelf, change its svg in `media/src/decor` (`width`/`height` and `viewBox`) and re-run `gen-decor-sheets`.
- To darken or recolour ONE placed decor, tint it: `tint=#777` in its symbol name (`meta.tint`, multiplied in). Redrawing its svg changes every use.

## Topic docs

Each doc below is the ONLY doc for its topic: update it rather than starting another.

| Topic | Doc | In short |
| --- | --- | --- |
| Floor | `docs/floor.md` | The look comes from one mutable object, `deckConfig` in `service/texture.ts`. Mutate it and call `w.floor.drawAll()`. |
| Walls | `docs/walls.md` | `Walls` draws walls and the lintels over doors (two per door, `lintelSegs`, apart from `wallSegs`). Heights are `wallHeight`, `doorHeight`, `lintelHeight` in `const.env`. A wall's own `meta.y` / `meta.h` is drawn, but sight, the player light and spots still take it as full height. Each wall is darker at its foot and top, in its own colour, so walls blend in any order. |
| Crisp fills | `docs/crisp-fills.md` | A canvas read back as ids (the room-hit canvas, room slots) is filled with `drawPolygonsCrisp`, never `drawPolygons`, whose soft edges blend two ids into a third. |
| Obstacle spritesheets | `docs/starship-sheets.md` | `gen-starship-sheets` packs one rect per obstacle polygon of each symbol, keyed `getObstacleSheetKey(symbolKey, obstacleId)` in `sheets.json`. `<Obstacles>` `addUvs` reads it directly. Keyed by index, so re-run it after any MapEdit obstacle change. |
| Npc skins | `docs/skins.md` | `gen-skin-sheets` lays out a 256px cell per skin in `sheets.json`. A DEV World draws `sheet/skin.N.png` from the skins' svgs (else pngs) and saves it, so a build fetches neither. Load a DEV World before committing. Also how to make a skin: classic arms, opaque overlays, the face layout. |
| Slices and eyes | `docs/skin-slices.md` | A slice is a face-sized piece of texture drawn over a skin's face. Each holds that skin's eyes one way: `shut`, `up`, `scared`... An npc's eyes are one uniform, the slice shown (`pose rob eyes:shut`, `blink:2`). None is drawn by hand: the dev server finds each skin's eyes in its png (`meta.eyes`), and a DEV World draws the slices and saves `sheet/skin-slices.N.png`. |
| Strafing | `docs/npc-strafe.md` | Whilst `npc.anim.strafe` (by default whilst `face.aim`) they keep their facing. `syncStrafe` blends four directional gaits by heading, paced to the ground each covers. |
| Stance | `docs/npc-stance.md` | After any gait an npc's feet stay roughly where they stopped. `npc-stance.ts` holds each ankle on the ground and solves the legs to reach, sinking and shifting the hips. `stanceConfig.on` in `const.npc` switches it off. Remount the World after editing it. |
| Breath | `docs/npc-breath.md` | An npc asked to (`anim.setBreathing`) shows lungs and a diaphragm through their body, moved and lit by the air in their lungs. Their bones are not touched. The player's is tuned in their bubble. |
| navcat patch | `docs/navcat-patch.md` | `navcat` is pnpm-patched: four corners per agent, a `boundaryQueryRange` agent param, corners that stay given up, a desired velocity that folds round a touched npc, and an END kept on a path ending on a mesh vertex. The doc says how to edit the patch. |
| Workers | `docs/workers.md` | See [Navigation](#navigation-and-crowd). |
| Time | `docs/time.md` | Two clocks. `w.gameTime` is scaled (`0`-`2`, the menu's slider, jsh `timescale`) and held by a pause: behaviours, animations, timers and detection run on it. `w.realTime` never is: the camera and UI marks. Wait in game time with `w.e.after`, `w.e.wait` or jsh `wSleep`, never `setTimeout`. |
| Tasks | `docs/tasks.md` | World code a jsh command awaits, which a kill must end, runs as a `Task` (`@npc-cli/util`). |
| jsh pausing | `docs/jsh-pause.md` | World commands (and their descendants) pause with the World via a pause group made in `awaitWorld`. One that must keep going calls `api.setPausable("world", false)` first, like `pick`. |
| Decorator panel | `docs/decorator.md` | `packages/ui/decorator` places runtime decor on a 2D top-down map of a live World (`meta.worldKey`, read from the query cache). The map is SVG in world metres, drawn from each geomorph's layout plus `w.nav.toNavTris` and the live doors. Npcs are shown only when chosen. Decor is configured in the World itself: **decorations** in the debug **overlay** select labels it and opens a card per pick. |
| Inventory | `docs/inventory.md` | `WorldHud` is the player's bar: psi, phaser, keys, then carried items (`q` psi, `e` phaser). It reads `w.e.carried`, the defs of decor taken, by npcKey, per World. An item is a runtime decor with `meta.item`. jsh `give` / `drop`, and `inventory` for what a press does. |
| Engagements | `docs/engagements.md` | One npc shooting another. A shot's outcome (hit, missed, dodged, shielded) is decided as it locks on: jsh `shots` sets the odds, the bar's debug badge forces one. A dodge picks a clip that clears its part's line from the shooter's bearing (`hitConfig.dodgeClips`), else it misses; in bed it is a hit. Also what a hit does, shield pieces, and npc focus, the player's choice of part. |
| Psi | `docs/psi.md` | Psi is raised or not, per npc (`w.e.setPsi`, `w.e.isPsiRaised`). Raised, their left hand is at their temple, and a press on another npc focuses on them, offering "Become". A thought (`w.speech.readThought`, jsh `demo_thoughts`) shows over their head (`w.bubble.think`) and in the speech history (`w.speech.think`), marked with its khandha. |
| Camera | `docs/camera.md` | A custom `MapControls` (`service/camera-controls.ts`). A left drag pans and a right drag turns, swapped by Shift, ctrl or cmd. Zoom eases between two stops. `embodied` mode sets what may be steered by zoom, and `w` heads up the screen, snapped near an axis. Following, the view frames the player and their frontier, read off the light sweep. |
| Spirit | `docs/spirit.md` | "Become" in npc focus (psi raised), or jsh `spirit`, leaves the player's body (`w.spirit.start`). The light draws in, a spark crosses to someone sitting or lying (else spawned in a bed or seat), and they wake as the player on a deep first breath. |
| Shields | `docs/shields.md` | A decor rect with `meta.shield` stands as a see-through panel (`w.shields`) that stops phaser fire, found on the phaser's own raycast in the nav worker. One with a frequency (`meta.freq`, jsh `shield`) lets through a phaser granted it (jsh `phaser`), and deactivates any other carried through it. `freq: null` stops all fire and deactivates none. |
| MapEdit saving | `docs/map-edit.md` | Playground files (key ending `--playground` / `-playground`) save to a localStorage draft, and are the only thing editable in production. Everything else saves to the filesystem in DEV via `POST /api/map-edit/file/:type/:filename`. `g-301--playground`'s hull and doors were drawn by hand, and its node NAMES are its tags. |
| Symbol generation | `docs/symbol-generation.md` | A symbol's JSON can be written from its png, saved through `POST /api/map-edit/file/symbol/{key}.json`, then checked by its thumbnail. An obstacle polygon takes in its drawn border, with no more points than its curves need. Also covers placing symbols in a hull symbol, the walls and doors it needs of its own, and how `assets.json` breaks. |
| Memory | `docs/memory.md` | A `TexArray` can hold its pixels three times over (GPU, CPU mirror, 2D canvas), so memory is mostly how many layers each has. The floor and ceiling are a layer per geomorph KEY. A `gpu` array has no mirror. |
| Deploys and stale tabs | `docs/deploys.md` | A tab can outlive its deploy. Production keeps superseded hashed assets for 30 deploys (`assetHistoryPlugin`, whose `/asset-history.json` also logs each deploy's ui chunk paths and sizes), and `NewVersionToast` offers a reload. Ui chunk names stay put unless their code changed. Keep them so: nothing a ui imports may value-import `@npc-cli/ui-registry` or another ui package's root (use a subpath, e.g. `/schemas`). `stableEntryPlugin` keeps chunks from importing the entry. |
| Spots | `docs/spots.md` | Places an npc might stand, per geomorph key (`public/spot/{gmKey}.json`, committed): along walls, at corners, by doors, doables and low cover. Each has its depth at 16 angles, the spots it sees, and what is near. `gen-spots` makes them in Node from a navcat navmesh, run by the dev server whenever `assets.json` changes. The Decorator's **spots** layer shows them, and a press on one shows what it sees. |
| Scenarios | `docs/scenarios.md` | The Scenario panel, `packages/ui/scenario`, lists three sections. **Scenarios**: npcs interacting, directed by queries over spots and live npc state (hide and seek, guard and intruder, meeting in secret, breach and clear), as yet stubs. **Characters**: name, npc, skin, rooms and door keys, one JSON each in `packages/media/src/scenario/character/{slug}.json`; DEV saves through `/api/scenario` (`vite-plugin-scenario`), a build bundles them as `virtual:scenario`. Their schema and the store shared with the Decorator are in `ui/world` (`scenario.schema.ts`, `scenario-shared.ts`). jsh `act {count,face,hide,avoid,park,pad,nudge} <npc> …` plays their pieces by hand, and `sees rob abe` / `sees --all …` ask who sees whom. **Conversations**: trees (`ui/world/src/service/talk.ts`), played in `WorldSpeech`'s history by thread. |
| Perception | `docs/perception.md` | Spot and sight queries (`spotQuery`) are answered on the nav worker, beside the plan ops. `worker.main.ts` sets it up per map with what blocks sight, and tells it of doors as they change. `worker/handle-perception.ts` and `worker/spots.ts` answer: from the static lists where they settle it (rooms in view, never, always), casting lines only for the rest. The **spots** debug overlay shows them in the World, coloured by sight (jsh `spots --show`). `sees --debug a b` says and draws why. |
| MCP server | `docs/mcp.md` | See [MCP server](#mcp-server). |
| Preview checks | `docs/preview-checks.md` | Checking a change in the browser, and the log of checks run. A production preview in a visible Chrome, never headless, driven by typing into the app's own jsh terminal one step at a time, pausing for "next". Players are moved, not spawned. |

## Renderer

Three.js WebGPU renderer (`three/webgpu`) with TSL node materials throughout. Use TSL imports (`three/tsl`) for shader nodes, not GLSL strings.

## Player light (visibility sweep)

`service/player-light.ts` answers "can the player see this?" once per frame instead of per fragment.

- **A compute pass** (`Fn(...)().compute(lightAngles)`) sweeps `lightAngles` directions from the player. It writes the distance to the nearest occluder into a polar table, an `attributeArray` storage buffer.
- `<PlayerLight>` in `WorldView` dispatches it from a `useFrame(..., -2)`, so it lands before the render.
- **Materials read one entry** of that table:
  ```
  v = positionWorld.xz - lightXZ;  lit = |v| <= table[angleOf(v)]
  ```
- Two neighbouring angles are sampled and their *lit/unlit results* blended. Blending the distances instead would put a shadow edge where neither surface is.

**Occluders**
- Every wall segment: `gmsData.byKey[gmKey].wallSegs`, transformed to world on map change by `syncWalls`.
- The **closed** part of each door. It is derived in-shader from the door's `src`/`dst`, `gapAtHighLambda` and live `openRatio`, mirroring `Doors`' own `inGap` test.
- Windows are excluded on purpose: light passes through glass.
- Except HULL windows (`meta.hull`). Their centre line `seg` joins the walls, so nothing beyond the hull is lit. A CURVED one (`meta.curved`) has an AABB `seg` cutting across its bay, so `curvedMidline` follows its arc instead.

**The table is created once** and never rebuilt, so materials reading it survive a map change. Only the occluder buffers are refilled, and nothing but the sweep reads those.

**Opting a material in** is one line: `m.colorNode = w.view.playerLight.applyLight(node)`, or `applyLightRgba` where the colour carries alpha.
- Unlit fragments are tinted towards black.
- A `strength` of `0` is exactly identity, so wrapping is unconditional. It is `0` with no player, or on a WebGL fallback backend, which has no real compute.

**A surface turned away takes less.**
- `applyLight` accepts a unit outward XZ normal, cut at edge-on. Obstacle skirts pass one per instance.
- A FIGURE asks `litBody(normalWorld)` for the AMOUNT instead, `0`–`1`. It wraps round them half-Lambert, off a lamp hung in front of the player. Whoever stands on the light has no bearing from it, and the player always does.
- The lamp hangs off the player's own height (`originY`), so it stays above one lain on a top bunk.
- Npcs add up their own exposure: `ambient` + that + `litAmbient` whilst lit, all in `const.npc`. A tint would be capped at a 0.4 swing by `unlitTint`.

## Player input

- **Walking.** `w`, `a`, `s` and `d` head as seen, snapped onto a world axis near it: see `embodied` mode in `docs/camera.md`.
- **Crouching.** `c` crouches the player behind cover (`anim.setCrouch`): a double tap, a full crouch; a tap is contextual, half or back up. Touch has no way yet.
  - Crouched they move slowly in that crouch's gaits, strafing too, and never run.
- **Gait.** `x` held runs, once the key repeats, and a tap ends the run (`w.player.setGait`, `getGait`). A toast names each.
  - The gait button on `WorldHud`, beside follow, toggles walk and run (`toggleRun`). A ↔ badge shows whilst strafing.
- **Strafing.** A double tap of Shift toggles it (`toggleStrafe`), whatever else is held, but not whilst aiming. Whilst on they keep their facing, so WASD strafes (`w.player.strafe`, `keepAim` in `aimAtPointer`). Standing only, never over another's aim. A raised phaser strafes them whatever is held. See `docs/npc-strafe.md`.
- **Running.** An npc runs whilst `anim.hurry`. Strafing, they walk, and run again once it stops.
  - A move's `fast` sets it either way (`--fast`, `fast:false`). A plain move leaves it be.
  - A double tap of `w`, `a`, `s` or `d` runs too (`w.player.setTapRun`), until those keys are let go or cancel out (`syncRun`).
- **Closing the page.** Ctrl or cmd with `w` closes it. So a close within `closeConfirmMs` of a key pressed over the World has the browser ask first (`beforeunload`, in `setupDom`). A reload doesn't ask.
- **Turning the player.**
  - On touch, a two-finger tap (`w.player.onTouch`). `w.player.lookTowards` takes the floor point under the fingers' midpoint as `lookAt`.
  - `aimAtPointer` faces them to it for `lookHoldMs`, just as `r` does the pointer. `LookMark` marks it with a cross.
  - On a desktop, a right click that picks something does the same (`picked`, in `use-world-events`). The exception is a pick of the player themself, which is what a trackpad's two-finger tap is, besides `r`.

## Navigation and crowd

- The navmesh uses `navcat` (a recast/detour JS port). Agents live in a `crowd`. `navcat` is patched: see `docs/navcat-patch.md`.
- **To teleport an agent**, set `agent.position` **before** calling `requestMoveTarget`. Otherwise path-finding starts from the old poly, and the agent walks through walls instead of snapping to the destination.
- **An npc's poly** is `agent.corridor.path[0]`, which the crowd keeps under their feet. Read `npc.nodeRef` rather than `getClosestPoly(npc.position)`.
- The first corner's `nodeRef` is the poly *after* it, not the current one.

**Workers** (see `docs/workers.md`):
- Under `packages/ui/world/src/worker/`: `physics.worker.ts` (rapier, `w.physics`) and `nav.worker.ts` (navmesh generation, room graph, raycasts on a `SegGrid`, `w.navWorker`). See `docs/workers.md`.
- The nav worker runs as two copies: `bulk` (navmesh, `park`, `pad`, `hide`...) and `fast` (rays, `sees`, quick queries). Post with `w.navWorker.post(msg, role?)`, never to a `Worker` directly.
- jsh's `jsh.worker.ts` in `packages/cli` wraps the nav one with jsh's plan ops (`park`, `pad`…), sent from `plan.main.ts`.
- The same worker holds spots and sight, asked from `perception.main.ts`: see `docs/perception.md`. Every jsh request goes through `worker.main.ts`.

## Which room an npc is in

`w.npc.npcToRoom`, changed by `enter-room` (`use-world-events`).

- A walker's room changes as they cross a door's centre LINE, not as their body leaves its "inside" sensor.
- `trackDoorway` notes the door on the sensor's `enter-collider`: its line, and the room to each side. A hull door's far room is the next geomorph's.
- `syncDoorways`, each tick, reads off the side they stand on (`w.e.insideDoorways`).
- The sensor's exit still fires its own `enter-room`, usually `reEntered`.
- A spawn sets the room itself.

## Spawning, parking and padding

- `state.placeNpcAt(npc, at, type)` places or teleports an npc. The `"navigable"` type throws if the position is off the navmesh. `"doable"` silently removes the agent instead.
- **Parked npcs are jsh state**, not the World's: `parked` in `/shared/map/{mapKey}/pred`, owned by `packages/cli/src/jsh/world/pred.ts` and persisted with the rest of `/shared`. It holds the wall segment each stands against.
  - `act park` records via `parked.mark`. A move, respawn or removal unparks.
- `padded` beside it is the same for `act pad`: a Set of those stood with room to walk right round them.
- An npc is parked or padded, never both.

## jsh commands

**Modules**
- Exports of `packages/cli/src/jsh/world/{act,core,demo,demo_mcp,debug,decor,pred,shots,sidestep,spot}.ts` become shell commands, and hot-reload. `modules.js` lists them.
- The default profile sources them all through `/etc/jsh-default.sh` (`world/jsh-default.sh`). A new module goes in both.
- Shell files reach `/etc` as exports of `scripts.js`, named `fooBarSh` for `/etc/foo-bar.sh`: `sources.ts` drops the `Sh` and kebab-cases the rest.
- An exported *function* becomes a command. Export an object to keep helpers out of the shell (see `parked` in `pred.ts`).
- The `*_mcp.ts` ones are Claude's, written through the [MCP server](#mcp-server).
- A later-sourced module may shadow an earlier one's command, never a builtin. Builtins win.

**Only `packages/cli/src/jsh/world` knows of the World.** The shell (`packages/cli/src/shell`: builtins, `api`, sessions) and `packages/cli/src/jsh`'s own modules, e.g. `util.js`, must not import or mention it.

**`api` methods are bound to `{ meta, node }` alone** (`provideProcessCtxt` in `shell/command.ts`).
- So inside `processApi`, `this` is not the api. `this.setPtags(…)` from another method is undefined at runtime, though it typechecks.
- Share logic via a `CmdService` method taking `meta`, e.g. `cmdService.setPtags(this.meta, …)`.

**Never spread a command's context** (`ct`, `JshCli.RunArg`).
- It is a Proxy (`provideProcessCtxt`): `api`, `args` and `w` exist only through its `get` trap.
- So `{ ...ct }` keeps only `etc`, `home`, `lib` and `shared`, and `api` is then `undefined`.
- Pass what is needed by name, e.g. `plan({ api: ct.api, w: ct.w, op })`.

**A long-running command must support kill**, or ctrl-c does nothing and only a page reload ends it.
- Register `const handlers = api.handleStatus({ cleanup })`, and have `cleanup` end the loop: unsubscribe, or resolve a promise the loop is racing.
- Never `await` something a kill cannot interrupt. `w.npc.nextTick()` never resolves whilst the World is paused, so race it: `Promise.race([w.npc.nextTick(), killed])`.
- On the way out, `handlers.dispose()`, then `throw api.getKillError()`.
- World code it awaits, which a kill must end, runs as a `Task`: see `docs/tasks.md`.
- Examples: `events` in `core.ts` (async iterable) and `demo_corners` in `demo.ts` (frame callback).

**An error ends its process**, as bash's `set -e`, so the statements after it never run. `set +e` lets it run on, `$?` holding the code. Subprocesses inherit it (`process.errexit`).

**Watching every tick needs no process.** `w.e.addKeyedTick(key, tick)` runs after each npc tick, so only whilst unpaused. `w.e.keyedTick.delete(key)` stops it. See `sidestep.ts`.

**Pausing**: see `docs/jsh-pause.md`.

## MCP server

`scripts/src/mcp/server.ts` (in `.mcp.json`) drives the `pnpm dev` page over CDP, through `window.__devMcp` (`packages/app/src/dev-mcp-hooks.ts`). It covers jsh lines in `tty-1` and beyond, their output, pointer presses on the World, the console and screenshots. See `docs/mcp.md`.

- Prototype in a tty. Keep what is reusable as exports of `packages/cli/src/jsh/world/*_mcp.ts`.
- Whilst Claude drives it, the World's busy overlay says "mcp testing".
- Unpause the World before a test moves or turns anyone.
- A result ending `[user input since last call: …]` means the user took over: stop and ask.
- If state seems off mid-test, ask whether they interacted before calling it a bug.

**Before EVERY call, write its input as a code fence**: the `jsh` line as `sh`, the `query` function as `js`, else its arguments. That message is the fence ALONE, with no other text. The VS Code extension shows a call's result but not its input, and it drops a fence that follows prose.

## Gotchas

**TSL shaders**
- **`positionLocal` is the raw geometry attribute.** For `BoxGeometry(1,1,1)` it is `[-0.5, 0.5]`, even after `geo.translate(0.5, 0.5, 0.5)`. Don't use it with `step()` assuming `[0,1]`. Use `uv()` for per-face detection on a box.
- **Edge/seam detection on boxes**: `uv()` gives `[0,1]` per face reliably.
  - Pre-compute physically-sized UV fractions as `seamPhysical / faceDimension`.
  - Tile N sub-panels with `uvCoord.x.mul(cols).fract()`, then detect seams with `step(seamW, subU).add(step(subU, seamW).clamp(0,1))`.
- **`DerivedGmsData.findRoomIdContaining`** throws `"Value is not of type 'long'"` on NaN or Infinity, e.g. from a divide-by-zero in a normal. Prefer a polygon ray-cast on `gm.rooms` (`gm.rooms.some(r => pointInPoly(px, py, r.outline))`), or rely on `meta.hull` filtering.

**`wallSegs` and panel placement**
- `wallSegs` are in **local geomorph space**, like `gm.rooms` and `gm.bounds`. Apply the instance `transform` before any world-space comparison.
- A near-door endpoint check is too aggressive. Wall segments share endpoints with door segments, so `u.distanceTo(da) < threshold` excludes every wall next to a door. Use midpoint-to-segment distance instead: `distToSeg(mx, mz, da.x, da.y, db.x, db.y)`.
- Panel slot count: `Math.floor(availLen / slotWidth)` needs a trailing gap, so it gives 0 for a short segment that fits 1 panel. Use `availLen >= panelWidth ? Math.floor((availLen - panelWidth) / slotWidth) + 1 : 0`.
