import {
  attribute,
  cameraPosition,
  cameraProjectionMatrix,
  cameraViewMatrix,
  cross,
  Discard,
  Fn,
  float,
  fwidth,
  max,
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

export const MAX_IMPACTS = 64;

export type ImpactResources = ReturnType<typeof createImpactResources>;

/** One instance per impact still fading, where a shot landed */
export function createImpactResources() {
  /** Where it landed, and the game seconds it did */
  const atData = new Float32Array(MAX_IMPACTS * 4);
  /** The shot's way there, unit, and its size */
  const dirData = new Float32Array(MAX_IMPACTS * 4);
  /** Its colour, and its kind */
  const lookData = new Float32Array(MAX_IMPACTS * 4);
  /** Its room slot, and whether it is lit */
  const roomData = new Float32Array(MAX_IMPACTS * 2);
  const attrs = [atData, dirData, lookData, roomData].map((data) =>
    new THREE.InstancedBufferAttribute(data, data.length / MAX_IMPACTS).setUsage(THREE.DynamicDrawUsage),
  );

  /** A unit quad across `z`, the shot's way */
  const base = new THREE.PlaneGeometry(2, 2);
  const geo = new THREE.InstancedBufferGeometry();
  for (const key of ["position", "normal", "uv"]) geo.setAttribute(key, base.getAttribute(key));
  geo.setIndex(base.getIndex());
  ["impactAt", "impactDir", "impactLook", "impactRooms"].forEach((key, i) => geo.setAttribute(key, attrs[i]));
  geo.instanceCount = 0;

  // as the beams: added over a dark deck, laid over a pale one. Seen through whom it met, as the ball is
  const mat = new THREE.MeshBasicNodeMaterial({
    transparent: true,
    depthWrite: false,
    depthTest: false,
    forceSinglePass: true,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = +5;

  return { mesh, mat, attrs, atData, dirData, lookData, roomData };
}

type F = THREE.Node<"float">;

/** A ring across the shot's way, turned to the camera, widening and fading, a flash at its centre at first */
export function impactNodes({ phase, gain }: PhaserUniforms, view: PhaserView) {
  const cfg = impactShaderConfig;
  const at = attribute<"vec4">("impactAt", "vec4");
  const dir = attribute<"vec4">("impactDir", "vec4");
  const look = attribute<"vec4">("impactLook", "vec4");
  const rooms = attribute<"vec2">("impactRooms", "vec2");
  /** `0` as it lands, `1` as it is gone: `phase` is game seconds */
  const age = phase.sub(at.w).div(cfg.secs).clamp(0, 1);

  const way = normalize(dir.xyz.add(vec3(0, 0, 1e-5)));
  /** Its normal: the shot's way, turned mostly to the camera, so it is never seen edge on */
  const normal = normalize(mix(way, normalize(cameraPosition.sub(at.xyz)), cfg.faceCamera));
  const side = normalize(cross(normal, vec3(0, 1, 0)).add(vec3(1e-5, 0, 0)));
  const up = cross(side, normal);
  /** Widening quickly, then slowly */
  const r = mix(float(cfg.from), float(cfg.to), age.oneMinus().pow(3).oneMinus()).mul(dir.w);
  // a little back the way it came, so a wall does not cut it
  const centre = at.xyz.sub(way.mul(cfg.back));
  const p = centre.add(side.mul(positionLocal.x).add(up.mul(positionLocal.y)).mul(r));
  const vertexNode = cameraProjectionMatrix.mul(cameraViewMatrix.mul(vec4(p, 1)));

  const vAt = varying(positionLocal.xy, "vImpactAt");
  const vAge = varying(age as F, "vImpactAge");
  const vSeen = varying(seenBy(view)(rooms.x, rooms.y), "vImpactSeen");
  const vColor = varying(look.xyz, "vImpactColor");

  const colorNode = Fn(() => {
    const d = vAt.length();
    /** Its line, `px` pixels either side of the unit circle */
    const px = d.oneMinus().abs().div(fwidth(d).max(1e-6));
    const ring = smoothstep(cfg.px + 0.5, cfg.px - 0.5, px)
      .mul(vAge.oneMinus().pow(2))
      .mul(cfg.ringAlpha);
    const flash = smoothstep(1, 0, d)
      .pow(2)
      .mul(smoothstep(cfg.flashShare, 0, vAge))
      .mul(cfg.flashAlpha);
    const bright = max(ring, flash).mul(gain).min(1);
    const a = view.objectPick.notEqual(0).select(0, bright.mul(vSeen).mul(view.foldNode));
    Discard(a.lessThan(1 / 512));
    return vec4(vColor, a);
  })();

  return { vertexNode, colorNode };
}

export const impactShaderConfig = {
  /** Game seconds each lives */
  secs: 0.45,
  /** Metres of its radius as it lands and as it is gone, before its size */
  from: 0.02,
  to: 0.16,
  /** How far it turns from across the shot to face the camera */
  faceCamera: 0.75,
  /** Metres it sits back the way the shot came */
  back: 0.03,
  /** Pixels of its line's half-width, and its alpha */
  px: 1,
  ringAlpha: 0.85,
  /** Its centre's flash: the share of its life it lasts, and its alpha */
  flashShare: 0.35,
  flashAlpha: 0.9,
} as const;

/** Its size: on someone, and by a full charge besides */
export const impactSize = { onNpc: 1.5, chargeWiden: 1.5 } as const;
