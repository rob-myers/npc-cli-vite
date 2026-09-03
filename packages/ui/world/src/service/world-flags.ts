/**
 * Per-world booleans that must survive a component HMR (which can remount a component with no
 * memory of e.g. having unveiled) yet reset with the World PANE itself: a re-added world must
 * start behind the veil, flat, else its walls flash unfolded before the bootstrap folds them.
 *
 * Kept on `hot.data` so an edit of this module keeps them too; a reload clears everything,
 * which is right — that genuinely does start behind the veil.
 */
const flags: Record<string, boolean> =
  import.meta.hot !== undefined ? (import.meta.hot.data.__WORLD_FLAGS__ ??= {}) : {};

const clearTimers: Record<string, number> = {};

export function getWorldFlag(name: string, worldKey: string): boolean {
  return flags[`${name}:${worldKey}`] === true;
}

export function setWorldFlag(name: string, worldKey: string, value: boolean): void {
  flags[`${name}:${worldKey}`] = value;
}

export function clearWorldFlags(worldKey: string): void {
  for (const key of Object.keys(flags)) {
    if (key.endsWith(`:${worldKey}`)) delete flags[key];
  }
}

/** Deferred, so an HMR effect bounce can cancel it — only a real pane removal clears */
export function scheduleClearWorldFlags(worldKey: string, ms = 1000): void {
  window.clearTimeout(clearTimers[worldKey]);
  clearTimers[worldKey] = window.setTimeout(() => clearWorldFlags(worldKey), ms);
}

export function cancelClearWorldFlags(worldKey: string): void {
  window.clearTimeout(clearTimers[worldKey]);
}
