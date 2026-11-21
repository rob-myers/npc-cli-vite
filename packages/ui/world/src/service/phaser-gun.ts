/**
 * The phaser's boxes in the right forearm's frame: `+x` up whilst aiming, `-y` out of the muzzle, the fist ending at `y` `-0.37`.
 * Model units. Drawn by `phaser-gun.shader.ts`, projected into the hud's icon by `gen-phaser-icon`
 */
export const gunBoxes: GunBox[] = [
  { name: "grip", min: [-0.085, -0.335, -0.03], max: [0.07, -0.255, 0.03], kind: "body", tone: 0.8 },
  { name: "butt", min: [-0.105, -0.345, -0.035], max: [-0.085, -0.245, 0.035], kind: "body", tone: 0.62 },
  { name: "body", min: [0.07, -0.43, -0.04], max: [0.16, -0.2, 0.04], kind: "body", tone: 1 },
  { name: "fin", min: [0.095, -0.2, -0.025], max: [0.15, -0.18, 0.025], kind: "body", tone: 0.75 },
  { name: "rail", min: [0.16, -0.4, -0.015], max: [0.18, -0.23, 0.015], kind: "body", tone: 1.2 },
  { name: "strip", min: [0.095, -0.4, 0.04], max: [0.135, -0.24, 0.046], kind: "strip", tone: 1 },
  { name: "strip", min: [0.095, -0.4, -0.046], max: [0.135, -0.24, -0.04], kind: "strip", tone: 1 },
  { name: "barrel", min: [0.0925, -0.51, -0.025], max: [0.1475, -0.43, 0.025], kind: "body", tone: 0.85 },
  { name: "collar", min: [0.08, -0.53, -0.035], max: [0.16, -0.51, 0.035], kind: "body", tone: 0.68 },
  { name: "tip", min: [0.095, -0.565, -0.0225], max: [0.145, -0.53, 0.0225], kind: "emitter", tone: 1 },
];

/** What may be fitted to the end of the gun, in the shader's order from `1` (`phaserBox.z`) */
export const gunAttachments = ["caliber", "shotgun", "rotator"] as const;
export type GunAttachment = (typeof gunAttachments)[number];

/** Each attachment's boxes, past the tip as `gunBoxes`: its emitter is where its beam leaves */
export const attachmentBoxes: Record<GunAttachment, GunBox[]> = {
  /** A wider, deeper emitter, for parallel rays */
  caliber: [
    { name: "sleeve", min: [0.075, -0.6, -0.05], max: [0.165, -0.53, 0.05], kind: "body", tone: 0.7 },
    { name: "tip", min: [0.085, -0.615, -0.04], max: [0.155, -0.6, 0.04], kind: "emitter", tone: 1 },
  ],
  /** A muzzle flaring out, for rays spreading */
  shotgun: [
    { name: "neck", min: [0.09, -0.59, -0.03], max: [0.15, -0.565, 0.03], kind: "body", tone: 0.8 },
    { name: "flare", min: [0.07, -0.62, -0.05], max: [0.17, -0.59, 0.05], kind: "body", tone: 0.65 },
    { name: "tip", min: [0.08, -0.627, -0.04], max: [0.16, -0.62, 0.04], kind: "emitter", tone: 1 },
  ],
  /** A ring holding three short barrels, for rapid bolts */
  rotator: [
    { name: "ring", min: [0.075, -0.6, -0.045], max: [0.165, -0.565, 0.045], kind: "body", tone: 0.6 },
    { name: "tip", min: [0.135, -0.64, -0.01], max: [0.155, -0.6, 0.01], kind: "emitter", tone: 1 },
    { name: "tip", min: [0.09, -0.64, 0.015], max: [0.11, -0.6, 0.035], kind: "emitter", tone: 1 },
    { name: "tip", min: [0.09, -0.64, -0.035], max: [0.11, -0.6, -0.015], kind: "emitter", tone: 1 },
  ],
};

export type GunBox = {
  name: string;
  min: [number, number, number];
  max: [number, number, number];
  /** `emitter` glows whilst armed. `strip` fills from the back as it charges */
  kind: "body" | "emitter" | "strip";
  /** Its shade of the gun's colour */
  tone: number;
};

/** The kinds as the shader's `phaserBox.x` */
export const gunKindIndex = { body: 0, emitter: 1, strip: 2 } as const;

const tip = gunBoxes.find((box) => box.kind === "emitter") as GunBox;
const strip = gunBoxes.find((box) => box.kind === "strip") as GunBox;

/** Where the beam leaves: the middle of the emitter's front face */
export const gunMuzzle: [number, number, number] = [(tip.min[0] + tip.max[0]) / 2, tip.min[1], 0];

/** Where the beam leaves an attachment: the middle of its emitters' front, else the gun's own muzzle */
export const muzzleOf = (attachment: null | GunAttachment) =>
  attachment === null ? gunMuzzle : attachmentMuzzles[attachment];

const attachmentMuzzles = Object.fromEntries(
  gunAttachments.map((key) => {
    const tips = attachmentBoxes[key].filter((box) => box.kind === "emitter");
    const x = tips.reduce((sum, box) => sum + (box.min[0] + box.max[0]) / 2, 0) / tips.length;
    return [key, [x, Math.min(...tips.map((box) => box.min[1])), 0]];
  }),
) as Record<GunAttachment, [number, number, number]>;

/** The strip's `y` from its back to its front, which a charge fills along */
export const gunStripY = [strip.max[1], strip.min[1]] as const;
