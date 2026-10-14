# npc-cli-vite — Claude notes

## Project structure

Pnpm monorepo. Key packages:
- `packages/app` — Vite app entry, public assets (sheets, symbols, maps, decor, skins)
- `packages/ui/world` — main 3D world: React Three Fiber components, camera, NPCs, lighting
- `packages/cli` — terminal/shell (tty, jsh commands)
- `packages/media` — static asset keys, symbol metadata, source images e.g. starship geomorphs
- `packages/util` — shared geometry (`Mat`, `Vect`, `Rect`), services, TSL helpers
- `scripts/src` — Vite plugins, map-edit API, asset processing (skia-canvas thumbnails)

## Renderer

Three.js WebGPU renderer (`three/webgpu`) with TSL node materials throughout. Use TSL imports (`three/tsl`) for shader nodes — not GLSL strings.

## Player light (visibility sweep)

`service/player-light.ts` answers "can the player see this?" once per frame instead of per fragment.
A **compute pass** (`Fn(...)().compute(lightAngles)`, dispatched by `<PlayerLight>` in `WorldView`
from a `useFrame(..., -2)` so it lands before the render) sweeps `lightAngles` directions from the
player and writes the distance to the nearest occluder into a polar table — an `attributeArray`
storage buffer. Materials then read one entry of that table:

```
v = positionWorld.xz - lightXZ;  lit = |v| <= table[angleOf(v)]
```

- **Occluders**: every wall segment (`gmsData.byKey[gmKey].wallSegs`, transformed to world on map
  change by `syncWalls`) plus the **closed** part of each door, derived in-shader from its
  `src`/`dst`, `gapAtHighLambda` and live `openRatio` — mirroring `Doors`' own `inGap` test.
  Windows are excluded on purpose — light passes through glass — except HULL windows (`meta.hull`),
  whose centre line `seg` joins the walls: nothing beyond the hull should be lit. A CURVED one
  (`meta.curved`) has an AABB `seg` cutting across its bay, so `curvedMidline` follows its arc instead.
- **The table is created once** and never rebuilt, so materials reading it survive a map change.
  Only the occluder buffers are refilled, and nothing but the sweep reads those.
- **Opting a material in** is one line: `m.colorNode = w.view.playerLight.applyLight(node)` (or
  `applyLightRgba` where the colour carries alpha). Unlit fragments are tinted towards black; a
  `strength` of `0` — no player, or a WebGL fallback backend, which has no real compute — is exactly
  identity, so wrapping is unconditional.
- **A surface turned away takes less.** `applyLight` accepts a unit outward XZ normal, cut at
  edge-on (obstacle skirts pass one per instance). A FIGURE asks `litBody(normalWorld)` for the
  AMOUNT instead, `0`–`1`, wrapped round them half-Lambert off a lamp hung in front of the player
  — whoever stands on the light has no bearing from it, and the player always does. The lamp is
  hung off the player's own height (`originY`), so it stays above one lain on a top bunk. Npcs add up
  their own exposure from it (`ambient` + that + `litAmbient` whilst lit, all in `const.npc`)
  rather than taking a tint, which `unlitTint` would cap at a 0.4 swing.
- Two neighbouring angles are sampled and their *lit/unlit results* blended. Blending the distances
  instead would put a shadow edge where neither surface is.

## Floor

See `docs/floor.md` — the ONLY doc for floor drawing. In short: the look comes from one mutable
object, `deckConfig` in `service/texture.ts`; mutate it and call `w.floor.drawAll()`.

## Crisp fills

See `docs/crisp-fills.md` — the ONLY doc for it. In short: a canvas read back as ids (the room-hit canvas,
room slots) must be filled with `drawPolygonsCrisp`, never `drawPolygons`, whose soft edges blend two ids
into a third.

## Obstacle spritesheets

See `docs/starship-sheets.md` — the ONLY doc for them. In short: `gen-starship-sheets` packs one rect
per obstacle polygon of each symbol, keyed `getObstacleSheetKey(symbolKey, obstacleId)` in
`sheets.json`; `<Obstacles>` `addUvs` reads it directly. Keyed by index, so re-run it after any
MapEdit obstacle change.

## Npc skins

See `docs/skins.md` — the ONLY doc for them. In short: `gen-skin-sheets` lays out a 256px cell per
skin in `sheets.json`; a DEV World draws `sheet/skin.N.png` from the skins' svgs (else pngs) and saves
it, so a build fetches neither. Load a DEV World before committing.

## Camera controls

Custom `MapControls` subclass in `service/camera-controls.ts`. Props flow: `WorldView.tsx` `ctrlOpts` → `<CameraControls>` (JSX wrapper) → `<primitive>` on the controls instance. `CameraControls.jsx` exposes a JSDoc `@typedef Props`; `WorldView.tsx` types `ctrlOpts` as `MapControlsProps`. Note r3f skips `undefined` props, so a prop `ctrlOpts` omits keeps the class default — which is how `zoomToCursor` stays on.

`1`, `2` and `3` select the fade mode — `sight`, `sense`, `ship` (`fadeRoomsModeByKey`) — as the menu's button cycles them.

**Zoom has two stops**, `minDistance` and `maxDistance`; there is no continuous dolly. `zoomProgress` (0 at `maxDistance`, 1 at `minDistance`) is what gestures move — wheel by `deltaY`, pinch by the `ln` of its spread — and `getZoomRadius()` maps it to the radius. Once input pauses (`zoomSettleMs`), `syncZoom()` eases to whichever stop is nearer, so reversing partway cancels a zoom. It self-sustains via `dispatchEvent(changeEvent)` → `r3f.invalidate()`, which is what makes it work in a demand frameloop; the arriving frame dispatches nothing so the frames can stop.

The radius is **not** persistent state — `update()` re-derives it from `position - target` each frame, so zoom must be written inside `update()`. Anything that moves the camera itself (e.g. `WorldView.lookAt`) must call `setZoomFromRadius` afterwards, else the next settle undoes it.

**`embodied` restricts what may be steered, by zoom.** Its azimuth is free at every zoom and untouched by zooming, and the compass dial (`compassDial`: `c`, or its button on `WorldHud` beside look/follow, `setCompassDial`) only keeps it clear of the diagonals: a view let go more than `maxAzimuthSkew` (π/8) off square eases back to that (`keepNearSquare`), on switching on too. Whilst on, `w`, `a`, `s` and `d` head along the world's axes, `w` along the one nearest up the screen (`getWasdDirection`), so a turned view still lines up with doors and that axis never flips under a resting view. That axis is held whilst any of them is down (`wasdPoint`), so a turn mid-walk does not swerve them. The button names `w`'s compass point (`compassPoint`: N is -z) and its needle leans by `compassSkew`, to where `w` heads on screen. The older detent, a turn let go snapping to a compass point (`detentEmbodiedAzimuth`), is kept behind `compassSnap`, which nothing sets. Zoomed out (`t > embodiedAxisLockFrom`) a drag locks to one axis. The polar is never clamped by the zoom, and ONE tilt is tracked, `embodiedPolar`: a zoom neither flattens the view nor tips it back, so both angles survive it. A drag owns the polar at every zoom and `shapeEmbodiedPolar` takes whatever tilt it leaves. Entering the mode and a reset set it to the camera's own tilt. Zoom past the outer stop there is none — the radius is only ever a zoom stop.

**Zoomed out, the view frames the player and their frontier.** `service/player-frontier` reads a fan of the light sweep's polar table back off the GPU (`playerLight.readTable`, into one kept `ReadbackBuffer`, one read in flight at a time and at most one per `frontierReadMinMs`) and keeps the furthest as `reach`, with `ahead` giving the vector to the frontier point. `followPlayer` holds the target `frontierPanFrac` of the way along it at every zoom (`getFollowGoal`, which the aimed zoom-in heads for too). Not following, a short look press (`f`, or the button) calls `holdFrontier` — following, it stops the follow: a `lookAt` tracking the goal, then `frontierHold` keeps the follow running until the camera is next touched (the controls' `start` event, see `onCameraStart`). `follow` is on or off (`setFollow`) — a long press on the button, or holding `f`, toggles it. An npc runs whilst `anim.hurry`, which a move's `fast` sets either way (`--fast`, `fast:false`) and a plain move leaves be; Its button on `WorldHud`, beside look/follow, toggles the player's. With the dial off `w`, `a`, `s` and `d` head as seen. Ctrl or cmd with `w` closes the page, so a close within `closeConfirmMs` of a key pressed over the World has the browser ask first (`beforeunload`, in `setupDom`) — a reload aside. A double tap of `w`, `a`, `s` or `d` runs too (`w.player.setTapRun`), until those keys are let go or cancel out (`syncRun`). A `lookAt` in `embodied` carries the stops on its own alpha, so the zoom lands with the pan. A player respawn (`spawned`, e.g. `fadeSpawn`) or a switch of player (`set-player`) calls `onPlayerRespawn`: the frontier is read afresh, and a follow pans there, never quicker than `respawnPanMinMs`. `easeFrontier` in `onCameraFrame` eases `controls.maxDistance` to the nearest radius that fits the segment in the frustum with `frontierMargin` to spare, clamped between `frontierNearFrac` of the travel and the persisted stop, and `controls.minDistance` to the same fit clamped between `frontierNearest` and the persisted inner stop — both back to persisted when not following (a look press only pans) or there is nothing to read. `t` is measured off the live stop, so a drawn-in view is still fully zoomed out. On TOUCH the stops are never drawn in (`getFrontierStops`): a follow only pans, and a pinch zooms continuously between the persisted stops (`freeZoom`), resting wherever it is let go.

**On touch a two-finger tap turns the player** (`w.player.onTouch`). `w.player.lookTowards` takes the floor point under their midpoint as `lookAt`, which `aimAtPointer` faces them to for `lookHoldMs` just as `r` does the pointer, and `LookMark` marks with a cross. On a desktop a right click that picks something does the same (`picked`, in `use-world-events`), unless it is the player themself, which is what a trackpad's two-finger tap is, besides `r`.

**Turns can pivot on a point too**: `rotateAbout` names one — `WorldView` gives the zoom crosshair whilst it shows, and nothing whilst following — and `setRotateAbout` takes it as a turn begins, mouse or touch alike. `update` then slides the whole rig by `slideAboutPivot`. Turning about the pivot and turning about `target` leave `position - target` identical, so they differ by a pure translation — which is all that helper applies. With no point named the turn is about `target`.

Zooms aim at a point: `setDollyTowards(clientX, clientY)` from the cursor (wheel) or the pinch centroid, then `applyZoomTowards(prev, next)` moves the camera along that aim and re-derives `target`. Only a **pure** pinch zooms — two fingers also rotate and pan, so `twoFingerRotateRatio` (smoothed centroid-motion share) must be under `pinchPurity`.

## Navigation / crowd

Navmesh uses `navcat` (recast/detour JS port). Agents live in a `crowd`. To teleport an agent, set `agent.position` **before** calling `requestMoveTarget` — otherwise path-finding starts from the old poly and the agent walks through walls instead of snapping to the destination.

An npc with an agent has its poly at `agent.corridor.path[0]`, which the crowd keeps under their feet — read `npc.nodeRef` rather than `getClosestPoly(npc.position)`. The first corner's `nodeRef` is the poly *after* it, not the current one.

Two workers under `packages/ui/world/src/worker/`: `physics.worker.ts` (rapier, `w.physics`) and `nav.worker.ts` (navmesh generation, room graph, raycast, `w.navWorker`). jsh's `jsh.worker.ts` in `packages/cli` wraps the nav one — see `docs/workers.md`.

**Strafing** — see `docs/npc-strafe.md`, the ONLY doc for it. In short: whilst `npc.anim.strafe` (by default whilst `face.aim`) they keep their facing, and `syncStrafe` blends four directional gaits by heading, paced to the ground each covers.

**Stance** — see `docs/npc-stance.md`, the ONLY doc for it. In short: after any gait an npc's feet stay roughly where they stopped. `npc-stance.ts` holds each ankle on the ground and solves the legs to reach, sinking and shifting the hips. `stanceConfig.on` in `const.npc` switches it off. Remount the World after editing it.

**Breath** — see `docs/npc-breath.md`, the ONLY doc for it. In short: an npc asked to (`anim.setBreathing`) shows lungs
and a diaphragm through their body, moved and lit by the air in their lungs. Their bones are not touched. The player's is tuned in their bubble.

**Slices and eyes** — see `docs/skin-slices.md`, the ONLY doc for them. In short: a slice is a face-sized piece of texture drawn over a skin's
face, and each holds that skin's eyes one way: `shut`, `up`, `scared`... An npc's eyes are one uniform, the slice shown (`pose rob eyes:shut`, `blink:2`).
None is drawn by hand: the dev server finds each skin's eyes in its png (`meta.eyes`), and a DEV World draws the slices and saves `sheet/skin-slices.N.png`.

`navcat` is pnpm-patched — four corners per agent, a `boundaryQueryRange` agent param, corners that stay given up, a desired velocity that folds round a touched npc, and an END kept on a path ending on a mesh vertex. See `docs/navcat-patch.md`, including how to edit the patch.

## Which room an npc is in

`w.npc.npcToRoom`, changed by `enter-room` (`use-world-events`). A walker's room changes as they cross a
door's centre LINE, not as their body leaves its "inside" sensor: `trackDoorway` notes the door on the
sensor's `enter-collider` — its line, and the room to each side, a hull door's far one being the next
geomorph's — and `syncDoorways`, each tick, reads off the side they stand on (`w.e.insideDoorways`).
The sensor's exit still fires its own `enter-room`, usually `reEntered`. A spawn sets the room itself.

## Spawning NPCs

`state.placeNpcAt(npc, at, type)` — places or teleports an NPC. The `"navigable"` type throws if the position is off the navmesh; `"doable"` silently removes the agent instead.

Which npcs are parked — and the wall segment each stands against — is jsh state, not the world's: `parked` in `/shared/map/{mapKey}/pred`, owned by `packages/cli/src/jsh/world/pred.ts` and persisted with the rest of `/shared`. `park` records via `parked.mark`; a move, respawn or removal unparks. `padded` beside it is the same for `pad` — a Set of those stood with room to walk right round them — and an npc is one or the other.

## jsh commands

Exports of `packages/cli/src/jsh/world/{core,demo,demo_mcp,debug,decor,pred}.ts` become shell commands, and hot-reload — `modules.js` lists them, and the default profile sources them. The `*_mcp.ts` ones are Claude's, written through the MCP server (see below). An exported *function* becomes one; export an object to keep helpers out of the shell (see `parked` in `pred.ts`).

**Only `packages/cli/src/jsh/world` knows of the World.** The shell (`packages/cli/src/shell`: builtins, `api`, sessions) and `packages/cli/src/jsh`'s own modules e.g. `util.js` must not import or mention it. A later-sourced module may shadow an earlier one's command, never a builtin — builtins win.

**`api` methods are bound to `{ meta, node }` alone** (`provideProcessCtxt` in `shell/command.ts`), so inside `processApi` `this` is not the api: `this.setPtags(…)` from another method is undefined at runtime, though it typechecks. Share logic via a `CmdService` method taking `meta`, e.g. `cmdService.setPtags(this.meta, …)`.

**A long-running command must support kill**, or ctrl-c does nothing and only a page reload ends it:
- register `const handlers = api.handleStatus({ cleanup })`, and have `cleanup` end the loop — unsubscribe, or resolve a promise the loop is racing;
- never `await` something a kill cannot interrupt: `w.npc.nextTick()` never resolves whilst the world is paused, so race it — `Promise.race([w.npc.nextTick(), killed])`;
- on the way out `handlers.dispose()`, then `throw api.getKillError()`.

See `events` in `core.ts` (async iterable) and `demo_corners` in `demo.ts` (frame callback).

**Pausing** — see `docs/jsh-pause.md`, the ONLY doc for it. In short: world commands (and their descendants) pause with the World via a pause group made in `awaitWorld`; one that must keep going calls `api.setPausable("world", false)` first, like `pick`.

## Decorator panel

See `docs/decorator.md` — the ONLY doc for it. In short: `packages/ui/decorator` places dynamic
(runtime) decor on a 2D top-down map of a live World (`meta.worldKey`, read from the query cache).
The map is SVG in world metres, drawn from each geomorph's layout plus `w.nav.toNavTris` and the live
doors; npcs are shown only when chosen. Decor is configured in the World itself: the debug **decorations**
toggle labels it and opens a card per pick.

## Inventory

See `docs/inventory.md` — the ONLY doc for it. In short: `WorldHud` is the player's bar (psi, phaser,
keys, then carried items; `q` psi, `e` held the phaser), over `w.e.carried` — the defs of decor taken, by npcKey, per
World. An item is a runtime decor with `meta.item`; jsh `give` / `drop`, and `inventory` for what a press does.

## Psi

See `docs/psi.md` — the ONLY doc for it. In short: psi is raised or not, per npc (`w.e.setPsi`, `w.e.isPsiRaised`), and raised, their
left hand is at their temple. Raised, a press on another npc reads
their thought (`w.speech.readThought`): over their head (`w.bubble.think`) and in the speech history (`w.speech.think`), marked with its khandha.

## Shields

See `docs/shields.md` — the ONLY doc for them. In short: a decor rect with `meta.shield` stands as a
see-through panel (`w.shields`) that stops phaser fire, found on the phaser's own raycast in the nav
worker. One of a frequency (`meta.freq`, jsh `shield`) lets a phaser granted it through (jsh `phaser`) and
deactivates any other carried through it; `freq: null` stops all fire and deactivates none.

## Lore

See `docs/manifest-lore.md` — the ONLY doc for it. In short: characters (name, npc, skin, rooms and door keys),
one JSON each in `packages/media/lore/character/{slug}.json`, edited in the Manifest panel, `packages/ui/manifest`
(DEV saves through `/api/lore`; a build bundles them as `virtual:lore`). Conversation trees (`ui/world/src/service/talk.ts`) are
outlined there and played in `WorldSpeech`'s history, by thread, each reply waiting on tests shown as pips.

## MapEdit saving

See `docs/map-edit.md` — the ONLY doc for where a saved MapEdit file goes. In short: playground
files (key ending `--playground` / `-playground`) save to a localStorage draft and are the only
thing editable in production; everything else saves to the filesystem in DEV via
`POST /api/map-edit/file/:type/:filename`. `g-301--playground`'s hull and doors were drawn by hand,
and its node NAMES are its tags.

## Symbol generation

See `docs/symbol-generation.md` — the ONLY doc for it. In short: a symbol's JSON can be written from
its png and saved through `POST /api/map-edit/file/symbol/{key}.json`, then checked by its thumbnail. An
obstacle polygon takes in its drawn border, with no more points than its curves need. The same doc covers
placing symbols in a hull symbol, the walls and doors it needs of its own, and how `assets.json` breaks.

## Memory

See `docs/memory.md` — the ONLY doc for it. In short: a `TexArray` can hold its pixels three times
over (GPU, CPU mirror, 2D canvas), so memory is mostly a matter of how many layers each has. The floor
and ceiling are a layer per geomorph KEY, and a `gpu` array has no mirror.

## Deploys and stale tabs

See `docs/deploys.md` — the ONLY doc for it. In short: a tab can outlive its deploy, so production
keeps superseded hashed assets for 30 deploys (`assetHistoryPlugin`, whose `/asset-history.json`
also logs each deploy's ui chunk paths and sizes), `NewVersionToast` offers a reload, and ui chunk
names stay put unless their code changed. Keep them so: nothing a ui imports may value-import
`@npc-cli/ui-registry` or another ui package's root (use a subpath, e.g. `/schemas`), and
`stableEntryPlugin` keeps chunks from importing the entry.

## MCP server

See `docs/mcp.md` — the ONLY doc for it. In short: `scripts/src/mcp/server.ts` (in `.mcp.json`) drives
the `pnpm dev` page over CDP through `window.__devMcp` (`packages/app/src/dev-mcp-hooks.ts`): jsh lines
in `tty-1` and beyond, their output, pointer presses on the World, the console, screenshots. Prototype in
a tty; keep what is reusable as exports of `packages/cli/src/jsh/world/*_mcp.ts`.

Before EVERY call to it, write the call's input as a code fence: the `jsh` line as `sh`, the `query`
function as `js`, else its arguments. That message is `IN` and the fence ALONE, with no other text.
The VS Code extension shows a call's result but not its input, and it drops a fence that follows prose.

## Checking a change in the browser

See `docs/browser-scenarios.md` — the ONLY doc for it, and the log of scenarios run. In short: a
production preview in a visible Chrome, driven by typing into the app's own jsh terminal one step at a
time, pausing for "next" — never headless. Players are moved, not spawned.

## TSL shader notes

- **`positionLocal` range**: returns the raw geometry attribute, which for `BoxGeometry(1,1,1)` is `[-0.5, 0.5]` even after `geo.translate(0.5, 0.5, 0.5)`. Don't use `positionLocal` with `step()` assuming `[0,1]` — use `uv()` instead for per-face detection on box geometry.
- **UV-based edge/seam detection on boxes**: `uv()` gives `[0,1]` per face reliably. Pre-compute physically-sized UV fractions as `seamPhysical / faceDimension`. Sub-panel grids: `uvCoord.x.mul(cols).fract()` to tile N sub-panels, then `step(seamW, subU).add(step(subU, seamW).clamp(0,1))` for seam detection.
- **`DerivedGmsData.findRoomIdContaining`**: throws `"Value is not of type 'long'"` when passed NaN or Infinity (e.g. from a divide-by-zero in a normal calculation). Prefer a polygon ray-cast on `gm.rooms` (`gm.rooms.some(r => pointInPoly(px, py, r.outline))`), or rely on `meta.hull` filtering instead.

## `wallSegs` / panel placement notes

- `wallSegs` are in **local geomorph space** (same as `gm.rooms`, `gm.bounds`). The instance `transform` converts them to world space — apply it before world-space comparisons.
- Near-door endpoint check is too aggressive: wall segments share endpoints with door segments, so `u.distanceTo(da) < threshold` excludes every wall adjacent to a door. Use midpoint-to-segment distance (`distToSeg(mx, mz, da.x, da.y, db.x, db.y)`) instead.
- Panel slot count formula: `Math.floor(availLen / slotWidth)` requires a trailing gap and gives 0 for short segments that fit 1 panel. Correct: `availLen >= panelWidth ? Math.floor((availLen - panelWidth) / slotWidth) + 1 : 0`.

## Conventions

- TSX/TS for almost everything; `camera-controls.js` and `CameraControls.jsx` are plain JS by design.
- A selector is a base-ui `Select`, never a native `<select>`, its trigger only as wide as what is chosen — `Picker`, from `@npc-cli/util/picker`.
- `useStateRef` (from `@npc-cli/util`) produces a stable ref-backed state object — treat it like a class instance, not React state.
- To find npcs near one, go through those in their room or the rooms they can reach (`w.e.getNpcsInReach(npcKey)`, over `w.npc.roomToNpcs`), not every npc in `w.n`, unless there is good reason: a wall is then never between the two.
- `w.n` is `null` until `<NPCs>` mounts, after every other `<World>` child — so anything run from their own mount (e.g. `w.e.setPsi`) must guard it.
- Geometry in 2D uses `x/y` (xz world plane); `y` in 2D = `z` in 3D. `parseGroundPoint` / `groudPointToTuple` (note the typo) handle the conversion.

- `const.env.ts` / `const.npc.ts` only contain constants, no methods. The npc tuning is split off so editing it does not rebuild the world: `World.tsx` refetches on its own HMR, and every importer of `const.env` — its hooks included — makes it one. So `const.npc` is imported by npc modules alone — those drawing npcs or what surrounds them too, e.g. `NpcRings`, `NpcBreath` — never `World`, `WorldView` or their hooks; what the world builds around an npc, `npcDims`, is in `const.env`
- Comments must be TERSE and sparing: one short line, never a paragraph, and only what the code
  doesn't already say. Prefer none to a restatement. Where one does clarify, attach it to the syntax
  it explains — a JSDoc on the `const` (or field, or function) beats a trailing or free-floating `//`.
  A JSDoc is two lines at most: give the "why" in a clause, never recap a mechanism the reader can see
- Comments must also be CLEAR: a plain statement, subject first, one idea to a sentence. No
  stream of consciousness: no clauses strung together on commas, dashes and colons, no "X, so Y — unless
  Z: W". A second idea is a second short sentence, or left out. Say what the thing is or returns before why
- Never scale a decor quad non-uniformly: to reshape one e.g. a shallower shelf, change its svg in `media/src/decor` (`width`/`height` and `viewBox`) and re-run `gen-decor-sheets`
- To darken or recolour ONE placed decor, tint it — `tint=#777` in its symbol name (`meta.tint`, multiplied in) — rather than redrawing its svg, which changes every use
- Markdown for the clipboard (e.g. a PR body via `pbcopy`) must be plain ASCII, emoji included: no typographic dashes, arrows, `±`, `°`, `§`, no 🤖 — `grep -P '[^\x00-\x7F]'` it first
- The dev page hot-reloads every save, so a name used before it is imported or declared breaks the render at once. Make an edit whole in one write, then run `npx biome lint --only=correctness/noUndeclaredVariables <files>` on what was touched: it takes milliseconds, where `pnpm typecheck` takes minutes
- Never stage (`git add`) — leave the index alone, even after editing a file that was already staged. Staging and committing are the user's
