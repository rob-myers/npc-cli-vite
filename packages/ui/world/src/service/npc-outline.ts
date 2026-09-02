import { color, Fn, float, mix, mrt, output, screenSize, screenUV, step, uniform, vec2, vec4 } from "three/tsl";
import * as THREE from "three/webgpu";

export type NpcMaskMrt = ReturnType<typeof mrt>;

/** Changes when this module is replaced, so an hmr of it rebuilds the pipeline that captured its nodes */
export const npcOutlineUid = crypto.randomUUID();

/**
 * The scene pass's extra output, whence the borders — npcs write their coverage into `r`, everyone
 * else writes nothing (see `NPCs.createMaterials`).
 *
 * BLENDED, which no MRT output but `output` itself is by default: unblended each fragment REPLACES
 * what is there and the walls, drawn after the npcs, simply wiped them. Blended, everything else
 * scales the mark under it by `1 - opacity` instead — which is what shows a border through a wall,
 * dimmed by however much of the npc it lets through.
 */
export function createNpcMaskMrt(): NpcMaskMrt {
  const maskMrt = mrt({ output, npcMask: vec4(0, 0, 0, output.a) }).setBlendMode(
    "npcMask",
    new THREE.BlendMode(THREE.NormalBlending),
  );
  // three's `merge` puts the merged blend modes on `blendings`, which nothing reads — `getBlendMode`
  // looks at `blendModes` — so every material with an `mrtNode` of its own would lose the blend
  const merge = maskMrt.merge.bind(maskMrt);
  maskMrt.merge = (other: THREE.MRTNode) => {
    const merged = merge(other);
    merged.blendModes = { ...maskMrt.blendModes, ...other.blendModes };
    return merged;
  };
  return maskMrt;
}

/**
 * Lays a border just outside every npc's silhouette over the finished frame. The silhouette comes
 * from `npcMask` rather than from edge-detecting the colour buffer, which cannot tell an npc from a
 * similarly coloured wall behind them.
 *
 * A `Fn`, because the `var`s below need a function scope to be assigned in — outside one the
 * assignments are dropped silently and no border appears at all.
 *
 * @param npcMask `r` is how much npc is here, after anything see-through in front of them
 * @param sceneDepth raw depth, only ever compared — never linearized
 */
export const applyNpcOutline = /* @__PURE__ */ Fn(
  ([frame, npcMask, sceneDepth]: [THREE.Node<"vec4">, THREE.TextureNode, THREE.TextureNode]) => {
    const onePx = vec2(1, 1).div(screenSize);

    // How much npc is HERE. DILATED by a pixel because a door sees through by dithered COVERAGE
    // rather than by blending, so it leaves the mask a pixel-wide checker rather than dimming it —
    // and every hole in that checker would take a border of its own
    const here = npcMask.r.toVar();
    for (const [dx, dy] of crossTaps) {
      here.assign(here.max(npcMask.sample(screenUV.add(onePx.mul(vec2(dx, dy)))).r));
    }

    // The most npc within reach, unrolled so no loop reaches the shader. A tap is IGNORED where
    // what is drawn here is nearer than the npc it found: we are in front of them, so the boundary
    // is our occluder's rather than theirs. Decor and obstacles draw before the npcs and depth-
    // write, holing the mask; a wall writes no depth and dims it instead
    const strength = float(0).toVar();
    for (const [dx, dy] of ringTaps) {
      const at = screenUV.add(onePx.mul(outlineWidth).mul(vec2(dx, dy)));
      const behindNpc = step(sceneDepth.sample(at).r.sub(depthBias), sceneDepth.r);
      strength.assign(strength.max(npcMask.sample(at).r.mul(behindNpc)));
    }

    // Npc beside us and next to none here — RELATIVE, so it survives whatever scaled the mask down.
    // The difference of the values instead reads every step as a silhouette, and a half-opaque wall
    // crossing an npc puts one along its own edge; a fixed threshold reads any floor under the mask
    // as npc everywhere and draws nothing
    const rim = step(here.div(strength.max(maskFloor)), relativeCut);
    // `strength` again for the alpha: the border dims exactly as the npc does, and stays away where
    // there is no npc within reach — `rim` being 1 out there
    return vec4(mix(frame.rgb, outlineColor, rim.mul(strength).mul(outlineAlpha)), frame.a);
  },
);

/**
 * Thinner as the view pulls back: the border is a fixed count of PIXELS, so an npc half the size on
 * screen wears twice as much of one. `zoomProgress` is `0` at the far stop and `1` at the near
 */
export function syncNpcOutlineWidth(zoomProgress: number): void {
  outlineWidth.value = outlineWidthFarPx + (outlineWidthPx - outlineWidthFarPx) * zoomProgress;
}

const outlineColor = /* @__PURE__ */ color("#555");
/** How opaque the border is — part-transparent, so what it sits on still reads through it */
const outlineAlpha = 0.25;
/** Half-width (px) of the border at the near zoom stop, i.e. how far out we look for npc pixels */
const outlineWidthPx = 5;
/** ...and at the far one */
const outlineWidthFarPx = 3;
const outlineWidth = /* @__PURE__ */ uniform(outlineWidthPx);
/** How much fainter the mask must be here than nearby to count as outside an npc */
const relativeCut = 0.25;
/** Guards that ratio where there is no npc within reach */
const maskFloor = 1e-4;
/** Guards the depth comparison where two surfaces nearly touch */
const depthBias = 0.00002;

/** The four immediate neighbours, whence `here` is dilated */
const crossTaps = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];
/** Eight neighbours, diagonals shortened so the border keeps an even width */
const diag = Math.SQRT1_2;
const ringTaps = [...crossTaps, [diag, diag], [diag, -diag], [-diag, diag], [-diag, -diag]];
