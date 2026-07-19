# Lighting Performance

Discussion of the efficiency of the room-clipped light feature (hold-to-grow static lights,
clipped to the room they're placed in via a ray-cast point-in-polygon test in
`packages/ui/world/src/service/xz-cylinder-postprocess.ts`).

## What's on the hot path

`litAmount()` runs as a full-screen post-process pass, per fragment, every frame:

1. **Depth reconstruction** — a cheap ray-plane fallback for background/floor pixels, or the
   fuller log-depth → view → world reconstruction for everything else. Note: once `Ceiling.tsx`
   was switched to `depthWrite: true` (fixing unlit wall-tops/ceiling at oblique angles), ceiling
   pixels moved from the cheap fallback path onto the expensive path — a small, deliberate cost
   increase traded for correctness.
2. **Tracked light** (if active): distance + falloff, then `trackedRoomClipFactor` — a real TSL
   `Loop` with `Break`, so its cost is proportional to that room's actual vertex count, not the
   64-vertex cap. Reasonably efficient.
3. **Static lights**: the outer `Loop` already early-exits via `hiWater`, so it only visits active
   slots — good. But each active light's `roomClipFactor` unrolls **all 64** `If` blocks
   unconditionally (the reason it avoids a nested-`Loop`-inside-`Loop` bug that broke badly during
   development), so it pays close to the full 64-edge cost regardless of the room's real vertex
   count (typically 4–12) or of whether that light was even close to the pixel.

## The one actionable inefficiency — fixed

`roomClipFactor`/`singleRoomClipFactor` used to run even when `litVal` was already 0 (pixel outside
the light's radius) — the overwhelming majority of (pixel, light) pairs for any given light.
Reported as a real, noticeable slowdown on a Pixel 8 (mobile GPUs feel per-fragment branchy cost
far more than desktop discrete GPUs, and it scales with # active lights). Fixed by gating each
light's room-clip call behind `If(inHeightRange.and(litVal.greaterThan(0)), ...)` — a real branch,
not `.select()`, so GPU warps entirely outside a light's influence skip the polygon scan
altogether. Applies to all three call sites: `tracked`, `preview`, and the per-active-light static
loop (the one whose cost scales with # active lights, so the highest-leverage of the three).

Ruled out as a cause: `devicePixelRatio`. `WorldView.tsx`'s `createRenderer` calls
`renderer.setPixelRatio(window.devicePixelRatio)`, but react-three-fiber's `<Canvas>` defaults to
`dpr={[1, 2]}` and re-applies its own clamped value via `gl.setPixelRatio` immediately after —
so actual render resolution is already capped at 2x regardless of a phone's native (higher) DPR.
No change needed there; further capping (e.g. to 1.5 on touch devices) remains an available lever
if the shader fix alone isn't enough, but it's a visual-quality tradeoff, not a free win.

## Not concerns

- CPU-side work (`createOutset`, `findRoomContaining`, `addLight`, `findLightNear`) all runs once
  per user gesture (placing/removing a light), not per-frame — negligible.
- Memory footprint is ~17KB of uniform data total (room-polygon vertex buffers for up to 32 lights
  + the tracked light).

## Minor cleanup note (quality, not perf)

`roomClipFactor` (unrolled `If`s) and `trackedRoomClipFactor` (real `Loop`) are near-duplicate
implementations of the same ray-cast point-in-polygon test, existing only because of the
nested-`Loop` constraint on the static-lights path. Not worth unifying unless that code is being
touched again anyway.
