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
  collapsed: true,
  crouch: true,
  crouch_backwards: true,
  crouch_cover: true,
  crouch_half: true,
  crouch_half_backwards: true,
  crouch_half_strafe_left: true,
  crouch_half_strafe_right: true,
  crouch_half_walk: true,
  crouch_left: true,
  crouch_strafe_left: true,
  crouch_strafe_right: true,
  crouch_walk: true,
  dodge_arm_left: true,
  dodge_arm_right: true,
  dodge_duck: true,
  dodge_duck_low: true,
  dodge_hop: true,
  drop: true,
  drop_left: true,
  idle: true,
  lie: true,
  lie_left: true,
  lie_pacified: true,
  lie_pain_head: true,
  lie_pain_high: true,
  lie_pain_low: true,
  lie_right: true,
  pacified: true,
  pain_arm_left: true,
  pain_arm_right: true,
  pain_head: true,
  pain_high: true,
  pain_leg_left: true,
  pain_leg_right: true,
  pick_up: true,
  pick_up_left: true,
  point: true,
  point_avoid: true,
  psi: true,
  run: true,
  shuffle: true,
  sit: true,
  sit_dodge_back: true,
  sit_dodge_brace: true,
  sit_dodge_duck: true,
  sit_dodge_lean_left: true,
  sit_dodge_lean_right: true,
  sit_dodge_legs: true,
  sit_pacified: true,
  sit_pain_head: true,
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

/** One lain rolls over at most once per `secs`, as long as the longest fade between their poses */
export const lieRoll = { secs: 0.6 } as const;

/**
 * One lain aims `ahead`, and anywhere from `from` to `to`: radians off their facing, which is towards their feet,
 * and positive to their left. On a side, they reach further down the bed than up it
 */
export const lieAim: Partial<Record<string, { ahead: number; from: number; to: number; drawIn?: boolean }>> = {
  /** On their back, not to their left at all: the arm aiming, their right, would lie across their body */
  lie: { ahead: 0, from: -Math.PI / 4, to: 0 },
  /** The arm aiming is on top, so a wall draws it in as one sat, not down by their side */
  lie_left: { ahead: Math.PI / 2, from: Math.PI / 9, to: (2 * Math.PI) / 3, drawIn: true },
  lie_right: { ahead: -Math.PI / 2, from: (-2 * Math.PI) / 3, to: -Math.PI / 9 },
};

/** The most one lain lifts or turns their head to look where they aim */
export const lieHeadMaxRad = Math.PI / 6;

/**
 * One sat turns towards a point without turning round: `maxRad` either way, the torso taking `body` of it and the head the rest.
 * A phaser aims from `aimFrom` to `aimTo`, radians off their facing and positive to their left
 */
export const sitTurn = {
  maxRad: Math.PI / 2,
  aimFrom: (-2 * Math.PI) / 3,
  aimTo: (2 * Math.PI) / 3,
  /** Past this to their left, the torso turns with the gun: the arm aiming, their right, would cross their chest */
  aimTorsoFrom: Math.PI / 4,
  body: 0.25,
  rate: 6,
} as const;

/**
 * One sat raises an arm past a table's edge: by way of this pose of the LEFT arm, elbow back and out, as Blockbench
 * keys it. They near it by `there` of the way, and leave for the clip's from `onFrom`. It takes `slow` times as long
 */
export const sitArmVia = { arm: [-70, 0, -30], forearm: [155, 0, 0], there: 0.5, onFrom: 0.4, slow: 1.6 } as const;

/** A "no": the head turns one way then the other `turns` times, `rad` at most, in `secs`. Over `1`, `slowing` gives the later turns more of the time */
export const headShakeConfig = { secs: 0.75, turns: 1, rad: 0.45, slowing: 1.6 } as const;

type ClipKey = keyof typeof fromAnimationClipKey;
export type HitRegion = "head" | "torso" | `${"arm" | "leg"}_${"left" | "right"}`;

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
      head: "pain_head",
      torso: "pain_high",
      arm_left: "pain_arm_left",
      arm_right: "pain_arm_right",
      leg_left: "pain_leg_left",
      leg_right: "pain_leg_right",
    },
    sit: {
      head: "sit_pain_head",
      torso: "sit_pain_high",
      arm_left: "sit_pain_low",
      arm_right: "sit_pain_low",
      leg_left: "sit_pain_low",
      leg_right: "sit_pain_low",
    },
    lie: {
      head: "lie_pain_head",
      torso: "lie_pain_high",
      arm_left: "lie_pain_low",
      arm_right: "lie_pain_low",
      leg_left: "lie_pain_low",
      leg_right: "lie_pain_low",
    },
  } satisfies Record<string, Record<HitRegion, ClipKey>>,
  /**
   * The dodges, each played once as a shot locks on: its weight, and for each part's line the shooter's bearings it clears.
   * 24 characters, 15 degrees apart from ahead round to their left, `1` clear: measured in Blockbench — see `w.npc.dodge`
   */
  dodgeClips: {
    dodge_duck: { weight: 3, clears: { head: "111111111111111111111111" } },
    dodge_duck_low: { weight: 2, clears: { head: "111111111111111111111111", torso: "111111111111111111111111" } },
    dodge_arm_left: { weight: 3, clears: { arm_left: "110000000011110000000011" } },
    dodge_arm_right: { weight: 3, clears: { arm_right: "111000000001111000000001" } },
    dodge_hop: { weight: 3, clears: { leg_left: "111111111111111111100111", leg_right: "100100111111111111111111" } },
    sit_dodge_duck: {
      weight: 3,
      clears: {
        head: "111111111111111111111111",
        arm_left: "110000000000110000000000",
        arm_right: "100000000001100000000001",
      },
    },
    sit_dodge_lean_left: {
      weight: 3,
      clears: { head: "111000000111111000000111", arm_right: "110100000001110100000001" },
    },
    sit_dodge_lean_right: {
      weight: 3,
      clears: { head: "111100000011111100000011", arm_left: "110000000101110000000101" },
    },
    sit_dodge_back: {
      weight: 2,
      clears: { arm_left: "100000011111100000111111", arm_right: "111111100000111111000000" },
    },
    sit_dodge_brace: {
      weight: 1,
      clears: {
        head: "111111111111111111111111",
        torso: "111111111111111111111111",
        arm_left: "111111110111111111111111",
        arm_right: "111111111111111101111111",
      },
    },
    sit_dodge_legs: {
      weight: 3,
      clears: { leg_left: "111111111100000001111111", leg_right: "111111110000001111111111" },
    },
  } as Partial<Record<ClipKey, { weight: number; clears: Partial<Record<HitRegion, string>> }>>,
  /** Where a dodged shot aims, by posture and part, else at the part. Sat, at the upper arm: a hand rests by the thigh */
  dodgeAim: {
    sit: { arm_left: "leftarm", arm_right: "rightarm" },
  } as Partial<Record<"stand" | "sit" | "lie", Partial<Record<HitRegion, string>>>>,
  /** Seconds a dodge takes to come in: quicker than any other pose, so it is under way as the beam arrives */
  dodgeFadeSecs: 0.08,
  /** How fast one stood turns to face a shot they dodge: each stood dodge clears its part's line from ahead */
  dodgeTurnRate: 20,
  /** Looped until released: every other clip above plays once */
  pacified: ["pacified", "sit_pacified", "lie_pacified"] as ClipKey[],
  /**
   * What a clip played once goes on to, looped until released: a head shot pacifies, and a body shot collapses one
   * stood. Any other goes back to rest, or to whatever they were in before
   */
  next: {
    pain_head: "pacified",
    pain_high: "collapsed",
    sit_pain_head: "sit_pacified",
    lie_pain_head: "lie_pacified",
  } as Partial<Record<ClipKey, ClipKey>>,
};

/** A personal shield's pieces, lit where a shot is stopped — see `NpcShields` */
export const shieldConfig = {
  color: "#8fe6ff",
  /** Times the size of the head the helmet is */
  helmet: 1.35,
  /** Times its part's girth, and its length, a band is */
  band: { girth: 1.35, length: 0.95 },
  /** Hex cells round and along each kind */
  cells: { helmet: [14, 4], band: [10, 3] } as Record<"helmet" | "band", [number, number]>,
  /** Unit lengths a second the lattice spreads from the hit */
  spreadSpeed: 4,
  /** Seconds it holds, then the seconds by which it has dissolved, cell by cell */
  holdSecs: 0.35,
  endSecs: 0.9,
};

/** Seconds a pain clip takes to go limp into pacified: it ends stood, not slumped */
export const pacifyFadeSecs = 0.8;

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
  collapsed: {},
  crouch: {},
  crouch_backwards: {},
  crouch_cover: {},
  crouch_half: {},
  crouch_half_backwards: {},
  crouch_half_strafe_left: {},
  crouch_half_strafe_right: {},
  crouch_half_walk: {},
  crouch_left: {},
  crouch_strafe_left: {},
  crouch_strafe_right: {},
  crouch_walk: {},
  dodge_arm_left: {},
  dodge_arm_right: {},
  dodge_duck: {},
  dodge_duck_low: {},
  dodge_hop: {},
  drop: {},
  drop_left: {},
  idle: { shuffle: 0.15 },
  lie: { lie_left: 0.5, lie_right: 0.5 },
  lie_left: { lie: 0.5, lie_right: 0.6 },
  lie_pacified: {},
  lie_pain_head: {},
  lie_pain_high: { lie_pacified: pacifyFadeSecs },
  lie_pain_low: { lie_pacified: pacifyFadeSecs },
  lie_right: { lie: 0.5, lie_left: 0.6 },
  pacified: {},
  pain_arm_left: { pacified: pacifyFadeSecs },
  pain_arm_right: { pacified: pacifyFadeSecs },
  pain_head: {},
  pain_high: { collapsed: pacifyFadeSecs, pacified: pacifyFadeSecs },
  pain_leg_left: { pacified: pacifyFadeSecs },
  pain_leg_right: { pacified: pacifyFadeSecs },
  pick_up: {},
  pick_up_left: {},
  point: {},
  point_avoid: {},
  psi: {},
  run: { shuffle: 0.15, walk: 0.25 },
  // brief, so it must fade quickly to be seen at all
  shuffle: { breathe: 0.15, idle: 0.15 },
  sit: {},
  sit_dodge_back: {},
  sit_dodge_brace: {},
  sit_dodge_duck: {},
  sit_dodge_lean_left: {},
  sit_dodge_lean_right: {},
  sit_dodge_legs: {},
  sit_pacified: {},
  sit_pain_head: {},
  sit_pain_high: { sit_pacified: pacifyFadeSecs },
  sit_pain_low: { sit_pacified: pacifyFadeSecs },
  sit_reach: {},
  strafe_left: {},
  strafe_right: {},
  phaser_aim: { shuffle: 0.15 },
  phaser_aim_avoid: {},
  walk: { shuffle: 0.15, run: 0.25 },
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

/** How an npc breathes: the player's is adjusted in their bubble, persisted — see `docs/npc-breath.md` */
export type BreathTune = {
  /** Breaths a minute */
  rate: number;
  /** The share of a breath spent breathing in */
  inhale: number;
  /** Metres their lungs swell at the top of a breath */
  reach: number;
  /** How bright their lungs and diaphragm are */
  glow: number;
};

export const defaultBreathTune: BreathTune = { rate: 14, inhale: 0.4, reach: 0.035, glow: 0.6 };

/** `[min, max, step]` of each — see `BreathControls` */
export const breathTuneRanges = {
  rate: [2, 40, 1],
  inhale: [0.2, 0.8, 0.05],
  reach: [0, 0.1, 0.005],
  glow: [0, 1, 0.05],
} as const;

/** Lengths are the model's own units, in the chest bone's frame: forward is `-z` */
export const breathConfig = {
  /** How hard the lungs recoil breathing out: higher empties them sooner, leaving a longer pause */
  recoil: 6,
  /** Seconds breathing takes to come on, or to settle once off */
  easeSecs: 1,
  lung: {
    color: "#ff4d4d",
    /** Each lung's centre, the left's mirrored, and its radii with their lungs empty */
    centre: [0.1, 0.02, 0],
    radii: [0.07, 0.105, 0.08],
    /** How much of a lung shows face-on: the rest gathers at its silhouette, by `rimPower` */
    faceOn: 0.25,
    rimPower: 1.5,
    /** How bright they are empty, as a share of full */
    empty: 0.45,
  },
  diaphragm: {
    color: "#ff9aa8",
    /** The height of its rim, how far its dome rises above that, and its radii */
    y: -0.115,
    dome: 0.07,
    radii: [0.19, 0.115],
    /** How far its crown drops at the top of a breath, per `reach` */
    travel: 1.5,
    /** How bright it is at rest, as a share of contracting */
    rest: 0.3,
  },
  /**
   * Looked down on, the ghost lies over their head, so it goes faint. `fade` is from and to, as the cosine
   * between the way they are looked at and the way their chest stands: `0` is straight on, and full
   */
  above: { fade: [0.2, 0.6], left: 0.15 },
  /** Metres nearer the eye its depth is drawn, so it shows through their own body yet not a wall */
  depthBias: 0.4,
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

/** The frames a blink and a shifty look step through, by name in `eyeFrames` — see `docs/skin-slices.md` */
export const eyesConfig = {
  blink: { frames: ["half", "shut", "half"], frameSecs: 0.05, gapSecs: 0.2 },
  shifty: { frames: ["left", "right"], frameSecs: 0.6 },
  /** The face front, as fractions of a skin */
  face: { x: 32 / 256, y: 32 / 256, size: 32 / 256 },
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

/** Metres a cycle of each directional gait covers — measured off the planted foot, `npcScale` included. Crouched, as keyed */
export const gaitStride = {
  walk: 0.84,
  strafe_right: 0.41,
  backwards: 0.7,
  strafe_left: 0.41,
  crouch_walk: 0.4,
  crouch_strafe_right: 0.25,
  crouch_backwards: 0.4,
  crouch_strafe_left: 0.25,
  crouch_half_walk: 0.5,
  crouch_half_strafe_right: 0.3,
  crouch_half_backwards: 0.5,
  crouch_half_strafe_left: 0.3,
};
/** Metres per second strafing each way, blended as the gaits are — see `w.e.move`'s `strafe`. Crouched, any move */
export const strafeSpeed = {
  walk: 1.2,
  strafe_right: 0.5,
  backwards: 1,
  strafe_left: 0.5,
  crouch_walk: 0.5,
  crouch_strafe_right: 0.3,
  crouch_backwards: 0.4,
  crouch_strafe_left: 0.3,
  crouch_half_walk: 0.8,
  crouch_half_strafe_right: 0.4,
  crouch_half_backwards: 0.6,
  crouch_half_strafe_left: 0.4,
};
/** Seconds the directional gaits take to follow a change of heading — else a turnabout snaps */
export const strafeEaseSecs = 0.25;
