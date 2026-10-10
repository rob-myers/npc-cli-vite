/**
 * The npcs' tuning, imported by npc modules alone — never by `World`, `WorldView` or their hooks,
 * which would rebuild the world on every edit. What the world builds AROUND an npc, their size,
 * is `npcDims` in `const.both.ts` — a copy here rather than an import, so this file stays independent
 */

/** An npc's label, unless `label` or the predicates say otherwise */
export const defaultNpcLabelColor = "#ff9";

export const npcScale = 0.8;

export const npcShadowRadius = npcScale / 2.5;

/**
 * Where `park` and `pad` stand npcs. `as const` is load-bearing: `plan.worker` keeps typed copies
 * of these, and only literal types make a drifted copy a compile error
 */
export const standConfig = {
  /** Below this much of a move, `park` turns them on the spot instead */
  parkMinMove: 0.02,
  /** How far out `park` looks for a wall to stand against */
  parkQueryRange: 2,
  /** How much room `pad` wants round them, from walls and from the parked or padded: 4 x `npcDims.agentRadius` */
  // padClearance: 0.72,
  padClearance: 0.6,
  /** How far from where they stand `pad` looks for such a spot */
  padQueryRange: 3,
  /** How far clear of a door somebody must stand to be out of the traffic through it */
  doorwayClearance: 0.6,
} as const;

/** A crowd agent's acceleration, speed and separation, by what they are doing */
export const agentConfig = {
  maxAcceleration: {
    idle: 4.0,
    /** An idle npc separating: `onTick` drops anyone at rest to this, else walk -> idle slides */
    idleSeparating: 0.25,
    walk: 18.0,
  },
  maxSpeed: {
    idle: 0.5,
    /** Separating idle npcs should not move by default */
    idleSeparating: 0.005,
    walk: 1.5,
    run: 3,
    /** Backing away — see `w.e.move`'s `backwards` */
    backwards: 0.8,
  },
  /**
   * Whilst a move is `fast` the gait on show follows their speed: run above one, back to walk
   * below the other — the gap is the hysteresis — and at least `minSecs` on each
   */
  gait: { runAbove: 1.9, walkBelow: 1.6, minSecs: 0.3 },
  /**
   * A fast move slows to a walk before arriving — its speed limit eased from run to walk. Navcat
   * only brakes within two radii, 0.15 s at a run: run -> idle, with no time for the gait to follow
   */
  walkIn: { from: 1.8, to: 0.9 },
  /**
   * Under this speed, close to the target, they have settled — arrived, even short of the arrival
   * radius: a neighbour's separation can hold them off it, stepping on the spot until `stuck`
   */
  settleSpeed: 0.1,
  separationWeight: {
    /** Less pushable */
    idle: 0.1,
    /** Too large breaks arrival near other npc (tried 0.5) */
    walk: 1.5,
  },
} as const;

/**
 * NPC tuning: `npcConfig.dist` in meters, `npcConfig.time` in seconds, `npcConfig.angle` in radians.
 */
export const npcConfig = {
  angle: {
    /** Opening turn beyond which an npc shuffles round before walking off */
    turnBeforeMove: Math.PI * 0.75,
    /** A target further than this from their facing, and within `dist.backStep`, is backed onto — see `w.e.move` */
    backStep: (Math.PI * 2) / 3,
  },
  dist: {
    /** Arrival radius when we slow down beforehand: on foot, a fast move included — see `walkIn` */
    arrive: 0.15,
    /** Arrival radius when gliding through, i.e. `arrive` is false */
    glide: { walk: 0.4, run: 0.8 },
    /** Arrival radius floor, else a zero-distance move never arrives */
    arriveMin: 0.02,
    /** Arrival radius is also capped at this fraction of `npc.last.targetDistance` */
    arriveFraction: 0.4,
    /** Manhattan distance below which a move uses `shuffle` rather than `walk` */
    shuffleTarget: 0.25,
    /** Within this of the closest reachable point we look rather than walk */
    blockedLook: 0.3,
    /** Look before teleporting onto a doable this close by */
    doableLook: 1.5,
    /** Within this, a target behind them is backed onto — past a `wasd_delta --fast` step, so held `s` never turns them */
    backStep: 0.75,
    /** Below this much movement per frame an npc counts as motionless */
    stuckEpsilon: 0.002,
    /** Within this of the target, getting no nearer for `stuckDuration` counts as circling */
    circling: 0.6,
  },
  time: {
    /** Grace after a move starts, before stuck detection applies */
    stuckGrace: 0.5,
    /** How long an npc must stay motionless to count as stuck */
    /** try fix choke point slow down */
    stuckDuration: 0.8,
    /** Minimum look duration before teleporting onto a nearby doable */
    look: 0.5,
  },
} as const;

/** See `getAgentParams` in `components/NPCs.tsx` */
export const crowdConfig = {
  /** Neighbour search range (tried 0.5–1.5) */
  collisionQueryRange: 0.7,
  // collisionQueryRange: 1.7,
  /** Wall search range: shorter, else walkers slow early beside walls */
  boundaryQueryRange: 0.4,
  /** Keeps a side once taken: `2` intersects less, `0.75` rounds npcs better */
  avoidanceWeightCurVel: 0.75,
  // avoidanceWeightCurVel: 1.5,
  /** navcat's is 20 */
  quickSearchIterations: 64,
  /** Enough to reach the sliced search */
  warmTicks: 4,
} as const;

/** `findNearestPoly` query box and tolerance, by accuracy */
export const closestPolyByAccuracy: Record<
  "0.005" | "0.1" | "0.5" | "4",
  { halfExtents: [number, number, number]; distance: number }
> = {
  "0.005": { halfExtents: [0.005, 0.005, 0.005], distance: 0.005 },
  "0.1": { halfExtents: [0.1, 0.1, 0.1], distance: 0.1 },
  "0.5": { halfExtents: [0.5, 0.5, 0.5], distance: 0.5 },
  /** A room's width or so: what a map edit leaves under someone whose floor it took */
  "4": { halfExtents: [4, 4, 4], distance: 4 },
};

export const npcSpawnConfig = {
  keyPattern: /^[a-z][a-z0-9-]*$/,
  /** Pick ids handed out before a spawn renumbers them */
  compactPickIdsAt: 200,
} as const;

/** See `NPCs.createMaterials` */
export const npcMaterialConfig = {
  labelHalfWidth: 0.5,
  labelHalfHeight: 0.125,
  /** Eased to `overheadAmount` as the view elevation goes `overheadFrom` → `overheadTo` */
  rim: { power: 5, amount: 0.2, color: [0.55, 0.72, 0.7], overheadAmount: 0.05, overheadFrom: 0.45, overheadTo: 0.85 },
  /** Exposure is ADDED: `ambient` out of the light, the light taking what that leaves, `litAmbient` on top */
  ambient: 0.3,
  ambientInSight: 0.12,
  litAmbient: 0.4,
  /** A light of the npcs' own, from straight above: how far an underside darkens, a side half as far */
  faceShade: 0.85,
} as const;

export const fromAnimationClipKey = {
  backwards: true,
  breathe: true,
  crouch: true,
  crouch_left: true,
  drop: true,
  drop_left: true,
  idle: true,
  lie: true,
  lie_pacified: true,
  lie_pacify_in: true,
  lie_pain_high: true,
  lie_pain_low: true,
  pacified: true,
  pacify_in: true,
  pain_arm_left: true,
  pain_arm_right: true,
  pain_high: true,
  pain_leg_left: true,
  pain_leg_right: true,
  pick_up: true,
  pick_up_left: true,
  point: true,
  point_avoid: true,
  psi: true,
  psi_avoid: true,
  run: true,
  shuffle: true,
  sit: true,
  sit_pacified: true,
  sit_pacify_in: true,
  sit_pain_high: true,
  sit_pain_low: true,
  sit_reach: true,
  strafe_left: true,
  strafe_right: true,
  phaser_aim: true,
  phaser_aim_avoid: true,
  walk: true,
};

export const defaultIdleAnimationClipKey = "breathe" satisfies import("./components/NPCs").AnimationClipKey;

/** Fallback for @see {fadeSecs} */
export const defaultFadeSecs = 0.3;

/** Easing an upper-body clip in or out, over the pose — see `NpcAnimation.setUpper` */
export const upperFadeSecs = 0.4;

/** One sat turns towards a point without turning round: `maxRad` either way, the torso taking `body` of it and the head the rest */
export const sitTurn = { maxRad: Math.PI / 4, body: 0.25, rate: 6 } as const;

/**
 * One sat raises an arm past a table's edge: by way of this pose of the LEFT arm, elbow back and out, as Blockbench
 * keys it. They near it by `there` of the way, and leave for the clip's from `onFrom`. It takes `slow` times as long
 */
export const sitArmVia = { arm: [-70, 0, -30], forearm: [155, 0, 0], there: 0.5, onFrom: 0.4, slow: 1.6 } as const;

/** A "no": the head turns one way then the other `turns` times, `rad` at most, in `secs`. Over `1`, `slowing` gives the later turns more of the time */
export const headShakeConfig = { secs: 0.75, turns: 1, rad: 0.45, slowing: 1.6 } as const;

type ClipKey = keyof typeof fromAnimationClipKey;
type HitRegion = "head" | "torso" | `${"arm" | "leg"}_${"left" | "right"}`;

/** What a phaser hit does: the clip played, by where it lands and how they are — see `w.npc.hit` */
export const hitConfig = {
  /** Where a bone's part is */
  region: {
    head: "head",
    chest: "torso",
    stomach: "torso",
    hips: "torso",
    leftarm: "arm_left",
    leftforearm: "arm_left",
    rightarm: "arm_right",
    rightforearm: "arm_right",
    leftthigh: "leg_left",
    leftshin: "leg_left",
    leftfoot: "leg_left",
    rightthigh: "leg_right",
    rightshin: "leg_right",
    rightfoot: "leg_right",
  } as Record<string, undefined | HitRegion>,
  clips: {
    stand: {
      head: "pacify_in",
      torso: "pain_high",
      arm_left: "pain_arm_left",
      arm_right: "pain_arm_right",
      leg_left: "pain_leg_left",
      leg_right: "pain_leg_right",
    },
    sit: {
      head: "sit_pacify_in",
      torso: "sit_pain_high",
      arm_left: "sit_pain_low",
      arm_right: "sit_pain_low",
      leg_left: "sit_pain_low",
      leg_right: "sit_pain_low",
    },
    lie: {
      head: "lie_pacify_in",
      torso: "lie_pain_high",
      arm_left: "lie_pain_low",
      arm_right: "lie_pain_low",
      leg_left: "lie_pain_low",
      leg_right: "lie_pain_low",
    },
  } satisfies Record<string, Record<HitRegion, ClipKey>>,
  /** Looped until released: every other clip above plays once */
  pacified: ["pacified", "sit_pacified", "lie_pacified"] as ClipKey[],
  /** What a clip played once goes on to, where that is not back to idle */
  next: { pacify_in: "pacified", sit_pacify_in: "sit_pacified", lie_pacify_in: "lie_pacified" } as Partial<
    Record<ClipKey, ClipKey>
  >,
};

/**
 * Cross-fade seconds `fadeSecs[src][dst]`, from one animation clip into another.
 * A missing destination falls back to @see {defaultFadeSecs}.
 */
export const fadeSecs: Record<
  keyof typeof fromAnimationClipKey,
  Partial<Record<keyof typeof fromAnimationClipKey, number>>
> = {
  backwards: {},
  breathe: { shuffle: 0.15 },
  crouch: {},
  crouch_left: {},
  drop: {},
  drop_left: {},
  idle: { shuffle: 0.15 },
  lie: {},
  lie_pacified: {},
  lie_pacify_in: {},
  lie_pain_high: {},
  lie_pain_low: {},
  pacified: {},
  pacify_in: {},
  pain_arm_left: {},
  pain_arm_right: {},
  pain_high: {},
  pain_leg_left: {},
  pain_leg_right: {},
  pick_up: {},
  pick_up_left: {},
  point: {},
  point_avoid: {},
  psi: {},
  psi_avoid: {},
  run: { shuffle: 0.15, walk: 0.25 },
  // brief, so it must fade quickly to be seen at all
  shuffle: { breathe: 0.15, idle: 0.15 },
  sit: {},
  sit_pacified: {},
  sit_pacify_in: {},
  sit_pain_high: {},
  sit_pain_low: {},
  sit_reach: {},
  strafe_left: {},
  strafe_right: {},
  phaser_aim: { shuffle: 0.15 },
  phaser_aim_avoid: {},
  walk: { shuffle: 0.15, run: 0.25 },
};

export const defaultPsiTune: PsiTune = {
  speed: 0.45,
  width: 2.25,
  packet: 1,
  amp: 0.12,
  line: 0.35,
  opacity: 0.3,
  color: "#9eb6ff",
};

/** The aggregates a mind is modelled on, and the colour a thought of each is marked with — see `docs/psi.md` */
export const psiKhandhas = {
  form: { color: "#e8a15a" },
  sensation: { color: "#ff6b81" },
  perception: { color: "#7be08a" },
  formations: { color: "#b48cff" },
  consciousness: { color: "#9fe8ff" },
} as const;

export type KhandhaKey = keyof typeof psiKhandhas;

/** `[min, max, step]` of each number in `PsiTune` — see `PsiControls` */
export const psiTuneRanges = {
  speed: [0.05, 2, 0.05],
  width: [0.5, 8, 0.25],
  packet: [0.2, 3, 0.1],
  amp: [0, 0.5, 0.01],
  line: [0, 1, 0.05],
  opacity: [0.05, 1, 0.05],
} as const;

/** What the player's bubble adjusts of `Psi`, persisted */
export type PsiTune = {
  /** How fast a wave goes: see `thoughtConfig.speedOver` */
  speed: number;
  /** Pixels wide a wave's line is drawn */
  width: number;
  /** Metres long a wave's sinusoid is */
  packet: number;
  /** Metres the sinusoid rises and falls */
  amp: number;
  /** How much of full strength the line has away from the sinusoid */
  line: number;
  /** Of each wave, which glows additively: lower is fainter */
  opacity: number;
  /** The player's waves: their intention */
  color: string;
};

/** What an npc may be posed as — see jsh `pose` */
export type PoseKey = keyof typeof poseConfig.poses;

/** jsh `pose`: each one's upper clip, and the one drawn in to whilst a crowd neighbour is within `near` metres */
export const poseConfig = {
  poses: {
    point: { upper: "point", avoid: "point_avoid" },
  },
  near: 0.65,
  /** Seconds they stay drawn in at least, and take to draw in */
  holdSecs: 0.5,
  drawInSecs: 0.15,
  /** Seconds the arm takes to come onto whom they pose `at`, from the fist's end in the right forearm's frame */
  aimSecs: 0.3,
  aimFrom: [0, -0.37, 0],
} as const;

/**
 * Stood still after a gait, their feet stay roughly where they stopped — see `npc-stance`. `on: false`
 * for none of it. Lengths are in the model's own metres.
 * - `maxOff`: the furthest a foot is held from where the standing pose has it.
 * - `keep`, `maxSplit`: the share kept of how far apart the feet were, and the most.
 * - `minOff`: feet nearer the pose's places than this are not held at all.
 * - `maxShift`: the furthest the hips move to stand over the feet. `maxLean`: the slant left to the legs.
 * - `level`: ankles within this of one another count as both down, and the one ahead is the planted one.
 */
export const stanceConfig = {
  on: true,
  keep: 0.6,
  maxSplit: 0.24,
  maxOff: 0.2,
  minOff: 0.01,
  maxShift: 0.08,
  maxLean: 0.04,
  level: 0.02,
  fadeSecs: 0.45,
};

/** Metres a cycle of each directional gait covers — measured off the planted foot, `npcScale` included */
export const gaitStride = { walk: 0.84, strafe_right: 0.41, backwards: 0.7, strafe_left: 0.41 };
/** Metres per second strafing each way, blended as the gaits are — see `w.e.move`'s `strafe` */
export const strafeSpeed = { walk: 1.2, strafe_right: 0.5, backwards: 1, strafe_left: 0.5 };
/** Seconds the directional gaits take to follow a change of heading — else a turnabout snaps */
export const strafeEaseSecs = 0.25;
