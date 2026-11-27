/**
 * The npcs' tuning, imported by npc modules alone — never by `World`, `WorldView` or their hooks,
 * which would rebuild the world on every edit. What the world builds AROUND an npc, their size,
 * is `npcDims` in `const.both.ts` — a copy here rather than an import, so this file stays independent
 */

/** An npc's label, unless `label` or the predicates say otherwise */
export const defaultNpcLabelColor = "#ff9";
/** …and anyone else's but the player's */
export const otherNpcLabelColor = "#bbb";
/** An npc label's font weight, the player's and anyone else's. Bolder on touch, whose screens are small */
export const npcLabelWeight = { desktop: { player: 400, other: 100 }, touch: { player: 600, other: 300 } };

export const npcScale = 0.8;

export const npcShadowRadius = npcScale / 2.5;

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
    run: 3.5,
    /** A run's least, at `dist.walkNear` of a wall ahead. Just above `gait.runAbove`, so the run clip stays on */
    runLeast: 2,
    /** Backing away — see `w.e.move`'s `backwards` */
    backwards: 0.8,
    /** A shuffle's steady pace: near the target it eases as the root of the distance — see `NpcAnimation.shuffleSpeed` */
    shuffle: 0.25,
    /** Slower than this a shuffle is still, for stuck detection: per second, not per frame as `dist.stuckEpsilon` is */
    shuffleStill: 0.02,
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
    /** Manhattan distance below which a move from rest uses `shuffle_step` rather than `walk` */
    shuffleTarget: 0.25,
    /** Within this of the closest reachable point we look rather than walk */
    blockedLook: 0.3,
    /** Look before teleporting onto a doable this close by */
    doableLook: 1.5,
    /** Within this, a target behind them is backed onto — past a `wasd_delta --fast` step, so held `s` never turns them */
    backStep: 0.75,
    /** Below this much movement per frame an npc counts as motionless */
    stuckEpsilon: 0.002,
    /** How far `roomAhead`'s ray leans out towards the side they move: to their hands */
    strafeWallSpan: 0.25,
    /**
     * With a wall this near, their right arm is drawn in: a run's swing reaches 0.8m with a gun.
     * Far enough on that the arm is in, or they walk, by the time they get there
     */
    armInNear: { walk: 1, run: 2.3 },
    /** A wall at least this square on (`roomAhead`'s `square`) has them walk too: a run's lean would put their head through */
    walkSquare: 0.7,
    /** Within this of a wall square ahead they walk. Further, up to `armInNear.run`, a straight run slows instead */
    walkNear: 1,
    /** Strafing, `walkNear` by way, blended. A run's guard reaches 0.57m ahead, 0.32m past the navmesh's edge */
    strafeWalkNear: { run_ahead: 1, run_strafe_right: 0.4, run_backwards: 0, run_strafe_left: 0.4 },
    /** Rays this far either side of a square hit, both clear, make it a post, e.g. a thin wall between doors: they keep running */
    postHalf: 0.6,
    /** How far past a post's face those rays must run clear */
    postMargin: 0.3,
    /** Not strafing, `roomAhead`'s ray leans this share of `strafeWallSpan` right of the way they go, the gun's side */
    armInLean: 0.45,
    /** A wall within this to the right of the way they face draws their right arm in. It is where the arm swings */
    armInSide: 0.45,
    /** Within this of the target, getting no nearer for `stuckDuration` counts as circling */
    circling: 0.6,
    /** Idle centres nearer than this intersect. A body is wider than its crowd agent, which keeps them 0.4m apart */
    overlap: 0.5,
    /** How far from the other a shuffle off them aims, centre to centre */
    overlapClear: 0.55,
  },
  time: {
    /** Grace after a move starts, before stuck detection applies */
    stuckGrace: 0.5,
    /** How long an npc must stay motionless to count as stuck */
    /** try fix choke point slow down */
    stuckDuration: 0.8,
    /** How long two idle npcs overlap before one shuffles off */
    overlapDuration: 0.5,
    /** Minimum look duration before teleporting onto a nearby doable */
    look: 0.5,
    /** A wall's draw-in of the right arm holds at least this, else taps at a wall shake it in and out */
    armInHold: 0.5,
  },
} as const;

/** See `getAgentParams` in `components/NPCs.tsx` */
export const crowdConfig = {
  /** Neighbour search range (tried 0.5–1.5) */
  collisionQueryRange: 0.7,
  // collisionQueryRange: 1.7,
  /** Wall search range for avoidance: none, since the navmesh is already cut back from walls by a body's width */
  boundaryQueryRange: 0,
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
  labelHalfWidth: 0.425,
  labelHalfHeight: 0.10625,
  /** Eased to `overheadAmount` as the view elevation goes `overheadFrom` → `overheadTo` */
  rim: { power: 5, amount: 0.2, color: [0.55, 0.72, 0.7], overheadAmount: 0.05, overheadFrom: 0.45, overheadTo: 0.85 },
  /** Exposure is ADDED: `ambient` out of the light, the light taking what that leaves, `litAmbient` on top, and `theme.npcs.sameRoom` */
  ambient: 0.3,
  ambientInSight: 0.12,
  litAmbient: 0.4,
  /** Seconds the player's room's extra light eases over — see `theme.npcs.sameRoom` */
  sameRoomSecs: 0.4,
  /** A light of the npcs' own, from `faceShadeDir`: how far a face turned away darkens, one edge-on half as far */
  faceShade: 0.85,
  /** Where `faceShade`'s light comes from, in world space. Straight above is `[0, 1, 0]` */
  faceShadeDir: [0.25, 1, 0.25],
} as const;

export const fromAnimationClipKey = {
  backwards: true,
  breathe: true,
  check_wrist: true,
  check_wrist_avoid: true,
  collapse: true,
  collapsed: true,
  collapsed_drag: true,
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
  die_back: true,
  die_back_mirror: true,
  die_forward: true,
  die_forward_mirror: true,
  drop: true,
  drop_left: true,
  duck: true,
  get_up_back: true,
  get_up_back_mirror: true,
  get_up_forward: true,
  get_up_forward_mirror: true,
  idle: true,
  lie: true,
  lie_left: true,
  lie_look_around: true,
  lie_pacified: true,
  lie_pain_head: true,
  lie_pain_high: true,
  lie_pain_low: true,
  lie_right: true,
  lie_stretch: true,
  look_around: true,
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
  rub_chin: true,
  run: true,
  run_ahead: true,
  run_backwards: true,
  run_strafe_left: true,
  run_strafe_right: true,
  scp_017_breathe: true,
  scp_017_walk: true,
  scp_035_breathe: true,
  scp_035_walk: true,
  scp_049_breathe: true,
  scp_049_walk: true,
  scp_096_breathe: true,
  scp_096_breathe_avoid: true,
  scp_096_walk: true,
  scp_1000_breathe: true,
  scp_1000_walk: true,
  scp_106_breathe: true,
  scp_106_walk: true,
  scp_173_breathe: true,
  scp_682_breathe: true,
  scp_682_walk: true,
  shift_weight: true,
  shrug: true,
  shuffle: true,
  shuffle_step: true,
  shuffle_step_back: true,
  shuffle_step_left: true,
  shuffle_step_right: true,
  sit: true,
  sit_check_wrist: true,
  sit_lean_forward: true,
  sit_look_around: true,
  sit_pacified: true,
  sit_pain_head: true,
  sit_pain_high: true,
  sit_pain_low: true,
  sit_reach: true,
  sit_rub_chin: true,
  sit_shrug: true,
  strafe_left: true,
  strafe_right: true,
  talk_left: true,
  phaser_aim: true,
  phaser_aim_avoid: true,
  walk: true,
};

/** Clips made at load by mirroring another (`mirrorClip`), so not in the glTF: each by the clip it mirrors */
export const mirroredClips: Partial<Record<ClipKey, ClipKey>> = {
  crouch_half_strafe_left: "crouch_half_strafe_right",
  crouch_left: "crouch",
  crouch_strafe_left: "crouch_strafe_right",
  die_back_mirror: "die_back",
  die_forward_mirror: "die_forward",
  drop_left: "drop",
  get_up_back_mirror: "get_up_back",
  get_up_forward_mirror: "get_up_forward",
  lie_right: "lie_left",
  pain_arm_right: "pain_arm_left",
  pain_leg_right: "pain_leg_left",
  pick_up_left: "pick_up",
};

/** A rest clip with a fidget once a cycle, e.g. `pose rob as:shrug`, within its box: see `gen-clip-keys` */
export const fidgetClipKeys = [
  "look_around",
  "rub_chin",
  "shift_weight",
  "shrug",
  "sit_check_wrist",
  "sit_lean_forward",
  "sit_look_around",
  "sit_rub_chin",
  "sit_shrug",
  "lie_look_around",
  "lie_stretch",
] as const satisfies import("./components/NPCs").AnimationClipKey[];

export const defaultIdleAnimationClipKey = "breathe" satisfies import("./components/NPCs").AnimationClipKey;

/** Fallback for @see {fadeSecs} */
export const defaultFadeSecs = 0.3;
/** Seconds into or out of a half crouch, stood or moving */
export const halfCrouchFadeSecs = 0.18;

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
  /** The most the neck turns towards a hand at their head, e.g. psi: past it the arm would cross the head, so the torso turns */
  heldNeckRad: Math.PI / 6,
  rate: 6,
} as const;

/**
 * One sat raises an arm past a table's edge: first its elbow is drawn `back` upper arms along the forearm's line.
 * They near that by `there` of the way, and leave for the clip's from `onFrom`. It takes `slow` times as long
 */
export const sitArmVia = { back: 1, there: 0.5, onFrom: 0.4, slow: 1.6 } as const;

/**
 * The left hand steadying a phaser as it charges: `grip` in the right forearm's frame, as `gunBoxes`, below the
 * barrel ahead of the handle. Model units. It reaches there over `secs`
 */
export const supportConfig = { grip: [0, -0.44, 0], secs: 0.25 } as const;

/** A "no": the head turns one way then the other `turns` times, `rad` at most, in `secs`. Over `1`, `slowing` gives the later turns more of the time */
export const headShakeConfig = { secs: 0.75, turns: 1, rad: 0.45, slowing: 1.6 } as const;

/**
 * Whilst they speak the head moves, eased in and out over `easeSecs`: it dips up to `pitch` about `hz` times a second,
 * as words come, and sways up to `sway` either way
 */
export const talkConfig = { pitch: 0.12, sway: 0.08, hz: 2.5, swayHz: 0.6, easeSecs: 0.25 } as const;

/**
 * A shot armour took jolts them: radians the struck part turns at most, and seconds to that and in all.
 * Each bone it hangs from turns `falloff` as far as the one below.
 */
export const flinchConfig: FlinchTune = { rad: 0.3, peakSecs: 0.06, secs: 0.45, falloff: 0.5 };

/** A hit jolts them twice as hard, peaking later. Whilst hurt they stay turned `hold` of the way. An arm turns `arms` as far */
export const hitFlinchConfig: FlinchTune = { ...flinchConfig, rad: 0.6, peakSecs: 0.1, hold: 0.3, arms: 0.4 };

/** A foot landing on a corpse jolts it a little */
export const stepFlinchConfig: FlinchTune = { ...flinchConfig, rad: 0.12, peakSecs: 0.05, secs: 0.3 };

export type FlinchTune = {
  rad: number;
  peakSecs: number;
  secs: number;
  falloff: number;
  hold?: number;
  /** How far it turns an arm, of `rad`, and what the arm hangs from falls off from that. A full turn takes it into the body */
  arms?: number;
};

/**
 * Whilst hurt a hand goes to the wound, if in reach. It eases in and out over `easeSecs`,
 * and stays `lingerSecs` after they recover, unless they move.
 */
export const clutchConfig = {
  /** Metres off the torso or a limb the hand rests: its half-thickness, as the forearm lies along it */
  palm: 0.08,
  /** Metres off the head the hand rests: it meets it end-on */
  palmHead: 0.03,
  /** Metres the hand may cross past their middle, e.g. onto the other arm */
  cross: 0.25,
  /** Metres from the shoulder a hand on its own side must be, else it takes the front: nearer, the arm folds up */
  sideMin: 0.25,
  /** Metres the elbow keeps off the chest: out past its side, or in front, and down from the reach */
  elbow: 0.1,
  easeSecs: 0.5,
  lingerSecs: 1.5,
} as const;

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
  /** Looped until released: every other clip above plays once */
  pacified: ["pacified", "sit_pacified", "lie_pacified"] as ClipKey[],
  /**
   * What a clip played once goes on to, looped until released: a head shot pacifies, and a body shot collapses one
   * stood. Any other goes back to rest, or to whatever they were in before
   */
  next: {
    collapse: "collapsed",
    pain_head: "pacified",
    pain_high: "collapsed",
    sit_pain_head: "sit_pacified",
    lie_pain_head: "lie_pacified",
  } as Partial<Record<ClipKey, ClipKey>>,
  /** Put down stood, a torso hit sinks them where they stand into `collapsed` */
  sink: "collapse" as ClipKey,
  /** Seconds a hurt clip fades in over, so its first jolt reads */
  fadeInSecs: 0.08,
};

/** Killed: how they fall, fit and lie, and get up again — see `w.e.takeHit` */
export const deathConfig = {
  /** Killed stood, they fall dead the way the shot pushes, held on its last frame: shot from the front, `back` */
  die: { back: "die_back", forward: "die_forward" } satisfies Record<string, ClipKey>,
  /** Revived, they get up by these, by the clip they fell by: one with none is let go at once */
  getUp: {
    die_back: "get_up_back",
    die_back_mirror: "get_up_back_mirror",
    die_forward: "get_up_forward",
    die_forward_mirror: "get_up_forward_mirror",
  } as Partial<Record<ClipKey, ClipKey>>,
  /** A death plays at a random rate between these, so no two fall in step */
  dieRate: [0.85, 1.15] as [number, number],
  /** Metres they lie either side of their middle: a wall nearer pushes them off it as they fall */
  lieWidth: 0.45,
  /** Metres either side a fall keeps clear of others and corpses: less than `lieWidth`, so bodies may overlap a little */
  othersWidth: 0.25,
  /** Metres of clear floor a fall dead needs along its way: behind them falling back, ahead falling forward */
  lieLength: { back: 1.25, forward: 1.8 },
  /** Radians a fall dead may turn to fit, tried in this order, before falling the other way */
  fitTurns: [0, 0.5, -0.5, 1, -1, 1.5, -1.5],
  /** Radians a fall dead turns off the shot's line at most, either way, at random but mostly little: so the dead do not lie aligned */
  fallJitter: 0.3,
  /** Of a fall's clip, how far in its turn and slide are done: before their body reaches out, e.g. into a wall */
  fitBy: 0.4,
  /** Metres their hips are off the floor as a fall dead lands, when `npc-fell` is emitted, e.g. for its thud */
  fellHipsY: 0.25,
  /** Metres a stood npc killed with no room to fall may stagger, nearer first, to fall where there is */
  staggerBy: [0.5, 1],
  /** Killed sat or lain, the pain clip goes on to this, held still at `deadSecs` into it. Stood, they `die` */
  dead: { sit: "sit_pacified", lie: "lie_pacified" } as Partial<Record<string, ClipKey>>,
  deadSecs: 0,
};

/** Over a corpse, a sole clears their body by `clear`. Its sensor is `margin` wider */
export const corpseConfig = {
  clear: 0.03,
  margin: 0.3,
  /** Metres in from their body's edge its height ramps up over */
  ramp: 0.04,
  /** Metres a second their hips rise or drop, as they step on or off */
  speed: 2,
};

/** Effects an npc may show, by `fxKind`: a skin's `fx` meta, else jsh `fx` — see `docs/skins.md` */
export const npcFxKinds = ["none", "static", "noir", "ghost", "shroud", "embers"] as const;

/**
 * An `embers` effect's sparks, rising off the body and fading: how many each, metres across, seconds each lasts,
 * metres it rises and drifts, and where on the body they start (metres out, and up as a share of height)
 */
export const emberConfig = {
  count: 20,
  size: 0.035,
  life: 3.6,
  rise: 0.45,
  drift: 0.05,
  spread: 0.18,
  from: 0.25,
  to: 1,
  /** New, then dying (linear) */
  hot: [1, 0.55, 0.12],
  cool: [0.6, 0.06, 0],
  glow: 1.2,
  /** How quickly each fades through its life: `1` evenly, higher sooner */
  fadeOut: 2.5,
  /** Metres they are drawn toward the camera, so those behind the body show over it */
  towardCamera: 0.35,
} as const;

/** A shroud's cloth colour (linear): their rim alone shows their shape */
export const shroudConfig = { color: [0, 0, 0] } as const;

/** Ghost and static: a shot passes through them, as they become a stipple or a dot screen — see `NpcGhost` */
export const ghostConfig = {
  /** How much of either look their body takes, over `inSecs` as the shot locks on, which waits till then */
  amount: 1,
  /** A ghost's share of screen pixels dropped, at most */
  stipple: 0.5,
  inSecs: 0.2,
  /** The dots: radians the grid turns, per pixel so higher is smaller, as `dotScreen` in `extra-fx`, and how bright they read the body */
  dots: { angle: Math.PI / 2, scale: 4.9, gain: 1.6 },
  /** Seconds they stay so once it lands, else after it locked on, then come back over `outSecs` */
  holdSecs: 0.4,
  missSecs: 1.5,
  outSecs: 0.5,
};

/** Armour: struck, the shot glances off the face it met, in a spray of sparks — see `NpcArmour` */
export const armourConfig = {
  color: "#8fe6ff",
  /** The shot glancing off: metres a second, metres long and wide, seconds, and how white */
  ricochet: { speed: 9, length: 0.45, width: 0.03, life: 0.25, white: 0.6 },
  /** Sparks round it: how many, radians off it at most, metres a second, metres long and wide, seconds */
  sparks: { count: 10, spread: 0.9, speed: [1.5, 3.5] as [number, number], length: 0.05, width: 0.012, life: 0.35 },
  /** How fast a streak slows, and how bright it is */
  drag: 6,
  bright: 0.9,
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
  backwards: { crouch_half_backwards: halfCrouchFadeSecs },
  breathe: { shuffle: 0.15, shuffle_step: 0.2, crouch_half: halfCrouchFadeSecs },
  check_wrist: {},
  check_wrist_avoid: {},
  collapse: { collapsed: 0 },
  collapsed: {},
  collapsed_drag: {},
  crouch: {},
  crouch_backwards: {},
  crouch_cover: {},
  crouch_half: { breathe: halfCrouchFadeSecs },
  crouch_half_backwards: { backwards: halfCrouchFadeSecs },
  crouch_half_strafe_left: {},
  crouch_half_strafe_right: {},
  crouch_half_walk: { walk: halfCrouchFadeSecs },
  crouch_left: {},
  crouch_strafe_left: {},
  crouch_strafe_right: {},
  crouch_walk: {},
  die_back: {},
  die_back_mirror: {},
  die_forward: {},
  die_forward_mirror: {},
  drop: {},
  drop_left: {},
  duck: {},
  get_up_back: { breathe: 0 },
  get_up_back_mirror: { breathe: 0 },
  get_up_forward: { breathe: 0 },
  get_up_forward_mirror: { breathe: 0 },
  idle: { shuffle: 0.15, shuffle_step: 0.2 },
  lie: { lie_left: 0.5, lie_right: 0.5 },
  lie_left: { lie: 0.5, lie_right: 0.6 },
  lie_look_around: {},
  lie_pacified: {},
  lie_pain_head: {},
  lie_pain_high: { lie_pacified: pacifyFadeSecs },
  lie_pain_low: { lie_pacified: pacifyFadeSecs },
  lie_right: { lie: 0.5, lie_left: 0.6 },
  lie_stretch: {},
  look_around: {},
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
  rub_chin: {},
  run: { shuffle: 0.15, walk: 0.25 },
  run_ahead: { shuffle: 0.15, walk: 0.25 },
  run_backwards: {},
  run_strafe_left: {},
  run_strafe_right: {},
  scp_017_breathe: {},
  scp_017_walk: {},
  scp_035_breathe: {},
  scp_035_walk: {},
  scp_049_breathe: {},
  scp_049_walk: {},
  scp_096_breathe: {},
  scp_096_breathe_avoid: {},
  scp_096_walk: {},
  scp_1000_breathe: {},
  scp_1000_walk: {},
  scp_106_breathe: {},
  scp_106_walk: {},
  scp_173_breathe: {},
  scp_682_breathe: {},
  scp_682_walk: {},
  shift_weight: {},
  shrug: {},
  // brief, so it must fade quickly to be seen at all
  shuffle: { breathe: 0.15, idle: 0.15 },
  /** Slower to rest than to start, so the legs settle out of their last step */
  shuffle_step: { breathe: 0.4, idle: 0.4 },
  shuffle_step_back: {},
  shuffle_step_left: {},
  shuffle_step_right: {},
  sit: {},
  sit_check_wrist: {},
  sit_lean_forward: {},
  sit_look_around: {},
  sit_pacified: {},
  sit_pain_head: {},
  sit_pain_high: { sit_pacified: pacifyFadeSecs },
  sit_pain_low: { sit_pacified: pacifyFadeSecs },
  sit_reach: {},
  sit_rub_chin: {},
  sit_shrug: {},
  strafe_left: {},
  strafe_right: {},
  talk_left: {},
  phaser_aim: { shuffle: 0.15 },
  phaser_aim_avoid: {},
  walk: { shuffle: 0.15, run: 0.25, run_ahead: 0.25, crouch_half_walk: halfCrouchFadeSecs },
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

/**
 * jsh `pose`: each one's upper clip, its arm, and the one drawn in to whilst a crowd neighbour is within `near` metres.
 * A right arm's pose also points at whom it is `at`
 */
export const poseConfig = {
  poses: {
    point: { upper: "point", avoid: "point_avoid", side: "right" },
    check_wrist: { upper: "check_wrist", avoid: "check_wrist_avoid", side: "right" },
    talk_left: { upper: "talk_left", avoid: null, side: "left" },
  },
  near: 0.65,
  /** Metres within which another draws a skin's idle in, e.g. `scp_096_breathe_avoid`: it reaches further than an arm */
  idleNear: 1,
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
  crouch_half_walk: 0.4,
  crouch_half_strafe_right: 0.25,
  crouch_half_backwards: 0.4,
  crouch_half_strafe_left: 0.25,
  run: 2.23,
  run_ahead: 1.72,
  run_strafe_right: 0.8,
  run_backwards: 1,
  run_strafe_left: 0.8,
  shuffle_step: 0.12,
  shuffle_step_right: 0.12,
  shuffle_step_back: 0.12,
  shuffle_step_left: 0.12,
};
/** Metres per second strafing each way, blended as the gaits are — see `w.e.move`'s `strafe`. Crouched, any move */
export const strafeSpeed = {
  walk: 1.2,
  strafe_right: 0.73,
  backwards: 1,
  strafe_left: 0.73,
  crouch_walk: 0.5,
  crouch_strafe_right: 0.3,
  crouch_backwards: 0.4,
  crouch_strafe_left: 0.3,
  crouch_half_walk: 0.85,
  crouch_half_strafe_right: 0.55,
  crouch_half_backwards: 0.8,
  crouch_half_strafe_left: 0.55,
  /** Running, each way paced near a straight run's cadence. Ahead may differ from `maxSpeed.run` */
  run_ahead: 3,
  run_strafe_right: 1.7,
  run_backwards: 1.7,
  run_strafe_left: 1.7,
  /** A short move's, each way: the crowd slows it near the target, so it peaks far lower */
  shuffle_step: agentConfig.maxSpeed.shuffle,
  shuffle_step_right: agentConfig.maxSpeed.shuffle,
  shuffle_step_back: agentConfig.maxSpeed.shuffle,
  shuffle_step_left: agentConfig.maxSpeed.shuffle,
};
/** Seconds the directional gaits take to follow a change of heading — else a turnabout snaps */
export const strafeEaseSecs = 0.25;

/** A stoop under a lintel, added over any gait (`duck`, additive): seconds it takes to ease in or out */
export const duckConfig = { fadeSecs: 0.25 };

/** One collapsed scoots back-first (`collapsed_drag`): metres a cycle covers, and metres per second */
export const dragConfig = { stride: 0.25, speed: 0.25 } as const;

/** What psi may do to whom it focuses on: placeholders */
export const psiActions = ["distract", "rush", "tired", "toilet"] as const;
