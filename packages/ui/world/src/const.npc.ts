/**
 * The npcs' tuning, imported by npc modules alone — never by `World`, `WorldView` or their hooks,
 * which would rebuild the world on every edit. What the world builds AROUND an npc, their size,
 * is `npcDims` in `const.env.ts`
 */

/** An npc's label, unless `label` or the predicates say otherwise */
export const defaultNpcLabelColor = "#ff9";

export const npcScale = 0.7;

export const npcShadowRadius = npcScale / 2.5;

/** How far clear of a door somebody must stand to be out of the traffic through it */
export const doorwayClearance = 0.6;
/** How far out `park` looks for a wall to stand against */
export const parkQueryRange = 2;
/** Below this much of a move, `park` turns them on the spot instead */
export const parkMinMove = 0.02;

export const idleMaxAcceleration = 4.0;
export const idleSeparatingMaxAcceleration = 0.25;
export const walkMaxAcceleration = 8.0;
export const idleAgentMaxSpeed = 0.5;
/** Separating idle npcs should not move by default */
export const idleSeparatingMaxSpeed = 0.005;
export const walkAgentMaxSpeed = 1.5;
export const runAgentMaxSpeed = 2.5;
/** Too large breaks arrival near other npc */
// export const walkSeparationWeight = 0.5;
export const walkSeparationWeight = 1.5;
/** Less pushable */
export const idleSeparationWeight = 0.1; // Less pushable

/**
 * NPC tuning: `npcConfig.dist` in meters, `npcConfig.time` in seconds, `npcConfig.angle` in radians.
 */
export const npcConfig = {
  angle: {
    /** Opening turn beyond which an npc shuffles round before walking off */
    turnBeforeMove: Math.PI * 0.75,
  },
  dist: {
    /** Arrival radius, per `running` and whether we slow down beforehand */
    arrive: { walk: 0.15, run: 0.025 },
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
  /** Wall search range: shorter, else walkers slow early beside walls */
  boundaryQueryRange: 0.4,
  /** Keeps a side once taken: `2` intersects less, `0.75` rounds npcs better */
  avoidanceWeightCurVel: 0.75,
  /** navcat's is 20 */
  quickSearchIterations: 64,
  /** Enough to reach the sliced search */
  warmTicks: 4,
} as const;

/** `findNearestPoly` query box and tolerance, by accuracy */
export const closestPolyByAccuracy: Record<
  "0.005" | "0.1" | "0.5",
  { halfExtents: [number, number, number]; distance: number }
> = {
  "0.005": { halfExtents: [0.005, 0.005, 0.005], distance: 0.005 },
  "0.1": { halfExtents: [0.1, 0.1, 0.1], distance: 0.1 },
  "0.5": { halfExtents: [0.5, 0.5, 0.5], distance: 0.5 },
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
  /** Least colour a lit npc keeps outside the player's light */
  litUnseen: 0.5,
} as const;

export const fromAnimationClipKey = {
  idle: true,
  /** `idle` leant back, shoulders back — see jsh's `demo_lean_back` */
  "idle-avoid": true,
  breathe: true,
  lie: true,
  run: true,
  shuffle: true,
  sit: true,
  walk: true,
};

export const defaultIdleAnimationClipKey = "breathe" satisfies import("./components/NPCs").AnimationClipKey;

/** Fallback for @see {fadeSecs} */
export const defaultFadeSecs = 0.3;

/**
 * Cross-fade seconds `fadeSecs[src][dst]`, from one animation clip into another.
 * A missing destination falls back to @see {defaultFadeSecs}.
 */
export const fadeSecs: Record<
  keyof typeof fromAnimationClipKey,
  Partial<Record<keyof typeof fromAnimationClipKey, number>>
> = {
  breathe: { shuffle: 0.15, "idle-avoid": 0.4 },
  idle: { shuffle: 0.15 },
  "idle-avoid": { breathe: 0.4 },
  lie: {},
  run: { shuffle: 0.15 },
  // brief, so it must fade quickly to be seen at all
  shuffle: { breathe: 0.15, idle: 0.15 },
  sit: {},
  walk: { shuffle: 0.15 },
};
