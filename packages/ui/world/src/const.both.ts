/** An npc's size, which the world builds around: the crowd, the door sensors, the camera's look height */
export const npcDims = {
  height: 1.2,
  /** Radius of an npc's crowd agent */
  agentRadius: 0.2,
  // agentRadius: 0.28,
  /** Sizes the crowd */
  maxAgentRadius: 0.5,
  /** Margin, on top of an npc's radius */
  shutDoorKeepOut: 0.05,
} as const;

/** A skin's slices, in pixels: a `cell` is a grid of them, and `maxSkins` sizes `w.texSkinSlices` — see `docs/skin-slices.md` */
export const skinSliceDims = { cell: 128, slice: 32, maxSkins: 32 } as const;

/** What each slice holds, in order: a skin's eyes, whole, one way they can be. `open` is clear */
export const eyeFrames = ["open", "half", "shut", "up", "left", "right", "scared", "none"] as const;
export type EyeFrame = (typeof eyeFrames)[number];
/** What an npc's eyes may be set to — see jsh `pose` */
export type EyesKey = EyeFrame | "shifty";
