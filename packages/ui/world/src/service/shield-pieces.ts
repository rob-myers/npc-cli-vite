import {
  abs,
  attribute,
  cameraPosition,
  exp,
  float,
  hash,
  max,
  mix,
  mod,
  normalWorld,
  positionWorld,
  smoothstep,
  uniform,
  uv,
  varying,
  vec2,
  vec3,
  vec4,
} from "three/tsl";
import * as THREE from "three/webgpu";
import { shieldConfig } from "../const.npc";
import { selectAs } from "./tsl";

export const MAX_SHIELD_PIECES = 32;

/** A helmet for the head, a band round any other part */
export const pieceKinds = ["helmet", "band"] as const;
export type PieceKind = (typeof pieceKinds)[number];

export type ShieldPiece = {
  mesh: THREE.InstancedMesh;
  /** Per instance: where it was hit, in the unit piece, then seconds since */
  hitData: Float32Array;
  hitAttr: THREE.InstancedBufferAttribute;
};

/** An instanced mesh of unit pieces per kind, one material for all. Each instance rides a bone — see `NpcShields` */
export function createShieldPieces(objectPick: THREE.Node<"float">) {
  const material = createShieldMaterial(objectPick);
  const geometries = { helmet: helmetGeometry(), band: bandGeometry() };
  const pieces = {} as Record<PieceKind, ShieldPiece>;
  for (const kind of pieceKinds) {
    const hitData = new Float32Array(MAX_SHIELD_PIECES * 4);
    const hitAttr = new THREE.InstancedBufferAttribute(hitData, 4).setUsage(THREE.DynamicDrawUsage);
    geometries[kind].setAttribute("shieldHit", hitAttr);
    const mesh = new THREE.InstancedMesh(geometries[kind], material, MAX_SHIELD_PIECES);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.count = 0;
    mesh.visible = false;
    mesh.frustumCulled = false;
    mesh.renderOrder = 2;
    mesh.raycast = () => {};
    pieces[kind] = { mesh, hitData, hitAttr };
  }
  return pieces;
}

/** A hex lattice that spreads from the hit with a ring at its front, holds, then dissolves cell by cell */
function createShieldMaterial(objectPick: THREE.Node<"float">) {
  const { holdSecs, endSecs, spreadSpeed } = shieldConfig;
  const hit = attribute<"vec4">("shieldHit", "vec4");
  const age = hit.w;
  /** Per instance, so per vertex: the front's spread, the ring's strength, how dissolved, the impact's brightness */
  const timing = varying(
    vec4(
      age.mul(spreadSpeed),
      smoothstep(float(0.1), float(holdSecs), age).oneMinus(),
      age
        .sub(holdSecs)
        .mul(1 / (endSecs - holdSecs))
        .clamp(0, 1),
      exp(age.mul(-8)),
    ),
  );
  const [front, ringShown, gone, impactShown] = [timing.x, timing.y, timing.z, timing.w];
  /** Per vertex too: the pieces are smooth */
  const rim = varying(normalWorld.dot(cameraPosition.sub(positionWorld).normalize()).abs().oneMinus().pow(2));

  // `uv` is in cells
  const q = uv();
  const r = vec2(1, Math.sqrt(3));
  const h = vec2(0.5, Math.sqrt(3) / 2);
  const a = mod(q, r).sub(h);
  const b = mod(q.sub(h), r).sub(h);
  const g = selectAs<"vec2">(a.dot(a).lessThan(b.dot(b)), a, b);
  /** `0` at a cell's middle, `0.5` at its edge */
  const fromMiddle = max(abs(g.x), abs(g).dot(h));
  const edge = smoothstep(float(0.38), float(0.48), fromMiddle);
  const id = q.sub(g);
  const cell = hash(
    id.x
      .mul(2)
      .round()
      .mul(7919)
      .add(id.y.mul(2 / Math.sqrt(3)).round())
      .add(100000),
  );

  /** From the hit, in the unit piece: the instance's matrix is not in `position` */
  const d = attribute<"vec3">("position", "vec3").distance(hit.xyz);
  const reached = smoothstep(front.sub(0.2), front, d).oneMinus();
  const ring = smoothstep(float(0), float(0.1), d.sub(front).abs()).oneMinus().mul(ringShown);
  const kept = smoothstep(gone, gone.add(0.15), cell.mul(0.85).add(0.1));
  const impact = smoothstep(float(0), float(0.3), d).oneMinus().mul(impactShown);
  const lattice = edge.mul(0.85).add(rim.mul(0.4)).add(0.05).mul(reached).mul(kept);

  const material = new THREE.MeshBasicNodeMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
  material.colorNode = mix(uniform(new THREE.Color(shieldConfig.color)), vec3(1), impact);
  // nothing of it in a pick: additive, so an alpha of nought adds nothing
  material.opacityNode = lattice.add(ring.mul(0.7)).add(impact).mul(objectPick.equal(0).toFloat());
  return material;
}

/** A dome of radius `0.5` down past its middle, open below */
function helmetGeometry() {
  return inCells(new THREE.SphereGeometry(0.5, 36, 12, 0, Math.PI * 2, 0, Math.PI * 0.62), shieldConfig.cells.helmet);
}

/** A barrel of radius `0.5` at its middle, `1` long about `y`, open at both ends */
function bandGeometry() {
  const profile = Array.from({ length: 9 }, (_, i) => {
    const y = i / 8 - 0.5;
    return new THREE.Vector2(0.5 * (0.86 + 0.14 * Math.cos(Math.PI * y)), y);
  });
  return inCells(new THREE.LatheGeometry(profile, 32), shieldConfig.cells.band);
}

/** Scales `uv` to hex cells, round and along: a whole number round, so the lattice meets itself */
function inCells(geometry: THREE.BufferGeometry, [round, along]: [number, number]) {
  const attr = geometry.getAttribute("uv");
  for (let i = 0; i < attr.count; i++) attr.setXY(i, attr.getX(i) * round, attr.getY(i) * along);
  return geometry;
}
