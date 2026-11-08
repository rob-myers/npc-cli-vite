/**
 * Whether the page's sound is muted, kept across visits: muted until first unmuted.
 * Shared by the World's hud-toast and the audio engine, which never import each other
 */
export const soundMute = {
  get(): boolean {
    try {
      return localStorage.getItem(storageKey) !== "false";
    } catch {
      return true;
    }
  },
  set(muted: boolean) {
    try {
      localStorage.setItem(storageKey, String(muted));
    } catch {} // e.g. storage blocked: muted for this visit alone
    for (const listener of listeners) listener(muted);
  },
  /** Runs `listener` on each change, returning its unsubscribe */
  subscribe(listener: (muted: boolean) => void) {
    listeners.add(listener);
    return () => void listeners.delete(listener);
  },
};

const storageKey = "sound-muted";
const listeners = new Set<(muted: boolean) => void>();
