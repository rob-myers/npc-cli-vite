import { Select } from "@base-ui/react/select";
import {
  type ExternalMessageProcessLeader,
  getPtagsPreview,
  type ProcessMeta,
  type ProcessStatus,
  type Session,
  sessionApi,
  toProcessStatus,
} from "@npc-cli/cli";
import type { JshUiMeta } from "@npc-cli/ui__jsh/schema";
import { UiContext } from "@npc-cli/ui-sdk/UiContext";
import { cn, ExhaustiveError, Spinner, useStateRef } from "@npc-cli/util";
import { error, throttle } from "@npc-cli/util/legacy/generic";
import {
  ArrowCounterClockwiseIcon,
  CaretRightIcon,
  PauseIcon,
  PlayIcon,
  PlugsConnectedIcon,
  PlugsIcon,
  XIcon,
} from "@phosphor-icons/react";
import debounce from "debounce";
import { AnimatePresence, motion } from "motion/react";
import type React from "react";
import { useContext, useEffect } from "react";
import { useShallow } from "zustand/react/shallow";
import JobsLibrary from "./JobsLibrary";
import type { TemplateUiMeta } from "./schema";

/**
 * Visual reinterpretation of shell CLI `jobs`.
 */
export default function Jobs({ meta }: { meta: TemplateUiMeta }) {
  const { uiStore, uiStoreApi } = useContext(UiContext);

  const ttyMetas = uiStore(
    useShallow(({ byId }) =>
      Object.values(byId).flatMap(({ meta }) => (meta.uiKey === "Jsh" ? (meta as JshUiMeta) : [])),
    ),
  );

  const state = useStateRef(
    (): State => ({
      connected: false,
      copiedSrc: null,
      copiedTimeoutId: 0,
      debouncedUpdate: debounce(() => state.update(), 200, { immediate: true }),
      disconnectSession: null,
      expandedUids: new Set(),
      ordered: [],
      pending: { src: null, timeoutId: 0, until: 0 },
      processes: [],
      reorder: throttle(() => {
        state.ordered = toOrdered(state.processes);
        state.update();
      }, 200),
      resetPids: new Set(),
      resetting: new Map(),
      sessionKey: null,
      ttyMeta: null,

      cleanupDead() {
        const alive = [] as ProcessLeader[];
        const now = Date.now();
        let removed = 0;

        // `processes` is sparse i.e. indexed by pid
        state.processes.forEach((p) => {
          if (canCleanup(p, now)) {
            removed++;
            state.expandedUids.delete(p.uid);
          } else {
            alive[p.pid] = p;
          }
        });

        if (removed > 0) {
          state.set({ processes: alive, ordered: toOrdered(alive) });
        }
      },

      changeProcess(e) {
        if (state.sessionKey === null) {
          return;
        }
        const pid = Number(e.currentTarget.dataset.pid);
        const act = e.currentTarget.dataset.act as "kill" | "pause" | "reset" | "resume";

        switch (act) {
          case "kill":
            if (pid === 0) {
              sessionApi.killSessionLeader(state.sessionKey);
            } else {
              sessionApi.kill(state.sessionKey, [pid], { GROUP: true, SIGINT: true });
            }
            break;
          case "pause":
            sessionApi.kill(state.sessionKey, [pid], { GROUP: true, STOP: true });
            break;
          case "reset":
            state.onReset(pid);
            break;
          case "resume":
            sessionApi.kill(state.sessionKey, [pid], { GROUP: true, CONT: true });
            break;
          default:
            throw new ExhaustiveError(act);
        }
      },
      connect() {
        state.connected = true;
        state.connectOrMount();
      },
      connectOrMount() {
        if (state.connectSession() === true) {
          state.flushPending();
        } else if (state.ttyMeta !== null) {
          // no session yet: mount the tty offscreen and connect when it has booted
          uiStoreApi.markEverSeen(state.ttyMeta.id);
        }
      },
      disconnect() {
        state.disconnectSession?.();
        state.disconnectSession = null;
        window.clearTimeout(state.pending.timeoutId);
        state.pending.src = null;
        state.set({ connected: false, processes: [], ordered: [] });
      },
      getSession() {
        return state.sessionKey === null ? undefined : sessionApi.getSession(state.sessionKey);
      },
      connectSession() {
        try {
          state.disconnectSession?.();

          const session = state.getSession();
          if (session === undefined) {
            state.set({ processes: [], ordered: [] });
            return false;
          }

          const leaders = Object.values(session.process).filter((p) => p.key === p.pgid);

          state.processes = leaders.reduce(
            (agg, meta) => ((agg[meta.key] = processMetaToProcessLeader(meta)), agg),
            [] as ProcessLeader[],
          );
          // session leader has its status reset; show as killed if not running
          if (session.process[0].cleanups.length === 0) {
            state.processes[0].status = toProcessStatus.Killed;
          }

          state.ordered = toOrdered(state.processes);

          // listen for leading process status
          state.disconnectSession = session.ttyShell.io.handleWriters(
            (msg) => msg?.key === "external" && msg.msg.key === "process-leader" && state.handleLeaderMessage(msg.msg),
          );

          state.update();
          return true;
        } catch (e) {
          error(e);
          return false;
        }
      },
      handleLeaderMessage(msg) {
        if (state.sessionKey === null) {
          return;
        }
        if (msg.profile === true) {
          return; // ignore profile
        }

        const process = sessionApi.getProcess({ sessionKey: state.sessionKey, pid: msg.pid });
        if (msg.act !== "ended" && process === undefined) {
          return;
        }

        // console.log(msg);
        // a reset re-runs under a new pid, so we keep the original item i.e. its ui
        const adopted = msg.act === "started" ? state.resetting.get(process.src) : undefined;
        if (adopted !== undefined) {
          state.resetting.delete(process.src);
          delete state.processes[adopted.pid];
          adopted.pid = msg.pid;
          state.processes[msg.pid] = adopted;
        }

        const item = (state.processes[msg.pid] ??= processMetaToProcessLeader(process));

        switch (msg.act) {
          case "ended": {
            item.status = toProcessStatus.Killed;
            if (state.resetPids.delete(msg.pid)) {
              // interactive becomes a new background item, others keep theirs
              msg.pid !== 0 && state.resetting.set(item.src, item);
              void state.rerunProcess(item.src);
            }
            msg.pid === 0 ? state.debouncedUpdate() : state.update();
            break;
          }
          case "paused":
            item.status = toProcessStatus.Suspended;
            state.update();
            break;
          case "resumed":
            item.status = toProcessStatus.Running;
            state.update();
            break;
          case "started": {
            item.status = toProcessStatus.Running;
            item.src = process.src;
            // a reset reuses the item, so its window restarts too
            item.startedAt = Date.now();
            state.debouncedUpdate();
            break;
          }
        }

        state.reorder();
      },
      onReset(pid) {
        const item = state.processes[pid];
        if (state.sessionKey === null || item === undefined) {
          return;
        }
        if (item.status === toProcessStatus.Killed) {
          void state.rerunProcess(item.src);
          return;
        }

        // re-run after kill i.e. on "ended"
        state.resetPids.add(pid);
        if (pid === 0) {
          sessionApi.killSessionLeader(state.sessionKey);
        } else {
          sessionApi.kill(state.sessionKey, [pid], { GROUP: true, SIGINT: true });
        }
      },
      flushPending() {
        window.clearTimeout(state.pending.timeoutId);
        const src = state.pending.src;
        if (src === null) {
          return;
        }

        // the tty may still be mounting, or its profile still running
        if (state.getSession()?.ttyShell.isInteractive() !== true) {
          if (Date.now() < state.pending.until) {
            state.pending.timeoutId = window.setTimeout(state.flushPending, pendingPollMs);
          } else {
            state.pending.src = null; // gave up
          }
          return;
        }

        state.pending.src = null;
        void state.rerunProcess(src);
      },
      runSrc(src) {
        if (!src) {
          return;
        }
        // queue, then flush: it runs at once when ready, else waits for the profile
        state.pending.src = src;
        state.pending.until = Date.now() + pendingTimeoutMs;
        if (state.connected === false || state.getSession() === undefined) {
          state.connect(); // mounts the tty when it was never seen, or was unmounted
        }
        state.flushPending();
      },
      async rerunProcess(src) {
        const session = state.getSession();
        if (session === undefined || !src) {
          return;
        }

        try {
          // relaunched as a background process even when interactive
          await session.ttyShell.sourceExternal(src, { background: true });
        } catch (e) {
          error(e);
        }
      },
      pasteSrc(src) {
        const session = state.getSession();
        if (session === undefined || !src) {
          return;
        }
        // xterm assumes newlines are \r\n
        session.ttyShell.xterm.spliceInput(src.replace(/\r?\n/g, "\r\n"));
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
      toggleExpanded(e) {
        const uid = Number(e.currentTarget.dataset.uid);
        state.expandedUids.delete(uid) === false && state.expandedUids.add(uid);
        state.update();
      },
      toggleTtyDisabled() {
        if (!state.ttyMeta) return;
        uiStoreApi.setUiMeta(state.ttyMeta.id, (draft) => (draft.disabled = !draft.disabled));
      },
      onChangeSessionKey(sessionKey) {
        if (sessionKey === null) {
          return;
        }
        state.sessionKey = sessionKey as `tty-${number}`;
        state.ttyMeta = ttyMetas.find((x) => x.sessionKey === state.sessionKey) ?? null;
        // a queued command belonged to the previous session, as did any expansion
        window.clearTimeout(state.pending.timeoutId);
        state.pending.src = null;
        state.expandedUids.clear();
        state.set({ processes: [], ordered: [] });
      },
    }),
    { deps: [ttyMetas] },
  );

  useEffect(() => {
    if (ttyMetas.length === 0) {
      state.set({ sessionKey: null, ttyMeta: null });
      return;
    }
    // keep the current session, else select the first
    const sessionKey =
      state.sessionKey !== null && ttyMetas.some((x) => x.sessionKey === state.sessionKey)
        ? state.sessionKey
        : ttyMetas[0].sessionKey;

    state.set({ sessionKey, ttyMeta: ttyMetas.find((x) => x.sessionKey === sessionKey) ?? null });
  }, [ttyMetas]);

  useEffect(() => {
    const intervalId = setInterval(state.cleanupDead, cleanupDeadMs);

    return () => {
      clearInterval(intervalId);
      window.clearTimeout(state.copiedTimeoutId);
      window.clearTimeout(state.pending.timeoutId);
    };
  }, []);

  useEffect(() => {
    // connect explicitly the first time; thereafter e.g. session switches reconnect,
    // mounting the newly selected tty when it has never been seen
    if (state.connected === true) {
      state.connectOrMount();
    }
  }, [state.connected, state.ttyMeta?.id, state.ttyMeta?.sessionBootedAt]); // sync onchange session

  const sessionsExist = ttyMetas.length > 0;
  const sessionExists = state.getSession() !== undefined;

  // rendered standalone when no session leader, else we couldn't switch session
  const sessionHeader = sessionsExist ? (
    <div className="flex justify-end items-stretch gap-1 pb-2">
      <Select.Root value={state.sessionKey ?? ""} onValueChange={state.onChangeSessionKey}>
        <Select.Trigger
          title="sessionKey"
          className={cn(
            "flex items-center gap-2 cursor-pointer px-3 py-1 rounded-l-sm text-sm",
            // the connect icon continues this trigger
            "border border-r-0 border-[#aaca] shadow-sm shadow-black/50 bg-black text-[#ff9]",
            "transition-colors hover:bg-[#111]",
          )}
        >
          <Select.Value placeholder="session" />
          <CaretRightIcon alt="open" className="size-3 rotate-90 text-[#999]" />
        </Select.Trigger>

        <Select.Portal>
          <Select.Positioner className="z-50" sideOffset={4} alignItemWithTrigger={false}>
            <Select.Popup className="py-1 rounded-sm border border-[#505050] shadow-lg shadow-black/50 bg-black font-mono text-sm">
              <Select.List>
                {ttyMetas.map(({ sessionKey: key }) => (
                  <Select.Item
                    key={key}
                    value={key}
                    className={cn(
                      "px-3 py-1 cursor-pointer text-[#ccc]",
                      "data-highlighted:bg-[#222] data-selected:text-[#ff9]",
                    )}
                  >
                    <Select.ItemText>{key}</Select.ItemText>
                  </Select.Item>
                ))}
              </Select.List>
            </Select.Popup>
          </Select.Positioner>
        </Select.Portal>
      </Select.Root>
      {/* attached to the select, being the same decision: which session, and are we on it */}
      <button
        type="button"
        title={state.connected ? "disconnect" : "connect to session"}
        className={cn(
          "cursor-pointer grid place-items-center px-2 rounded-r-sm text-sm",
          "border border-[#aaca] shadow-sm shadow-black/50 bg-black",
          "transition-colors hover:bg-[#111]",
          state.connected ? "text-[#afa] hover:text-[#faa]" : "text-[#999] hover:text-[#afa]",
        )}
        onClick={state.connected ? state.disconnect : state.connect}
      >
        {state.connected === false ? (
          <PlugsIcon alt="connect to session" className="size-4" />
        ) : sessionExists === false ? (
          // the tty is mounting in the background — see `connect`
          <Spinner className="size-4" />
        ) : (
          <PlugsConnectedIcon alt="disconnect" className="size-4" />
        )}
      </button>
      {state.connected === true && state.ttyMeta !== null && (
        <button
          type="button"
          title={state.ttyMeta.disabled ? "resume tty" : "pause tty"}
          className="cursor-pointer flex items-center px-3 py-1 rounded-sm border border-[#555] shadow-sm shadow-black/50 transition-colors hover:bg-[#333]"
          onClick={state.toggleTtyDisabled}
        >
          {state.ttyMeta.disabled ? (
            <PlayIcon alt="resume tty" className="size-4 text-green-400" />
          ) : (
            <PauseIcon alt="pause tty" className="size-4 text-[#ccc]" />
          )}
        </button>
      )}
    </div>
  ) : null;

  return (
    <div data-jobs-root className="p-4 h-full overflow-hidden text-white min-h-[50px] flex flex-col gap-2">
      {/* process leaders scroll, so spawning does not shift the library */}
      <div
        className={cn(
          // the gutter is stable, so overflowing does not shift either
          "flex-1 min-h-0 overflow-y-auto [scrollbar-width:thin] [scrollbar-gutter:stable]",
          "flex flex-col gap-2 p-2 rounded border border-[#2a2a2a] bg-black/40",
        )}
      >
        {sessionsExist === false && <div className="font-mono text-[#999]">{`[No sessions]`}</div>}

        {state.processes[0] === undefined && <div className="w-full p-1 font-mono">{sessionHeader}</div>}

        {sessionsExist && (
          <div className="flex flex-col text-base text-white">
            {/* keyed, so switching session swaps items without exit animations */}
            <AnimatePresence key={state.sessionKey ?? ""} initial={false}>
              {state.ordered.map((p) => {
                const killed = p.status === toProcessStatus.Killed;
                const paused = p.status === toProcessStatus.Suspended;
                const expanded = state.expandedUids.has(p.uid);
                return (
                  <motion.div
                    key={p.uid}
                    layout
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.3 }}
                    className="min-w-32 flex flex-col w-full rounded shadow-lg shadow-black/40 bg-[#222] text-[#0f0] font-mono"
                  >
                    {/* header, connected to the session leader */}
                    {p.pid === 0 && sessionHeader}

                    {/* never wraps: a src too wide for the row truncates instead */}
                    <div className="flex items-stretch">
                      {/* fixed width so cards align */}
                      <div className="relative flex shrink-0 bg-black border border-[#555]">
                        <div className="w-12 px-1 flex items-center justify-center text-sm text-[#ff9]">{p.pid}</div>
                      </div>

                      <div className="flex shrink-0 items-stretch text-white">
                        <div
                          className={cn(controlCss, killed && "pointer-events-none text-[#777]")}
                          onClick={!killed ? state.changeProcess : undefined}
                          data-act={paused ? "resume" : "pause"}
                          data-pid={p.pid}
                        >
                          {paused ? (
                            <PlayIcon alt="resume" className="size-3" />
                          ) : (
                            <PauseIcon alt="pause" className="size-3" />
                          )}
                        </div>
                        <div
                          className={cn(controlCss, "text-[#faa]", killed && "pointer-events-none text-[#777]")}
                          onClick={!killed ? state.changeProcess : undefined}
                          data-act="kill"
                          data-pid={p.pid}
                        >
                          <XIcon alt="kill" className="size-4" />
                        </div>
                        {/* available when killed, where it just re-runs */}
                        <div
                          className={controlCss}
                          title={p.pid === 0 ? "re-run in background" : "reset"}
                          onClick={state.changeProcess}
                          data-act="reset"
                          data-pid={p.pid}
                        >
                          {p.pid === 0 ? (
                            <span className="text-sm leading-none text-[#999]">{"&"}</span>
                          ) : (
                            <ArrowCounterClockwiseIcon alt="reset" className="size-4" />
                          )}
                        </div>
                      </div>

                      <div
                        title={p.src}
                        data-uid={p.uid}
                        onClick={state.toggleExpanded}
                        className={cn(
                          // `min-w-0` lets it shrink past its content, so `truncate` bites
                          "grow min-w-0 cursor-pointer px-2 py-1 bg-black border border-[#505050] text-sm",
                          expanded
                            ? // up to two lines i.e. 2 * 1.25rem + py-1, thereafter scrolling
                              "max-h-12 overflow-auto [scrollbar-width:thin] break-words"
                            : // one line, however long the source
                              "truncate",
                          killed ? "text-[#f99]" : paused ? "text-[#ccc]" : "text-[#0f0]",
                        )}
                      >
                        {p.src || "[empty]"}
                      </div>
                    </div>
                  </motion.div>
                );
              })}
            </AnimatePresence>
          </div>
        )}
      </div>

      <JobsLibrary
        uiId={meta.id}
        canRun={sessionExists && state.connected}
        copiedSrc={state.copiedSrc}
        onCopy={state.copySrc}
        onPaste={state.pasteSrc}
        onRun={state.runSrc}
      />
    </div>
  );
}

const controlCss = cn(
  "flex items-center justify-center w-7 px-2 py-0.5 border border-[#555] cursor-pointer transition-colors hover:bg-[#333]",
);

/** How often killed processes are forgotten */
const cleanupDeadMs = 3000;
/** How long a process leader is shown before it can be cleaned up */
const minShownMs = 1000;
/** How long a copied `src` is indicated */
const copiedMs = 1000;
/** How often we check whether a queued `src` can run yet */
const pendingPollMs = 250;
/** How long a queued `src` waits for its session, e.g. a tty which never boots */
const pendingTimeoutMs = 20000;

type State = {
  /** We use an array to represent mapping `pid -> processLeader` */
  processes: ProcessLeader[];
  /**  Re-ordered `processes` */
  ordered: ProcessLeader[];
  /** Most recently copied `src`, briefly indicated */
  copiedSrc: null | string;
  /** Forgets `copiedSrc` after `copiedMs` */
  copiedTimeoutId: number;
  copySrc: (src: string) => void;
  /** pids whose "ended" should trigger a re-run — see `onReset` */
  resetPids: Set<number>;
  /** `src` -> item awaiting the pid of its re-run */
  resetting: Map<string, ProcessLeader>;
  /** Kill the process group of `pid`, then re-run its `src` */
  onReset: (pid: number) => void;
  rerunProcess: (src: string) => Promise<void>;
  /** Run `src`, first connecting (and mounting the tty) if we aren't ready */
  runSrc: (src: string) => void;
  /** A `src` awaiting a session whose profile has finished */
  pending: {
    src: null | string;
    timeoutId: number;
    /** When we give up on `src` */
    until: number;
  };
  /** Run `pending.src` once ready, else poll until `pending.until` */
  flushPending: () => void;
  /** Insert `src` at the tty prompt, without running it */
  pasteSrc: (src: string) => void;
  toggleTtyDisabled: () => void;
  /** Forget killed processes */
  cleanupDead: () => void;
  /** `uid`s whose `src` is shown over two lines, rather than one */
  expandedUids: Set<number>;
  toggleExpanded: (e: React.MouseEvent<HTMLDivElement>) => void;
  sessionKey: null | `tty-${number}`;
  /** The selected session, if it exists i.e. its tty is mounted */
  getSession: () => undefined | Session;
  ttyMeta: null | JshUiMeta;
  changeProcess: (e: React.PointerEvent<HTMLDivElement>) => void;
  /** Have we connected to the selected session? Until then nothing is shown */
  connected: boolean;
  /** Connect, and stay connected e.g. when the session changes */
  connect: () => void;
  /** Connect to the selected session, mounting its tty in the background if absent */
  connectOrMount: () => void;
  /** Stop tracking the session, without touching its tty */
  disconnect: () => void;
  connectSession: () => boolean;
  debouncedUpdate: () => void;
  disconnectSession: null | (() => void);
  handleLeaderMessage: (msg: ExternalMessageProcessLeader) => void;
  onChangeSessionKey: (sessionKey: null | string) => void;
  /** Recompute `ordered`, at most once per 200ms */
  reorder: () => void;
};

type ProcessLeader = {
  /** Initial `pid`, stable across resets i.e. usable as a React key */
  uid: number;
  pid: number;
  src: string;
  status: ProcessStatus;
  ptagsText: string;
  /** When the current run started, so we don't clean up too soon */
  startedAt: number;
};

/**
 * The interactive process (pid 0) stays put, even when killed.
 * Short-lived ones linger too, else the fixed interval could
 * remove them almost as soon as they were spawned.
 */
function canCleanup(p: ProcessLeader, now: number) {
  return p.status === toProcessStatus.Killed && p.pid !== 0 && now - p.startedAt >= minShownMs;
}

/** Densify sparse `processes` (indexed by pid) and order it */
function toOrdered(processes: ProcessLeader[]) {
  return processes.filter(Boolean).sort(compareProcessLeaders);
}

/** Order by pid=0, tags, src */
function compareProcessLeaders(p: ProcessLeader, q: ProcessLeader) {
  if (p.pid === 0) return -1;
  if (q.pid === 0) return +1;
  return p.ptagsText < q.ptagsText || p.src < q.src ? -1 : +1;
}

function processMetaToProcessLeader({ key: pid, src, status, ptags }: ProcessMeta): ProcessLeader {
  return {
    uid: pid,
    pid,
    src,
    status,
    ptagsText: getPtagsPreview(ptags).join(""),
    startedAt: Date.now(),
  };
}
