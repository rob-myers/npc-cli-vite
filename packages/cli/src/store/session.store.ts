import { type KeyedLookup, tryLocalStorageSet } from "@npc-cli/util/legacy/generic";
import { create } from "zustand";
import type { Device, MessageFromShell, MessageFromXterm, ShellIo } from "../io";
import type { NamedFunction } from "../parse";
import type { TtyShell } from "../tty-shell";

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
  getSession(sessionKey: string) {
    return useSession.getState().session[sessionKey];
  },
  persistHistory(sessionKey: string) {
    const { ttyShell } = sessionApi.getSession(sessionKey);
    tryLocalStorageSet(`history@session-${sessionKey}`, JSON.stringify(ttyShell.getHistory()));
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
