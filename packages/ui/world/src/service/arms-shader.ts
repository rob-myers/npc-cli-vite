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

export const MAX_ARMS = 128;

/** The mesh's parts, a geometry group and a material apiece, in this order */
export const armsParts = ["gun", "beam", "ball"] as const;
export type ArmsPart = (typeof armsParts)[number];

export type ArmsResources = ReturnType<typeof createArmsResources>;

export function createArmsResources() {
  const { sides, segments, gunBoxes } = shaderConfig;
  // the muzzle and eased shown, the end and eased locked
  const srcData = new Float32Array(MAX_ARMS * 4);
  const dstData = new Float32Array(MAX_ARMS * 4);
  /** Each end's npc's room slot, then whether they are lit — they fade with it as the npcs do */
  const roomData = new Float32Array(MAX_ARMS * 4);
  /** The right forearm's origin, and its world scale by the gun's eased presence — then its world quaternion */
  const gunData = new Float32Array(MAX_ARMS * 4);
  const quatData = new Float32Array(MAX_ARMS * 4);
  const attrs = [srcData, dstData, roomData, gunData, quatData].map((data) =>
    new THREE.InstancedBufferAttribute(data, 4).setUsage(THREE.DynamicDrawUsage),
  );

  /** `glow` marks the gun's emitter, lit as the beam is */
  const glowing = (geo: THREE.BufferGeometry, glow: number) =>
    geo.setAttribute(
      "armsGlow",
      new THREE.BufferAttribute(new Float32Array(geo.getAttribute("position").count).fill(glow), 1),
    );
  const gun = mergeGeometries(
    gunBoxes.map(([min, max], i) =>
      glowing(
        new THREE.BoxGeometry(max[0] - min[0], max[1] - min[1], max[2] - min[2]).translate(
          (min[0] + max[0]) / 2,
          (min[1] + max[1]) / 2,
          (min[2] + max[2]) / 2,
        ),
        i === gunBoxes.length - 1 ? 1 : 0,
      ),
    ),
  );
  /** Unit ring about `y`, open-ended: `y + 0.5` is how far along the beam */
  const beam = glowing(new THREE.CylinderGeometry(1, 1, 1, sides, segments, true), 0);
  const ball = glowing(new THREE.SphereGeometry(1, sides * 2, sides), 0);
  const base = mergeGeometries([gun, beam, ball], true); // a group apiece, as `armsParts`

  const geo = new THREE.InstancedBufferGeometry();
  for (const key of ["position", "normal", "uv", "armsGlow"]) geo.setAttribute(key, base.getAttribute(key));
  geo.setIndex(base.getIndex());
  for (const { start, count, materialIndex } of base.groups) geo.addGroup(start, count, materialIndex);
  ["armsSrc", "armsDst", "armsRooms", "armsGun", "armsQuat"].forEach((key, i) => geo.setAttribute(key, attrs[i]));
  geo.instanceCount = 0;

  // additive, glowing over a dark floor — `Arms.syncTheme` lays them over a pale one instead
  const glowOpts = { depthWrite: false, forceSinglePass: true, blending: THREE.AdditiveBlending };
  const mats = [
    new THREE.MeshBasicNodeMaterial({ transparent: true }),
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
    phase: uniform(0),
    color: uniform(new THREE.Color(shaderConfig.color)),
    gunColor: uniform(new THREE.Color(shaderConfig.gunColor)),
    /** From `theme.npcs.fxStrength` */
    gain: uniform(1),
    /** The beam's alpha on the way: more over a pale deck — see `Arms.syncTheme` */
    faint: uniform(shaderConfig.faint as number),
  };
}

type ArmsView = {
  objectPick: THREE.UniformNode<"float", number>;
  foldNode: THREE.UniformNode<"float", number>;
  fadeRoomsFx: FadeRooms;
  litNpcsEnabled: THREE.UniformNode<"float", number>;
};

export function armsNodes(resources: ArmsResources, view: ArmsView, part: ArmsPart) {
  return part === "gun" ? gunNodes(resources, view) : beamNodes(resources, view, part === "ball");
}

const seenBy =
  ({ fadeRoomsFx, litNpcsEnabled }: ArmsView) =>
  (slot: THREE.Node<"float">, lit: THREE.Node<"float">) =>
    fadeRoomsFx.getVisiblity(slot).max(lit.mul(litNpcsEnabled));

/** The gun, held along the forearm */
function gunNodes({ color, gunColor, gain }: ArmsResources, view: ArmsView) {
  const { edgePx, edgeDarken } = shaderConfig;
  const gun = attribute<"vec4">("armsGun", "vec4");
  const quat = attribute<"vec4">("armsQuat", "vec4");
  /** `v` turned by the forearm's quaternion */
  const turned = (v: THREE.Node<"vec3">) => {
    const inner = cross(quat.xyz, v).add(v.mul(quat.w)) as THREE.Node<"vec3">;
    return v.add(cross(quat.xyz, inner).mul(2)) as THREE.Node<"vec3">;
  };
  const p = gun.xyz.add(turned(positionLocal.mul(gun.w) as THREE.Node<"vec3">));
  const vertexNode = cameraProjectionMatrix.mul(cameraViewMatrix.mul(vec4(p, 1)));

  const rooms = attribute<"vec4">("armsRooms", "vec4");
  const vSeen = varying(seenBy(view)(rooms.x, rooms.z), "vGunSeen");
  const glow = attribute<"float">("armsGlow", "float");
  const vGlow = varying<"float">(glow as THREE.Node<"float">, "vGunGlow");
  /** Lit from above, so its faces tell apart */
  const lit = turned(normalLocal as THREE.Node<"vec3">).dot(normalize(vec3(0.3, 1, 0.2)));
  const vShade = varying(lit.mul(0.3).add(0.7), "vGunShade");
  const colorNode = Fn(() => {
    const a = view.objectPick.notEqual(0).select(0, vSeen.mul(view.foldNode));
    Discard(a.lessThan(1 / 512));
    // each face edged in a darker line, a constant few pixels wide: `uv` runs `0` to `1` across a box's face
    const face = uv();
    const fromEdge = face.min(face.oneMinus()).div(fwidth(face).max(1e-6));
    const edge = smoothstep(edgePx - 0.5, edgePx + 0.5, fromEdge.x.min(fromEdge.y)).oneMinus();
    const body = mix(gunColor.mul(vShade), color.mul(gain.min(1)), vGlow);
    return vec4(body.mul(edge.mul(edgeDarken).oneMinus()), a);
  })();

  return { vertexNode, colorNode };
}

/** The beam's nodes, else with `tip` its end's ball */
function beamNodes({ phase, color, gain, faint }: ArmsResources, view: ArmsView, tip: boolean) {
  const { radius, tipRadius, solid, nearMetres, bands } = shaderConfig;
  const src = attribute<"vec4">("armsSrc", "vec4");
  const dst = attribute<"vec4">("armsDst", "vec4");
  const [shown, locked] = [src.w, dst.w];
  const t = tip ? float(1) : positionLocal.y.add(0.5);

  const d = dst.xyz.sub(src.xyz);
  const side = normalize(vec3(d.z.negate(), 0, d.x).add(vec3(1e-4, 0, 0)));
  const normal = normalize(cross(side, d));
  const across = side.mul(positionLocal.x).add(normal.mul(positionLocal.z));
  const offset = tip ? across.add(normalize(d).mul(positionLocal.y)).mul(locked.mul(tipRadius)) : across.mul(radius);
  const p = mix(src.xyz, dst.xyz, t).add(offset.mul(shown));
  const vertexNode = cameraProjectionMatrix.mul(cameraViewMatrix.mul(vec4(p, 1)));

  const rooms = attribute<"vec4">("armsRooms", "vec4");
  const seen = seenBy(view);
  /** As their npcs are: the ball the target, the beam each end nearer it */
  const vSeen = varying(
    tip ? seen(rooms.y, rooms.w) : mix(seen(rooms.x, rooms.z), seen(rooms.y, rooms.w), t.mul(locked)),
    tip ? "vBallSeen" : "vBeamSeen",
  );
  const vShown = varying(shown, tip ? "vBallShown" : "vBeamShown");
  const vLocked = varying(locked, tip ? "vBallLocked" : "vBeamLocked");
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
    const a = view.objectPick.notEqual(0).select(0, vShown.mul(vSeen).mul(body.mul(gain).min(1)).mul(view.foldNode));
    Discard(a.lessThan(1 / 512));
    return vec4(color, a);
  })();

  return { vertexNode, colorNode };
}

export const shaderConfig = {
  /**
   * The gun's boxes `[min, max]` in the right forearm's frame, whose fist ends at `y` `-0.37`: the last glows.
   * Model units
   */
  gunBoxes: [
    [
      [-0.1, -0.33, -0.03],
      [0.08, -0.25, 0.03],
    ],
    [
      [0.07, -0.48, -0.04],
      [0.17, -0.22, 0.04],
    ],
    [
      [0.09, -0.54, -0.025],
      [0.15, -0.48, 0.025],
    ],
  ] as [number[], number[]][],
  /** Pale against a dark deck, and dark against a pale one */
  /** Pixels of darker line along each of the gun's edges, and how far it darkens */
  edgePx: 1,
  edgeDarken: 0.6,
  gunColor: "#5f6875",
  paleGunColor: "#474d57",
  /** Metres of radius of the beam, and of the ball at its end */
  radius: 0.01,
  tipRadius: 0.035,
  /** The beam's alpha on the way, and within `nearMetres` of the body part */
  faint: 0.04,
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
