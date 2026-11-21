import * as THREE from "three/webgpu";
import { phaserLook } from "./phaser.shader";
import { type GunAttachment, gunAttachments } from "./phaser-gun";

/** The beam's styles, in the shader's order (`beamLook.x`) */
export const beamStyles = ["plain", "lightning", "tesla", "static", "bolts"] as const;
type BeamStyle = (typeof beamStyles)[number];

/** How a phaser's beam looks: its item's meta, overridden by jsh `phaser` */
export type PhaserLook = {
  style: BeamStyle;
  /** Any css colour three reads, e.g. `#4cf` or `orange` */
  color: string;
  attachment: null | GunAttachment;
};

export const defaultLook: PhaserLook = { style: "plain", color: phaserLook.color, attachment: null };

/** Writes into `out` the look from item meta (`beam`, `beam-color`, `attachment`) and an override. A bad meta value is ignored */
export function resolveLook(meta: undefined | Meta, override: undefined | Partial<PhaserLook>, out: PhaserLook) {
  out.style = override?.style ?? (beamStyles.includes(meta?.beam) ? meta?.beam : defaultLook.style);
  out.color = override?.color ?? (isColor(meta?.["beam-color"]) ? meta?.["beam-color"] : defaultLook.color);
  out.attachment =
    override?.attachment !== undefined
      ? override.attachment
      : gunAttachments.includes(meta?.attachment)
        ? meta?.attachment
        : defaultLook.attachment;
  return out;
}

/** Throws on any field `look` sets badly, naming it */
export function checkLook(look: Partial<PhaserLook>) {
  if (look.style !== undefined && !beamStyles.includes(look.style))
    throw Error(`beam: expected one of ${beamStyles.join(", ")}`);
  if (look.color !== undefined && !isColor(look.color)) throw Error("color: expected e.g. #4cf or orange");
  if (look.attachment !== undefined && look.attachment !== null && !gunAttachments.includes(look.attachment))
    throw Error(`attachment: expected one of ${gunAttachments.join(", ")}`);
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
 * `spread`: per ray of a shotgun or caliber, metres on the ground it goes before it stops.
 * `ownLeg`: where the shot's own line bounced on to. `rayLegs`: per ray, its own bounce, else `ownLeg` for its own line.
 * Reused: read them before the next call
 */
export function beamSegments(
  look: PhaserLook,
  from: THREE.Vector3,
  end: THREE.Vector3,
  spread: null | readonly number[],
  ownLeg?: null | THREE.Vector3,
  rayLegs?: null | readonly (null | { end: THREE.Vector3 })[],
): readonly BeamSegment[] {
  let k = rays(look, from, end, spread);
  // then each ray's bounce from where it ended: its own, else the shot's own line's
  for (let i = 0; i < rayCount(look.attachment) && k < segments.length; i++) {
    const ray = segments[i];
    const own = look.attachment === "shotgun" ? attachmentBeams.shotgun.angles[i] === 0 : true;
    const leg = rayLegs?.[i]?.end ?? (own ? ownLeg : null);
    if (leg == null) continue;
    // a caliber's rays keep their offsets from the shot's own line
    const off = look.attachment === "caliber" ? tmpOff.subVectors(ray.to, end) : tmpOff.set(0, 0, 0);
    set(segments[k++], ray.to, tmpEnd.set(leg.x + off.x, ray.to.y, leg.z + off.z), true, ray.width);
  }
  out.length = k;
  for (let i = 0; i < k; i++) out[i] = segments[i];
  return out;
}

/** Writes its rays into `segments`, giving how many */
function rays(look: PhaserLook, from: THREE.Vector3, end: THREE.Vector3, spread: null | readonly number[]) {
  set(segments[0], from, end, true, 1);
  if (look.attachment === "caliber") return caliber(from, end, spread);
  if (look.attachment === "shotgun") return shotgun(from, end, spread);
  if (look.style !== "tesla") return 1;
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
  return 3;
}

/** Parallel rays about the axis, a triangle across it, each to the end, else as far as `reach` on the ground */
function caliber(from: THREE.Vector3, end: THREE.Vector3, reach: null | readonly number[]) {
  const length = from.distanceTo(end);
  const slope = length / (Math.hypot(end.x - from.x, end.z - from.z) || 1);
  const way = tmpWay.subVectors(end, from).normalize();
  for (let i = 0; i < 3; i++) {
    const { origin, dir } = attachmentRay("caliber", i, from, way, tmpRay);
    const along = Math.min(length, (reach?.[i] ?? Number.POSITIVE_INFINITY) * slope);
    set(segments[i], origin, tmpEnd.copy(dir).multiplyScalar(along).add(origin), true, attachmentBeams.caliber.width);
  }
  return 3;
}

/** How many rays an attachment fires */
export const rayCount = (attachment: null | GunAttachment) =>
  attachment === "caliber" ? 3 : attachment === "shotgun" ? attachmentBeams.shotgun.angles.length : 1;

/**
 * An attachment's `i`th ray from `from` along the shot's `way`, written to `out`: a shotgun's fanned by bearing, a
 * caliber's offset across it. `middle`: it is the shot's own line
 */
export function attachmentRay(
  attachment: GunAttachment,
  i: number,
  from: THREE.Vector3,
  way: THREE.Vector3,
  out: { origin: THREE.Vector3; dir: THREE.Vector3; middle?: boolean },
) {
  if (attachment === "shotgun") {
    const angle = attachmentBeams.shotgun.angles[i];
    out.origin.copy(from);
    out.dir.copy(way).applyAxisAngle(up, angle);
    out.middle = angle === 0;
    return out;
  }
  const { radius } = attachmentBeams.caliber;
  const side = tmpSide.crossVectors(way, up).normalize();
  const over = tmpOver.crossVectors(side, way);
  const angle = attachment === "caliber" ? triangle[i] : 0;
  out.origin
    .copy(from)
    .addScaledVector(side, radius * Math.cos(angle))
    .addScaledVector(over, radius * Math.sin(angle));
  out.dir.copy(way);
  out.middle = attachment !== "caliber";
  return out;
}

const tmpRay = { origin: new THREE.Vector3(), dir: new THREE.Vector3() };

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
  return angles.length;
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
const [tmpWay, tmpSide, tmpOver, tmpEnd, tmpOff] = Array.from({ length: 5 }, () => new THREE.Vector3());

/** Its rays, at most 5, and a bounce apiece */
const segments: BeamSegment[] = Array.from({ length: 10 }, () => ({
  from: new THREE.Vector3(),
  to: new THREE.Vector3(),
  ball: true,
  width: 1,
}));
const out: BeamSegment[] = [];

function isColor(color: unknown): color is string {
  return typeof color === "string" && (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(color) || color in THREE.Color.NAMES);
}
