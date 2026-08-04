import { Select } from "@base-ui/react/select";
import {
  type ExternalMessageProcessLeader,
  getPtagsPreview,
  type ProcessMeta,
  type ProcessStatus,
  sessionApi,
  toProcessStatus,
} from "@npc-cli/cli";
import type { JshUiMeta } from "@npc-cli/ui__jsh/schema";
import { UiContext } from "@npc-cli/ui-sdk/UiContext";
import { cn, ExhaustiveError, useStateRef } from "@npc-cli/util";
import { error, throttle } from "@npc-cli/util/legacy/generic";
import { ArrowCounterClockwiseIcon, CaretRightIcon, PauseIcon, PlayIcon, XIcon } from "@phosphor-icons/react";
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
      ordered: [],
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
          canCleanup(p, now) ? removed++ : (alive[p.pid] = p);
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
        state.connectSession();
      },
      connectSession() {
        try {
          state.disconnectSession?.();

          const session = sessionApi.getSession(state.sessionKey ?? "");
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
      async rerunProcess(src) {
        const session = state.sessionKey === null ? undefined : sessionApi.getSession(state.sessionKey);
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
        const session = state.sessionKey === null ? undefined : sessionApi.getSession(state.sessionKey);
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
      toggleTtyDisabled() {
        if (!state.ttyMeta) return;
        uiStoreApi.setUiMeta(state.ttyMeta.id, (draft) => (draft.disabled = !draft.disabled));
      },
      onChangeSessionKey(sessionKey) {
        if (sessionKey === null) {
          return;
        }
        state.sessionKey = sessionKey as `tty-${number}`;
        state.ttyMeta = ttyMetas[ttyMetas.findIndex((x) => x.sessionKey === state.sessionKey)] ?? null;
        state.set({ processes: [], ordered: [] });
      },
    }),
    { deps: [ttyMetas] },
  );

  useEffect(() => {
    const sessionKeys = ttyMetas.map((x) => x.sessionKey);
    if (ttyMetas.length === 0) {
      state.set({ sessionKey: null, ttyMeta: null });
    } else if (state.sessionKey === null || !sessionKeys.includes(state.sessionKey)) {
      // select first
      state.set({
        sessionKey: sessionKeys[0],
        ttyMeta: ttyMetas[ttyMetas.findIndex((x) => x.sessionKey === state.sessionKey)] ?? null,
      });
    } else {
      // select current
      state.set({ ttyMeta: ttyMetas[ttyMetas.findIndex((x) => x.sessionKey === state.sessionKey)] });
    }
  }, [ttyMetas]);

  useEffect(() => {
    const intervalId = setInterval(state.cleanupDead, cleanupDeadMs);

    return () => {
      clearInterval(intervalId);
      window.clearTimeout(state.copiedTimeoutId);
    };
  }, []);

  useEffect(() => {
    // connect explicitly the first time; thereafter e.g. session switches reconnect
    if (state.connected === true) {
      state.connectSession();
    }
  }, [state.connected, state.ttyMeta?.sessionBootedAt]); // sync onchange session

  const sessionsExist = ttyMetas.length > 0;
  const sessionExists = state.sessionKey !== null && sessionApi.getSession(state.sessionKey) !== undefined;

  // rendered standalone when no session leader, else we couldn't switch session
  const sessionHeader = sessionsExist ? (
    <div className="flex items-stretch gap-1 pb-2">
      <Select.Root value={state.sessionKey ?? ""} onValueChange={state.onChangeSessionKey}>
        <Select.Trigger
          title="sessionKey"
          className={cn(
            "flex items-center gap-2 cursor-pointer px-3 py-1 rounded-sm text-sm",
            "border border-[#aaca] shadow-sm shadow-black/50 bg-black text-[#ff9]",
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
      {sessionExists === true && state.connected === false && (
        <button
          type="button"
          title="connect to session"
          className="cursor-pointer flex items-center gap-1.5 px-3 py-1 rounded-sm border border-[#ccc]/50 shadow-sm shadow-black/50 text-sm text-[#afa] transition-colors hover:bg-[#111]"
          onClick={state.connect}
        >
          {/* <PlugsIcon alt="connect" className="size-4" /> */}
          connect
        </button>
      )}
      {state.ttyMeta !== null && (
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

        {state.processes[0] === undefined && (
          <div className="self-start w-full max-w-[400px] p-1 font-mono">
            {sessionHeader}

            {sessionExists === false && (
              <div className="w-full p-4 text-sm bg-black text-[#ff9b] border border-[#505050] rounded rounded-tr-none">
                Switch to the terminal tab to mount it
              </div>
            )}
          </div>
        )}

        {sessionsExist && (
          <div className="flex flex-col items-start gap-0.5 text-base text-white">
            {/* keyed, so switching session swaps items without exit animations */}
            <AnimatePresence key={state.sessionKey ?? ""} initial={false}>
              {state.ordered.map((p) => {
                const killed = p.status === toProcessStatus.Killed;
                const paused = p.status === toProcessStatus.Suspended;
                return (
                  <motion.div
                    key={p.uid}
                    layout
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.3 }}
                    className="min-w-32 flex flex-col w-full max-w-[400px] p-1 rounded shadow-lg shadow-black/40 bg-[#222] text-[#0f0] font-mono"
                  >
                    {/* header, connected to the session leader */}
                    {p.pid === 0 && sessionHeader}

                    <div className="flex flex-wrap items-stretch gap-y-0.5">
                      {/* fixed width so cards align */}
                      <div className="relative flex shrink-0 bg-black border border-[#aaca]">
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
                        className={cn(
                          // up to two lines i.e. 2 * 1.25rem + py-1
                          "grow min-w-32 max-h-12 overflow-auto [scrollbar-width:thin] break-words",
                          "px-2 py-1 bg-black border border-[#505050] text-sm",
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
        onRun={state.rerunProcess}
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
  /** Insert `src` at the tty prompt, without running it */
  pasteSrc: (src: string) => void;
  toggleTtyDisabled: () => void;
  /** Forget killed processes */
  cleanupDead: () => void;
  sessionKey: null | `tty-${number}`;
  ttyMeta: null | JshUiMeta;
  changeProcess: (e: React.PointerEvent<HTMLDivElement>) => void;
  /** Have we connected to the selected session? Until then nothing is shown */
  connected: boolean;
  /** Connect, and stay connected e.g. when the session changes */
  connect: () => void;
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
