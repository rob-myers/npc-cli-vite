import {
  attribute,
  cameraPosition,
  cameraProjectionMatrix,
  cameraViewMatrix,
  exp,
  max,
  mix,
  uniform,
  uv,
  varying,
  vec3,
  vec4,
} from "three/tsl";
import * as THREE from "three/webgpu";
import { armourConfig } from "../const.npc";
import { selectAs } from "./tsl";

export const MAX_ARMOUR_STREAKS = 96;

/** Per instance: where it starts and game seconds when, its way and metres a second, then its length, width, life and whiteness */
export const streakAttrs = ["streakFrom", "streakDir", "streakLook"] as const;

export type ArmourStreaks = {
  mesh: THREE.InstancedMesh;
  data: Record<(typeof streakAttrs)[number], Float32Array>;
  attrs: Record<(typeof streakAttrs)[number], THREE.InstancedBufferAttribute>;
  /** Game seconds now, so nothing is written whilst they fly */
  now: THREE.UniformNode<"float", number>;
};

/** Streaks flying from where armour took a shot: it glancing off, and sparks — see `NpcArmour` */
export function createArmourStreaks(objectPick: THREE.Node<"float">): ArmourStreaks {
  const geometry = new THREE.PlaneGeometry(1, 1);
  const data = {} as ArmourStreaks["data"];
  const attrs = {} as ArmourStreaks["attrs"];
  for (const key of streakAttrs) {
    data[key] = new Float32Array(MAX_ARMOUR_STREAKS * 4);
    attrs[key] = new THREE.InstancedBufferAttribute(data[key], 4).setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute(key, attrs[key]);
  }
  const now = uniform(0);
  const mesh = new THREE.InstancedMesh(geometry, createStreakMaterial(objectPick, now), MAX_ARMOUR_STREAKS);
  // after the phasers, else their beams are drawn over these
  Object.assign(mesh, { count: 0, visible: false, frustumCulled: false, renderOrder: 6 });
  mesh.raycast = () => {};
  return { mesh, data, attrs, now };
}

/** A ribbon facing the camera: its head flies out and slows, its tail a length behind, brightest at the head */
function createStreakMaterial(objectPick: THREE.Node<"float">, now: THREE.Node<"float">) {
  const { drag, bright } = armourConfig;
  const from = attribute<"vec4">("streakFrom", "vec4");
  const dir = attribute<"vec4">("streakDir", "vec4");
  const look = attribute<"vec4">("streakLook", "vec4");
  const age = now.sub(from.w);
  /** Metres its head has flown, slowing */
  const flown = dir.w.mul(exp(age.mul(-drag)).oneMinus()).div(drag);
  const along = mix(max(flown.sub(look.x), 0), flown, uv().x);
  const at = from.xyz.add(dir.xyz.mul(along));
  const side = dir.xyz.cross(cameraPosition.sub(at)).normalize();
  const world = at.add(side.mul(uv().y.sub(0.5).mul(look.y)));
  const clip = cameraProjectionMatrix.mul(cameraViewMatrix).mul(vec4(world, 1));
  const material = new THREE.MeshBasicNodeMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
  material.vertexNode = selectAs<"vec4">(objectPick.equal(0), clip, vec4(0, 0, 0, 1)); // a point whilst picking
  const fade = varying(age.div(look.z).clamp(0, 1).oneMinus().pow(1.5));
  material.colorNode = mix(uniform(new THREE.Color(armourConfig.color)), vec3(1), look.w);
  material.opacityNode = fade.mul(uv().x).mul(bright);
  return material;
}
