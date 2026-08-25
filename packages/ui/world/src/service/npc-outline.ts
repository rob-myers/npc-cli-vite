import { float, screenSize, screenUV, select, step, vec2, vec3, vec4 } from "three/tsl";
import * as THREE from "three/webgpu";
import type { SelectAnyType } from "./texture";

/**
 * How the `npcMask` attachment blends, which no MRT output but `output` itself does by default —
 * each fragment REPLACES what is there, and the walls, drawn after the npcs, simply wiped them.
 *
 * Blended, the attachment does two jobs at once. An npc writes their coverage as the weight, so
 * their marks land; everything else writes `vec4(0)` weighted by its OWN opacity, so a see-through
 * wall does not wipe what is behind it but scales it by `1 - opacity` — which is what dims an
 * npc's border to match how much of them shows through. Solid geometry is drawn before the npcs, so
 * its full weight only ever clears an empty buffer.
 *
 * The alpha channel is never read back: three clears every MRT attachment past the first to alpha
 * `1`, giving only the first the real clear value (see `WebGPUBackend`), so nothing accumulated
 * there could be told from that. Hence the packing in `getNpcOutline`, which keeps to `rgb`.
 */
export function createNpcMaskBlend(): THREE.BlendMode {
  return new THREE.BlendMode(THREE.NormalBlending);
}

/**
 * A border colour, packed into the two channels the mask can spare — `r` being spoken for. Written
 * by the npc (see `NPCs.createMaterials`) and read back by `getNpcOutline`.
 *
 * The hue goes in as 3:3:2 bits and its brightness rides alongside, rather than the colour being
 * quantised whole: a grey is then exact whatever its value, where 3 bits of a dark grey would not
 * be. Both are recovered as ratios against `r`, and whatever dimmed one dimmed all three alike, so
 * the colour that comes back is the colour that went in however much stands in front of it.
 */
export function packOutlineColor(color: THREE.ColorRepresentation, out = new THREE.Vector2()): THREE.Vector2 {
  const { r, g, b } = tmpColor.set(color);
  const brightest = Math.max(r, g, b, 1e-4);
  const code =
    (Math.round((r / brightest) * 7) << 5) | (Math.round((g / brightest) * 7) << 2) | Math.round((b / brightest) * 3);
  return out.set(code / 255, brightest);
}

const tmpColor = /* @__PURE__ */ new THREE.Color();

/**
 * The border just outside every npc's silhouette, as a LAYER rather than a finished colour: the
 * caller composites it over the scene and then the pair over whatever lies behind (see
 * `post-processing`). Returning it whole is what lets it be part-transparent — mixing it into the
 * scene colour here would blend it towards the nothing the scene left in a gap in the floor.
 *
 * The silhouette comes from `npcMask`, an extra attachment the scene pass writes (see
 * `WorldView.setupPostProcessing` and `NPCs.createMaterials`), rather than from edge-detecting
 * the colour buffer — which cannot tell an npc from a similarly coloured wall behind it.
 *
 * @param npcMask `r` is how much of an npc is here after anything see-through in front of them,
 * and `gb` their colour packed against it — see `packOutlineColor`
 * @param sceneDepth Raw logarithmic depth, as `litAmount` takes — only compared, never linearized
 * @returns the border's colour, with how opaque it is here in `a`
 */
export function getNpcOutline(npcMask: THREE.TextureNode, sceneDepth: THREE.TextureNode): THREE.Node<"vec4"> {
  const depthHere = sceneDepth.r;
  const onePx = vec2(1, 1).div(screenSize);
  const texel = onePx.mul(outlineWidthPx);

  // How much npc is HERE, which the border is what stands proud of — see the rim below.
  // DILATED by a pixel, because the mask is stippled wherever a door stands in front of them: a
  // door sees through by COVERAGE rather than by blending (see `Doors`' panel materials), so it
  // writes depth on the samples it covers and the npc behind it is REJECTED on those rather than
  // dimmed — and the coverage is dithered, so what survives is a pixel-wide checker of full
  // coverage and none. Each of those holes read as background and took a border of its own, which
  // is what painted an occluded npc solid. A wall never did this: it blends, which scales the
  // whole mask evenly and leaves no hole. The border loses its innermost pixel in exchange
  const onNpcHere = npcMask.r.toVar();
  for (const [dx, dy] of dilateTaps) {
    onNpcHere.assign(onNpcHere.max(npcMask.sample(screenUV.add(onePx.mul(vec2(dx, dy)))).r));
  }

  // the strongest neighbour wins the colour, so two npcs side by side each keep their own. Kept
  // packed until the end, so only the winner is ever unpacked
  const strength = float(0).toVar();
  const packed = vec2(0).toVar();

  // unrolled whilst building the node graph, so no loop reaches the shader
  for (const [dx, dy] of outlineTaps) {
    const at = screenUV.add(texel.mul(vec2(dx, dy)));
    const tap = npcMask.sample(at);
    // three's log depth is `viewZ = -near * e^(depth * ln(far/near))`, so a larger raw depth is
    // farther away. Where we are nearer than the npc we are occluding them, and the boundary is
    // the occluder's edge rather than the npc's — no outline there.
    const behindNpc = step(sceneDepth.sample(at).r.sub(depthBias), depthHere);
    const there = tap.r.mul(behindNpc);
    const theirs = tap.gb.div(tap.r.max(onNpcAlpha));
    packed.assign((select as SelectAnyType)(there.greaterThan(strength), theirs, packed));
    strength.assign(strength.max(there));
  }

  // 3:3:2, undone — see `packOutlineColor`. The half rounds the code off the ratio's last bits
  const code = packed.x.mul(255).add(0.5).floor();
  const hue = vec3(code.div(32).floor(), code.div(4).floor().mod(8), code.mod(4)).div(vec3(7, 7, 3));

  // How much MORE npc there is beside us than here, which is `0` everywhere ON one and rises to
  // their full coverage just outside them. RELATIVE, so it holds however faint the mask has been
  // left by what stands in front: an absolute threshold reads an npc dimmed past it as background
  // and paints the border straight across them — which is what a door did, its samples rejecting
  // the npc's depth where a wall merely blends over them
  const rim = strength.sub(onNpcHere).max(0);

  return vec4(hue.mul(packed.y), rim.mul(outlineAlpha));
}

/** Guards the divide that recovers a border colour from its coverage — see `packOutlineColor` */
const onNpcAlpha = 0.01;
/** How opaque the border is — part-transparent, so what it sits on still reads through it */
const outlineAlpha = 0.25;
/** Half-width (px) of the border, i.e. how far out we look for npc pixels */
const outlineWidthPx = 4;
/** Guards the depth comparison against noise where the two surfaces nearly touch */
const depthBias = 0.00002;

/** The four immediate neighbours, whence `onNpcHere` is dilated over a stippled mask */
const dilateTaps = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

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
