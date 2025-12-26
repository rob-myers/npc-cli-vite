export const ProcessTag = {
  /** STOP/CONT by ptags is based on this process tag */
  always: "always",
  /** Interactive processes e.g. a non-background pipeline spawned from shell */
  interactive: "interactive",
} as const;

/**
 * Whilst paused, should spawned background processes also start paused?
 */
export const spawnBgPausedDefault = false;

export const toProcessStatus = {
  Suspended: 0,
  Running: 1,
  Killed: 2,
} as const;

/** `0` is suspended, `1` is running, `2` is killed */
export type ProcessStatus = (typeof toProcessStatus)[keyof typeof toProcessStatus];
