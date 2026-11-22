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
  { name: "collar", min: [0.08, -0.53, -0.035], max: [0.16, -0.51, 0.035], kind: "body", tone: 0.68, under: true },
  { name: "tip", min: [0.095, -0.565, -0.0225], max: [0.145, -0.53, 0.0225], kind: "emitter", tone: 1, under: true },
];

/** The gun's colours, for its shader and the hud's icon (`service/phaser-icon.ts`) */
export const gunColors = {
  gun: "#5f6875",
  paleGun: "#7d8591",
  /** The icon's gun, a little lighter */
  iconGun: "#6c7582",
  /** The strip along its side, dark */
  slot: "#2e353f",
  /** Its emitter, deactivated */
  dead: "#3d7fd9",
  /** An attachment's body, white, edged black, its holes put away */
  attach: "#e4e7eb",
  attachEdge: "#0b0d10",
  hole: "#16191d",
  /** The icon's edges, bar an attachment's */
  iconEdge: "#2b3038",
  /** The default beam */
  beam: "#ff8a5c",
};

/** What may be fitted to the end of the gun, in the shader's order from `1` (`phaserBox.z`) */
export const gunAttachments = ["caliber", "shotgun", "rotator"] as const;
export type GunAttachment = (typeof gunAttachments)[number];

/**
 * Each attachment's shapes, white, sleeved over the barrel: as `gunBoxes`, a round one bounded by `min` and `max`.
 * Its emitters are holes in its front, where its beam leaves
 */
export const attachmentBoxes: Record<GunAttachment, GunBox[]> = {
  /** A box with a hole, for parallel rays */
  caliber: [
    { name: "block", min: [0.07, -0.62, -0.05], max: [0.17, -0.43, 0.05], kind: "body", tone: 1 },
    hole("hole", 0.12, 0, 0.03, -0.62),
  ],
  /** A wide cylinder with a wide hole, for rays spreading */
  shotgun: [
    {
      name: "drum",
      min: [0.055, -0.64, -0.065],
      max: [0.185, -0.43, 0.065],
      kind: "body",
      tone: 1,
      round: { sides: 12, smooth: true },
    },
    hole("hole", 0.12, 0, 0.047, -0.64),
  ],
  /** A triangular prism, its end larger, with three holes, for rapid bolts */
  rotator: [
    { name: "prism", min: [0.04, -0.58, -0.08], max: [0.2, -0.43, 0.08], kind: "body", tone: 1, round: { sides: 3 } },
    { name: "end", min: [0.02, -0.62, -0.1], max: [0.22, -0.58, 0.1], kind: "body", tone: 1, round: { sides: 3 } },
    ...[0, 1, 2].map((i) =>
      hole(
        "hole",
        0.12 + 0.045 * Math.cos((2 * Math.PI * i) / 3),
        0.045 * Math.sin((2 * Math.PI * i) / 3),
        0.015,
        -0.62,
      ),
    ),
  ],
};

/** Whether `box` is a hole: on the gun a texture on its attachment's front, in the icon a disc */
export const isHole = (box: GunBox) => box.kind === "emitter" && box.round !== undefined;

/** Each attachment's holes, from `1` as `phaserBox.z`: the front's `y`, and each hole's middle `x`, `z` and radius */
export const attachmentHoles = gunAttachments.map((key, i) => ({
  attachment: i + 1,
  holes: attachmentBoxes[key].filter(isHole).map(({ min, max }) => ({
    y: max[1] + 0.001,
    x: (min[0] + max[0]) / 2,
    z: (min[2] + max[2]) / 2,
    r: (max[0] - min[0]) / 2,
  })),
}));

/** A round hole in a front face at `y`, at `x`, `z`: a texture on the gun (`attachmentHoles`), a disc in the icon */
function hole(name: string, x: number, z: number, r: number, y: number): GunBox {
  return {
    name,
    min: [x - r, y - 0.007, z - r],
    max: [x + r, y - 0.001, z + r],
    kind: "emitter",
    tone: 1,
    round: { sides: 10, smooth: true },
  };
}

export type GunBox = {
  name: string;
  min: [number, number, number];
  max: [number, number, number];
  /** `emitter` glows whilst armed. `strip` fills from the back as it charges */
  kind: "body" | "emitter" | "strip";
  /** Its shade of the gun's colour */
  tone: number;
  /** Covered by any attachment, so hidden whilst one is fitted */
  under?: true;
  /**
   * A prism along `y` of `sides` sides, a corner at `+x`, about the middle of `min` and `max` in `x` and `z`.
   * `smooth`: a cylinder, its sides' seams not edged
   */
  round?: { sides: number; smooth?: true };
};

type Vec3 = [number, number, number];

/** One face of a box, its points anticlockwise from outside. `edges[i]` runs from `points[i]` on: edged, or a `seam` edged only on a silhouette */
export type GunFace = { points: Vec3[]; normal: Vec3; edges: (boolean | "seam")[] };

/** A box's faces, outward */
export function gunFaces({ min, max, round }: GunBox): GunFace[] {
  if (round === undefined) {
    const at = (ix: number, iy: number, iz: number): Vec3 => [
      ix ? max[0] : min[0],
      iy ? max[1] : min[1],
      iz ? max[2] : min[2],
    ];
    return [
      [
        [1, 0, 0],
        [at(1, 0, 0), at(1, 1, 0), at(1, 1, 1), at(1, 0, 1)],
      ],
      [
        [-1, 0, 0],
        [at(0, 0, 0), at(0, 1, 0), at(0, 1, 1), at(0, 0, 1)],
      ],
      [
        [0, 1, 0],
        [at(0, 1, 0), at(1, 1, 0), at(1, 1, 1), at(0, 1, 1)],
      ],
      [
        [0, -1, 0],
        [at(0, 0, 0), at(1, 0, 0), at(1, 0, 1), at(0, 0, 1)],
      ],
      [
        [0, 0, 1],
        [at(0, 0, 1), at(1, 0, 1), at(1, 1, 1), at(0, 1, 1)],
      ],
      [
        [0, 0, -1],
        [at(0, 0, 0), at(1, 0, 0), at(1, 1, 0), at(0, 1, 0)],
      ],
    ].map(([normal, points]) =>
      outward({ points: points as Vec3[], normal: normal as Vec3, edges: [true, true, true, true] }),
    );
  }
  const { sides, smooth } = round;
  const [cx, cz, r] = [(min[0] + max[0]) / 2, (min[2] + max[2]) / 2, (max[0] - min[0]) / 2];
  const angle = (k: number) => (2 * Math.PI * k) / sides;
  const at = (k: number, y: number): Vec3 => [cx + r * Math.cos(angle(k)), y, cz + r * Math.sin(angle(k))];
  const seam = smooth === true ? "seam" : true;
  const faces: GunFace[] = Array.from({ length: sides }, (_, k) => ({
    points: [at(k, min[1]), at(k + 1, min[1]), at(k + 1, max[1]), at(k, max[1])],
    normal: [Math.cos(angle(k + 0.5)), 0, Math.sin(angle(k + 0.5))],
    edges: [true, seam, true, seam],
  }));
  const ring = (y: number) => Array.from({ length: sides }, (_, k) => at(k, y));
  faces.push({ points: ring(min[1]), normal: [0, -1, 0], edges: ring(0).map(() => true) });
  faces.push({ points: ring(max[1]), normal: [0, 1, 0], edges: ring(0).map(() => true) });
  return faces.map(outward);
}

/** Its points anticlockwise seen along `-normal`, its edges kept to them */
function outward(face: GunFace): GunFace {
  const [a, b, c] = face.points;
  const [u, v] = [b.map((x, i) => x - a[i]), c.map((x, i) => x - a[i])];
  const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
  if (n[0] * face.normal[0] + n[1] * face.normal[1] + n[2] * face.normal[2] >= 0) return face;
  const last = face.points.length - 1;
  return {
    normal: face.normal,
    points: [...face.points].reverse(),
    edges: face.edges.map((_, j) => (j < last ? face.edges[last - 1 - j] : face.edges[last])),
  };
}

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
