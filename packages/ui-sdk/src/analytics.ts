import { tryLocalStorageGet, tryLocalStorageRemove, tryLocalStorageSet } from "@npc-cli/util/legacy/generic";

type EventData = Record<string, string | number>;
type Umami = { track(name: string, data?: EventData): void };

/** umami's own kill-switch: it tests truthiness, so enabling means REMOVING the key */
const disabledKey = "umami.disabled";
const loadedDebounceMs = 3000;

type Session = {
  /** ui ids already measured, so an effect re-run on HMR does not re-record */
  seen: Set<string>;
  pending: { uiKey: string; ms: number }[];
  sentLoaded: boolean;
  timeoutId: undefined | ReturnType<typeof setTimeout>;
  /** events raised before the deferred umami script ran */
  queue: [string, EventData][];
};

const newSession = (): Session => ({
  seen: new Set(),
  pending: [],
  sentLoaded: false,
  timeoutId: undefined,
  queue: [],
});

// survives HMR, else a module re-execution resets the guards and resends — cf. `uiStore`
const session: Session = import.meta.hot ? (import.meta.hot.data.__ANALYTICS__ ??= newSession()) : newSession();

export const isTrackingDisabled = (): boolean => !!tryLocalStorageGet(disabledKey);

export function setTrackingDisabled(next: boolean): void {
  if (next === true) {
    tryLocalStorageSet(disabledKey, "1");
  } else {
    tryLocalStorageRemove(disabledKey);
  }
}

function track(name: string, rawData: EventData): void {
  if (typeof window === "undefined") return;
  // umami's own `screen` is the physical display; this is the room the app actually had
  const data = { ...rawData, viewport: `${window.innerWidth}x${window.innerHeight}` };
  if (import.meta.env.DEV) console.debug("📊", name, data);
  if (isTrackingDisabled()) return;

  const umami = (window as unknown as { umami?: Umami }).umami;
  // not just presence: an id on the script tag, or a blocker's stub, can shadow `window.umami`
  if (typeof umami?.track !== "function") {
    session.queue.push([name, data]); // the deferred script has not run yet
    return;
  }
  for (const [queued, queuedData] of session.queue.splice(0)) {
    umami.track(queued, queuedData);
  }
  umami.track(name, data);
}

/** `uiId` dedupes, because the reporting effect re-fires on every HMR save */
export function recordUiLoad(uiId: string, uiKey: string, ms: number): void {
  if (session.seen.has(uiId)) return;
  session.seen.add(uiId);
  session.pending.push({ uiKey, ms });
  clearTimeout(session.timeoutId);
  session.timeoutId = setTimeout(flushUisLoaded, loadedDebounceMs);
}

/** One `uis-loaded` per page: the initial layout, once it has stopped changing */
export function flushUisLoaded(): void {
  clearTimeout(session.timeoutId);
  session.timeoutId = undefined;
  if (session.sentLoaded === true || session.pending.length === 0) return;
  session.sentLoaded = true;

  const loads = session.pending.splice(0);
  const data: EventData = {
    uis: loads
      .map((x) => x.uiKey)
      .sort()
      .join(","),
    count: loads.length,
  };
  for (const { uiKey, ms } of loads) {
    // slowest instance of each uiKey, rounded so the values aggregate rather than all being unique
    data[uiKey] = Math.max(Number(data[uiKey] ?? 0), Math.round(ms / 100) * 100);
  }
  track("uis-loaded", data);
}
