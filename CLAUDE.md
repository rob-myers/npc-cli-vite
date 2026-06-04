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

## Conventions

- TSX/TS for almost everything; `camera-controls.js` and `CameraControls.jsx` are plain JS by design.
- `useStateRef` (from `@npc-cli/util`) produces a stable ref-backed state object — treat it like a class instance, not React state.
- Geometry in 2D uses `x/y` (xz world plane); `y` in 2D = `z` in 3D. `parseGroundPoint` / `groudPointToTuple` (note the typo) handle the conversion.
- Sentinel for "no light": `Vector4(0, -1000, 0, 1)` — far enough that the clamped factor is always 0.
