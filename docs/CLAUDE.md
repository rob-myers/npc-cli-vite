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
  — whoever stands on the light has no bearing from it, and the player always does. Npcs add up
  their own exposure from it (`ambient` + that + `litAmbient` whilst lit, all in `const.npc`)
  rather than taking a tint, which `unlitTint` would cap at a 0.4 swing.
- Two neighbouring angles are sampled and their *lit/unlit results* blended. Blending the distances
  instead would put a shadow edge where neither surface is.

## Floor

See `docs/floor.md` — the ONLY doc for floor drawing. In short: the look comes from one mutable
object, `deckConfig` in `service/texture.ts`; mutate it and call `w.floor.drawAll()`.

## Obstacle spritesheets

See `docs/starship-sheets.md` — the ONLY doc for them. In short: `gen-starship-sheets` packs one rect
per obstacle polygon of each symbol, keyed `getObstacleSheetKey(symbolKey, obstacleId)` in
`sheets.json`; `<Obstacles>` `addUvs` reads it directly. Keyed by index, so re-run it after any
MapEdit obstacle change.

## Camera controls

Custom `MapControls` subclass in `service/camera-controls.ts`. Props flow: `WorldView.tsx` `ctrlOpts` → `<CameraControls>` (JSX wrapper) → `<primitive>` on the controls instance. `CameraControls.jsx` exposes a JSDoc `@typedef Props`; `WorldView.tsx` types `ctrlOpts` as `MapControlsProps`. Note r3f skips `undefined` props, so a prop `ctrlOpts` omits keeps the class default — which is how `zoomToCursor` stays on.

**Zoom has two stops**, `minDistance` and `maxDistance`; there is no continuous dolly. `zoomProgress` (0 at `maxDistance`, 1 at `minDistance`) is what gestures move — wheel by `deltaY`, pinch by the `ln` of its spread — and `getZoomRadius()` maps it to the radius. Once input pauses (`zoomSettleMs`), `syncZoom()` eases to whichever stop is nearer, so reversing partway cancels a zoom. It self-sustains via `dispatchEvent(changeEvent)` → `r3f.invalidate()`, which is what makes it work in a demand frameloop; the arriving frame dispatches nothing so the frames can stop.

The radius is **not** persistent state — `update()` re-derives it from `position - target` each frame, so zoom must be written inside `update()`. Anything that moves the camera itself (e.g. `WorldView.lookAt`) must call `setZoomFromRadius` afterwards, else the next settle undoes it.

**`canonical` restricts what may be steered, by zoom.** Its azimuth is free at every zoom and untouched by zooming, but a turn let go with ctrl or cmd held (`controls.ctrlHeld`) is a detented compass dial (`detentCanonicalAzimuth`): it advances a point per `canonicalSnapArm` turned, else springs back to the point nearest where it set out, and a turn-back within the same drag is a cancel only whilst it stayed within a quarter turn. Zoomed out (`t > canonicalAxisLockFrom`) a drag locks to one axis. The polar is never clamped by the zoom, and ONE tilt is tracked, `canonicalPolar`: a zoom neither flattens the view nor tips it back, so both angles survive it. A drag owns the polar at every zoom and `shapeCanonicalPolar` takes whatever tilt it leaves. Entering the mode and a reset set it to the camera's own tilt. Zoom past the outer stop there is none — the radius is only ever a zoom stop.

**Zoomed out, the view frames the player and their frontier.** `service/player-frontier` reads a fan of the light sweep's polar table back off the GPU (`playerLight.readTable`, into one kept `ReadbackBuffer`, one read in flight at a time and at most one per `frontierReadMinMs`) and keeps the furthest as `reach`, with `ahead` giving the vector to the frontier point. `followPlayer` holds the target `frontierPanFrac` of the way along it at every zoom (`getFollowGoal`, which the aimed zoom-in heads for too). Not following, a short look press (`f`, or the button) calls `holdFrontier`: a `lookAt` tracking the goal, then `frontierHold` keeps the follow running until the camera is next touched (the controls' `start` event, see `onCameraStart`). `easeFrontier` in `onCameraFrame` eases `controls.maxDistance` to the nearest radius that fits the segment in the frustum with `frontierMargin` to spare, clamped between `frontierNearFrac` of the travel and the persisted stop, and `controls.minDistance` to the same fit clamped between `frontierNearest` and the persisted inner stop — both back to persisted when there is nothing to read. `t` is measured off the live stop, so a drawn-in view is still fully zoomed out.

**Turns can pivot on a point too**: `rotateAbout` names one — `WorldView` gives the zoom crosshair whilst it shows, and nothing whilst following — and `setRotateAbout` takes it as a turn begins, mouse or touch alike. `update` then slides the whole rig by `slideAboutPivot`. Turning about the pivot and turning about `target` leave `position - target` identical, so they differ by a pure translation — which is all that helper applies. With no point named the turn is about `target`.

Zooms aim at a point: `setDollyTowards(clientX, clientY)` from the cursor (wheel) or the pinch centroid, then `applyZoomTowards(prev, next)` moves the camera along that aim and re-derives `target`. Only a **pure** pinch zooms — two fingers also rotate and pan, so `twoFingerRotateRatio` (smoothed centroid-motion share) must be under `pinchPurity`.

## Navigation / crowd

Navmesh uses `navcat` (recast/detour JS port). Agents live in a `crowd`. To teleport an agent, set `agent.position` **before** calling `requestMoveTarget` — otherwise path-finding starts from the old poly and the agent walks through walls instead of snapping to the destination.

An npc with an agent has its poly at `agent.corridor.path[0]`, which the crowd keeps under their feet — read `npc.nodeRef` rather than `getClosestPoly(npc.position)`. The first corner's `nodeRef` is the poly *after* it, not the current one.

Two workers under `packages/ui/world/src/worker/`: `physics.worker.ts` (rapier, `w.physics`) and `nav.worker.ts` (navmesh generation, room graph, raycast, `w.navWorker`). jsh's `jsh.worker.ts` in `packages/cli` wraps the nav one — see `docs/workers.md`.

`navcat` is pnpm-patched — four corners per agent, a `boundaryQueryRange` agent param, corners that stay given up, and a desired velocity that folds round a touched npc. See `docs/navcat-patch.md`, including how to edit the patch.

## Spawning NPCs

`state.placeNpcAt(npc, at, type)` — places or teleports an NPC. The `"navigable"` type throws if the position is off the navmesh; `"doable"` silently removes the agent instead.

Which npcs are parked — and the wall segment each stands against — is jsh state, not the world's: `parked` in `/shared/map/{mapKey}/pred`, owned by `packages/cli/src/jsh/world/pred.ts` and persisted with the rest of `/shared`. `park` records via `parked.mark`; a move, respawn or removal unparks. `padded` beside it is the same for `pad` — a Set of those stood with room to walk right round them — and an npc is one or the other.

## jsh commands

Exports of `packages/cli/src/jsh/world/{core,demo,debug,decor,pred}.ts` become shell commands, and hot-reload — `modules.js` lists them, and the default profile sources them. An exported *function* becomes one; export an object to keep helpers out of the shell (see `parked` in `pred.ts`).

**A long-running command must support kill**, or ctrl-c does nothing and only a page reload ends it:
- register `const handlers = api.handleStatus({ cleanup })`, and have `cleanup` end the loop — unsubscribe, or resolve a promise the loop is racing;
- never `await` something a kill cannot interrupt: `w.npc.nextTick()` never resolves whilst the world is paused, so race it — `Promise.race([w.npc.nextTick(), killed])`;
- on the way out `handlers.dispose()`, then `throw api.getKillError()`.

See `events` in `core.ts` (async iterable) and `demo_corners` in `demo.ts` (frame callback).

## Decorator panel

See `docs/decorator.md` — the ONLY doc for it. In short: `packages/ui/decorator` places dynamic
(runtime) decor on a 2D top-down map of a live World (`meta.worldKey`, read from the query cache).
The map is SVG in world metres, drawn from each geomorph's layout plus `w.nav.toNavTris` and the live
doors; npcs are shown only when chosen. Decor is configured in the World itself: the debug **decorations**
toggle labels it and opens a card per pick.

## MapEdit saving

See `docs/map-edit.md` — the ONLY doc for where a saved MapEdit file goes. In short: playground
files (key ending `--playground` / `-playground`) save to a localStorage draft and are the only
thing editable in production; everything else saves to the filesystem in DEV via
`POST /api/map-edit/file/:type/:filename`. `g-301--playground`'s hull and doors were drawn by hand,
and its node NAMES are its tags.

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
- `useStateRef` (from `@npc-cli/util`) produces a stable ref-backed state object — treat it like a class instance, not React state.
- Geometry in 2D uses `x/y` (xz world plane); `y` in 2D = `z` in 3D. `parseGroundPoint` / `groudPointToTuple` (note the typo) handle the conversion.

- `const.env.ts` / `const.npc.ts` only contain constants, no methods. The npc tuning is split off so editing it does not rebuild the world: `World.tsx` refetches on its own HMR, and every importer of `const.env` — its hooks included — makes it one. So `const.npc` is imported by npc modules alone, never `World`, `WorldView` or their hooks; what the world builds around an npc, `npcDims`, is in `const.env`
- Comments must be TERSE: one short line, never a paragraph, and only what the code doesn't already
  say. Prefer none to a restatement. A JSDoc is two lines at most — give the "why" in a clause, not
  an essay, and never recap a mechanism the reader can see. Trailing `// like this` beats a line above
- Markdown for the clipboard (e.g. a PR body via `pbcopy`) must be plain ASCII, emoji included: no typographic dashes, arrows, `±`, `°`, `§`, no 🤖 — `grep -P '[^\x00-\x7F]'` it first
- Never stage (`git add`) — leave the index alone, even after editing a file that was already staged. Staging and committing are the user's
