import { Popover } from "@base-ui/react/popover";
import { Select } from "@base-ui/react/select";
import {
  type ExternalMessageProcessLeader,
  getPtagsPreview,
  type ProcessMeta,
  type ProcessStatus,
  ProcessTag,
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
  CheckIcon,
  CopyIcon,
  DotsThreeIcon,
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
import type { JobsUiMeta } from "./schema";

/**
 * Visual reinterpretation of shell CLI `jobs`.
 * Its library of commands is in SkipNet.
 */
export default function Jobs(props: Props) {
  const { uiStore, uiStoreApi } = useContext(UiContext);

  const ttyMetas = uiStore(
    useShallow(({ byId }) =>
      Object.values(byId).flatMap(({ meta }) => (meta.uiKey === "Jsh" ? (meta as JshUiMeta) : [])),
    ),
  );

  const state = useStateRef(
    (): State => ({
      connected: false,
      optedOut: false,
      copiedSrc: null,
      copiedTimeoutId: 0,
      debouncedUpdate: debounce(() => state.update(), 200, { immediate: true }),
      expandedUids: new Set(),
      ordered: [],
      processes: [],
      reorder: throttle(() => state.set({ ordered: toOrdered(state.processes) }), 200),
      resetPids: new Set(),
      resetting: new Map(),
      sessionDisconnector: null,
      sessionKey: null,
      ttyMeta: null,

      changeProcess(e) {
        if (state.sessionKey === null) {
          return;
        }
        const pid = Number(e.currentTarget.dataset.pid);
        const act = e.currentTarget.dataset.act as "always" | "kill" | "pause" | "reset" | "resume";

        switch (act) {
          case "always": {
            const item = state.processes[pid];
            sessionApi.setAlways(state.sessionKey, pid, (item.always = !item.always));
            state.update();
            break;
          }
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
      connect() {
        state.connected = true;
        state.optedOut = false;
        state.connectOrMount();
      },
      connectOrMount() {
        if (state.connectSession() === false && state.ttyMeta !== null) {
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
          // session leader is reused: finished once the prompt is back, whatever it registered
          if (session.ttyShell.isInitialized() && session.ttyShell.isInteractive()) {
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
        state.optedOut = true;
        state.sessionDisconnector?.();
        state.sessionDisconnector = null;
        state.set({ connected: false, processes: [], ordered: [] });
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
              void state.rerunProcess(item.origSrc, item.always);
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
            item.origSrc = process.origSrc;
            item.always = process.ptags[ProcessTag.always] === true;
            // a reset reuses the item, so its window restarts too
            item.startedAt = Date.now();
            state.debouncedUpdate();
            break;
          }
        }

        state.reorder();
      },
      onChangeSessionKey(sessionKey) {
        if (sessionKey === null) {
          return;
        }
        state.sessionKey = sessionKey as `tty-${number}`;
        state.ttyMeta = ttyMetas.find((x) => x.sessionKey === state.sessionKey) ?? null;
        // any expansion belonged to the previous session
        state.expandedUids.clear();
        state.set({ processes: [], ordered: [] });
      },
      onReset(pid) {
        const item = state.processes[pid];
        if (state.sessionKey === null || item === undefined) {
          return;
        }
        if (item.status === toProcessStatus.Killed) {
          void state.rerunProcess(item.origSrc, item.always);
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
      async rerunProcess(src, always = false) {
        const session = state.getSession();
        if (session === undefined || !src) {
          return;
        }

        try {
          // relaunched as a background process even when interactive
          await session.ttyShell.sourceExternal(src, {
            background: true,
            ptags: always ? { [ProcessTag.always]: true } : undefined,
          });
        } catch (e) {
          error(e);
        }
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
    }),
    { deps: [ttyMetas] },
  );

  useEffect(() => {
    if (ttyMetas.length === 0) {
      state.set({ sessionKey: null, ttyMeta: null });
      return;
    }
    const preferred = ttyMetas.some((x) => x.sessionKey === props.sessionKey) ? props.sessionKey : undefined;
    if (preferred !== undefined && state.sessionKey !== null && preferred !== state.sessionKey) {
      return state.onChangeSessionKey(preferred);
    }
    // the preferred session, else keep the current one, else select the first
    const sessionKey =
      preferred ??
      (state.sessionKey !== null && ttyMetas.some((x) => x.sessionKey === state.sessionKey)
        ? state.sessionKey
        : ttyMetas[0].sessionKey);

    state.set({ sessionKey, ttyMeta: ttyMetas.find((x) => x.sessionKey === sessionKey) ?? null });
  }, [ttyMetas, props.sessionKey]);

  useEffect(() => {
    const intervalId = setInterval(state.cleanupDead, cleanupDeadMs);

    return () => {
      clearInterval(intervalId);
      window.clearTimeout(state.copiedTimeoutId);
    };
  }, []);

  useEffect(() => {
    // connect explicitly the first time; thereafter e.g. session switches reconnect,
    // mounting the newly selected tty when it has never been seen
    if (state.connected === true) {
      state.connectOrMount();
    } else if (state.optedOut === false && state.getSession() !== undefined) {
      state.connect(); // its tty has mounted, e.g. to run a library command
    }
  }, [state.connected, state.ttyMeta?.id, state.ttyMeta?.sessionBootedAt]); // sync onchange session

  const sessionsExist = ttyMetas.length > 0;
  const session = state.getSession();
  const sessionExists = session !== undefined;
  const ttyToggleAvailable = state.connected === true && state.ttyMeta !== null;

  const sessionHeader = sessionsExist ? (
    <div className="flex justify-end items-stretch gap-1">
      <Select.Root
        value={state.sessionKey ?? ""}
        onValueChange={(key) => {
          state.onChangeSessionKey(key);
          key !== null && props.onSessionKey?.(key as `tty-${number}`);
        }}
      >
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
      // nothing is selected by a stray drag or Cmd+A: a job's source is copied from its menu, an example by its button
      className="bg-term-dashboard pt-2 h-full overflow-hidden text-term-foreground min-h-[50px] flex flex-col select-none"
    >
      <header className="shrink-0 flex items-stretch gap-1 font-mono">
        <div className="flex items-center gap-1.5 px-3 py-1 text-sm text-term-accent" title="processes">
          <ListBulletsIcon alt="processes" className="size-4" />
          {state.ordered.length}
        </div>

        <div className="ml-auto">{sessionHeader}</div>
      </header>

      {sessionsExist === false && <div className="font-mono text-term-muted">{`[No sessions]`}</div>}

      <div className="flex-1 min-h-0 relative">
        <div
          className={cn(
            "size-full overflow-y-auto [scrollbar-width:thin] [scrollbar-gutter:stable]",
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
                    // position only: a size animation would scale the card, text and all, as the
                    // source cell grows — that cell eases its own height instead
                    layout="position"
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
                        <JobTags
                          job={p}
                          session={session}
                          onToggle={state.changeProcess}
                          copied={state.copiedSrc === p.src}
                          onCopy={state.copySrc}
                        />
                      </div>

                      {/* `data-more` whilst the source scrolls on below, which the fade shows */}
                      <div className="group relative grow min-w-0 flex">
                        <div
                          title={p.src}
                          data-uid={p.uid}
                          onClick={state.toggleExpanded}
                          ref={(el) => syncMoreBelow(el, expanded)}
                          onScroll={(e) => syncMoreBelow(e.currentTarget, expanded)}
                          onTransitionEnd={(e) => syncMoreBelow(e.currentTarget, expanded)}
                          className={cn(
                            // `min-w-0` lets it shrink past its content, so `truncate` bites
                            "grow min-w-0 cursor-pointer px-2 py-1 bg-term-inset text-sm",
                            "dark:border-l dark:border-term-border-subtle",
                            "transition-[max-height] duration-200",
                            expanded
                              ? // up to two lines i.e. 2 * 1.25rem + py-1, thereafter scrolling
                                "max-h-12 overflow-auto scrollbar-thin break-words"
                              : // one line, however long the source
                                "max-h-7 truncate",
                            killed ? "text-term-danger" : paused ? "text-term-paused" : "text-term-running",
                          )}
                        >
                          {p.src || "[empty]"}
                        </div>
                        <div className={moreBelowFadeCss} />
                      </div>
                    </div>
                  </motion.div>
                );
              })}
            </AnimatePresence>
          </div>
        </div>
      </div>
    </div>
  );
}

/** A job's tags take no room in its row: an ellipsis lists them on demand, `always` as a toggle */
/** A job's menu: copy its source, toggle `always`, and its other tags */
function JobTags(props: {
  job: ProcessLeader;
  session: undefined | Session;
  onToggle: State["changeProcess"];
  /** Whether its source was just copied */
  copied: boolean;
  onCopy: State["copySrc"];
}) {
  const { always, pid, status, src } = props.job;
  return (
    <Popover.Root>
      <Popover.Trigger
        title="process tags"
        disabled={status === toProcessStatus.Killed}
        className={cn(
          controlCss,
          always && "text-term-accent",
          "disabled:pointer-events-none disabled:text-term-faint",
        )}
      >
        <DotsThreeIcon alt="process tags" weight="bold" className="size-4" />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner className="z-50" side="bottom" align="start" sideOffset={4}>
          <Popover.Popup className={cn(popupCss, "max-w-64 flex flex-wrap gap-1 p-2")}>
            <div
              className={cn(ptagCss, "flex items-center cursor-pointer hover:bg-term-hover-strong text-term-muted")}
              title="copy"
              onClick={() => props.onCopy(src)}
            >
              {props.copied ? (
                <CheckIcon alt="copied" className="size-3.5 text-term-ok" />
              ) : (
                <CopyIcon alt="copy" className="size-3.5" />
              )}
            </div>
            <div
              className={cn(
                ptagCss,
                "cursor-pointer hover:bg-term-hover-strong",
                always ? "border-term-accent text-term-accent" : "border-dashed text-term-faint",
              )}
              onClick={props.onToggle}
              data-act="always"
              data-pid={pid}
            >
              {ProcessTag.always}
            </div>
            {Object.entries(getJobPtags(props.session, pid)).map(([key, values]) => (
              // a popover rather than a tooltip, which a tap would not open
              <Popover.Root key={key}>
                <Popover.Trigger openOnHover delay={100} className={cn(ptagCss, "cursor-pointer text-term-muted")}>
                  {key}
                </Popover.Trigger>
                <Popover.Portal>
                  <Popover.Positioner className="z-50" side="top" sideOffset={4}>
                    <Popover.Popup className={cn(popupCss, "px-1.5 py-0.5 text-term-ok")}>
                      {[...values].join(", ")}
                    </Popover.Popup>
                  </Popover.Positioner>
                </Popover.Portal>
              </Popover.Root>
            ))}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

/** Each tag bar `always`, with its distinct values over the job: `pick | move` is `WORLD_PAUSABLE` both ways */
function getJobPtags(session: undefined | Session, pgid: number) {
  const ptags: Record<string, Set<string>> = {};
  for (const p of Object.values(session?.process ?? {})) {
    if (p.pgid !== pgid) continue;
    for (const [key, value] of Object.entries(p.ptags)) {
      if (key !== ProcessTag.always) (ptags[key] ??= new Set()).add(String(value));
    }
  }
  return ptags;
}

/** Sets `data-more` on the wrapper: whether the expanded source scrolls on below */
function syncMoreBelow(el: null | HTMLElement, expanded: boolean) {
  const more = expanded === true && el !== null && el.scrollTop + el.clientHeight < el.scrollHeight - 1;
  el?.parentElement?.setAttribute("data-more", String(more));
}

/** A fade in the cell's own colour along its foot, shown by `data-more` */
const moreBelowFadeCss = cn(
  "pointer-events-none absolute inset-x-0 bottom-0 h-5 bg-linear-to-t from-term-inset to-transparent",
  "opacity-0 transition-opacity group-data-[more=true]:opacity-100",
);

const controlCss = cn(
  "flex items-center justify-center w-7 px-2 py-0.5 cursor-pointer transition-colors hover:bg-term-hover-strong",
);

const ptagCss = "px-1.5 py-0.5 rounded-sm border border-term-border-subtle select-none transition-colors";

const popupCss = cn(
  "rounded-sm outline-0 font-mono text-xs",
  "border border-term-border shadow-lg shadow-black/50 bg-term-inset",
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
  /** `always` re-tags it so, as a reset keeps what its job was tagged */
  rerunProcess: (src: string, always?: boolean) => Promise<void>;
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
  /** Disconnected by the user, so a mounted tty is not connected to */
  optedOut: boolean;
  connectSession: () => boolean;
  debouncedUpdate: () => void;
  sessionDisconnector: null | (() => void);
  handleLeaderMessage: (msg: ExternalMessageProcessLeader) => void;
  onChangeSessionKey: (sessionKey: null | string) => void;
  /** Recompute `ordered`, at most once per 200ms */
  reorder: () => void;
};

type Props = {
  /** Absent within SkipNet */
  meta?: JobsUiMeta;
  /** The session to show, when it exists */
  sessionKey?: `tty-${number}`;
  /** A session picked by the user */
  onSessionKey?(sessionKey: `tty-${number}`): void;
};

type ProcessLeader = {
  /** Initial `pid`, stable across resets i.e. usable as a React key */
  uid: number;
  pid: number;
  src: string;
  /** As given, e.g. with its comments — see `ProcessMeta.origSrc` */
  origSrc: string;
  status: ProcessStatus;
  /** Tagged `always`, kept once it dies so a re-run can be too */
  always: boolean;
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

function processMetaToProcessLeader({ key: pid, src, origSrc, status, ptags }: ProcessMeta): ProcessLeader {
  return {
    uid: pid,
    pid,
    src,
    origSrc,
    status,
    always: ptags[ProcessTag.always] === true,
    ptagsText: getPtagsPreview(ptags).join(""),
    startedAt: Date.now(),
  };
}
