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
  uniform,
  varying,
  vec3,
  vec4,
} from "three/tsl";
import * as THREE from "three/webgpu";
import { swordConfig } from "../const.npc";

export const MAX_SWORDS = 128;

export type SwordResources = ReturnType<typeof createSwordResources>;

export function createSwordResources() {
  // unit ring about `y`, open-ended: `y + 0.5` is how far along the rope
  const base = new THREE.CylinderGeometry(1, 1, 1, swordConfig.sides, swordConfig.segments, true);
  const geo = new THREE.InstancedBufferGeometry();
  geo.setAttribute("position", base.getAttribute("position"));
  geo.setIndex(base.getIndex());
  geo.instanceCount = 0;

  // the hand's tip and eased shown, the end and eased locked
  const srcData = new Float32Array(MAX_SWORDS * 4);
  const dstData = new Float32Array(MAX_SWORDS * 4);
  geo.setAttribute("swordSrc", new THREE.InstancedBufferAttribute(srcData, 4).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute("swordDst", new THREE.InstancedBufferAttribute(dstData, 4).setUsage(THREE.DynamicDrawUsage));
  const phase = uniform(0);

  const mat = new THREE.MeshBasicNodeMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    forceSinglePass: true,
    blending: THREE.AdditiveBlending,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = +5;

  return { geo, mat, mesh, srcData, dstData, phase };
}

export function swordNodes(
  { phase }: SwordResources,
  {
    objectPick,
    foldNode,
  }: { objectPick: THREE.UniformNode<"float", number>; foldNode: THREE.UniformNode<"float", number> },
) {
  const { r0, r1, alpha, faint, solid, nearMetres, bands, color } = swordConfig;
  const src = attribute<"vec4">("swordSrc", "vec4");
  const dst = attribute<"vec4">("swordDst", "vec4");
  const [shown, locked] = [src.w, dst.w];
  const t = positionLocal.y.add(0.5);

  const d = dst.xyz.sub(src.xyz);
  const onRope = mix(src.xyz, dst.xyz, t);
  const side = normalize(vec3(d.z.negate(), 0, d.x).add(vec3(1e-4, 0, 0)));
  const normal = normalize(cross(side, d));
  const radius = mix(float(r0), mix(float(r0), float(r1), locked), t.mul(t)).mul(shown);
  const p = onRope.add(side.mul(positionLocal.x).add(normal.mul(positionLocal.z)).mul(radius));
  const vertexNode = cameraProjectionMatrix.mul(cameraViewMatrix.mul(vec4(p, 1)));

  const along = varying(t, "vSwordT");
  const vShown = varying(shown, "vSwordShown");
  const vLocked = varying(locked, "vSwordLocked");
  /** Metres short of the end, where a locked rope meets the body part */
  const toEnd = varying(t.oneMinus().mul(d.length()), "vSwordToEnd");
  const colorNode = Fn(() => {
    const flow = smoothstep(0.6, 1, fract(along.mul(bands).sub(phase)))
      .mul(0.5)
      .add(0.5); // pulses towards the target
    /** A stub dies away at its tip */
    const stub = along.oneMinus().mul(flow).mul(alpha);
    /** Faint and pulsing on the way, solid as it nears the part */
    const lockedOn = mix(flow.mul(faint), float(solid), smoothstep(0, nearMetres, toEnd).oneMinus());
    const a = objectPick.notEqual(0).select(0, vShown.mul(mix(stub, lockedOn, vLocked)).mul(foldNode));
    Discard(a.lessThan(1 / 512));
    return vec4(uniform(new THREE.Color(color)), a);
  })();

  return { vertexNode, colorNode };
}
