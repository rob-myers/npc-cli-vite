import {
  cameraPosition,
  cameraProjectionMatrix,
  cameraViewMatrix,
  cos,
  Discard,
  exp,
  Fn,
  float,
  fwidth,
  mix,
  positionLocal,
  sin,
  smoothstep,
  uniform,
  varying,
  vec2,
  vec3,
  vec4,
} from "three/tsl";
import * as THREE from "three/webgpu";
import { defaultPsiTune } from "../const.npc";
import { coverageFull } from "./post-processing";

export type PsiResources = ReturnType<typeof createPsiResources>;

export function createPsiResources() {
  // a strip from one of them to the other: `z` from `-1` to `1` along it, `x` across it
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute([-1, 0, -1, 1, 0, -1, -1, 0, 1, 1, 0, 1], 3));
  geo.setIndex([0, 2, 1, 1, 2, 3]);

  /** The player, and whom psi is on: world `xz`, eased presence, the height of the foot of their head — see `Psi.upload` */
  const playerAt = uniform(new THREE.Vector4());
  const otherAt = uniform(new THREE.Vector4());
  /** Metres the wave's sinusoid has come, less than nought for none — see `Psi.exchange` */
  const come = uniform(-1);
  /** Which wave it is: `0` the player's intention out from them, `1` the other's thought back */
  const back = uniform(0);
  /** The colour of the thought on its way: its khandha's — see `Psi.syncTune` */
  const thoughtColor = uniform(new THREE.Color(defaultPsiTune.color));
  const width = uniform(defaultPsiTune.width);
  /** Metres long a wave's sinusoid is, and how far it rises and falls — see `PsiTune` */
  const packet = uniform(defaultPsiTune.packet);
  /** Amplitude */
  const amp = uniform(defaultPsiTune.amp);
  /** How much of full strength the line has away from the sinusoid */
  const line = uniform(defaultPsiTune.line);
  const opacity = uniform(defaultPsiTune.opacity);
  const color = uniform(new THREE.Color(defaultPsiTune.color));
  /** From `theme.npcs.fxStrength` */
  const gain = uniform(1);
  /** `1` whilst additive, when strength past full whitens the line; `0` over a pale deck */
  const whiten = uniform(1);
  /** Pixels of dark edging either side of a line, for contrast over a pale deck; `0` whilst additive */
  const casing = uniform(0);
  /** A cased line's core: the hue at its palest, down to white */
  const coreColor = uniform(new THREE.Color("#fff"));
  /** Scales the finished line's alpha: over a pale deck, where its strength only firms it up */
  const fade = uniform(1);

  // added light, so a line glows over a dark floor — `Psi.syncTune` lays it over a pale one instead
  const mat = new THREE.MeshBasicNodeMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    ...glowBlend,
  });
  // one mesh serves both waves, only one being on its way at a time
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = +5;
  mesh.visible = false;

  return {
    geo,
    mesh,
    playerAt,
    otherAt,
    come,
    back,
    thoughtColor,
    width,
    packet,
    amp,
    line,
    opacity,
    color,
    gain,
    whiten,
    casing,
    coreColor,
    fade,
  };
}

/** The nodes of whichever wave is on its way: the player's intention, or the other's thought */
export function psiNodes(
  {
    playerAt,
    otherAt,
    come,
    back,
    thoughtColor,
    width,
    packet,
    amp,
    line,
    opacity,
    color,
    gain,
    whiten,
    casing,
    coreColor,
    fade,
  }: PsiResources,
  {
    objectPick,
    foldNode,
  }: {
    objectPick: THREE.UniformNode<"float", number>;
    foldNode: THREE.UniformNode<"float", number>;
  },
) {
  const { wavelength, crestSpeedOver, lineSpeedOver, lineTip, sideRoom, startOver, landFrom } = shaderConfig;
  const between = otherAt.xy.sub(playerAt.xy).length();
  const half = width.mul(0.5);
  const strength = opacity.mul(gain);

  // a line `from` one of them `to` the other in `ink`, and a sinusoid `come` metres along it
  const from = mix(playerAt, otherAt, back);
  const to = mix(otherAt, playerAt, back);
  const ink = mix(color, thoughtColor, back);
  // the player's is theirs alone to send: the other's needs psi to be on them
  const present = playerAt.z.mul(mix(float(1), otherAt.z, back));
  // The strip runs head to head, wide enough for the sinusoid.
  // It turns about that line to face the camera, so the wave reads from any side, above included
  const share: THREE.Node<"float"> = positionLocal.z.mul(0.5).add(0.5);
  const side: THREE.Node<"float"> = positionLocal.x.mul(amp.add(sideRoom));
  const tail = vec3(from.x, from.w, from.y);
  const span = vec3(to.x, to.w, to.y).sub(tail);
  const on3 = tail.add(span.mul(share));
  const across = span.cross(cameraPosition.sub(on3));
  const at = on3.add(across.div(across.length().max(1e-4)).mul(side));
  const vertexNode = cameraProjectionMatrix.mul(cameraViewMatrix.mul(vec4(at, 1)));
  /** Metres along the line, and off it */
  const onLine: THREE.Node<"vec2"> = vec2(share.mul(between), side);
  const on = varying(onLine);

  const colorNode = Fn(() => {
    // the sinusoid is a few waves about where it has come to, dying away either side
    const within = on.x.sub(come).div(packet.mul(0.5).max(1e-3));
    // it grows out of nothing over `startOver`, and is gone by the time it is there
    const shown = smoothstep(0, startOver, come).mul(smoothstep(between.sub(landFrom), between, come).oneMinus());
    const swell = exp(within.mul(within).negate()).mul(shown);
    // its crests outrun it, so it plays as it goes: each rises at its back and dies at its front
    const phase = on.x.sub(come.mul(crestSpeedOver)).mul((2 * Math.PI) / wavelength);
    const off = amp.mul(swell).mul(sin(phase));
    const slope = amp
      .mul(swell)
      .mul(cos(phase))
      .mul((2 * Math.PI) / wavelength);
    // pixels from the curve: metres over what a pixel covers, less for its slant
    const metresPerPx = fwidth(on).length().mul(Math.SQRT1_2).max(1e-6);
    const px = on.y
      .sub(off)
      .abs()
      .div(metresPerPx.mul(slope.mul(slope).add(1).sqrt()));
    const core = smoothstep(half.sub(0.5), half.add(0.5), px).oneMinus(); // solid, 1px edge
    // the core and its casing, should it have one
    const drawn = smoothstep(half.add(casing).sub(0.5), half.add(casing).add(0.5), px).oneMinus();
    // the line runs out ahead of the sinusoid, and joins them first
    const reach = come.mul(lineSpeedOver);
    // …and stays for the reply, which would otherwise have to lay it again
    const laid = smoothstep(reach.sub(lineTip), reach, on.x).oneMinus().max(back);
    const bright = mix(line, float(1), swell);
    // clamped after the strength, so one past full firms up the line's soft edges too
    const shape = drawn.mul(laid).mul(bright).mul(present).mul(foldNode).mul(strength).min(1);

    // nothing to pick, and most of the strip is off the wave
    const a = objectPick.equal(0).select(shape, float(0));
    Discard(a.lessThan(1 / 512)); // which would otherwise still blend
    // alpha stops at one, so strength past it whitens an additive line
    const lit = ink.mul(mix(float(1), strength.max(1), whiten));
    // over a pale deck, near white cased in its own ink, darkened: read over white and grey alike
    const rgb = mix(lit.mul(casingShade), mix(coreColor, lit, whiten), core.max(whiten));
    // Added light is scaled here, not by the blend. Its alpha is then free to count as coverage.
    // The post pass would otherwise weigh a wave over empty canvas by its faint alpha
    const covered = smoothstep(0, 1 / 64, a).mul(coverageFull);
    return vec4(rgb.mul(mix(float(1), a, whiten)), mix(a.mul(fade), covered, whiten));
  })();

  return { vertexNode, colorNode };
}

const shaderConfig = {
  /** Metres from one crest of the sinusoid to the next */
  wavelength: 0.35,
  /** How many times faster than the sinusoid its crests go */
  crestSpeedOver: 0.5,
  /** How many times faster than the sinusoid the line runs out */
  lineSpeedOver: 6,
  /** Metres over which the line's leading end fades */
  lineTip: 0.3,
  /** Metres of strip either side of the sinusoid's swing, for its line's own width */
  sideRoom: 0.1,
  /** Metres a sinusoid has come by the time it is fully there */
  startOver: 0.4,
  /** Metres short of whom it makes for a sinusoid begins to go */
  landFrom: 0.7,
} as const;

/** Light added as the shader scaled it. Alpha takes the greater, so a wave over empty canvas counts as drawn */
export const glowBlend = {
  blending: THREE.CustomBlending,
  blendSrc: THREE.OneFactor,
  blendDst: THREE.OneFactor,
  blendEquationAlpha: THREE.MaxEquation,
  blendSrcAlpha: THREE.OneFactor,
  blendDstAlpha: THREE.OneFactor,
} as const;

/** How dark a line's casing is, of its ink */
const casingShade = 0.18;
