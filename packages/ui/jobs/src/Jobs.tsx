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
import {
  error,
  throttle,
  tryLocalStorageGetParsed,
  tryLocalStorageRemove,
  tryLocalStorageSet,
} from "@npc-cli/util/legacy/generic";
import {
  ArrowCounterClockwiseIcon,
  CaretRightIcon,
  CheckIcon,
  CopyIcon,
  PauseIcon,
  PlayIcon,
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
      confirmClear: false,
      confirmClearTimeoutId: 0,
      connected: false,
      copiedSrc: null,
      copiedTimeoutId: 0,
      debouncedUpdate: debounce(() => state.update(), 200, { immediate: true }),
      disconnectSession: null,
      folded: { interactive: true, background: true },
      history: [],
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

      addHistory(items) {
        // one entry per src, appended with its most recent pid
        const bySrc = new Map(items.map((p) => [p.src, p]));
        state.history = state.history
          .filter((p) => !bySrc.has(p.src))
          .concat(Array.from(bySrc.values()))
          .slice(-maxHistory);
        if (state.sessionKey !== null) {
          tryLocalStorageSet(getHistoryKey(state.sessionKey), JSON.stringify(state.history));
        }
      },
      clearHistory() {
        window.clearTimeout(state.confirmClearTimeoutId);

        if (state.confirmClear === false) {
          // click again to confirm, else we forget
          state.confirmClearTimeoutId = window.setTimeout(() => state.set({ confirmClear: false }), confirmClearMs);
          return state.set({ confirmClear: true });
        }

        if (state.sessionKey !== null) {
          tryLocalStorageRemove(getHistoryKey(state.sessionKey));
        }
        state.set({ confirmClear: false, history: [] });
      },
      cleanupDead() {
        const dead = [] as ProcessLeader[];
        const alive = [] as ProcessLeader[];

        // `processes` is sparse i.e. indexed by pid
        state.processes.forEach((p) => {
          if (isDeadAndNonInteractive(p)) {
            dead.push(p);
          } else {
            alive[p.pid] = p;
          }
        });

        if (dead.length === 0) {
          return;
        }

        state.addHistory(dead);
        state.set({ processes: alive, ordered: toOrdered(alive) });
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
            state.set({ processes: [], ordered: [], history: [] });
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
          state.history = state.restoreHistory();

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
            // record as soon as shown, rather than when it dies
            if (item.src) {
              state.addHistory([{ ...item }]);
            }
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
      restoreHistory() {
        if (state.sessionKey === null) {
          return [];
        }
        const restored = tryLocalStorageGetParsed<ProcessLeader[]>(getHistoryKey(state.sessionKey));
        return Array.isArray(restored) ? restored.slice(-maxHistory) : [];
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
      toggleFold(key) {
        state.folded[key] = !state.folded[key];
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
      window.clearTimeout(state.confirmClearTimeoutId);
      window.clearTimeout(state.copiedTimeoutId);
    };
  }, []);

  useEffect(() => {
    // connect explicitly the first time; thereafter e.g. session switches reconnect
    if (state.connected === true) {
      state.connectSession();
    } else {
      state.set({ history: state.restoreHistory() }); // viewable before connecting
    }
  }, [state.connected, state.ttyMeta?.sessionBootedAt]); // sync onchange session

  const sessionsExist = ttyMetas.length > 0;
  const sessionExists = state.sessionKey !== null && sessionApi.getSession(state.sessionKey) !== undefined;
  const historyGroups: { key: HistoryGroupKey; items: ProcessLeader[] }[] = [
    // most recent first
    { key: "interactive", items: state.history.filter((p) => p.pid === 0).reverse() },
    { key: "background", items: state.history.filter((p) => p.pid !== 0).reverse() },
  ];

  // rendered standalone when no session leader, else we couldn't switch session
  const sessionHeader = sessionsExist ? (
    <div className="flex items-stretch justify-end gap-1 pb-2">
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
          className="cursor-pointer flex items-center gap-1.5 px-3 py-1 rounded-sm border border-[#99f]/50 shadow-sm shadow-black/50 text-sm text-[#99f] transition-colors hover:bg-[#111]"
          onClick={state.connect}
        >
          <PlugsIcon alt="connect" className="size-4" />
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
    <div data-jobs-root className="p-4 h-full overflow-auto text-white min-h-[50px] flex flex-col gap-2">
      {sessionsExist === false && <div className="font-mono text-[#999]">{`[No sessions]`}</div>}

      {state.processes[0] === undefined && (
        <div className="self-center w-full max-w-[400px] p-1 font-mono">{sessionHeader}</div>
      )}

      {sessionsExist && (
        <div className="flex flex-col items-center gap-0.5 text-base text-white">
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

          {state.connected && sessionExists === false && (
            <div className="w-full p-4 text-sm bg-black text-[#ff9b] border border-[#505050] rounded rounded-tr-none">
              Switch to the terminal tab to mount it
            </div>
          )}
        </div>
      )}

      <div className="mt-auto self-center w-full max-w-[400px] flex flex-col gap-2 font-mono text-sm">
        <JobsLibrary
          uiId={meta.id}
          canRun={sessionExists}
          copiedSrc={state.copiedSrc}
          onCopy={state.copySrc}
          onPaste={state.pasteSrc}
          onRun={state.rerunProcess}
        />

        {state.history.length > 0 && (
          <div className="flex flex-col gap-1">
            <div className="flex items-center justify-between gap-3 pl-1">
              <div className="text-[#999]">history</div>
              <button
                type="button"
                title="clear history"
                className={cn("cursor-pointer", state.confirmClear ? "text-[#faa]" : "text-[#999]")}
                onClick={state.clearHistory}
              >
                {state.confirmClear ? "confirm" : "clear"}
              </button>
            </div>
            {historyGroups.map(({ key, items }) => (
              <HistoryGroup
                key={key}
                groupKey={key}
                items={items}
                folded={state.folded[key]}
                onToggle={state.toggleFold}
                copiedSrc={state.copiedSrc}
                onCopy={state.copySrc}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

const controlCss = cn(
  "flex items-center justify-center w-7 px-2 py-0.5 border border-[#555] cursor-pointer transition-colors hover:bg-[#333]",
);

/** A foldable group of historical processes, each line copyable */
function HistoryGroup({
  groupKey,
  items,
  folded,
  onToggle,
  copiedSrc,
  onCopy,
}: {
  groupKey: HistoryGroupKey;
  items: ProcessLeader[];
  folded: boolean;
  onToggle: (key: HistoryGroupKey) => void;
  copiedSrc: null | string;
  onCopy: (src: string) => void;
}) {
  if (items.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-col gap-0.5 p-1 bg-black border border-[#505050] rounded shadow-md shadow-black/40">
      <button
        type="button"
        className="flex items-center gap-1 cursor-pointer text-[#999]"
        onClick={() => onToggle(groupKey)}
      >
        <CaretRightIcon alt={folded ? "unfold" : "fold"} className={cn("size-3", !folded && "rotate-90")} />
        {`${groupKey} (${items.length})`}
      </button>

      {folded === false && (
        <div className="flex flex-col gap-0.5 max-h-40 overflow-auto [scrollbar-width:thin]">
          {items.map((p, i) => (
            <div key={`${groupKey}@${i}`} className="flex items-center gap-2 pl-1">
              <button
                type="button"
                title="copy"
                className="shrink-0 cursor-pointer text-[#777] hover:text-white"
                onClick={() => onCopy(p.src)}
              >
                {copiedSrc === p.src ? (
                  <CheckIcon alt="copied" className="size-3 text-[#0f0]" />
                ) : (
                  <CopyIcon alt="copy" className="size-3" />
                )}
              </button>
              {/* {p.ptagsText && <div className="shrink-0 text-[#777]">{p.ptagsText}</div>} */}
              <div className="grow min-w-0 truncate text-white" title={p.src}>
                {p.src || "[empty]"}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** How often killed processes move into `history` */
const cleanupDeadMs = 3000;
/** How long "clear history" awaits confirmation */
const confirmClearMs = 3000;
/** How long a copied `src` is indicated */
const copiedMs = 1000;
/** Max number of `history` entries, dropping oldest */
const maxHistory = 100;

function getHistoryKey(sessionKey: `tty-${number}`) {
  return `jobs-history:${sessionKey}`;
}

type State = {
  /** We use an array to represent mapping `pid -> processLeader` */
  processes: ProcessLeader[];
  /**  Re-ordered `processes` */
  ordered: ProcessLeader[];
  /** Killed processes, most recent last */
  history: ProcessLeader[];
  /** Which `history` groups are folded away? */
  folded: Record<HistoryGroupKey, boolean>;
  /** Most recently copied `src`, briefly indicated in `history` */
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
  toggleFold: (key: HistoryGroupKey) => void;
  toggleTtyDisabled: () => void;
  /** Has "clear history" been clicked once i.e. awaiting confirmation? */
  confirmClear: boolean;
  /** Forgets `confirmClear` after `confirmClearMs` */
  confirmClearTimeoutId: number;
  clearHistory: () => void;
  /** Append to history and persist */
  addHistory: (items: ProcessLeader[]) => void;
  /** Move killed processes from `processes` into `history` */
  cleanupDead: () => void;
  restoreHistory: () => ProcessLeader[];
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

type HistoryGroupKey = "interactive" | "background";

type ProcessLeader = {
  /** Initial `pid`, stable across resets i.e. usable as a React key */
  uid: number;
  pid: number;
  src: string;
  status: ProcessStatus;
  ptagsText: string;
};

/** the interactive process (pid 0) stays put, even when killed */
function isDeadAndNonInteractive(p: ProcessLeader) {
  return p.status === toProcessStatus.Killed && p.pid !== 0;
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
  };
}
