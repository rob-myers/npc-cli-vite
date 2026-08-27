import { float, mix, smoothstep, time } from "three/tsl";
import type * as THREE from "three/webgpu";

/**
 * A value on its way from `from` to `to`, having set off at `at` on `time`'s clock.
 *
 * The whole journey is a pure function of that clock, so the shader draws it by itself and there
 * is nothing here to step: no per-frame easing, nothing that moves at the rate the ticks happen
 * to arrive, and the same curve however few frames it is drawn over. All the cpu does is say where
 * a value is headed, and only when that changes.
 *
 * Packed as a `vec3` — `[from, to, at]` — wherever the gpu reads one.
 */
export type Morph = { from: number; to: number; at: number };

/** A `Morph` that has nowhere to go */
export function arrivedAt(value: number, now: number): Morph {
  return { from: value, to: value, at: now };
}

/** Where a morph stands right now — the same curve `morphNode` draws in the shader */
export function morphAt(m: Morph, secs: number, now: number): number {
  const along = Math.min(Math.max((now - m.at) / secs, 0), 1);
  return m.from + (m.to - m.from) * along * along * (3 - 2 * along);
}

/**
 * Sends a morph off towards `wanted` from wherever it has got to, so a change of mind part way
 * across carries on from there rather than snapping back. A no-op if it is already headed there
 */
export function retarget(m: Morph, wanted: number, secs: number, now: number): void {
  if (m.to === wanted) return;
  m.from = morphAt(m, secs, now);
  m.to = wanted;
  m.at = now;
}

/** Whether a morph has arrived, and so has nothing left to draw */
export function settled(m: Morph, secs: number, now: number): boolean {
  return now - m.at >= secs;
}

/** Where a `Morph` packed as `[from, to, at]` stands now — the same curve `morphAt` reads */
export function morphNode(packed: THREE.Node<"vec3">, secs: number): THREE.Node<"float"> {
  const along = time.sub(packed.z).div(secs).clamp(0, 1);
  return mix(packed.x, packed.y, smoothstep(float(0), float(1), along));
}
