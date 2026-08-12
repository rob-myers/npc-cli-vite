import { float, mix, screenSize, screenUV, step, vec2, vec3 } from "three/tsl";
import type * as THREE from "three/webgpu";

/**
 * Paints a white border just outside every npc's silhouette.
 *
 * The silhouette comes from `npcMask`, an extra attachment the scene pass writes (see
 * `WorldView.setupPostProcessing` and `NPCs.createMaterials`), rather than from edge-detecting
 * the colour buffer — which cannot tell an npc from a similarly coloured wall behind it.
 *
 * @param npcMask `1` where an npc body won the depth test, `0` elsewhere
 * @param sceneDepth Raw logarithmic depth, as `litAmount` takes — only compared, never linearized
 * @param amount `0` is exactly identity, `1` fully applies it — see `w.view.fx`
 */
export function applyNpcOutline(
  color: THREE.Node<"vec3">,
  npcMask: THREE.TextureNode,
  sceneDepth: THREE.TextureNode,
  amount: THREE.Node<"float">,
): THREE.Node<"vec3"> {
  const onNpcHere = step(0.5, npcMask.r);
  const depthHere = sceneDepth.r;
  const texel = vec2(1, 1).div(screenSize).mul(outlineWidthPx);

  // unrolled whilst building the node graph, so no loop reaches the shader
  let edge: THREE.Node<"float"> = float(0);
  for (const [dx, dy] of outlineTaps) {
    const at = screenUV.add(texel.mul(vec2(dx, dy)));
    const onNpcThere = step(0.5, npcMask.sample(at).r);
    // three's log depth is `viewZ = -near * e^(depth * ln(far/near))`, so a larger raw depth is
    // farther away. Where we are nearer than the npc we are occluding it, and the boundary is
    // the occluder's edge rather than the npc's — no outline there.
    const behindNpc = step(sceneDepth.sample(at).r.sub(depthBias), depthHere);
    edge = edge.max(onNpcThere.mul(behindNpc));
  }

  // only just *outside* the silhouette, so an npc is never painted over
  return mix(color, vec3(0, 0, 0), edge.mul(onNpcHere.oneMinus()).mul(amount));
}

/** Half-width (px) of the border, i.e. how far out we look for npc pixels */
const outlineWidthPx = 4;
/** Guards the depth comparison against noise where the two surfaces nearly touch */
const depthBias = 0.00002;

/** Eight neighbours, diagonals shortened so the border keeps an even width */
const diag = Math.SQRT1_2;
const outlineTaps = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [diag, diag],
  [diag, -diag],
  [-diag, diag],
  [-diag, -diag],
];
