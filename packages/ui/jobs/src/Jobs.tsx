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
import { cn, useStateRef } from "@npc-cli/util";
import { error, throttle } from "@npc-cli/util/legacy/generic";
import { ArrowsClockwiseIcon, PauseIcon, PlayIcon, XIcon } from "@phosphor-icons/react";
import debounce from "debounce";
import type React from "react";
import { useContext, useEffect } from "react";
import { useShallow } from "zustand/react/shallow";

/**
 * Visual reinterpretation of shell CLI `jobs`.
 */
export default function Jobs() {
  const { uiStore } = useContext(UiContext);

  const ttyMetas = uiStore(
    useShallow(({ byId }) =>
      Object.values(byId)
        .map((x) => x.meta)
        .filter((meta): meta is JshUiMeta => meta.uiKey === "Jsh"),
    ),
  );

  const state = useStateRef(
    (): State => ({
      debouncedUpdate: debounce(() => state.update(), 200, { immediate: true }),
      disconnectSession: null,
      reorder: throttle(() => {
        state.ordered = state.processes.slice().sort(compareProcessLeaders);
        state.update();
      }, 200),
      ordered: [],
      processes: [],
      sessionKey: null,
      sessionSelectEl: null,
      ttyMeta: null,

      changeProcess(e) {
        if (state.sessionKey === null) {
          return;
        }
        const pid = Number(e.currentTarget.dataset.pid);
        const act = e.currentTarget.dataset.act as "pause" | "resume" | "kill";

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
          case "resume":
            sessionApi.kill(state.sessionKey, [pid], { GROUP: true, CONT: true });
            break;
          default:
        }
      },
      connectSession() {
        try {
          state.disconnectSession?.();

          const session = sessionApi.getSession(state.sessionKey ?? "");
          if (session === undefined) {
            state.set({ processes: [], ordered: [] });
            return;
          }

          const leaders = Object.values(session.process).filter((p) => p.key === p.pgid);

          state.processes = leaders.reduce(
            (agg, meta) => ((agg[meta.key] = processMetaToProcessLeader(meta)), agg),
            [] as ProcessLeader[],
          );

          state.ordered = state.processes.slice().sort(compareProcessLeaders);

          // listen for leading process status
          state.disconnectSession = session.ttyShell.io.handleWriters(
            (msg) => msg?.key === "external" && msg.msg.key === "process-leader" && state.handleLeaderMessage(msg.msg),
          );

          state.update();
        } catch (e) {
          error(e);
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
            msg.pid === 0 ? state.debouncedUpdate() : state.update();
            // state.debouncedUpdate();
            break;
          }
        }

        state.reorder();
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
  }, [ttyMetas]);

  const sessionsExist = ttyMetas.length > 0;

  return (
    <div className="p-2 h-full overflow-auto text-white min-h-[50px] flex flex-col gap-2">
      {!sessionsExist && (
        <h2 className="flex gap-3 items-baseline self-end text-[#ccc] font-mono text-base pb-0.5">
          {/* Processes */}
          <div className="text-[#999]">{`[No sessions]`}</div>
        </h2>
      )}

      {sessionsExist && (
        <div className="flex">
          <select
            ref={state.ref("sessionSelectEl")}
            onChange={state.onChangeSessionKey}
            title="sessionKey"
            // 🔔 text-align-last fixes safari
            className="p-1 text-md font-mono bg-black"
          >
            {ttyMetas.map(({ sessionKey: key }) => (
              <option key={key} value={key}>
                {key}
              </option>
            ))}
          </select>
          <button className="cursor-pointer px-2 bg-[#222]" onClick={state.connectSession}>
            <ArrowsClockwiseIcon alt="refresh" className="size-3" />
          </button>
        </div>
      )}

      {sessionsExist && (
        <div className="flex flex-row flex-wrap items-stretch gap-1 text-base text-white">
          {state.ordered.map((p) => {
            const killed = p.status === toProcessStatus.Killed;
            const paused = p.status === toProcessStatus.Suspended;
            return (
              <div key={p.pid} className="flex flex-col gap-2 flex-1 p-1 rounded bg-[#222] text-[#0f0] font-mono">
                <div className="flex items-stretch flex-wrap gap-2">
                  <div className="flex justify-between bg-black border border-[#aaca]">
                    <div className="px-1 text-[#ff9]">{p.pid}</div>
                    {p.ptagsText && <div className="px-1 bg-[#222]">{p.ptagsText}</div>}
                  </div>
                  <div className="flex items-stretch gap-1 text-white">
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
                  </div>
                </div>
                <div
                  className={cn(
                    "grow px-2 py-1 bg-black border border-[#505050] text-sm overflow-auto max-h-20",
                    killed ? "text-[#f99]" : paused ? "text-[#ccc]" : "text-[#0f0]",
                  )}
                >
                  {p.src || "[empty]"}
                </div>
              </div>
            );
          })}

          {state.ordered.length === 0 && (
            <div className="w-full p-4 text-sm text-[#ff9b] border border-[#505050] rounded rounded-tr-none">
              Refresh to track current processes.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const controlCss = "flex items-center justify-center w-7 px-2 py-0.5 border border-[#555] cursor-pointer";

type State = {
  /** We use an array to represent mapping `pid -> processLeader` */
  processes: ProcessLeader[];
  /**  Re-ordered `processes` */
  ordered: ProcessLeader[];
  sessionKey: null | `tty-${number}`;
  sessionSelectEl: null | HTMLSelectElement;
  ttyMeta: null | JshUiMeta;
  changeProcess: (e: React.PointerEvent<HTMLDivElement>) => void;
  connectSession: () => void;
  debouncedUpdate: () => void;
  disconnectSession: null | (() => void);
  handleLeaderMessage: (msg: ExternalMessageProcessLeader) => void;
  onChangeSessionKey: (e: React.ChangeEvent<HTMLSelectElement>) => void;
  /** Recompute `ordered`, at most once per 200ms */
  reorder: () => void;
};

type ProcessLeader = {
  pid: number;
  src: string;
  status: ProcessStatus;
  ptagsText: string;
};

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
