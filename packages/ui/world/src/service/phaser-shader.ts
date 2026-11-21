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
import type { FadeRooms } from "./fade-rooms";
import { gunBoxes, gunKindIndex, gunStripY } from "./phaser-gun";

export const MAX_PHASERS = 128;

/** The mesh's parts, a geometry group and a material apiece, in this order */
export const phaserParts = ["gun", "beam", "ball"] as const;
export type PhaserPart = (typeof phaserParts)[number];

export type PhaserResources = ReturnType<typeof createPhaserResources>;

export function createPhaserResources() {
  const { sides, segments } = shaderConfig;
  // the muzzle and eased shown, the end and eased locked
  const srcData = new Float32Array(MAX_PHASERS * 4);
  const dstData = new Float32Array(MAX_PHASERS * 4);
  /** Each end's npc's room slot, then whether they are lit — they fade with it as the npcs do */
  const roomData = new Float32Array(MAX_PHASERS * 4);
  /** The right forearm's origin, and its world scale by the gun's eased presence — then its world quaternion */
  const gunData = new Float32Array(MAX_PHASERS * 4);
  const quatData = new Float32Array(MAX_PHASERS * 4);
  /** The gun's glow as it charges or cools, then the charge its shot was fired with */
  const chargeData = new Float32Array(MAX_PHASERS * 2);
  const attrs = [srcData, dstData, roomData, gunData, quatData, chargeData].map((data) =>
    new THREE.InstancedBufferAttribute(data, data === chargeData ? 2 : 4).setUsage(THREE.DynamicDrawUsage),
  );

  /** Each vertex's box: its kind as `gunKindIndex`, and its tone */
  const boxed = (geo: THREE.BufferGeometry, kind: number, tone: number) => {
    const count = geo.getAttribute("position").count;
    const data = new Float32Array(2 * count).map((_, i) => (i % 2 === 0 ? kind : tone));
    return geo.setAttribute("phaserBox", new THREE.BufferAttribute(data, 2));
  };
  const gun = mergeGeometries(
    gunBoxes.map(({ min, max, kind, tone }) =>
      boxed(
        new THREE.BoxGeometry(max[0] - min[0], max[1] - min[1], max[2] - min[2]).translate(
          (min[0] + max[0]) / 2,
          (min[1] + max[1]) / 2,
          (min[2] + max[2]) / 2,
        ),
        gunKindIndex[kind],
        tone,
      ),
    ),
  );
  /** Unit ring about `y`, open-ended: `y + 0.5` is how far along the beam */
  const beam = boxed(new THREE.CylinderGeometry(1, 1, 1, sides, segments, true), 0, 1);
  const ball = boxed(new THREE.SphereGeometry(1, sides * 2, sides), 0, 1);
  const base = mergeGeometries([gun, beam, ball], true); // a group apiece, as `phaserParts`

  const geo = new THREE.InstancedBufferGeometry();
  for (const key of ["position", "normal", "uv", "phaserBox"]) geo.setAttribute(key, base.getAttribute(key));
  geo.setIndex(base.getIndex());
  for (const { start, count, materialIndex } of base.groups) geo.addGroup(start, count, materialIndex);
  ["phaserSrc", "phaserDst", "phaserRooms", "phaserGun", "phaserQuat", "phaserCharge"].forEach((key, i) =>
    geo.setAttribute(key, attrs[i]),
  );
  geo.instanceCount = 0;

  // additive, glowing over a dark floor — `Phasers.syncTheme` lays them over a pale one instead
  const glowOpts = { depthWrite: false, forceSinglePass: true, blending: THREE.AdditiveBlending };
  const mats = [
    // opaque, else drawn after the walls and over them
    new THREE.MeshBasicNodeMaterial(),
    new THREE.MeshBasicNodeMaterial({ transparent: true, ...glowOpts, side: THREE.DoubleSide }),
    // seen through whomever it is in, e.g. a body part targeted from their far side
    new THREE.MeshBasicNodeMaterial({ transparent: true, ...glowOpts, depthTest: false }),
  ];
  const mesh = new THREE.Mesh(geo, mats);
  mesh.frustumCulled = false;
  mesh.renderOrder = +5;

  return {
    mesh,
    mats,
    attrs,
    srcData,
    dstData,
    roomData,
    gunData,
    quatData,
    chargeData,
    phase: uniform(0),
    color: uniform(new THREE.Color(shaderConfig.color)),
    gunColor: uniform(new THREE.Color(shaderConfig.gunColor)),
    slotColor: uniform(new THREE.Color(shaderConfig.slotColor)),
    deadColor: uniform(new THREE.Color(shaderConfig.deadColor)),
    /** From `theme.npcs.fxStrength` */
    gain: uniform(1),
    /** The beam's alpha on the way: more over a pale deck — see `Phasers.syncTheme` */
    faint: uniform(shaderConfig.faint as number),
  };
}

type PhaserView = {
  objectPick: THREE.UniformNode<"float", number>;
  foldNode: THREE.UniformNode<"float", number>;
  fadeRoomsFx: FadeRooms;
  litNpcsEnabled: THREE.UniformNode<"float", number>;
};

export function phaserNodes(resources: PhaserResources, view: PhaserView, part: PhaserPart) {
  if (part === "gun") return gunNodes(resources, view);
  return beamNodes(resources, view, part === "ball");
}

const seenBy =
  ({ fadeRoomsFx, litNpcsEnabled }: PhaserView) =>
  (slot: THREE.Node<"float">, lit: THREE.Node<"float">) =>
    fadeRoomsFx.getVisiblity(slot).max(lit.mul(litNpcsEnabled));

/** The gun, held along the forearm */
function gunNodes({ color, gunColor, slotColor, deadColor, gain }: PhaserResources, view: PhaserView) {
  const { edgePx, edgeDarken, chargeBody, chargeEmitter, stripArmed, stripFull } = shaderConfig;
  const gun = attribute<"vec4">("phaserGun", "vec4");
  const quat = attribute<"vec4">("phaserQuat", "vec4");
  /** `v` turned by the forearm's quaternion */
  const turned = (v: THREE.Node<"vec3">) => {
    const inner = cross(quat.xyz, v).add(v.mul(quat.w)) as THREE.Node<"vec3">;
    return v.add(cross(quat.xyz, inner).mul(2)) as THREE.Node<"vec3">;
  };
  const p = gun.xyz.add(turned(positionLocal.mul(gun.w.abs()) as THREE.Node<"vec3">));
  const vertexNode = cameraProjectionMatrix.mul(cameraViewMatrix.mul(vec4(p, 1)));

  const rooms = attribute<"vec4">("phaserRooms", "vec4");
  const vSeen = varying(seenBy(view)(rooms.x, rooms.z), "vGunSeen");
  const box = attribute<"vec2">("phaserBox", "vec2");
  const glow = box.x.equal(gunKindIndex.emitter).select(1, 0) as THREE.Node<"float">;
  const vGlow = varying<"float">(glow, "vGunGlow");
  const vStrip = varying<"float">(box.x.equal(gunKindIndex.strip).select(1, 0) as THREE.Node<"float">, "vGunStrip");
  const vTone = varying<"float">(box.y, "vGunTone");
  /** How far along the strip from its back, which a charge fills to */
  const vStripT = varying<"float">(
    positionLocal.y.sub(gunStripY[0]).div(gunStripY[1] - gunStripY[0]) as THREE.Node<"float">,
    "vGunStripT",
  );
  const charge = attribute<"vec2">("phaserCharge", "vec2").x;
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
    const beamColor = color.mul(gain.min(1));
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

/** The beam's nodes, else with `tip` its end's ball */
function beamNodes({ phase, color, gain, faint }: PhaserResources, view: PhaserView, tip: boolean) {
  const { radius, tipRadius, solid, nearMetres, bands, chargeWiden, chargeBright } = shaderConfig;
  const src = attribute<"vec4">("phaserSrc", "vec4");
  const dst = attribute<"vec4">("phaserDst", "vec4");
  const [shown, locked] = [src.w, dst.w];
  /** The charge it was fired with */
  const fired = attribute<"vec2">("phaserCharge", "vec2").y;
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

  const rooms = attribute<"vec4">("phaserRooms", "vec4");
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

export const shaderConfig = {
  /** Pale against a dark deck, and dark against a pale one */
  /** Pixels of darker line along each of the gun's edges, and how far it darkens */
  edgePx: 1,
  edgeDarken: 0.6,
  gunColor: "#5f6875",
  /** The strip along its side: dark, `stripArmed` of the beam's colour whilst armed, `stripFull` times it where charged */
  slotColor: "#2e353f",
  stripArmed: 0.45,
  stripFull: 1.3,
  /** Its emitter, deactivated */
  deadColor: "#3d7fd9",
  paleGunColor: "#7d8591",
  /** Metres of radius of the beam, and of the ball at its end */
  radius: 0.01,
  tipRadius: 0.035,
  /** A full charge widens the beam and ball by `1 + chargeWiden`, and its alpha by `1 + chargeBright` */
  chargeWiden: 1.5,
  chargeBright: 0.6,
  /** Charging, how much of the beam's colour the gun gains: its body, and its emitter */
  chargeBody: 0.25,
  chargeEmitter: 1.2,
  /** The beam's alpha on the way, and within `nearMetres` of the body part */
  faint: 0.45,
  solid: 0.9,
  nearMetres: 0.25,
  /** Pulses along the beam, drifting towards the target a band per second */
  bands: 4,
  color: "#ff8a5c",
  /** Over a pale deck: the lightness `color`'s hue is drawn at, fully saturated, and the beam's alpha on the way */
  paleLightness: 0.4,
  paleFaint: 0.6,
  sides: 6,
  segments: 24,
} as const;
