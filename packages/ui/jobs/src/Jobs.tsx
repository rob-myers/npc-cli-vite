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
  XIcon,
} from "@phosphor-icons/react";
import debounce from "debounce";
import { AnimatePresence, motion } from "motion/react";
import type React from "react";
import { useContext, useEffect } from "react";
import { useShallow } from "zustand/react/shallow";

/**
 * Visual reinterpretation of shell CLI `jobs`.
 */
export default function Jobs() {
  const { uiStore, uiStoreApi } = useContext(UiContext);

  const ttyMetas = uiStore(
    useShallow(({ byId }) =>
      Object.values(byId).flatMap(({ meta }) => (meta.uiKey === "Jsh" ? (meta as JshUiMeta) : [])),
    ),
  );

  const state = useStateRef(
    (): State => ({
      debouncedUpdate: debounce(() => state.update(), 200, { immediate: true }),
      disconnectSession: null,
      reorder: throttle(() => {
        state.ordered = toOrdered(state.processes);
        state.update();
      }, 200),
      confirmClear: false,
      confirmClearTimeoutId: 0,
      copiedSrc: null,
      copiedTimeoutId: 0,
      folded: { interactive: true, background: true },
      history: [],
      ordered: [],
      processes: [],
      sessionKey: null,
      sessionSelectEl: null,
      ttyMeta: null,

      addHistory(items) {
        // 🔔 one entry per src, appended with its most recent pid
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
          // 🔔 click again to confirm, else we forget
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
            sessionApi.sendSignalToGroup(state.sessionKey, pid, "reset");
            break;
          case "resume":
            sessionApi.kill(state.sessionKey, [pid], { GROUP: true, CONT: true });
            break;
          default:
            throw new ExhaustiveError(act);
        }
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

        const process = sessionApi.getProcess({ sessionKey: state.sessionKey, pid: msg.pid });
        if (msg.act !== "ended" && process === undefined) {
          return;
        }

        // console.log(msg);
        const item = (state.processes[msg.pid] ??= processMetaToProcessLeader(process));

        switch (msg.act) {
          case "ended": {
            item.status = toProcessStatus.Killed;
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
            // 🔔 record as soon as shown, rather than when it dies
            if (item.src) {
              state.addHistory([{ ...item }]);
            }
            state.debouncedUpdate();
            break;
          }
        }

        state.reorder();
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
      onChangeSessionKey(e) {
        const { value } = e.currentTarget;
        state.sessionKey = value as `tty-${number}`;
        state.ttyMeta = ttyMetas[ttyMetas.findIndex((x) => x.sessionKey === state.sessionKey)];
        state.update();
      },
    }),
    { deps: [ttyMetas] },
  );

  useEffect(() => {
    const sessionKeys = ttyMetas.map((x) => x.sessionKey);
    if (ttyMetas.length === 0) {
      state.set({ sessionKey: null, ttyMeta: null });
    } else if (state.sessionKey === null || !sessionKeys.includes(state.sessionKey)) {
      state.set({
        sessionKey: (state.sessionSelectEl?.value as `tty-${number}`) ?? sessionKeys[0],
        ttyMeta: ttyMetas[ttyMetas.findIndex((x) => x.sessionKey === state.sessionKey)],
      });
    } else {
      // Must sync
      state.set({ ttyMeta: ttyMetas[ttyMetas.findIndex((x) => x.sessionKey === state.sessionKey)] });
    }
  }, [ttyMetas, state.sessionSelectEl?.value]);

  useEffect(() => {
    const intervalId = setInterval(state.cleanupDead, cleanupDeadMs);
    return () => {
      clearInterval(intervalId);
      window.clearTimeout(state.confirmClearTimeoutId);
      window.clearTimeout(state.copiedTimeoutId);
    };
  }, []);

  useEffect(() => {
    state.connectSession();
  }, [state.ttyMeta?.sessionBootedAt]); // sync onchange session

  const sessionsExist = ttyMetas.length > 0;
  const historyGroups: { key: HistoryGroupKey; items: ProcessLeader[] }[] = [
    // 🔔 most recent first
    { key: "interactive", items: state.history.filter((p) => p.pid === 0).reverse() },
    { key: "background", items: state.history.filter((p) => p.pid !== 0).reverse() },
  ];

  return (
    <div className="p-2 h-full overflow-auto text-white min-h-[50px] flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2 font-mono">
        {sessionsExist ? (
          <>
            <select
              ref={state.ref("sessionSelectEl")}
              onChange={state.onChangeSessionKey}
              title="sessionKey"
              // 🔔 text-align-last fixes safari
              className="p-1 text-md bg-black"
            >
              {ttyMetas.map(({ sessionKey: key }) => (
                <option key={key} value={key}>
                  {key}
                </option>
              ))}
            </select>
            {state.ttyMeta && (
              <button
                type="button"
                title="refresh"
                className={cn(
                  "cursor-pointer px-2 bg-[#222] text-sm",
                  state.ttyMeta.disabled ? "text-gray-400" : "text-green-400",
                )}
                onClick={state.toggleTtyDisabled}
              >
                {state.ttyMeta?.disabled ? "paused" : "enabled"}
              </button>
            )}
          </>
        ) : (
          <div className="text-[#999]">{`[No sessions]`}</div>
        )}
      </div>

      {sessionsExist && (
        <div className="flex flex-row flex-wrap items-stretch gap-x-1 gap-y-0.5 text-base text-white">
          <AnimatePresence initial={false}>
            {state.ordered.map((p) => {
              const killed = p.status === toProcessStatus.Killed;
              const paused = p.status === toProcessStatus.Suspended;
              return (
                <motion.div
                  key={p.pid}
                  layout
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.3 }}
                  className="flex items-stretch grow min-w-64 max-w-[400px] p-1 rounded bg-[#222] text-[#0f0] font-mono"
                >
                  {/* 🔔 fixed width so cards align */}
                  <div className="relative flex shrink-0 bg-black border border-[#aaca]">
                    <div className="w-12 px-1 text-center text-[#ff9]">{p.pid}</div>
                    {p.ptagsText && (
                      <div
                        title={p.ptagsText}
                        className="absolute bottom-0 right-0 px-1 py-0.5 rounded-tl bg-[#333] text-[#ccc] text-xs leading-none"
                      >
                        {p.ptagsText}
                      </div>
                    )}
                  </div>

                  <div
                    title={p.src}
                    className={cn(
                      "grow min-w-0 truncate px-2 py-1 bg-black border border-[#505050] text-sm",
                      killed ? "text-[#f99]" : paused ? "text-[#ccc]" : "text-[#0f0]",
                    )}
                  >
                    {p.src || "[empty]"}
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
                    <div
                      className={cn(controlCss, killed && "pointer-events-none text-[#777]")}
                      onClick={!killed ? state.changeProcess : undefined}
                      data-act="reset"
                      data-pid={p.pid}
                    >
                      <ArrowCounterClockwiseIcon alt="reset" className="size-4" />
                    </div>
                  </div>
                </motion.div>
              );
            })}
          </AnimatePresence>

          {state.ordered.length === 0 && (
            <div className="w-full p-4 text-sm bg-black text-[#ff9b] border border-[#505050] rounded rounded-tr-none">
              Switch to tab "{state.ttyMeta?.title}" to mount it
            </div>
          )}
        </div>
      )}

      {sessionsExist && state.history.length > 0 && (
        <div className="flex flex-col gap-1 font-mono text-sm">
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
  );
}

const controlCss = "flex items-center justify-center w-7 px-2 py-0.5 border border-[#555] cursor-pointer";

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
    <div className="flex flex-col gap-0.5 p-1 bg-black border border-[#505050] rounded">
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

/** per session persisted history  */
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
  sessionSelectEl: null | HTMLSelectElement;
  ttyMeta: null | JshUiMeta;
  changeProcess: (e: React.PointerEvent<HTMLDivElement>) => void;
  connectSession: () => boolean;
  debouncedUpdate: () => void;
  disconnectSession: null | (() => void);
  handleLeaderMessage: (msg: ExternalMessageProcessLeader) => void;
  onChangeSessionKey: (e: React.ChangeEvent<HTMLSelectElement>) => void;
  /** Recompute `ordered`, at most once per 200ms */
  reorder: () => void;
};

type HistoryGroupKey = "interactive" | "background";

type ProcessLeader = {
  pid: number;
  src: string;
  status: ProcessStatus;
  ptagsText: string;
};

/** 🔔 the interactive process (pid 0) stays put, even when killed */
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
    pid,
    src,
    status,
    ptagsText: getPtagsPreview(ptags).join(""),
  };
}
