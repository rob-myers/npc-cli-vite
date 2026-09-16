/** An npc's size, which the world builds around: the crowd, the door sensors, the camera's look height */
export const npcDims = {
  height: 1.2,
  /** Radius of an npc's crowd agent */
  agentRadius: 0.18,
  /** Sizes the crowd */
  maxAgentRadius: 0.5,
  /** Margin, on top of an npc's radius */
  shutDoorKeepOut: 0.05,
} as const;
