import {
  attribute,
  cameraPosition,
  cameraProjectionMatrix,
  cameraViewMatrix,
  dot,
  exp,
  length,
  mix,
  modelWorldMatrix,
  normalWorld,
  positionGeometry,
  positionLocal,
  positionWorld,
  uniform,
  varying,
  vec3,
  vec4,
} from "three/tsl";
import * as THREE from "three/webgpu";
import { refractConfig } from "../const.npc";
import { selectAs } from "./tsl";

export const MAX_REFRACTS = 8;

export type Refracts = {
  /** Psi beams from their brows, a tube each */
  beams: THREE.InstancedMesh;
  /** Per beam: how bright */
  beamAlphas: THREE.InstancedBufferAttribute;
  /** A band round each head, a radius `1` ring about its `y`, and how bright */
  bands: THREE.InstancedMesh;
  bandAlphas: THREE.InstancedBufferAttribute;
  /** A glow where each meets the shot: its middle, and how bright */
  flares: THREE.InstancedMesh;
  flareAt: THREE.InstancedBufferAttribute;
  /** What a tick writes, sent in its range */
  uploads: THREE.BufferAttribute[];
};

/** Psi beams that refract a shot, and the glow where they meet it — see `NpcRefract` */
export function createRefracts(objectPick: THREE.Node<"float">): Refracts {
  // a radius `1` and `1` long, from `y` 0
  const tube = new THREE.CylinderGeometry(1, 1, 1, 8, 1, true).translate(0, 0.5, 0);
  const beamAlphas = new THREE.InstancedBufferAttribute(new Float32Array(MAX_REFRACTS), 1).setUsage(
    THREE.DynamicDrawUsage,
  );
  tube.setAttribute("beamAlpha", beamAlphas);
  const material = createBeamMaterial(objectPick);
  const beams = new THREE.InstancedMesh(tube, material, MAX_REFRACTS);
  // after the phasers, else their beams are drawn over these
  Object.assign(beams, { count: 0, visible: false, frustumCulled: false, renderOrder: 6 });
  beams.raycast = () => {};

  // the beam's look, its alpha by the same name
  const { radius, thick } = refractConfig.band;
  const ring = new THREE.TorusGeometry(1, thick / radius, 4, 32).rotateX(Math.PI / 2);
  const bandAlphas = new THREE.InstancedBufferAttribute(new Float32Array(MAX_REFRACTS), 1).setUsage(
    THREE.DynamicDrawUsage,
  );
  ring.setAttribute("beamAlpha", bandAlphas);
  const bands = new THREE.InstancedMesh(ring, material, MAX_REFRACTS);
  Object.assign(bands, { count: 0, visible: false, frustumCulled: false, renderOrder: 6 });
  bands.raycast = () => {};

  const quad = new THREE.PlaneGeometry(2, 2);
  const flareAt = new THREE.InstancedBufferAttribute(new Float32Array(MAX_REFRACTS * 4), 4).setUsage(
    THREE.DynamicDrawUsage,
  );
  quad.setAttribute("flareAt", flareAt);
  const flares = new THREE.InstancedMesh(quad, createFlareMaterial(objectPick), MAX_REFRACTS);
  Object.assign(flares, { count: 0, visible: false, frustumCulled: false, renderOrder: 6 });
  flares.raycast = () => {};
  const uploads = [beams.instanceMatrix, beamAlphas, bands.instanceMatrix, bandAlphas, flareAt];
  return { beams, beamAlphas, bands, bandAlphas, flares, flareAt, uploads };
}

const additive = (side: THREE.Side) =>
  new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side });

/** Brightest down its middle as seen, so round from any side: white at its core. Its near side alone */
function createBeamMaterial(objectPick: THREE.Node<"float">) {
  /** Worked out at its 16 corners, and eased between: its facets are narrow */
  const facing = varying(dot(normalWorld, cameraPosition.sub(positionWorld).normalize()).max(0));
  const facing2 = facing.mul(facing);
  const material = additive(THREE.FrontSide);
  const clip = cameraProjectionMatrix.mul(cameraViewMatrix).mul(modelWorldMatrix.mul(vec4(positionLocal, 1)));
  material.vertexNode = selectAs<"vec4">(objectPick.equal(0), clip, vec4(0, 0, 0, 1)); // a point whilst picking
  material.colorNode = mix(uniform(new THREE.Color(refractConfig.psiColor)), vec3(1), facing2.mul(facing2).mul(0.7));
  material.opacityNode = attribute<"float">("beamAlpha", "float").mul(facing.mul(facing.sqrt()));
  return material;
}

/** Facing the camera, white at its middle */
function createFlareMaterial(objectPick: THREE.Node<"float">) {
  const at = attribute<"vec4">("flareAt", "vec4");
  const r = length(positionGeometry.xy);
  const view = cameraViewMatrix.mul(vec4(at.xyz, 1));
  const clip = cameraProjectionMatrix.mul(view.add(vec4(positionGeometry.xy.mul(refractConfig.flareM), 0, 0)));
  const material = additive(THREE.DoubleSide);
  material.vertexNode = selectAs<"vec4">(objectPick.equal(0), clip, vec4(0, 0, 0, 1));
  /** `exp(-4r²)`, its cube the core's `exp(-12r²)` */
  const glow = exp(r.mul(r).mul(-4));
  material.colorNode = mix(uniform(new THREE.Color(refractConfig.psiColor)), vec3(1), glow.mul(glow).mul(glow));
  material.opacityNode = glow.mul(at.w);
  return material;
}
