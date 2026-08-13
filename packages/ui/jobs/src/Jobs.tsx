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
import { error, throttle, tryLocalStorageGetParsed, tryLocalStorageSet } from "@npc-cli/util/legacy/generic";
import {
  ArrowCounterClockwiseIcon,
  CaretRightIcon,
  ListBulletsIcon,
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
 *
 * Includes library of useful commands.
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
      expandedUids: new Set(),
      listEl: null,
      ordered: [],
      pending: { src: null, timeoutId: 0, until: 0 },
      processes: [],
      processesHeight: tryLocalStorageGetParsed<number>(processesHeightStorageKey(meta.id)) ?? defaultProcessesHeight,
      spawning: { src: null, startedAt: 0, timeoutId: 0 },
      reorder: throttle(() => state.set({ ordered: toOrdered(state.processes) }), 200),
      resetPids: new Set(),
      resetting: new Map(),
      resizing: false,
      sessionDisconnector: null,
      sessionKey: null,
      showProcesses: tryLocalStorageGetParsed(showProcessesStorageKey(meta.id)) === true,
      ttyMeta: null,

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
      clampProcessesHeight(height) {
        const rootHeight = state.listEl?.parentElement?.clientHeight ?? 0;
        const max = rootHeight > 0 ? rootHeight * maxProcessesFraction : Infinity;
        return Math.round(Math.min(Math.max(height, minProcessesHeight), Math.max(minProcessesHeight, max)));
      },
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
      clearSpawning() {
        if (state.spawning.src === null) {
          return;
        }
        window.clearTimeout(state.spawning.timeoutId);

        // a local process starts within a frame, so without this the spinner never paints
        const remainingMs = state.spawning.startedAt + spinnerMinMs - Date.now();
        if (remainingMs > 0) {
          state.spawning.timeoutId = window.setTimeout(state.clearSpawning, remainingMs);
          return;
        }

        state.spawning.src = null;
        state.update();
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
      connectSession() {
        try {
          state.sessionDisconnector?.();

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
          state.sessionDisconnector = session.ttyShell.io.handleWriters(
            (msg) => msg?.key === "external" && msg.msg.key === "process-leader" && state.handleLeaderMessage(msg.msg),
          );

          state.update();
          return true;
        } catch (e) {
          error(e);
          return false;
        }
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
      disconnect() {
        state.sessionDisconnector?.();
        state.sessionDisconnector = null;
        window.clearTimeout(state.pending.timeoutId);
        state.pending.src = null;
        state.clearSpawning();
        state.set({ connected: false, processes: [], ordered: [] });
      },
      flushPending() {
        window.clearTimeout(state.pending.timeoutId);
        const src = state.pending.src;
        if (src === null) {
          return;
        }

        // wait until tty profile complete
        if (state.getSession()?.ttyShell.isProfileFinished() !== true) {
          if (Date.now() < state.pending.until) {
            state.pending.timeoutId = window.setTimeout(state.flushPending, pendingPollMs);
          } else {
            state.pending.src = null;
            state.clearSpawning();
          }
          return;
        }

        state.pending.src = null;
        void state.rerunProcess(src);
      },
      getSession() {
        return state.sessionKey === null ? undefined : sessionApi.getSession(state.sessionKey);
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
            if (state.spawning.src !== null && toComparableSrc(process.src) === toComparableSrc(state.spawning.src)) {
              state.clearSpawning(); // it's ours: the process leader is now listed
            }
            state.debouncedUpdate();
            break;
          }
        }

        state.reorder();
      },
      isRunning(src) {
        const key = toComparableSrc(src);
        // paused counts as running, so only a killed process may be re-run
        return state.processes.some((p) => p.status !== toProcessStatus.Killed && toComparableSrc(p.src) === key);
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
        state.clearSpawning();
        state.expandedUids.clear();
        state.set({ processes: [], ordered: [] });
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
      onResizeStart(e) {
        e.preventDefault();
        const handle = e.currentTarget;
        handle.setPointerCapture(e.pointerId);
        const startY = e.clientY;
        const startHeight = state.processesHeight;

        const onMove = (ev: PointerEvent) => {
          state.set({ processesHeight: state.clampProcessesHeight(startHeight + (ev.clientY - startY)) });
        };
        const onUp = () => {
          handle.removeEventListener("pointermove", onMove);
          handle.removeEventListener("pointerup", onUp);
          handle.removeEventListener("pointercancel", onUp);
          tryLocalStorageSet(processesHeightStorageKey(meta.id), String(state.processesHeight));
          state.set({ resizing: false });
        };
        handle.addEventListener("pointermove", onMove);
        handle.addEventListener("pointerup", onUp);
        handle.addEventListener("pointercancel", onUp);
        state.set({ resizing: true });
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
          state.clearSpawning();
          error(e);
        }
      },
      runSrc(src) {
        if (!src || state.isRunning(src)) {
          return; // already running, so re-running would just duplicate it
        }
        // queue, then flush: it runs at once when ready, else waits for the profile
        state.pending.src = src;
        state.pending.until = Date.now() + pendingTimeoutMs;
        state.setSpawning(src);
        if (state.connected === false || state.getSession() === undefined) {
          state.connect(); // mounts the tty when it was never seen, or was unmounted
        }
        state.flushPending();
      },
      setListEl(el) {
        state.listEl = el;
      },
      setSpawning(src) {
        window.clearTimeout(state.spawning.timeoutId);
        state.set({
          spawning: { src, startedAt: Date.now(), timeoutId: window.setTimeout(state.clearSpawning, pendingTimeoutMs) },
        });
      },
      toggleExpanded(e) {
        const uid = Number(e.currentTarget.dataset.uid);
        state.expandedUids.delete(uid) === false && state.expandedUids.add(uid);
        state.update();
      },
      toggleShowProcesses() {
        state.showProcesses = !state.showProcesses;
        tryLocalStorageSet(showProcessesStorageKey(meta.id), String(state.showProcesses));
        state.update();
      },
      toggleTtyDisabled() {
        if (!state.ttyMeta) return;
        uiStoreApi.setUiMeta(state.ttyMeta.id, (draft) => (draft.disabled = !draft.disabled));
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
      window.clearTimeout(state.spawning.timeoutId);
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
  const ttyToggleAvailable = state.connected === true && state.ttyMeta !== null;

  const sessionHeader = sessionsExist ? (
    <div className="flex justify-end items-stretch gap-1">
      <Select.Root value={state.sessionKey ?? ""} onValueChange={state.onChangeSessionKey}>
        <Select.Trigger
          title="sessionKey"
          className={cn(
            "flex items-center gap-2 cursor-pointer px-3 py-1 text-sm",
            // the connect icon continues this trigger
            "border border-r-0 border-term-surface shadow-sm shadow-black/50 bg-term-inset text-term-accent",
            "transition-colors hover:bg-term-hover",
          )}
        >
          <Select.Value placeholder="session" />
          <CaretRightIcon alt="open" className="size-3 rotate-90 text-term-muted" />
        </Select.Trigger>

        <Select.Portal>
          <Select.Positioner className="z-50" sideOffset={4} alignItemWithTrigger={false}>
            <Select.Popup className="py-1 rounded-sm border border-term-surface shadow-lg shadow-black/50 bg-term-inset font-mono text-sm">
              <Select.List>
                {ttyMetas.map(({ sessionKey: key }) => (
                  <Select.Item
                    key={key}
                    value={key}
                    className={cn(
                      "px-3 py-1 cursor-pointer text-term-paused",
                      "data-highlighted:bg-term-surface data-selected:text-term-accent",
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
          "border border-term-surface shadow-sm shadow-black/50 bg-term-inset",
          "transition-colors hover:bg-term-hover",
          state.connected ? "text-term-ok hover:text-term-danger" : "text-term-muted hover:text-term-ok",
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
      {/* shown greyed out whilst disconnected, else connecting would shift the row leftwards */}
      <button
        type="button"
        disabled={ttyToggleAvailable === false}
        title={ttyToggleAvailable === false ? "not connected" : state.ttyMeta?.disabled ? "resume tty" : "pause tty"}
        className={cn(
          "flex items-center px-3 py-1 rounded-sm text-sm",
          "border border-term-surface shadow-sm shadow-black/50 transition-colors",
          ttyToggleAvailable ? "cursor-pointer hover:bg-term-hover-strong" : "cursor-default",
        )}
        onClick={state.toggleTtyDisabled}
      >
        {ttyToggleAvailable === false ? (
          <PauseIcon alt="pause tty (not connected)" className="size-4 text-term-faint" />
        ) : state.ttyMeta?.disabled ? (
          <PlayIcon alt="resume tty" className="size-4 text-term-ok" />
        ) : (
          <PauseIcon alt="pause tty" className="size-4 text-term-paused" />
        )}
      </button>
    </div>
  ) : null;

  return (
    <div
      data-jobs-root
      className="bg-term-dashboard pt-2 h-full overflow-hidden text-term-foreground min-h-[50px] flex flex-col"
    >
      <header className="shrink-0 flex items-stretch gap-1 font-mono">
        {/* toggles the processes below, and says how many there are */}
        <button
          type="button"
          title={state.showProcesses ? "hide processes" : "show processes"}
          className={cn(
            "flex items-center gap-1.5 px-3 py-1 rounded-sm text-sm cursor-pointer",
            "border border-term-surface shadow-sm shadow-black/50 transition-colors hover:bg-term-hover-strong",
            state.showProcesses ? "text-term-accent" : "text-term-muted",
          )}
          onClick={state.toggleShowProcesses}
        >
          <ListBulletsIcon alt="processes" className="size-4" />
          {state.ordered.length}
        </button>

        {/* a clicked library command has been queued, but has yet to lead a process */}
        {state.spawning.src !== null && (
          <div className="flex items-center px-2 text-term-accent" title={`running: ${state.spawning.src}`}>
            <Spinner className="size-4" />
          </div>
        )}

        <div className="ml-auto">{sessionHeader}</div>
      </header>

      {sessionsExist === false && <div className="font-mono text-term-muted">{`[No sessions]`}</div>}

      {/* nothing to show whilst disconnected, so no empty box either */}
      {state.showProcesses && state.ordered.length > 0 && (
        <div
          ref={state.setListEl}
          style={{ height: state.processesHeight }}
          // a few items tall, resized by the handle below, up to `maxProcessesFraction` of the pane
          className="shrink-0 min-h-12 max-h-[40%] flex flex-col"
        >
          <div
            className={cn(
              "flex-1 min-h-0 overflow-y-auto [scrollbar-width:thin] [scrollbar-gutter:stable]",
              "p-2 rounded border border-term-border-subtle bg-term-inset/40",
            )}
          >
            <div className="flex flex-col text-base text-term-foreground">
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
                      className="min-w-32 flex flex-col w-full rounded text-term-running font-mono"
                    >
                      {/* never wraps: a src too wide for the row truncates instead */}
                      {/* dark mode has too little contrast between the cells to separate them by fill alone */}
                      <div className="flex items-stretch dark:border-b dark:border-term-border-subtle">
                        {/* fixed width so cards align */}
                        <div className="relative flex shrink-0 bg-term-inset dark:border-r dark:border-term-border-subtle">
                          <div className="w-12 px-1 flex items-center justify-center text-sm text-term-accent">
                            {p.pid}
                          </div>
                        </div>

                        <div className="flex shrink-0 items-stretch text-term-foreground">
                          <div
                            className={cn(controlCss, killed && "pointer-events-none text-term-faint")}
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
                            className={cn(
                              controlCss,
                              "text-term-danger",
                              killed && "pointer-events-none text-term-faint",
                            )}
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
                              <span className="text-sm leading-none text-term-muted">{"&"}</span>
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
                            "grow min-w-0 cursor-pointer px-2 py-1 bg-term-inset text-sm",
                            "dark:border-l dark:border-term-border-subtle",
                            expanded
                              ? // up to two lines i.e. 2 * 1.25rem + py-1, thereafter scrolling
                                "max-h-12 overflow-auto [scrollbar-width:thin] break-words"
                              : // one line, however long the source
                                "truncate",
                            killed ? "text-term-danger" : paused ? "text-term-paused" : "text-term-running",
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
          </div>

          <div
            title="drag to resize"
            onPointerDown={state.onResizeStart}
            className={cn(
              "shrink-0 h-5 flex items-center justify-center cursor-ns-resize touch-none select-none group",
              state.resizing && "cursor-grabbing",
            )}
          >
            <div
              className={cn(
                "h-0.5 w-10 rounded-full transition-colors",
                state.resizing ? "bg-term-accent" : "bg-term-border group-hover:bg-term-muted",
              )}
            />
          </div>
        </div>
      )}

      <JobsLibrary uiId={meta.id} copiedSrc={state.copiedSrc} onCopy={state.copySrc} onRun={state.runSrc} />
    </div>
  );
}

const controlCss = cn(
  "flex items-center justify-center w-7 px-2 py-0.5 cursor-pointer transition-colors hover:bg-term-hover-strong",
);

/** How often killed processes are forgotten */
const cleanupDeadMs = 3000;
/** How long a process leader is shown before it can be cleaned up */
const minShownMs = 1000;
/** How long a copied `src` is indicated */
const copiedMs = 1000;
/** Held briefly, else a process which starts at once just flickers the spinner */
const spinnerMinMs = 500;

function showProcessesStorageKey(uiId: string) {
  return `jobs-show-processes:${uiId}`;
}
function processesHeightStorageKey(uiId: string) {
  return `jobs-processes-height:${uiId}`;
}
/** A few items tall */
const defaultProcessesHeight = 96;
const minProcessesHeight = 48;
/** Most of the pane the process leaders may take */
const maxProcessesFraction = 0.4;

/**
 * A process's `src` is re-printed from its parse tree, so it can differ in
 * whitespace from the `src` we sent — compare them leniently.
 */
function toComparableSrc(src: string) {
  return src.replace(/\s+/g, " ").trim();
}
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
  /** Does a process lead `src` and remain unkilled? Then `runSrc` won't duplicate it */
  isRunning: (src: string) => boolean;
  /** A clicked `src` whose process has yet to start, shown as a spinner in the header */
  spawning: {
    src: null | string;
    /** When it was clicked, so the spinner is shown for at least `spinnerMinMs` */
    startedAt: number;
    /** Gives up on `src`, so the spinner cannot spin forever */
    timeoutId: number;
  };
  setSpawning: (src: string) => void;
  clearSpawning: () => void;
  /** A `src` awaiting a session whose profile has finished */
  pending: {
    src: null | string;
    timeoutId: number;
    /** When we give up on `src` */
    until: number;
  };
  /** Run `pending.src` once ready, else poll until `pending.until` */
  flushPending: () => void;
  toggleTtyDisabled: () => void;
  /** Forget killed processes */
  cleanupDead: () => void;
  /** Are the process leaders shown below the header? Persisted */
  showProcesses: boolean;
  toggleShowProcesses: () => void;
  /** Height (px) of the process leaders, persisted */
  processesHeight: number;
  /** Wraps the process leaders and their resize handle */
  listEl: null | HTMLDivElement;
  setListEl: (el: null | HTMLDivElement) => void;
  /** Whilst the resize handle is being dragged */
  resizing: boolean;
  onResizeStart: (e: React.PointerEvent<HTMLDivElement>) => void;
  clampProcessesHeight: (height: number) => number;
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
  sessionDisconnector: null | (() => void);
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
