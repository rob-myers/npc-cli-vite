import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import {
  attribute,
  cameraProjectionMatrix,
  cameraViewMatrix,
  cross,
  Discard,
  Fn,
  float,
  fwidth,
  mix,
  normalize,
  normalLocal,
  positionLocal,
  smoothstep,
  uniform,
  uv,
  varying,
  vec3,
  vec4,
} from "three/tsl";
import * as THREE from "three/webgpu";
import { type PhaserUniforms, type PhaserView, seenBy } from "./phaser.shader";
import { attachmentBoxes, type GunBox, gunAttachments, gunBoxes, gunKindIndex, gunStripY } from "./phaser-gun";

export const MAX_PHASERS = 128;

export type GunResources = ReturnType<typeof createGunResources>;

/** One instance per gun shown, held along its npc's right forearm */
export function createGunResources() {
  /** The right forearm's origin, and its world scale by the gun's eased presence — then its world quaternion */
  const gunData = new Float32Array(MAX_PHASERS * 4);
  const quatData = new Float32Array(MAX_PHASERS * 4);
  /** Its npc's room slot, whether they are lit, and its attachment's index from `1`, else `0` */
  const roomData = new Float32Array(MAX_PHASERS * 3);
  /** Its beam's colour, then its glow as it charges or cools */
  const tintData = new Float32Array(MAX_PHASERS * 4);
  const attrs = [gunData, quatData, roomData, tintData].map((data) =>
    new THREE.InstancedBufferAttribute(data, data.length / MAX_PHASERS).setUsage(THREE.DynamicDrawUsage),
  );

  /** Each vertex's box: its kind as `gunKindIndex`, its tone, and its attachment's index from `1`, else `0` */
  const boxed = ({ min, max, kind, tone }: GunBox, attachment: number) => {
    const geo = new THREE.BoxGeometry(max[0] - min[0], max[1] - min[1], max[2] - min[2]).translate(
      (min[0] + max[0]) / 2,
      (min[1] + max[1]) / 2,
      (min[2] + max[2]) / 2,
    );
    const count = geo.getAttribute("position").count;
    const data = new Float32Array(3 * count).map((_, i) => [gunKindIndex[kind], tone, attachment][i % 3]);
    return geo.setAttribute("phaserBox", new THREE.BufferAttribute(data, 3));
  };
  const base = mergeGeometries([
    ...gunBoxes.map((box) => boxed(box, 0)),
    ...gunAttachments.flatMap((key, i) => attachmentBoxes[key].map((box) => boxed(box, i + 1))),
  ]);

  const geo = new THREE.InstancedBufferGeometry();
  for (const key of ["position", "normal", "uv", "phaserBox"]) geo.setAttribute(key, base.getAttribute(key));
  geo.setIndex(base.getIndex());
  ["phaserGun", "phaserQuat", "gunRooms", "gunTint"].forEach((key, i) => geo.setAttribute(key, attrs[i]));
  geo.instanceCount = 0;

  // opaque, else drawn after the walls and over them
  const mat = new THREE.MeshBasicNodeMaterial();
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = +5;

  return {
    mesh,
    mat,
    attrs,
    gunData,
    quatData,
    roomData,
    tintData,
    gunColor: uniform(new THREE.Color(gunShaderConfig.gunColor)),
    slotColor: uniform(new THREE.Color(gunShaderConfig.slotColor)),
    deadColor: uniform(new THREE.Color(gunShaderConfig.deadColor)),
  };
}

/** The gun, held along the forearm */
export function gunNodes({ gunColor, slotColor, deadColor }: GunResources, { gain }: PhaserUniforms, view: PhaserView) {
  const { edgePx, edgeDarken, chargeBody, chargeEmitter, stripArmed, stripFull } = gunShaderConfig;
  const gun = attribute<"vec4">("phaserGun", "vec4");
  const quat = attribute<"vec4">("phaserQuat", "vec4");
  /** `v` turned by the forearm's quaternion */
  const turned = (v: THREE.Node<"vec3">) => {
    const inner = cross(quat.xyz, v).add(v.mul(quat.w)) as THREE.Node<"vec3">;
    return v.add(cross(quat.xyz, inner).mul(2)) as THREE.Node<"vec3">;
  };
  const rooms = attribute<"vec3">("gunRooms", "vec3");
  const box = attribute<"vec3">("phaserBox", "vec3");
  /** `0` for another attachment's box, collapsed to nothing */
  const fitted = box.z.equal(0).or(box.z.equal(rooms.z)).select(1, 0);
  const p = gun.xyz.add(turned(positionLocal.mul(gun.w.abs()).mul(fitted) as THREE.Node<"vec3">));
  const vertexNode = cameraProjectionMatrix.mul(cameraViewMatrix.mul(vec4(p, 1)));

  const vSeen = varying(seenBy(view)(rooms.x, rooms.y), "vGunSeen");
  const glow = box.x.equal(gunKindIndex.emitter).select(1, 0) as THREE.Node<"float">;
  const vGlow = varying<"float">(glow, "vGunGlow");
  const vStrip = varying<"float">(box.x.equal(gunKindIndex.strip).select(1, 0) as THREE.Node<"float">, "vGunStrip");
  const vTone = varying<"float">(box.y, "vGunTone");
  /** How far along the strip from its back, which a charge fills to */
  const vStripT = varying<"float">(
    positionLocal.y.sub(gunStripY[0]).div(gunStripY[1] - gunStripY[0]) as THREE.Node<"float">,
    "vGunStripT",
  );
  const tint = attribute<"vec4">("gunTint", "vec4");
  const charge = tint.w;
  const vTint = varying(tint.xyz, "vGunTint");
  /** Armed, its quaternion's `w` is positive: `q` and `-q` turn alike */
  const vArmed = varying<"float">(quat.w.greaterThan(0).select(1, 0) as THREE.Node<"float">, "vGunArmed");
  /** A dead one's scale is negative */
  const vDead = varying<"float">(gun.w.lessThan(0).select(1, 0) as THREE.Node<"float">, "vGunDead");
  /** Lit from above, so its faces tell apart */
  const lit = turned(normalLocal as THREE.Node<"vec3">).dot(normalize(vec3(0.3, 1, 0.2)));
  const vShade = varying(lit.mul(0.3).add(0.7), "vGunShade");
  const vCharge = varying<"float">(charge, "vGunCharge");
  /** How much of the beam's colour it gains as it charges: its emitter most. Per vertex, as each box is one or other */
  const vCharged = varying<"float">(
    charge.mul(mix(float(chargeBody), float(chargeEmitter), glow)).mul(vStrip.oneMinus()),
    "vGunCharged",
  );
  const colorNode = Fn(() => {
    const a = view.objectPick.notEqual(0).select(0, vSeen.mul(view.foldNode));
    Discard(a.lessThan(1 / 512));
    // each face edged in a darker line, a constant few pixels wide: `uv` runs `0` to `1` across a box's face
    const face = uv();
    const fromEdge = face.min(face.oneMinus()).div(fwidth(face).max(1e-6));
    const edge = smoothstep(edgePx - 0.5, edgePx + 0.5, fromEdge.x.min(fromEdge.y)).oneMinus();
    const beamColor = vTint.mul(gain.min(1));
    const emitter = mix(mix(gunColor, deadColor, vDead).mul(vShade), beamColor, vArmed);
    /** Dark, faintly lit whilst armed, and filled from the back by the charge */
    const slot = mix(slotColor, beamColor, vArmed.mul(vDead.oneMinus()).mul(stripArmed)).mul(vShade);
    const filled = smoothstep(vStripT.sub(0.04), vStripT, vCharge);
    const strip = mix(slot, beamColor.mul(stripFull), filled);
    const shell = mix(gunColor.mul(vShade).mul(vTone), emitter, vGlow);
    const body = mix(shell, strip, vStrip).add(beamColor.mul(vCharged));
    // opaque, so it fades to black as the body does
    return vec4(body.mul(edge.mul(edgeDarken).oneMinus()).mul(a), 1);
  })();

  return { vertexNode, colorNode };
}

export const gunShaderConfig = {
  /** Pixels of darker line along each of the gun's edges, and how far it darkens */
  edgePx: 1,
  edgeDarken: 0.6,
  gunColor: "#5f6875",
  paleGunColor: "#7d8591",
  /** The strip along its side: dark, `stripArmed` of the beam's colour whilst armed, `stripFull` times it where charged */
  slotColor: "#2e353f",
  stripArmed: 0.45,
  stripFull: 1.3,
  /** Its emitter, deactivated */
  deadColor: "#3d7fd9",
  /** Charging, how much of the beam's colour the gun gains: its body, and its emitter */
  chargeBody: 0.25,
  chargeEmitter: 1.2,
} as const;
