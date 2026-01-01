import { computeJShSource, type JSh } from "@npc-cli/parse-sh";
import {
  addToLookup,
  deepClone,
  jsStringify,
  type KeyedLookup,
  removeFromLookup,
  tryLocalStorageGet,
  tryLocalStorageSet,
  warn,
} from "@npc-cli/util/legacy/generic";
import { create } from "zustand";
import { type ProcessStatus, ProcessTag, toProcessStatus } from "./const";
import {
  type Device,
  FifoDevice,
  type MessageFromShell,
  type MessageFromXterm,
  makeShellIo,
  NullDevice,
  type ShellIo,
  VarDevice,
  type VarDeviceMode,
  VoiceDevice,
} from "./io";
import type { NamedFunction } from "./parse";
import { TtyShell, ttyError } from "./shell";
import { computeNormalizedParts, killProcess, resolveNormalized, ShError } from "./util";

export const sessionApi = {
  addFunc(sessionKey: string, funcName: string, file: JSh.FileWithMeta) {
    sessionApi.getSession(sessionKey).func[funcName] = {
      key: funcName,
      node: file,
      src: computeJShSource.multilineSrc(file),
    };
  },
  addTtyLineCtxts(sessionKey: string, lineText: string, ctxts: TtyLinkCtxt[]) {
    sessionApi.getSession(sessionKey).ttyLink[lineText] = ctxts;
  },
  createFifo(key: string, size?: number) {
    const fifo = new FifoDevice(key, size);
    return (useSession.getState().device[fifo.key] = fifo);
  },
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
  createSession(sessionKey: string, env: Record<string, any>): Session {
    const persisted = sessionApi.rehydrate(sessionKey);
    const ttyIo = makeShellIo<MessageFromXterm, MessageFromShell>();
    const ttyShell = new TtyShell(sessionKey, ttyIo, persisted.history || []);
    const { device } = useSession.getState();
    device[ttyShell.key] = ttyShell;
    device["/dev/null"] = new NullDevice("/dev/null");
    device["/dev/voice"] = new VoiceDevice("/dev/voice");

    useSession.setState(({ session }) => ({
      session: addToLookup(
        {
          key: sessionKey,
          func: {},
          ttyIo,
          ttyShell,
          ttyLink: {},
          etc: {},
          var: {
            PWD: "/home",
            OLDPWD: "",
            ...persisted.var,
            ...deepClone(env),
          },
          modules: {} as any,
          nextPid: 0,
          process: {},
          lastBg: 0,
          lastExit: { fg: 0, bg: 0 },
          verbose: false,
        },
        session,
      ),
    }));
    return sessionApi.getSession(sessionKey);
  },
  createVarDevice(meta: JSh.BaseMeta, varPath: string, mode: VarDeviceMode) {
    const device = new VarDevice(meta, varPath, mode);
    return (useSession.getState().device[device.key] = device);
  },
  getFunc(sessionKey: string, fnKey: string): NamedFunction | undefined {
    return sessionApi.getSession(sessionKey).func[fnKey];
  },
  getLastExitCode(meta: JSh.BaseMeta) {
    return sessionApi.getSession(meta.sessionKey).lastExit[meta.background ? "bg" : "fg"];
  },
  getNextPid(sessionKey: string) {
    return sessionApi.getSession(sessionKey).nextPid++;
  },
  getPositional(pid: number, sessionKey: string, varName: number) {
    return sessionApi.getSession(sessionKey).process[pid].positionals[varName] || "";
  },
  getProcess(meta: { sessionKey: string; pid: number }) {
    return sessionApi.getSession(meta.sessionKey).process[meta.pid];
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
  getVar<T = any>(meta: JSh.BaseMeta, varName: string): T {
    const process = sessionApi.getProcess(meta);
    if (process !== undefined && varName in process.localVar) {
      // Got locally specified variable
      return process.localVar[varName] as T;
    } else if (process !== undefined && varName in process.inheritVar) {
      // Got variable locally specified in ancestral process
      return process.inheritVar[varName] as T;
    } else {
      // Got top-level variable in "file-system" e.g. /home/foo
      return sessionApi.getSession(meta.sessionKey).var[varName] as T;
    }
  },
  getVarDeep(meta: JSh.BaseMeta, varPath: string): any | undefined {
    const session = sessionApi.getSession(meta.sessionKey);
    /**
     * Can deep get /home/* and /etc/*
     * TODO support deep get of local vars?
     */
    const root = { home: session.var, etc: session.etc };
    const parts = computeNormalizedParts(varPath, sessionApi.getVar(meta, "PWD") as string);
    return Function("__", `return ${JSON.stringify(parts)}.reduce((agg, x) => agg[x], __)`)(root);
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
  killSessionLeader(sessionKey: string) {
    const { ttyShell } = sessionApi.getSession(sessionKey);
    ttyShell.xterm.sendSigKill();
  },
  onTtyLink(opts: {
    sessionKey: string;
    lineText: string;
    linkText: string;
    linkStartIndex: number;
    lineNumber: number;
  }) {
    // console.log('onTtyLink', opts,
    //   api.getSession(opts.sessionKey).ttyLink,
    //   api.getSession(opts.sessionKey).ttyLink[opts.lineText],
    // );

    try {
      // 🔔 HACK: permit toggle link (e.g. on/off) without leaving link first
      const { xterm } = sessionApi.getSession(opts.sessionKey).ttyShell.xterm;
      const linkifier = (xterm as any)._core.linkifier;
      // console.log(linkifier);
      setTimeout(() => {
        const position = linkifier._positionFromMouseEvent(
          linkifier._lastMouseEvent,
          linkifier._element,
          linkifier._mouseService!,
        );
        position && linkifier._askForLink(position, false);
      });
    } catch (e) {
      console.warn("HACK: permit toggle link: failed", e);
    }

    sessionApi
      .getSession(opts.sessionKey)
      .ttyLink[opts.lineText]?.find(
        (x) => x.linkStartIndex === opts.linkStartIndex && x.linkText === opts.linkText,
      )
      ?.callback(opts.lineNumber);
  },
  persistHome(sessionKey: string) {
    const { PWD, OLDPWD, CACHE_SHORTCUTS, ...persistedVarLookup } =
      sessionApi.getSession(sessionKey).var;

    tryLocalStorageSet(`var@session-${sessionKey}`, jsStringify(persistedVarLookup, false, true));
  },
  persistHistory(sessionKey: string) {
    const { ttyShell } = sessionApi.getSession(sessionKey);
    tryLocalStorageSet(`history@session-${sessionKey}`, JSON.stringify(ttyShell.getHistory()));
  },
  rehydrate(sessionKey: string) {
    let storedHistory = null as null | string[];
    let storedVar = null as null | Record<string, any>;

    try {
      storedHistory = JSON.parse(tryLocalStorageGet(`history@session-${sessionKey}`) || "null");
    } catch (e) {
      // Can fail in CodeSandbox in Chrome Incognito
      ttyError(`${sessionKey}: rehydrate history failed`);
      ttyError(e);
    }

    const prevValue = tryLocalStorageGet(`var@session-${sessionKey}`) || "null";
    try {
      // storedVar = JSON.parse(tryLocalStorageGet(`var@session-${sessionKey}`) || "null");
      // 🔔 must handle newlines generated by npm module "javascript-stringify"
      storedVar = Function(`return ${prevValue.replace(/\n/g, "\\n")}`)();
      // console.log({storedVar})
    } catch (e) {
      // Can fail in CodeSandbox in Chrome Incognito
      ttyError(`${sessionKey}: rehydrate variables failed: ${prevValue}`);
      ttyError(e);
    }

    return { history: storedHistory, var: storedVar };
  },
  removeDevice(deviceKey: string) {
    delete useSession.getState().device[deviceKey];
  },
  removeProcess(pid: number, sessionKey: string) {
    const processes = useSession.getState().session[sessionKey].process;
    killProcess(processes[pid]);
    delete processes[pid];
  },
  removeSession(sessionKey: string) {
    const session = sessionApi.getSession(sessionKey);
    if (session) {
      const { process, ttyShell } = session;
      session.verbose = false;
      ttyShell.dispose();
      Object.values(process)
        .reverse()
        .forEach((x) => void killProcess(x));
      delete useSession.getState().device[ttyShell.key];
      useSession.setState(({ session }) => ({ session: removeFromLookup(sessionKey, session) }));
    } else {
      warn(`removeSession: ${sessionKey}: cannot remove non-existent session`);
    }
  },
  removeTtyLineCtxts(sessionKey: string, lineText: string) {
    delete sessionApi.getSession(sessionKey).ttyLink[lineText];
  },
  resolve(fd: number, meta: JSh.BaseMeta) {
    return useSession.getState().device[meta.fd[fd]];
  },
  setLastExitCode(meta: JSh.BaseMeta, exitCode?: number) {
    const session = sessionApi.getSession(meta.sessionKey);
    if (session === undefined) {
      warn(`session ${meta.sessionKey} no longer exists`);
    } else if (typeof exitCode === "number") {
      session.lastExit[meta.background ? "bg" : "fg"] = exitCode;
    } else {
      warn(`process ${meta.pid} had no exitCode`);
    }
  },
  setVar(meta: JSh.BaseMeta, varName: string, varValue: any) {
    const session = sessionApi.getSession(meta.sessionKey);
    const process = session.process[meta.pid];
    if (process !== undefined && (varName in process.localVar || varName in process.inheritVar)) {
      /**
       * One can set a local variable from an ancestral process,
       * but it will only change the value in current process.
       */
      process.localVar[varName] = varValue;
    } else {
      session.var[varName] = varValue;
    }
  },
  setVarDeep(meta: JSh.BaseMeta, varPath: string, varValue: any) {
    const session = sessionApi.getSession(meta.sessionKey);
    const process = session.process[meta.pid];
    const parts = varPath.split("/");

    let root: Record<string, any>, normalParts: string[];

    /**
     * We support writing to local process variables,
     * e.g. `( cd && echo 'pwn3d!'>PWD && pwd )`
     */
    const localCtxt =
      parts[0] in process.localVar
        ? process.localVar
        : parts[0] in process.inheritVar
          ? process.inheritVar
          : null;
    if (localCtxt) {
      root = localCtxt;
      normalParts = parts;
    } else {
      root = { home: session.var };
      normalParts = computeNormalizedParts(varPath, sessionApi.getVar(meta, "PWD") as string);

      if (!(normalParts[0] === "home" && normalParts.length > 1)) {
        throw new ShError("only the home directory is writable", 1);
      }
    }

    try {
      const leafKey = normalParts.pop() as string;
      const parent = resolveNormalized(normalParts, root);
      parent[leafKey] = varValue;
    } catch (e) {
      throw new ShError(`cannot resolve /${normalParts.join("/")}`, 1);
    }
  },
  writeMsg(sessionKey: string, msg: string, level: "info" | "error") {
    sessionApi.getSession(sessionKey).ttyIo.write({ key: level, msg });
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

  etc: Record<string, string>;
  var: {
    [varName: string]: unknown;
    PWD: string;
    OLDPWD: string;
    /** `processApi[key]` is `processApi.getCached(var[CACHE_SHORTCUTS[key]])` */
    CACHE_SHORTCUTS?: { [key: string]: string };
  };

  // 🚧
  // modules: import("../terminal/TtyWithFunctions").TtyJsModules;
  /** e.g. `import util` */
  modules: any;

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
