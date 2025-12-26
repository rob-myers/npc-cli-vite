import { type KeyedLookup, tryLocalStorageSet, warn } from "@npc-cli/util/legacy/generic";
import { create } from "zustand";
import { ProcessTag } from "../const";
import type { Device, MessageFromShell, MessageFromXterm, ShellIo } from "../io";
import type { NamedFunction } from "../parse";
import type { TtyShell } from "../tty-shell";
import type { BaseMeta } from "../types";
import { killProcess } from "../util";

export const sessionApi = {
  createProcess(def: {
    sessionKey: string;
    ppid: number;
    pgid: number;
    src: string;
    posPositionals?: string[];
    ptags: Meta;
  }) {
    const pid = sessionApi.getNextPid(def.sessionKey);
    const processes = sessionApi.getSession(def.sessionKey).process;

    return (processes[pid] = {
      key: pid,
      ppid: def.ppid,
      pgid: def.pgid,
      sessionKey: def.sessionKey,
      status: toProcessStatus.Running,
      src: def.src,
      positionals: ["jsh", ...(def.posPositionals ?? [])],
      cleanups: [],
      onSuspends: [],
      onResumes: [],
      localVar: {},
      inheritVar: {},
      ptags: def.ptags,
    });
  },
  getNextPid(sessionKey: string) {
    return sessionApi.getSession(sessionKey).nextPid++;
  },
  getProcesses(sessionKey: string, pgid: number) {
    const session = sessionApi.getSession(sessionKey);
    if (session !== undefined) {
      const processes = Object.values(session.process);
      return pgid === undefined ? processes : processes.filter((x) => x.pgid === pgid);
    } else {
      warn(`${"getProcesses"}: session does not exist: ${sessionKey}`);
      return [];
    }
  },
  getSession(sessionKey: string) {
    return useSession.getState().session[sessionKey];
  },
  kill(sessionKey: string, pids: number[], opts: KillOpts = {}) {
    const session = sessionApi.getSession(sessionKey);

    if (opts.byPtags === true) {
      // const interactive = session.ttyShell.isInteractive();

      if (opts.STOP === true) {
        const processes = Object.values(session.process)
          .filter((p) => p.status === toProcessStatus.Running && !(ProcessTag.always in p.ptags))
          .reverse();
        sessionApi.killProcesses(processes, opts);
        return processes.map((p) => p.key);
      }

      if (opts.CONT === true) {
        // continue specific pids (ones we previously paused)
        const processes = pids
          .map((pid) => session.process[pid])
          .filter((p) => p?.status === toProcessStatus.Suspended);
        sessionApi.killProcesses(processes, opts);
        return processes.map((p) => p.key);
      }
    }

    for (const pid of pids) {
      const p = session.process[pid];
      if (!p) {
        // Already killed
        continue;
      }

      const processes =
        p.pgid === pid || opts.GROUP === true
          ? // Apply command to whole process group in reverse
            sessionApi
              .getProcesses(sessionKey, p.pgid)
              .reverse()
          : [p]; // Apply command to exactly one process

      sessionApi.killProcesses(processes, opts);
    }
    return pids;
  },
  killProcesses(processes: ProcessMeta[], opts: KillOpts) {
    if (opts.SIGINT === true) {
      for (const p of processes) {
        killProcess(p, opts.SIGINT);
      }
    } else if (opts.STOP === true) {
      const byPtags = !!opts.byPtags;
      for (const p of processes) {
        p.onSuspends = p.onSuspends.filter((onSuspend) => onSuspend(byPtags));
        p.status = toProcessStatus.Suspended;
      }
    } else if (opts.CONT === true) {
      for (const p of processes) {
        p.onResumes = p.onResumes.filter((onResume) => onResume());
        p.status = toProcessStatus.Running;
      }
    }

    if (opts.ptags !== undefined) {
      processes.forEach((p) => void Object.assign(p.ptags, opts.ptags));
    }
  },
  persistHistory(sessionKey: string) {
    const { ttyShell } = sessionApi.getSession(sessionKey);
    tryLocalStorageSet(`history@session-${sessionKey}`, JSON.stringify(ttyShell.getHistory()));
  },
  removeProcess(pid: number, sessionKey: string) {
    const processes = useSession.getState().session[sessionKey].process;
    killProcess(processes[pid]);
    delete processes[pid];
  },
  setLastExitCode(meta: BaseMeta, exitCode?: number) {
    const session = sessionApi.getSession(meta.sessionKey);
    if (session === undefined) {
      warn(`session ${meta.sessionKey} no longer exists`);
    } else if (typeof exitCode === "number") {
      session.lastExit[meta.background ? "bg" : "fg"] = exitCode;
    } else {
      warn(`process ${meta.pid} had no exitCode`);
    }
  },
};

export const useSession = create<State>()(
  (_set, _get): State => ({
    session: {},
    device: {},
  }),
);

export type State = {
  session: KeyedLookup<Session>;
  device: KeyedLookup<Device>;
};

export type Session = {
  key: string;
  process: KeyedLookup<ProcessMeta>;
  func: KeyedLookup<NamedFunction>;

  /**
   * Currently only support one tty per session, i.e.
   * cannot have two terminals in same session.
   */
  ttyIo: ShellIo<MessageFromXterm, MessageFromShell>;
  ttyShell: TtyShell;
  ttyLink: { [lineText: string]: TtyLinkCtxt[] };

  etc: Record<string, unknown>;
  var: {
    [varName: string]: unknown;
    PWD: string;
    OLDPWD: string;
    /** `processApi[key]` is `processApi.getCached(var[CACHE_SHORTCUTS[key]])` */
    CACHE_SHORTCUTS?: { [key: string]: string };
  };

  // 🚧
  // modules: import("../terminal/TtyWithFunctions").TtyJsModules;

  nextPid: number;
  lastExit: {
    /** Last exit code: foreground */
    fg: number;
    /** Last exit code: background */
    bg: number;
  };
  lastBg: number;
  verbose: boolean;
};

export const toProcessStatus = {
  Suspended: 0,
  Running: 1,
  Killed: 2,
} as const;

/** `0` is suspended, `1` is running, `2` is killed */
export type ProcessStatus = (typeof toProcessStatus)[keyof typeof toProcessStatus];

export type Ptags = Record<string, string | boolean | number | undefined | null>;

export type ProcessMeta = {
  /** pid */
  key: number;
  ppid: number;
  pgid: number;
  sessionKey: string;
  /** `0` is suspended, `1` is running, `2` is killed */
  status: ProcessStatus;
  /** Source of code defining this process. */
  src: string;
  /**
   * Executed:
   * - on process finished
   * - on Ctrl-C or `kill`
   * - on reboot builtin
   */
  cleanups: ((SIGINT?: boolean) => void)[];
  /**
   * Processes with src:
   * > `run {moduleKey} {fnKey} ...`
   *
   * can be rebooted, to avoid stale JavaScript on hot module reload.
   */
  reboot?: {
    apply(): void;
    applying: boolean;
    /** Each `cleanups[i]` where `i ≥ cleanupId` will be invoked. */
    cleanupId: number;
  };
  /**
   * Executed on suspend, without clearing `true` returners.
   * The latter should be idempotent, e.g. unsubscribe, pause.
   *
   * - `byPtags` true iff suspended by ptags
   * - thus can distinguish <Tty> pause from process pause
   */
  onSuspends: ((byPtags: boolean) => void | boolean)[];
  /**
   * Executed on resume, without clearing `true` returners.
   * The latter should be idempotent, e.g. reject, resolve.
   */
  onResumes: (() => void | boolean)[];
  positionals: string[];
  /**
   * Variables specified locally in this process.
   * Particularly helpful for background processes and subshells,
   * which have their own PWD and OLDPWD.
   */
  localVar: Record<string, unknown>;
  /** Inherited local variables. */
  inheritVar: Record<string, unknown>;
  ptags: Ptags;
};

export type TtyLinkCtxt = {
  /** Line stripped of ansi-codes. */
  lineText: string;
  /** Label text stripped of ansi-codes e.g. `[ foo ]` has link text `foo` */
  linkText: string;
  /**
   * One character before the link text occurs,
   * or equivalently one character after the leading square bracket.
   */
  linkStartIndex: number;
  /**
   * Callback associated with link
   * @param callback Line we clicked on (possibly wrapped)
   */
  callback(lineNumber: number): void;
};

interface KillOpts {
  STOP?: boolean;
  CONT?: boolean;
  SIGINT?: boolean;
  /**
   * - For `api.killProcesses` this is just passed to suspend callbacks.
   * - For `api.kill` this selects the processes to be killed, i.e. those
   *   lacking the process tag `ProcessTag.always`
   */
  byPtags?: boolean;
  GROUP?: boolean;
  ptags?: Ptags;
}
