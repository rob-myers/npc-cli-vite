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

## Lighting (Walls / Obstacles)

Per-instance uniform arrays hold the 2 nearest lights for each wall segment or obstacle skirt edge. Lights come from `getLightMetas(gm)` which returns `{ x, y, radius, roomId }` per `DecorCircle` with `meta.light === true`. Radius is per-light (not a global constant). Light data is packed into `Vector4` — `xyz` = world position, `w` = radius — and passed as `uniformArray(..., "vec4")`. The fixed `lightRadius` constant still exists in `texture.ts` but is only used by `drawLights` (canvas 2D); the shader uses per-light radius.

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
  Windows are excluded on purpose: light passes through glass.
- **The table is created once** and never rebuilt, so materials reading it survive a map change.
  Only the occluder buffers are refilled, and nothing but the sweep reads those.
- **Opting a material in** is one line: `m.colorNode = w.view.playerLight.applyLight(node)` (or
  `applyLightRgba` where the colour carries alpha). Unlit fragments are tinted towards black; a
  `strength` of `0` — no player, or a WebGL fallback backend, which has no real compute — is exactly
  identity, so wrapping is unconditional.
- Two neighbouring angles are sampled and their *lit/unlit results* blended. Blending the distances
  instead would put a shadow edge where neither surface is.

## Floor

See `docs/FLOOR.md` — the ONLY doc for floor drawing. In short: the look comes from one mutable
object, `deckConfig` in `service/texture.ts`; mutate it and call `w.floor.drawAll()`.

## Camera controls

Custom `MapControls` subclass in `service/camera-controls.ts`. Props flow: `WorldView.tsx` `ctrlOpts` → `<CameraControls>` (JSX wrapper) → `<primitive>` on the controls instance. `CameraControls.jsx` exposes a JSDoc `@typedef Props`; `WorldView.tsx` types `ctrlOpts` as `MapControlsProps`. Note r3f skips `undefined` props, so a prop `ctrlOpts` omits keeps the class default — which is how `zoomToCursor` stays on.

**Zoom has two stops**, `minDistance` and `maxDistance`; there is no continuous dolly. `zoomProgress` (0 at `maxDistance`, 1 at `minDistance`) is what gestures move — wheel by `deltaY`, pinch by the `ln` of its spread — and `getZoomRadius()` maps it to the radius. Once input pauses (`zoomSettleMs`), `syncZoom()` eases to whichever stop is nearer, so reversing partway cancels a zoom. It self-sustains via `dispatchEvent(changeEvent)` → `r3f.invalidate()`, which is what makes it work in a demand frameloop; the arriving frame dispatches nothing so the frames can stop.

The radius is **not** persistent state — `update()` re-derives it from `position - target` each frame, so zoom must be written inside `update()`. Anything that moves the camera itself (e.g. `WorldView.lookAt`) must call `setZoomFromRadius` afterwards, else the next settle undoes it.

Zooms aim at a point: `setDollyTowards(clientX, clientY)` from the cursor (wheel) or the pinch centroid, then `applyZoomTowards(prev, next)` moves the camera along that aim and re-derives `target`. Only a **pure** pinch zooms — two fingers also rotate and pan, so `twoFingerRotateRatio` (smoothed centroid-motion share) must be under `pinchPurity`.

## Navigation / crowd

Navmesh uses `navcat` (recast/detour JS port). Agents live in a `crowd`. To teleport an agent, set `agent.position` **before** calling `requestMoveTarget` — otherwise path-finding starts from the old poly and the agent walks through walls instead of snapping to the destination.

## Spawning NPCs

`state.placeNpcAt(npc, at, type)` — places or teleports an NPC. The `"navigable"` type throws if the position is off the navmesh; `"doable"` silently removes the agent instead.

## Map-edit save flow

`POST /api/map-edit/file/:folder/:filename` → `saveMapEditFile(filePath, body)` in `scripts/src/service/process-map-edit-save.ts`. That function: parses + validates body, writes JSON, generates thumbnail (skia-canvas), updates manifest.

`savedFileSpecifiers` is the source of truth for the map/symbol selector in `FileMenu.tsx`. It is rebuilt by `updateSavedFileSpecifiers(drafts)` which merges manifest entries + localStorage drafts. When adding a new entry always produce a **new array** — mutating in place then passing the same reference prevents `useMemo` from recomputing `mapFiles` in `MapFileSelect`.

Delete maps via `state.deleteFile(file)` (removes localStorage draft + calls `DELETE /api/map-edit/file/...` in dev, then invalidates the manifests query). Symbols are not deletable from the UI — only maps have a trash button in `MapFileSelect`.

## `loadDrafts` — use-originals / use-drafts toggle

`LoadDraftsMode = "use-originals" | "use-drafts"` controls where MapEdit loads from and saves to. The value is **per-instance**, persisted to localStorage keyed by instance ID (e.g. `map-edit-load-drafts:<id>`). Shared helpers live in `packages/ui/map-edit/src/use-drafts.ts` and are imported by both MapEdit and World.

**MapEdit behaviour:**
- `"use-originals"` (DEV default): loads from filesystem/manifest; saves write to filesystem (DEV only via `saveMapEditFile`) and delete any stale localStorage draft for that file.
- `"use-drafts"` (PROD default): loads from localStorage draft; saves write to localStorage only — `saveMapEditFile` is **not** called even in DEV.
- On mount: `state.load(undefined, { ignoreDraft: state.loadDrafts === "use-originals" })`.
- `state.switchLoadDrafts(next)`: when switching to `"use-originals"` it first snapshots the current edit state as a draft (so the work is not lost), then reloads from the original.
- A motion toast appears after every save — `"draft saved"` or `"saved to file"` — driven by `state.toastTs: Record<string, number>` (timestamp per key) and the `useToastTs` hook in `MainMenu.tsx`.

**World behaviour:**
- `loadDrafts` lives on World component state (`World.tsx`), not WorldView, because the React Query `queryKey` is constructed there. `state.set({ loadDrafts })` triggers a queryKey change and automatic refetch.
- `"use-drafts"` enables `recomputeAssetsInProduction` (overlays localStorage symbol drafts onto `assets`) in both DEV and PROD. Previously this was PROD-only.
- The select is in `WorldMenu.tsx`; the storage key is `world-load-drafts:<id>`.

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
- Sentinel for "no light": `Vector4(0, -1000, 0, 1)` — far enough that the clamped factor is always 0.

- const.ts only contains constants, no methods