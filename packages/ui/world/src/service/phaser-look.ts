import * as THREE from "three/webgpu";
import { phaserLook } from "./phaser.shader";

/** The beam's styles, in the shader's order (`beamLook.x`) */
export const beamStyles = ["plain", "lightning", "tesla", "static", "bolts"] as const;
export type BeamStyle = (typeof beamStyles)[number];

/** What may be fitted to the end of the gun */
export const gunAttachments = ["caliber", "shotgun", "rotator"] as const;
export type GunAttachment = (typeof gunAttachments)[number];

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

/** The segments of a beam from `tip` to `end` as `look` has it. Reused: read them before the next call */
export function beamSegments(look: PhaserLook, tip: THREE.Vector3, end: THREE.Vector3): readonly BeamSegment[] {
  segments[0].from.copy(tip);
  segments[0].to.copy(end);
  if (look.style !== "tesla") return single;
  // forks arc from the muzzle to either side, short of the end
  const { reach, spread, maxSpread } = teslaForks;
  const dx = end.x - tip.x;
  const dz = end.z - tip.z;
  const flat = Math.hypot(dx, dz) || 1;
  const off = Math.min(spread * tip.distanceTo(end), maxSpread);
  for (let i = 1; i < segments.length; i++) {
    const { from, to } = segments[i];
    const side = i === 1 ? off : -off;
    from.copy(tip);
    to.lerpVectors(tip, end, reach[i - 1]);
    to.x += (-dz / flat) * side;
    to.z += (dx / flat) * side;
  }
  return segments;
}

/** Tesla's two forks: how far along the beam each reaches, how far aside per metre of it, and how thick */
const teslaForks = { reach: [0.8, 0.65], spread: 0.08, maxSpread: 0.4, width: 0.6 };

const segments: BeamSegment[] = [0, 1, 2].map((i) => ({
  from: new THREE.Vector3(),
  to: new THREE.Vector3(),
  ball: i === 0,
  width: i === 0 ? 1 : teslaForks.width,
}));
const single = segments.slice(0, 1);

function isColor(color: unknown): color is string {
  return typeof color === "string" && (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(color) || color in THREE.Color.NAMES);
}

function isBounces(n: unknown): n is number {
  return Number.isInteger(n) && (n as number) >= 0 && (n as number) <= 4;
}
