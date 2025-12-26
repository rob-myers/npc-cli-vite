export const ProcessTag = {
  /** STOP/CONT by ptags is based on this process tag */
  always: "always",
  /** Interactive processes e.g. a non-background pipeline spawned from shell */
  interactive: "interactive",
} as const;
