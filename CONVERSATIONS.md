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

## The one actionable inefficiency

`roomClipFactor` runs even when `litVal` is already 0 (pixel outside the light's radius) — the
overwhelming majority of (pixel, light) pairs for any given light. Guarding the room-clip call
behind "only if litVal > 0" would cut most of the wasted work, since most fragments aren't near
most lights. This is the highest-leverage change if it ever needs optimizing.

## Not concerns

- CPU-side work (`createOutset`, `findRoomContaining`, `addLight`, `findLightNear`) all runs once
  per user gesture (placing/removing a light), not per-frame — negligible.
- Memory footprint is ~17KB of uniform data total (room-polygon vertex buffers for up to 32 lights
  + the tracked light).
- For the realistic case (a handful of active lights, moderate resolution) this is all fine; it'd
  only start to bite with many (10+) simultaneously active lights on a lower-end/mobile GPU.

## Minor cleanup note (quality, not perf)

`roomClipFactor` (unrolled `If`s) and `trackedRoomClipFactor` (real `Loop`) are near-duplicate
implementations of the same ray-cast point-in-polygon test, existing only because of the
nested-`Loop` constraint on the static-lights path. Not worth unifying unless that code is being
touched again anyway.
