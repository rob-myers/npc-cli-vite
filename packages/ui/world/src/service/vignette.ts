import { length, mix, smoothstep, uv } from "three/tsl";
import type * as THREE from "three/webgpu";

/**
 * Darkens `color` towards the corners of the frame.
 *
 * @param amount `0` is exactly identity, `1` fully applies it — see `w.view.fx`
 */
export function applyVignette(color: THREE.Node<"vec3">, amount: THREE.Node<"float">): THREE.Node<"vec3"> {
  // bright within `inner`, dark beyond `outer`
  const factor = smoothstep(vignetteInner, vignetteOuter, length(uv().sub(0.5))).oneMinus();
  return color.mul(mix(1, factor, amount));
}

/** Radius (in uv, so the corner is ~0.707) within which nothing is darkened */
const vignetteInner = 0.1;
/** Radius beyond which it is fully dark */
const vignetteOuter = 0.5;
