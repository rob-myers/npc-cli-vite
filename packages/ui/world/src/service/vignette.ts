import { length, mix, smoothstep, uv } from "three/tsl";
import type * as THREE from "three/webgpu";

/**
 * Darkens `color` towards the corners of the frame.
 *
 * @param amount `0` is exactly identity, `1` fully applies it — see `w.view.fx`
 * @param lit How lit this pixel is (room or dynamic light), which holds the darkening off
 */
export function applyVignette(
  color: THREE.Node<"vec3">,
  amount: THREE.Node<"float">,
  lit: THREE.Node<"float">,
): THREE.Node<"vec3"> {
  // bright within `inner`, dark beyond `outer`
  const corners = smoothstep(vignetteInner, vignetteOuter, length(uv().sub(0.5))).oneMinus();
  // light wins: a lit pixel is darkened at most down to its own brightness, so a lamp
  // near the edge of frame still reads rather than being crushed
  const factor = corners.max(lit);
  return color.mul(mix(1, factor, amount));
}

/** Radius (in uv, so the corner is ~0.707) within which nothing is darkened */
const vignetteInner = 0.1;
/** Radius beyond which it is fully dark */
const vignetteOuter = 0.5;
