import { warn } from "@npc-cli/util/legacy/generic";

/**
 * Signaling carries the WebRTC offer/answer/ICE exchange (plus join intent and presence)
 * before a peer connection exists. Two impls:
 * - `InMemorySignaling` — same page, works in PROD, no server.
 * - `DevWsSignaling` — rides Vite's HMR websocket, so two tabs work in dev.
 *
 * A real websocket impl for PROD can slot in behind the same interface.
 */

export type SignalMsg =
  | { kind: "join-request"; worldKey: string }
  | { kind: "offer" | "answer"; sdp: string }
  | { kind: "ice"; candidate: RTCIceCandidateInit }
  | { kind: "bye" };

/** A joinable world seen via signaling — `uid` is `${pageId}/${worldKey}` */
export type RemoteWorld = {
  uid: string;
  worldKey: string;
  mapKey: string;
  mode: "idle" | "server" | "client";
};

export interface Signaling {
  readonly selfUid: string;
  send(toUid: string, msg: SignalMsg): void;
  /** Returns unsubscribe */
  onMessage(cb: (fromUid: string, msg: SignalMsg) => void): () => void;
  /** Presence, for discovery — may be a no-op */
  announce(info: Omit<RemoteWorld, "uid">): void;
  /** Returns unsubscribe — `InMemorySignaling` never calls back (discovery is via `uiStore`) */
  onRoster(cb: (worlds: RemoteWorld[]) => void): () => void;
  close(): void;
}

/**
 * Disambiguates the same `worldKey` open in two tabs. Pinned on `hot.data`: an HMR of this
 * module must NOT remint it, else this page's own worlds look like another tab's (and
 * `isSamePage` misroutes) — only a real reload starts a new page identity
 */
export const pageId: string = (() => {
  const existing = import.meta.hot?.data.__WORLD_RTC_PAGE_ID__;
  const id = typeof existing === "string" ? existing : crypto.randomUUID().slice(0, 8);
  if (import.meta.hot !== undefined) import.meta.hot.data.__WORLD_RTC_PAGE_ID__ = id;
  return id;
})();

export function uidOf(worldKey: string) {
  return `${pageId}/${worldKey}`;
}

export function isSamePage(uid: string) {
  return uid.startsWith(`${pageId}/`);
}

/** One handler per world — same-page worlds exchange signals directly */
const inMemoryHandlers = new Map<string, (fromUid: string, msg: SignalMsg) => void>();

export class InMemorySignaling implements Signaling {
  readonly selfUid: string;

  constructor(worldKey: string) {
    this.selfUid = uidOf(worldKey);
  }
  send(toUid: string, msg: SignalMsg) {
    const handler = inMemoryHandlers.get(toUid);
    if (handler === undefined) return warn(`net-signaling: no such world: ${toUid}`);
    // async-like, matching a real transport — neither end re-enters the other mid-call
    queueMicrotask(() => handler(this.selfUid, msg));
  }
  onMessage(cb: (fromUid: string, msg: SignalMsg) => void) {
    inMemoryHandlers.set(this.selfUid, cb);
    return () => {
      if (inMemoryHandlers.get(this.selfUid) === cb) inMemoryHandlers.delete(this.selfUid);
    };
  }
  announce(_info: Omit<RemoteWorld, "uid">) {}
  onRoster(_cb: (worlds: RemoteWorld[]) => void) {
    return () => {};
  }
  close() {
    inMemoryHandlers.delete(this.selfUid);
  }
}

/** Wire format on the Vite HMR websocket, event name `world-rtc` */
export type WorldRtcWireMsg =
  | { type: "announce"; from: string; info: Omit<RemoteWorld, "uid"> }
  | { type: "goodbye"; from: string }
  | { type: "signal"; from: string; to: string; msg: SignalMsg }
  | { type: "roster"; worlds: RemoteWorld[] };

export class DevWsSignaling implements Signaling {
  readonly selfUid: string;
  private messageCbs = new Set<(fromUid: string, msg: SignalMsg) => void>();
  private rosterCbs = new Set<(worlds: RemoteWorld[]) => void>();
  private lastInfo: Omit<RemoteWorld, "uid"> | null = null;
  private heartbeat = 0;
  private onWire = (data: WorldRtcWireMsg) => {
    if (data.type === "signal" && data.to === this.selfUid) {
      for (const cb of this.messageCbs) cb(data.from, data.msg);
    } else if (data.type === "roster") {
      const worlds = data.worlds.filter((x) => x.uid !== this.selfUid);
      for (const cb of this.rosterCbs) cb(worlds);
    }
  };

  private onPageHide = () => {
    // a closing tab says goodbye at once, rather than lingering in rosters until the prune
    import.meta.hot?.send("world-rtc", { type: "goodbye", from: this.selfUid } satisfies WorldRtcWireMsg);
  };

  constructor(worldKey: string) {
    this.selfUid = uidOf(worldKey);
    import.meta.hot?.on("world-rtc", this.onWire);
    window.addEventListener("pagehide", this.onPageHide);
  }
  static available() {
    return import.meta.hot !== undefined;
  }
  send(toUid: string, msg: SignalMsg) {
    import.meta.hot?.send("world-rtc", {
      type: "signal",
      from: this.selfUid,
      to: toUid,
      msg,
    } satisfies WorldRtcWireMsg);
  }
  onMessage(cb: (fromUid: string, msg: SignalMsg) => void) {
    this.messageCbs.add(cb);
    return () => void this.messageCbs.delete(cb);
  }
  announce(info: Omit<RemoteWorld, "uid">) {
    this.lastInfo = info;
    import.meta.hot?.send("world-rtc", { type: "announce", from: this.selfUid, info } satisfies WorldRtcWireMsg);
    // the server prunes peers it hasn't heard from — keep re-announcing
    window.clearInterval(this.heartbeat);
    this.heartbeat = window.setInterval(() => {
      if (this.lastInfo !== null)
        import.meta.hot?.send("world-rtc", {
          type: "announce",
          from: this.selfUid,
          info: this.lastInfo,
        } satisfies WorldRtcWireMsg);
    }, heartbeatMs);
  }
  onRoster(cb: (worlds: RemoteWorld[]) => void) {
    this.rosterCbs.add(cb);
    return () => void this.rosterCbs.delete(cb);
  }
  close() {
    window.clearInterval(this.heartbeat);
    window.removeEventListener("pagehide", this.onPageHide);
    import.meta.hot?.send("world-rtc", { type: "goodbye", from: this.selfUid } satisfies WorldRtcWireMsg);
    import.meta.hot?.off("world-rtc", this.onWire);
    this.messageCbs.clear();
    this.rosterCbs.clear();
  }
}

const heartbeatMs = 4000;
