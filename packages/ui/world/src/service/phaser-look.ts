import * as THREE from "three/webgpu";
import { phaserLook } from "./phaser.shader";
import { type GunAttachment, gunAttachments } from "./phaser-gun";

export { type GunAttachment, gunAttachments };

/** The beam's styles, in the shader's order (`beamLook.x`) */
export const beamStyles = ["plain", "lightning", "tesla", "static", "bolts"] as const;
export type BeamStyle = (typeof beamStyles)[number];

/** How a phaser's beam looks: its item's meta, overridden by jsh `phaser` */
export type PhaserLook = {
  style: BeamStyle;
  /** Any css colour three reads, e.g. `#4cf` or `orange` */
  color: string;
  attachment: null | GunAttachment;
  /** How many times a shot at no one reflects off a wall */
  bounces: number;
};

export const defaultLook: PhaserLook = { style: "plain", color: phaserLook.color, attachment: null, bounces: 0 };

/** Writes into `out` the look from item meta (`beam`, `beam-color`, `attachment`, `bounces`) and an override. A bad meta value is ignored */
export function resolveLook(meta: undefined | Meta, override: undefined | Partial<PhaserLook>, out: PhaserLook) {
  out.style = override?.style ?? (beamStyles.includes(meta?.beam) ? meta?.beam : defaultLook.style);
  out.color = override?.color ?? (isColor(meta?.["beam-color"]) ? meta?.["beam-color"] : defaultLook.color);
  out.attachment =
    override?.attachment !== undefined
      ? override.attachment
      : gunAttachments.includes(meta?.attachment)
        ? meta?.attachment
        : defaultLook.attachment;
  out.bounces = override?.bounces ?? (isBounces(meta?.bounces) ? meta?.bounces : defaultLook.bounces);
  return out;
}

/** Throws on any field `look` sets badly, naming it */
export function checkLook(look: Partial<PhaserLook>) {
  if (look.style !== undefined && !beamStyles.includes(look.style))
    throw Error(`beam: expected one of ${beamStyles.join(", ")}`);
  if (look.color !== undefined && !isColor(look.color)) throw Error("color: expected e.g. #4cf or orange");
  if (look.attachment !== undefined && look.attachment !== null && !gunAttachments.includes(look.attachment))
    throw Error(`attachment: expected one of ${gunAttachments.join(", ")}`);
  if (look.bounces !== undefined && !isBounces(look.bounces)) throw Error("bounces: expected 0 to 4");
}

/** The colour a beam is drawn in: over a pale deck its hue, fully saturated at `paleLightness` */
export function beamRgb(color: string, pale: boolean) {
  let pair = rgbs.get(color);
  if (pair === undefined) {
    const paled = new THREE.Color(color);
    const { h } = paled.getHSL({ h: 0, s: 0, l: 0 }, THREE.SRGBColorSpace);
    paled.setHSL(h, 1, phaserLook.paleLightness, THREE.SRGBColorSpace);
    rgbs.set(color, (pair = [new THREE.Color(color), paled]));
  }
  return pair[pale ? 1 : 0];
}

/** By colour: its rgb over a dark deck, then a pale one */
const rgbs = new Map<string, [THREE.Color, THREE.Color]>();

/** One straight piece of a beam, drawn as an instance. `ball`: its end is lit. `width` scales its width */
export type BeamSegment = { from: THREE.Vector3; to: THREE.Vector3; ball: boolean; width: number };

/**
 * The segments of a beam from `from` to `end` as `look` has it: an attachment's pattern, else tesla's forks, else one.
 * `spread`: metres on the ground a shotgun's rays go before they stop, as `attachmentBeams.shotgun.angles`.
 * Reused: read them before the next call
 */
export function beamSegments(
  look: PhaserLook,
  from: THREE.Vector3,
  end: THREE.Vector3,
  spread: null | readonly number[],
): readonly BeamSegment[] {
  set(segments[0], from, end, true, 1);
  if (look.attachment === "caliber") return caliber(from, end);
  if (look.attachment === "shotgun") return shotgun(from, end, spread);
  if (look.style !== "tesla") return single;
  // forks arc from the muzzle to either side, short of the end
  const { reach, spread: aside, maxSpread, width } = teslaForks;
  const dx = end.x - from.x;
  const dz = end.z - from.z;
  const flat = Math.hypot(dx, dz) || 1;
  const off = Math.min(aside * from.distanceTo(end), maxSpread);
  for (const i of [1, 2]) {
    const side = i === 1 ? off : -off;
    const { to } = set(segments[i], from, tmpEnd.lerpVectors(from, end, reach[i - 1]), false, width);
    to.x += (-dz / flat) * side;
    to.z += (dx / flat) * side;
  }
  return three;
}

/** Parallel rays about the axis, a triangle across it */
function caliber(from: THREE.Vector3, end: THREE.Vector3) {
  const { radius, width } = attachmentBeams.caliber;
  const way = tmpWay.subVectors(end, from).normalize();
  const side = tmpSide.crossVectors(way, up).normalize();
  const over = tmpOver.crossVectors(side, way);
  for (const [i, angle] of triangle.entries()) {
    tmpOff
      .copy(side)
      .multiplyScalar(radius * Math.cos(angle))
      .addScaledVector(over, radius * Math.sin(angle));
    set(segments[i], tmpFrom.addVectors(from, tmpOff), tmpEnd.addVectors(end, tmpOff), true, width);
  }
  return three;
}

/** Rays fanned about the beam's way: the middle one to the end, the others to their own walls (`spread`) */
function shotgun(from: THREE.Vector3, end: THREE.Vector3, spread: null | readonly number[]) {
  const { angles, width } = attachmentBeams.shotgun;
  const length = from.distanceTo(end);
  /** Metres along the beam per metre on the ground */
  const slope = length / (Math.hypot(end.x - from.x, end.z - from.z) || 1);
  const way = tmpWay.subVectors(end, from).normalize();
  /** Where a ray pitched down meets the floor */
  const floor = way.y < 0 ? from.y / -way.y : Infinity;
  for (const [i, angle] of angles.entries()) {
    // only the middle ray is the shot: the others go on to their own walls, else as far as it
    const reach = angle === 0 ? length : Math.min((spread?.[i] ?? length / slope) * slope, floor);
    tmpEnd.copy(way).applyAxisAngle(up, angle).multiplyScalar(reach).add(from);
    set(segments[i], from, tmpEnd, true, angle === 0 ? 1 : width);
  }
  return five;
}

function set(seg: BeamSegment, from: THREE.Vector3, to: THREE.Vector3, ball: boolean, width: number) {
  seg.from.copy(from);
  seg.to.copy(to);
  seg.ball = ball;
  seg.width = width;
  return seg;
}

/** Tesla's two forks: how far along the beam each reaches, how far aside per metre of it, and how thick */
const teslaForks = { reach: [0.8, 0.65], spread: 0.08, maxSpread: 0.4, width: 0.6 };

/** Caliber's rays: metres from the axis, and how thick. Shotgun's: radians off the way, by bearing, and how thick */
export const attachmentBeams = {
  caliber: { radius: 0.025, width: 0.7 },
  shotgun: { angles: [-0.07, -0.035, 0, 0.035, 0.07], width: 0.6 },
} as const;

const triangle = [Math.PI / 2, (7 * Math.PI) / 6, (11 * Math.PI) / 6];
const up = new THREE.Vector3(0, 1, 0);
const [tmpWay, tmpSide, tmpOver, tmpOff, tmpFrom, tmpEnd] = Array.from({ length: 6 }, () => new THREE.Vector3());

const segments: BeamSegment[] = Array.from({ length: 5 }, () => ({
  from: new THREE.Vector3(),
  to: new THREE.Vector3(),
  ball: true,
  width: 1,
}));
const single = segments.slice(0, 1);
const three = segments.slice(0, 3);
const five = segments.slice(0, 5);

function isColor(color: unknown): color is string {
  return typeof color === "string" && (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(color) || color in THREE.Color.NAMES);
}

function isBounces(n: unknown): n is number {
  return Number.isInteger(n) && (n as number) >= 0 && (n as number) <= 4;
}
