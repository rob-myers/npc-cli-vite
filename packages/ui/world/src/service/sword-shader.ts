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
import type { FadeRooms } from "./fade-rooms";

export const MAX_SWORDS = 128;

export type SwordResources = ReturnType<typeof createSwordResources>;

export function createSwordResources() {
  const { sides, segments } = swordConfig;
  // the hand's tip and eased shown, the end and eased locked
  const srcData = new Float32Array(MAX_SWORDS * 4);
  const dstData = new Float32Array(MAX_SWORDS * 4);
  /** Each end's npc's room slot, then whether they are lit — they fade with it as the npcs do */
  const roomData = new Float32Array(MAX_SWORDS * 4);
  const attrs = [srcData, dstData, roomData].map((data) =>
    new THREE.InstancedBufferAttribute(data, 4).setUsage(THREE.DynamicDrawUsage),
  );
  const toMesh = (base: THREE.BufferGeometry, opts: THREE.MeshBasicNodeMaterialParameters) => {
    const geo = new THREE.InstancedBufferGeometry();
    geo.setAttribute("position", base.getAttribute("position"));
    geo.setIndex(base.getIndex());
    geo.setAttribute("swordSrc", attrs[0]);
    geo.setAttribute("swordDst", attrs[1]);
    geo.setAttribute("swordRooms", attrs[2]);
    geo.instanceCount = 0;
    const mat = new THREE.MeshBasicNodeMaterial({
      transparent: true,
      depthWrite: false,
      forceSinglePass: true,
      blending: THREE.AdditiveBlending,
      ...opts,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false;
    return mesh;
  };

  /** Unit ring about `y`, open-ended: `y + 0.5` is how far along the rope */
  const tube = toMesh(new THREE.CylinderGeometry(1, 1, 1, sides, segments, true), { side: THREE.DoubleSide });
  /** Seen through whomever it is in, e.g. a body part targeted from their far side — so only whilst locked on */
  const ball = toMesh(new THREE.SphereGeometry(1, sides * 2, sides), { depthTest: false });
  tube.renderOrder = +5;
  ball.renderOrder = +6;
  const group = new THREE.Group().add(tube, ball);

  return { tube, ball, group, attrs, srcData, dstData, roomData, phase: uniform(0) };
}

/** The rope's nodes, else with `tip` its end's ball */
export function swordNodes(
  { phase }: SwordResources,
  {
    objectPick,
    foldNode,
    fadeRoomsFx,
    litNpcsEnabled,
  }: {
    objectPick: THREE.UniformNode<"float", number>;
    foldNode: THREE.UniformNode<"float", number>;
    fadeRoomsFx: FadeRooms;
    litNpcsEnabled: THREE.UniformNode<"float", number>;
  },
  tip: boolean,
) {
  const { radius, tipRadius, alpha, faint, solid, nearMetres, bands, color } = swordConfig;
  const src = attribute<"vec4">("swordSrc", "vec4");
  const dst = attribute<"vec4">("swordDst", "vec4");
  const [shown, locked] = [src.w, dst.w];
  const t = tip ? float(1) : positionLocal.y.add(0.5);

  const d = dst.xyz.sub(src.xyz);
  const side = normalize(vec3(d.z.negate(), 0, d.x).add(vec3(1e-4, 0, 0)));
  const normal = normalize(cross(side, d));
  const across = side.mul(positionLocal.x).add(normal.mul(positionLocal.z));
  const offset = tip ? across.add(normalize(d).mul(positionLocal.y)).mul(locked.mul(tipRadius)) : across.mul(radius);
  const p = mix(src.xyz, dst.xyz, t).add(offset.mul(shown));
  const vertexNode = cameraProjectionMatrix.mul(cameraViewMatrix.mul(vec4(p, 1)));

  const rooms = attribute<"vec4">("swordRooms", "vec4");
  const seen = (slot: THREE.Node<"float">, lit: THREE.Node<"float">) =>
    fadeRoomsFx.getVisiblity(slot).max(lit.mul(litNpcsEnabled));
  /** As their npcs are: the ball the target, the rope each end nearer it */
  const vSeen = varying(
    tip ? seen(rooms.y, rooms.w) : mix(seen(rooms.x, rooms.z), seen(rooms.y, rooms.w), t.mul(locked)),
    "vSwordSeen",
  );
  const vShown = varying(shown, "vSwordShown");
  const vLocked = varying(locked, "vSwordLocked");
  const along = varying(t, "vSwordT");
  /** Metres short of the end, where a locked rope meets the body part */
  const toEnd = varying(t.oneMinus().mul(d.length()), "vSwordToEnd");
  const colorNode = Fn(() => {
    const flow = smoothstep(0.6, 1, fract(along.mul(bands).sub(phase)))
      .mul(0.5)
      .add(0.5); // pulses towards the target
    /** Faint and pulsing on the way, solid as it nears the part */
    const lockedOn = mix(flow.mul(faint), float(solid), smoothstep(0, nearMetres, toEnd).oneMinus());
    const body = tip ? float(solid) : mix(flow.mul(alpha), lockedOn, vLocked);
    const a = objectPick.notEqual(0).select(0, vShown.mul(vSeen).mul(body).mul(foldNode));
    Discard(a.lessThan(1 / 512));
    return vec4(uniform(new THREE.Color(color)), a);
  })();

  return { vertexNode, colorNode };
}
