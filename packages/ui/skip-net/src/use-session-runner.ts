import { type ExternalMessageProcessLeader, type Session, sessionApi, toProcessStatus } from "@npc-cli/cli";
import { queryClientApi } from "@npc-cli/cli/shell/query-client";
import type { JshUiMeta } from "@npc-cli/ui__jsh/schema";
import { UiContext } from "@npc-cli/ui-sdk/UiContext";
import { useStateRef } from "@npc-cli/util";
import { error } from "@npc-cli/util/legacy/generic";
import { useContext, useEffect } from "react";

/** Runs an article's commands in a session, mounting its tty and awaiting its profile first */
export function useSessionRunner(ttyMeta: null | JshUiMeta) {
  const { uiStoreApi } = useContext(UiContext);

  const state = useStateRef(
    (): State => ({
      awaitedWorldKey: null,
      copiedSrc: null,
      copiedTimeoutId: 0,
      pending: { src: null, timeoutId: 0, until: 0 },
      spawning: { src: null, startedAt: 0, timeoutId: 0 },
      ttyMeta,
      unlisten: null,

      clearSpawning() {
        if (state.spawning.src === null) return;
        window.clearTimeout(state.spawning.timeoutId);
        // a local process starts within a frame, so without this the spinner never paints
        const remainingMs = state.spawning.startedAt + spinnerMinMs - Date.now();
        if (remainingMs > 0) {
          state.spawning.timeoutId = window.setTimeout(state.clearSpawning, remainingMs);
          return;
        }
        state.set({ spawning: { ...state.spawning, src: null } });
      },
      copySrc(src) {
        window.clearTimeout(state.copiedTimeoutId);
        navigator.clipboard
          .writeText(src)
          .then(() => {
            state.set({ copiedSrc: src });
            state.copiedTimeoutId = window.setTimeout(() => state.set({ copiedSrc: null }), copiedMs);
          })
          .catch(error);
      },
      dispose() {
        window.clearTimeout(state.copiedTimeoutId);
        window.clearTimeout(state.pending.timeoutId);
        window.clearTimeout(state.spawning.timeoutId);
        state.pending.src = null;
        state.unlisten?.();
        state.unlisten = null;
        state.set({ awaitedWorldKey: null, spawning: { ...state.spawning, src: null } });
      },
      flushPending() {
        window.clearTimeout(state.pending.timeoutId);
        const src = state.pending.src;
        if (src === null) return;

        const session = state.getSession();
        if (session?.ttyShell.isProfileFinished() !== true) {
          // the profile's `awaitWorld` holds every command until that World has mounted
          const worldKey = session?.var.WORLD_KEY;
          const awaited = typeof worldKey === "string" && queryClientApi.get(worldKey) === undefined ? worldKey : null;
          awaited !== state.awaitedWorldKey && state.set({ awaitedWorldKey: awaited });
          if (Date.now() < state.pending.until) {
            state.pending.timeoutId = window.setTimeout(state.flushPending, pendingPollMs);
          } else {
            state.pending.src = null;
            state.set({ awaitedWorldKey: null });
            state.clearSpawning();
          }
          return;
        }

        state.pending.src = null;
        state.awaitedWorldKey !== null && state.set({ awaitedWorldKey: null });
        state.listen(session);
        session.ttyShell.sourceExternal(src, { background: true }).catch((e) => {
          state.clearSpawning();
          error(e);
        });
      },
      getSession() {
        return state.ttyMeta === null ? undefined : sessionApi.getSession(state.ttyMeta.sessionKey);
      },
      isRunning(src) {
        // paused counts as running, so only a killed process may be re-run
        const session = state.getSession();
        return Object.values(session?.process ?? {}).some(
          (p) => p.key === p.pgid && p.origSrc === src && p.status !== toProcessStatus.Killed,
        );
      },
      listen(session) {
        state.unlisten?.();
        state.unlisten = session.ttyShell.io.handleWriters(
          (msg) =>
            msg?.key === "external" && msg.msg.key === "process-leader" && state.onLeaderMessage(session, msg.msg),
        );
      },
      onLeaderMessage(session, msg) {
        if (msg.act !== "started" || state.spawning.src === null) return;
        const process = sessionApi.getProcess({ sessionKey: session.key, pid: msg.pid });
        if (process?.origSrc === state.spawning.src) state.clearSpawning(); // ours: its process leads
      },
      runSrc(src) {
        if (!src || state.ttyMeta === null || state.isRunning(src)) {
          return; // already running, so re-running would just duplicate it
        }
        state.pending.src = src;
        state.pending.until = Date.now() + pendingTimeoutMs;
        state.setSpawning(src);
        if (state.getSession() === undefined) {
          uiStoreApi.markEverSeen(state.ttyMeta.id); // mounts the tty offscreen
        }
        state.flushPending();
      },
      setSpawning(src) {
        window.clearTimeout(state.spawning.timeoutId);
        state.set({
          spawning: { src, startedAt: Date.now(), timeoutId: window.setTimeout(state.clearSpawning, pendingTimeoutMs) },
        });
      },
    }),
  );

  const sessionKey = ttyMeta?.sessionKey;
  state.ttyMeta = ttyMeta;

  useEffect(() => state.dispose, [sessionKey]); // a queued command belonged to the previous session

  return state;
}

export type SessionRunner = ReturnType<typeof useSessionRunner>;

type State = {
  /** The session's World, whilst its profile waits on it with a command queued */
  awaitedWorldKey: null | string;
  /** Most recently copied `src`, briefly indicated */
  copiedSrc: null | string;
  copiedTimeoutId: number;
  /** A `src` awaiting a session whose profile has finished, given up at `until` */
  pending: { src: null | string; timeoutId: number; until: number };
  /** A run `src` whose process has yet to start, shown for at least `spinnerMinMs` */
  spawning: { src: null | string; startedAt: number; timeoutId: number };
  ttyMeta: null | JshUiMeta;
  /** Stops listening to the session's process leaders */
  unlisten: null | (() => void);
  clearSpawning(): void;
  copySrc(src: string): void;
  /** Forgets anything queued or spawning, e.g. on a change of session */
  dispose(): void;
  /** Runs `pending.src` once its profile has finished, else polls until `pending.until` */
  flushPending(): void;
  /** The session, if its tty is mounted */
  getSession(): undefined | Session;
  /** Does an unkilled process lead `src`, as given rather than as the shell re-prints it? */
  isRunning(src: string): boolean;
  listen(session: Session): void;
  onLeaderMessage(session: Session, msg: ExternalMessageProcessLeader): void;
  /** Queues `src`, mounting the tty if it is not */
  runSrc(src: string): void;
  setSpawning(src: string): void;
};

const copiedMs = 1000;
/** How often a queued `src` checks whether it can run yet */
const pendingPollMs = 250;
/** How long a queued `src` waits for its session, e.g. a tty which never boots */
const pendingTimeoutMs = 20000;
/** The spinner shows at least this long */
const spinnerMinMs = 500;
