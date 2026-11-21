/**
 * The phaser's boxes in the right forearm's frame: `+x` up whilst aiming, `-y` out of the muzzle, the fist ending at `y` `-0.37`.
 * Model units. Drawn by `phaser-shader.ts`, projected into the hud's icon by `gen-phaser-icon`
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

/** The strip's `y` from its back to its front, which a charge fills along */
export const gunStripY = [strip.max[1], strip.min[1]] as const;
