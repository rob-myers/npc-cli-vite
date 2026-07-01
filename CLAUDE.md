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

## Camera controls

Custom `MapControls` subclass in `service/camera-controls.js` (JS, not TS). Props flow: `WorldView.tsx` `ctrlOpts` → `<CameraControls>` (JSX wrapper) → `<primitive>` on the controls instance. `CameraControls.jsx` exposes a JSDoc `@typedef Props`; `WorldView.tsx` types `ctrlOpts` as `MapControlsProps & { extraZoom?: number }`.

`extraZoom` (default 1): allows zooming in beyond `minDistance` by the given factor, then tweens back. Tween self-sustains via `dispatchEvent(changeEvent)` → `r3f.invalidate()` even in demand frameloop. Works with both normal dolly and `zoomToCursor` paths.

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