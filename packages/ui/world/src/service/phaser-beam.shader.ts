import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import {
  attribute,
  cameraProjectionMatrix,
  cameraViewMatrix,
  cross,
  Discard,
  Fn,
  float,
  fract,
  mix,
  normalize,
  positionLocal,
  smoothstep,
  varying,
  vec3,
  vec4,
} from "three/tsl";
import * as THREE from "three/webgpu";
import { type PhaserUniforms, type PhaserView, seenBy } from "./phaser.shader";

export const MAX_BEAM_SEGMENTS = 512;

export type BeamResources = ReturnType<typeof createBeamResources>;

/** One instance per beam segment shown, from its start to its end, with its ball there */
export function createBeamResources() {
  const { sides, segments } = beamShaderConfig;
  /** Its start and eased shown, its end and eased locked */
  const srcData = new Float32Array(MAX_BEAM_SEGMENTS * 4);
  const dstData = new Float32Array(MAX_BEAM_SEGMENTS * 4);
  /** Each end's npc's room slot, then whether they are lit — they fade with it as the npcs do */
  const roomData = new Float32Array(MAX_BEAM_SEGMENTS * 4);
  /** The charge its shot was fired with */
  const firedData = new Float32Array(MAX_BEAM_SEGMENTS);
  const attrs = [srcData, dstData, roomData, firedData].map((data) =>
    new THREE.InstancedBufferAttribute(data, data.length / MAX_BEAM_SEGMENTS).setUsage(THREE.DynamicDrawUsage),
  );

  /** Unit ring about `y`, open-ended: `y + 0.5` is how far along the beam */
  const beam = new THREE.CylinderGeometry(1, 1, 1, sides, segments, true);
  const ball = new THREE.SphereGeometry(1, sides * 2, sides);
  const base = mergeGeometries([beam, ball], true); // a group apiece: beam, then ball

  const geo = new THREE.InstancedBufferGeometry();
  for (const key of ["position", "normal", "uv"]) geo.setAttribute(key, base.getAttribute(key));
  geo.setIndex(base.getIndex());
  for (const { start, count, materialIndex } of base.groups) geo.addGroup(start, count, materialIndex);
  ["beamSrc", "beamDst", "beamRooms", "beamFired"].forEach((key, i) => geo.setAttribute(key, attrs[i]));
  geo.instanceCount = 0;

  // additive, glowing over a dark floor — `Phasers.syncTheme` lays them over a pale one instead
  const glowOpts = { depthWrite: false, forceSinglePass: true, blending: THREE.AdditiveBlending };
  const mats = [
    new THREE.MeshBasicNodeMaterial({ transparent: true, ...glowOpts, side: THREE.DoubleSide }),
    // seen through whomever it is in, e.g. a body part targeted from their far side
    new THREE.MeshBasicNodeMaterial({ transparent: true, ...glowOpts, depthTest: false }),
  ];
  const mesh = new THREE.Mesh(geo, mats);
  mesh.frustumCulled = false;
  mesh.renderOrder = +5;

  return { mesh, mats, attrs, srcData, dstData, roomData, firedData };
}

/** The beam's nodes, else with `tip` its end's ball */
export function beamNodes({ phase, color, gain, faint }: PhaserUniforms, view: PhaserView, tip: boolean) {
  const { radius, tipRadius, solid, nearMetres, bands, chargeWiden, chargeBright } = beamShaderConfig;
  const src = attribute<"vec4">("beamSrc", "vec4");
  const dst = attribute<"vec4">("beamDst", "vec4");
  const [shown, locked] = [src.w, dst.w];
  /** The charge it was fired with */
  const fired = attribute<"float">("beamFired", "float");
  const t = tip ? float(1) : positionLocal.y.add(0.5);

  const d = dst.xyz.sub(src.xyz);
  const side = normalize(vec3(d.z.negate(), 0, d.x).add(vec3(1e-4, 0, 0)));
  const normal = normalize(cross(side, d));
  const across = side.mul(positionLocal.x).add(normal.mul(positionLocal.z));
  const offset = (
    tip ? across.add(normalize(d).mul(positionLocal.y)).mul(locked.mul(tipRadius)) : across.mul(radius)
  ).mul(fired.mul(chargeWiden).add(1));
  const p = mix(src.xyz, dst.xyz, t).add(offset.mul(shown));
  const vertexNode = cameraProjectionMatrix.mul(cameraViewMatrix.mul(vec4(p, 1)));

  const rooms = attribute<"vec4">("beamRooms", "vec4");
  const seen = seenBy(view);
  /** As their npcs are: the ball the target, the beam each end nearer it */
  const vSeen = varying(
    tip ? seen(rooms.y, rooms.w) : mix(seen(rooms.x, rooms.z), seen(rooms.y, rooms.w), t.mul(locked)),
    tip ? "vBallSeen" : "vBeamSeen",
  );
  const vShown = varying(shown, tip ? "vBallShown" : "vBeamShown");
  const vLocked = varying(locked, tip ? "vBallLocked" : "vBeamLocked");
  /** Its alpha's gain by the charge it was fired with */
  const vFired = varying(fired.mul(chargeBright).add(1), tip ? "vBallFired" : "vBeamFired");
  const along = varying(t, tip ? "vBallT" : "vBeamT");
  /** Metres short of the end, where the beam meets the body part */
  const toEnd = varying(t.oneMinus().mul(d.length()), tip ? "vBallToEnd" : "vBeamToEnd");
  const colorNode = Fn(() => {
    const flow = smoothstep(0.6, 1, fract(along.mul(bands).sub(phase)))
      .mul(0.5)
      .add(0.5); // pulses towards the target
    /** Faint and pulsing on the way, solid as it nears the part */
    const lockedOn = mix(flow.mul(faint), float(solid), smoothstep(0, nearMetres, toEnd).oneMinus());
    const body = tip ? float(solid) : lockedOn.mul(vLocked);
    const bright = body.mul(gain).mul(vFired).min(1);
    const a = view.objectPick.notEqual(0).select(0, vShown.mul(vSeen).mul(bright).mul(view.foldNode));
    Discard(a.lessThan(1 / 512));
    return vec4(color, a);
  })();

  return { vertexNode, colorNode };
}

export const beamShaderConfig = {
  /** Metres of radius of the beam, and of the ball at its end */
  radius: 0.01,
  tipRadius: 0.035,
  /** A full charge widens the beam and ball by `1 + chargeWiden`, and its alpha by `1 + chargeBright` */
  chargeWiden: 1.5,
  chargeBright: 0.6,
  /** The beam's alpha within `nearMetres` of the body part */
  solid: 0.9,
  nearMetres: 0.25,
  /** Pulses along the beam, drifting towards the target a band per second */
  bands: 4,
  sides: 6,
  segments: 24,
} as const;
