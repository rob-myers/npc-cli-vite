import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import {
  attribute,
  cameraProjectionMatrix,
  cameraViewMatrix,
  Discard,
  Fn,
  float,
  fract,
  mix,
  normalLocal,
  positionLocal,
  smoothstep,
  uniform,
  varying,
  vec3,
  vec4,
} from "three/tsl";
import * as THREE from "three/webgpu";
import { wallHeight } from "../const.env";
import type { FadeRooms } from "./fade-rooms";

export const MAX_SHIELDS = 256;

/** Floats a shield: `shieldEnds`, `shieldFx`, `shieldHit`, four each */
export const shieldStride = 12;

export type ShieldResources = ReturnType<typeof createShieldResources>;

export function createShieldResources() {
  const data = new Float32Array(MAX_SHIELDS * shieldStride);
  const buffer = new THREE.InstancedInterleavedBuffer(data, shieldStride).setUsage(THREE.DynamicDrawUsage);
  /** `x` runs along it and `y` up it, each `0` to `1` */
  const base = new THREE.PlaneGeometry(1, 1).translate(0.5, 0.5, 0);
  const geo = new THREE.InstancedBufferGeometry();
  geo.setAttribute("position", base.getAttribute("position"));
  geo.setIndex(base.getIndex());
  ["shieldEnds", "shieldFx", "shieldHit"].forEach((key, i) =>
    geo.setAttribute(key, new THREE.InterleavedBufferAttribute(buffer, 4, i * 4)),
  );
  geo.instanceCount = 0;

  // additive over a dark floor — `Shields.syncTheme` lays it over a pale one instead
  const mat = new THREE.MeshBasicNodeMaterial({
    transparent: true,
    depthWrite: false,
    forceSinglePass: true,
    side: THREE.DoubleSide,
    ...addedBlending,
  });
  const mesh = new THREE.Mesh(geo, mat);
  /** Its frame is laid OVER what is behind, being dark, and writes depth: its near bars hide its far ones */
  const frameMat = new THREE.MeshBasicNodeMaterial({
    transparent: true,
    forceSinglePass: true,
    side: THREE.DoubleSide,
  });
  const frameGeo = new THREE.InstancedBufferGeometry().copy(createFrameGeometry() as THREE.InstancedBufferGeometry);
  ["shieldEnds", "shieldFx"].forEach((key, i) =>
    frameGeo.setAttribute(key, new THREE.InterleavedBufferAttribute(buffer, 4, i * 4)),
  );
  frameGeo.instanceCount = 0;
  const frameMesh = new THREE.Mesh(frameGeo, frameMat);
  for (const m of [mesh, frameMesh]) {
    m.frustumCulled = false;
    m.visible = false;
  }
  // the frame first: it writes depth, which the field is then tested against
  [frameMesh.renderOrder, mesh.renderOrder] = [3.4, 3.5];

  return {
    mesh,
    mat,
    frameMesh,
    frameMat,
    data,
    buffer,
    color: uniform(new THREE.Color(shaderConfig.color)),
    /** How far in its hatching is, `0` to `1`: out and back in again, as the world ticks */
    fade: uniform(1),
    /** From `theme.npcs.fxStrength` */
    gain: uniform(1),
    /** …and of the glow round a beam, apart: `paleGain` would make a solid disc of it */
    glowGain: uniform(1),
    /** `1` whilst added to a dark deck, `0` laid over a pale one */
    added: uniform(1),
    /** Alpha all over, by theme */
    fill: uniform(shaderConfig.fill),
    /** Metres, by theme */
    lineWidth: uniform(shaderConfig.lineWidth),
  };
}

/**
 * Four bars round a shield's edge. `position` is which side and level each corner is pinned to, `0` or `1`,
 * then its depth in metres; `shieldBar` the metres in from there — so a bar is as wide on any length of shield
 */
function createFrameGeometry() {
  const { rim, frameDepth } = shaderConfig;
  /** A bar's two ends each way: `[pinned to, metres in]` */
  type End = [number, number];
  const bar = (a0: End, a1: End, u0: End, u1: End) => {
    const box = new THREE.BoxGeometry(1, 1, 1);
    const at = box.getAttribute("position");
    const inset = new Float32Array(at.count * 2);
    for (let i = 0; i < at.count; i++) {
      const [along, up] = [at.getX(i) > 0 ? a1 : a0, at.getY(i) > 0 ? u1 : u0];
      inset.set([along[1], up[1]], i * 2);
      at.setXYZ(i, along[0], up[0], at.getZ(i) * frameDepth);
    }
    box.setAttribute("shieldBar", new THREE.BufferAttribute(inset, 2));
    box.deleteAttribute("uv");
    return box;
  };
  // biome-ignore format: a bar a row
  return mergeGeometries([
    bar([0, 0], [0, rim], [0, 0], [1, 0]),
    bar([1, -rim], [1, 0], [0, 0], [1, 0]),
    bar([0, rim], [1, -rim], [0, 0], [0, rim]),
    bar([0, rim], [1, -rim], [1, -rim], [1, 0]),
  ]);
}

/** Colour and alpha both summed: the shader premultiplies, and gives its coverage as alpha */
export const addedBlending = {
  blending: THREE.CustomBlending,
  blendSrc: THREE.OneFactor,
  blendDst: THREE.OneFactor,
  blendSrcAlpha: THREE.OneFactor,
  blendDstAlpha: THREE.OneFactor,
} as const;

type ShieldView = {
  objectPick: THREE.UniformNode<"float", number>;
  foldNode: THREE.UniformNode<"float", number>;
  fadeRoomsFx: FadeRooms;
};

/**
 * A shield, by instance: its ends `a` then `b` in the plan; its room's slot, then whether it is on;
 * where a beam meets it, in metres along and up, and how strongly
 */
function shieldBase(view: ShieldView, frame = false) {
  const c = shaderConfig;
  const ends = attribute<"vec4">("shieldEnds", "vec4");
  const fx = attribute<"vec4">("shieldFx", "vec4");

  const [dx, dz]: THREE.Node<"float">[] = [ends.z.sub(ends.x), ends.w.sub(ends.y)];
  const length: THREE.Node<"float"> = dx.mul(dx).add(dz.mul(dz)).sqrt();
  /** A bar's corner is pinned to a side and a level, then set in from there */
  const bar = attribute<"vec2">("shieldBar", "vec2");
  const along: THREE.Node<"float"> = frame ? positionLocal.x.mul(length).add(bar.x) : positionLocal.x.mul(length);
  const up: THREE.Node<"float"> = frame ? positionLocal.y.mul(wallHeight).add(bar.y) : positionLocal.y.mul(wallHeight);
  /** Metres out of its plane, along `(-dz, dx)`: only a bar has any */
  const out: THREE.Node<"float"> = frame ? positionLocal.z.div(length) : float(0);
  const t = along.div(length);
  const p = vec3(ends.x.add(dx.mul(t)).sub(dz.mul(out)), up, ends.y.add(dz.mul(t)).add(dx.mul(out)));
  const vertexNode = cameraProjectionMatrix.mul(cameraViewMatrix.mul(vec4(p, 1)));

  // floats apiece: a vector of them is TS2590, "too complex to represent"
  const vAlong = varying(along, frame ? "vFrameAlong" : "vShieldAlong");
  const vUp = varying(up, frame ? "vFrameUp" : "vShieldUp");
  const vSeen = varying(view.fadeRoomsFx.getVisiblity(fx.x), frame ? "vFrameSeen" : "vShieldSeen");
  /** How much of itself it is, on or off */
  const vStrength = varying(fx.y.mul(c.on - c.off).add(c.off), frame ? "vFrameStrength" : "vShieldStrength");
  const vLength = varying(length, frame ? "vFrameLength" : "vShieldLength");
  /** Metres in from its nearest edge */
  const inset = vAlong.min(vLength.sub(vAlong)).min(vUp).min(float(wallHeight).sub(vUp));
  return { vertexNode, vAlong, vUp, vSeen, vStrength, inset };
}

/** Its frame: plain dark bars, the same over any deck */
export function shieldFrameNodes(view: ShieldView) {
  const c = shaderConfig;
  const { vertexNode, vSeen } = shieldBase(view, true);
  /** `1` on its two faces, `0` round its thickness — which catches a little light */
  const vFace = varying(normalLocal.z.abs(), "vFrameFace");
  const [metal, light] = [c.frameColor, c.frameLine].map((hex) => vec3(...new THREE.Color(hex).toArray()));

  const colorNode = Fn(() => {
    const a = view.objectPick.notEqual(0).select(0, vSeen.mul(c.frameAlpha).mul(view.foldNode));
    Discard(a.lessThan(1 / 512));
    return vec4(mix(metal, light, vFace.oneMinus().mul(c.frameSide)), a);
  })();

  return { vertexNode, colorNode };
}

/** Its field, within the frame */
export function shieldNodes(res: ShieldResources, view: ShieldView) {
  const { color, gain, glowGain, lineWidth, added, fill, fade } = res;
  const c = shaderConfig;
  const { vertexNode, vAlong, vUp, vSeen, vStrength, inset } = shieldBase(view);
  const hit = attribute<"vec4">("shieldHit", "vec4");
  const [vHitAlong, vHitUp, vHit, vStruck] = [hit.x, hit.y, hit.z, hit.w].map((n, i) => varying(n, `vShieldHit${i}`));

  const colorNode = Fn(() => {
    const rim = smoothstep(float(c.rim), float(c.rim - 0.004), inset);

    // the field it holds: slanted lines, which stand out from a ship that is all uprights and levels
    const slant = fract(vAlong.add(vUp).div(c.hatchGap));
    // …fading right out and back in, but up in full whilst fired on
    const hatching = smoothstep(lineWidth.div(c.hatchGap), float(0), slant.min(slant.oneMinus())).mul(
      fade.max(vStruck),
    );
    // …when all of it is less seen through, for a while
    const face = fill.add(hatching.mul(c.grid)).add(vStruck.mul(c.struckFill)).mul(rim.oneMinus()).mul(vStrength);

    // a beam on it
    const [hx, hy] = [vAlong.sub(vHitAlong), vUp.sub(vHitUp)];
    const near = smoothstep(float(c.glowRadius), float(0), hx.mul(hx).add(hy.mul(hy)).sqrt());
    const glow = near.mul(near).mul(vHit).mul(c.glow); // squared: it thins out early, with no rim

    const a = view.objectPick
      .notEqual(0)
      .select(0, vSeen.mul(face.mul(gain).add(glow.mul(glowGain)).min(1)).mul(view.foldNode));
    Discard(a.lessThan(1 / 512));
    // added, its colour comes premultiplied and its alpha is COVERAGE: the post pass drops what little
    // is drawn over nothing, e.g. before a room out of sight, so its lines must count as drawn there
    return vec4(mix(color, color.mul(a), added), mix(a, a.mul(c.coverage).min(1), added));
  })();

  return { vertexNode, colorNode };
}

export const shaderConfig = {
  color: "#ffffff",
  /** Laid over a pale deck, where nothing can be added: dark, as white would not show */
  paleColor: "#15181c",
  /** Its frame: metres wide, how solid, its metal, and the lighter metal of its sides */
  rim: 0.07,
  frameAlpha: 0.92,
  frameColor: "#0d0f12",
  frameLine: "#3a414b",
  /** Metres thick, and how far towards its lines' colour that thickness is lit */
  frameDepth: 0.05,
  frameSide: 0.35,
  /** Its field's hatching: `hatchGap` metres between its slanted lines, measured along it */
  hatchGap: 0.14,
  /** Seconds its hatching takes to fade out and back in */
  hatchFadeSecs: 4,
  /** …and how much stronger it is drawn there: laid over, it shows far less than added */
  paleGain: 14,
  /** …and how much of itself it is over a dark one */
  darkGain: 0.3,
  /** Alpha all over its field, then of the field's lines, `lineWidth` metres wide */
  fill: 0.03,
  /** …none over a pale deck: lines alone, so it is clear yet seen through */
  paleFill: 0,
  grid: 0.22,
  lineWidth: 0.012,
  /** …wider over a pale deck, where a thin dark line is lost */
  paleLineWidth: 0.013,
  /** How much of that it keeps whilst on, then off */
  on: 0.25,
  off: 0.04,
  /** How many times its alpha it counts as drawn, where nothing else is */
  coverage: 30,
  /** Alpha all over its field whilst fired on, as its lines come up in full */
  struckFill: 0.12,
  /** Round a beam: how bright, and how far in metres */
  glow: 0.18,
  /** …and how much of that over a pale deck, where it is a dark smudge */
  paleGlow: 0.9,
  glowRadius: 0.22,
} as const;
