import type { JSh } from "@npc-cli/parse-sh";
import { observableToAsyncIterable } from "@npc-cli/util";
import {
  entries,
  generateSelector,
  jsArg,
  jsStringify,
  parseJsArg,
  parseJsonArg,
  removeLast,
  safeJsonCompact,
  safeJsStringify,
} from "@npc-cli/util/legacy/generic";
import { ansi, EOF, toProcessStatus } from "./const";
import {
  type Device,
  dataChunk,
  getOpts,
  isDataChunk,
  isProxy,
  type ReadResult,
  redirectNode,
  type VarDeviceMode,
} from "./io";
import { cloneParsed, type NamedFunction } from "./parse";
import { type ProcessMeta, type Session, sessionApi } from "./session.store";
import { TtyShell } from "./tty-shell";
import { computeChoiceTtyLinkFactory } from "./ttyLinkFactory";
import { addStdinToArgs, killError, parseFnOrStr, resolvePath, ShError } from "./util";

class CmdService {
  /** Wait for process to resume with escape-hatch `exposeReject`. */
  async awaitResume(
    meta: Pick<JSh.BaseMeta, "sessionKey" | "pid">,
    exposeReject?: (reject: (reason?: any) => void) => void,
  ) {
    let handlers: HandleStatusReturns;

    const { status } = sessionApi.getProcess(meta);
    if (status === toProcessStatus.Running) {
      return;
    } else if (status === toProcessStatus.Killed) {
      throw killError(meta);
    }

    try {
      await new Promise<void>((resolve, reject) => {
        handlers = cmdService.handleStatus(meta, {
          onResumes: resolve,
          cleanups: () => reject(killError(meta)),
        });
        exposeReject?.(reject);
      });
    } finally {
      handlers!.dispose();
    }
  }

  private async *choice(node: JSh.ParsedSh, text: string, outputVarName?: string) {
    const lines = text.replace(/\r/g, "").split(/\n/);
    const parsedLines = lines.map((text) => computeChoiceTtyLinkFactory(text));
    for (const { ttyText } of parsedLines) {
      yield ttyText;
    }

    if (!parsedLines.some((x) => x.linkCtxtsFactory !== undefined)) {
      return;
    }

    let handlers: HandleStatusReturns;
    const stdoutKey = node.meta.fd[1];
    try {
      // some link must be clicked to proceed
      if (outputVarName !== undefined) {
        // optionally store in variable
        cmdService.redirectToVar(node, 1, outputVarName);
      }

      yield await new Promise<any>((resolve, reject) => {
        handlers = cmdService.handleStatus(node.meta, { cleanups: reject });
        parsedLines.forEach(
          ({ ttyTextKey, linkCtxtsFactory }) =>
            void (
              linkCtxtsFactory !== undefined &&
              sessionApi.addTtyLineCtxts(
                node.meta.sessionKey,
                ttyTextKey,
                linkCtxtsFactory(resolve),
              )
            ),
        );
      });
    } finally {
      if (outputVarName !== undefined) {
        redirectNode(node, { 1: stdoutKey });
      }
      handlers!.dispose();
      // ℹ️ currently assume one time usage
      parsedLines.forEach(
        ({ ttyTextKey }) => void sessionApi.removeTtyLineCtxts(node.meta.sessionKey, ttyTextKey),
      );
    }
  }

  get(node: JSh.ParsedSh, args: string[]) {
    const meta = node.meta;
    const root = this.provideProcessCtxt(node);
    const pwd = root.home.PWD;
    const process = sessionApi.getProcess(meta);

    const outputs = args.map((arg) => {
      // basic tilde expansion
      if (arg === "~") arg = "/home";
      if (arg.startsWith("~/")) arg = `/home/${arg.slice(2)}`;

      const parts = arg.split("/");
      const localCtxt =
        parts[0] in process.localVar
          ? (process.localVar as Record<string, any>)
          : parts[0] in process.inheritVar
            ? (process.inheritVar as Record<string, any>)
            : null;

      return parts[0] && localCtxt !== null
        ? parts.reduce((agg, part) => agg[part], localCtxt)
        : resolvePath(arg, root, pwd);
    });

    return outputs;
  }

  handleStatus(meta: Pick<JSh.BaseMeta, "sessionKey" | "pid">, handlers: HandleStatusHandlers) {
    const process = sessionApi.getProcess(meta);
    const handlerEntries = entries(handlers);
    for (const [key, fn] of handlerEntries) {
      process[key].push(fn as any);
    }
    return Object.assign(handlers, {
      dispose() {
        for (const [key, fn] of handlerEntries) removeLast(process[key], fn);
      },
    });
  }

  isCmd(word: string): word is CommandName {
    return word in commandKeys;
  }

  async launchFunc(node: JSh.CallExpr, namedFunc: NamedFunction, args: string[]) {
    const cloned = cloneParsed(namedFunc.node);
    const { ttyShell } = sessionApi.getSession(node.meta.sessionKey);
    Object.assign(cloned.meta, {
      ...node.meta,
      ppid: node.meta.pid,
      stack: node.meta.stack.concat(namedFunc.key), // TODO elsewhere?
    } as JSh.BaseMeta);
    try {
      // Run function in own process, yet without localized PWD
      await ttyShell.spawn(cloned, {
        by: "function",
        posPositionals: args.slice(),
      });
    } finally {
      // Propagate function exitCode to callee
      // ℹ️ Errors are usually caught earlier via `handleShError`,
      //    but may arise via `kill` or failed pipe-sibling
      node.exitCode = cloned.exitCode;
    }
  }

  /**
   * 🔔 Core per-process API.
   *
   * Currently, methods only have access to `this.meta`.
   * Sometimes this means working directly with the process object.
   */
  private readonly processApi = {
    // Overwritten via Function.prototype.bind.
    meta: {} as JSh.BaseMeta,
    // Overwritten via Function.prototype.bind.
    node: {} as JSh.ParsedSh,

    ansi,

    addStdinToArgs,

    async awaitResume(exposeReject?: (reject: (reason?: any) => void) => void) {
      await cmdService.awaitResume(this.meta, exposeReject);
    },

    async *choice(text: string, varName?: string) {
      yield* cmdService.choice(this.node, text, varName);
    },

    dataChunk,

    async eagerReadLoop<T>(loopBody: (datum: T) => Promise<void>, onInterrupt?: (datum: T) => any) {
      let proms = [] as Promise<void>[];
      let datum = await cmdService.read(this.meta);
      while (datum !== EOF) {
        const resolved = await Promise.race(
          (proms = [loopBody(datum), cmdService.read(this.meta)]),
        );
        if (resolved === undefined) {
          // Finished loopBody
          datum = await proms[1];
        } else if (resolved === EOF) {
          await proms[0];
          datum = resolved;
        } else {
          // Read before loopBody finished
          await onInterrupt?.(datum);
          datum = resolved;
        }
      }
    },

    eof: EOF,

    generateSelector,

    get(args: string[]) {
      const badIndex = args.findIndex((x) => typeof x !== "string");
      if (badIndex >= 0) {
        throw new ShError(`cannot get non-string value: ${JSON.stringify(args[badIndex])}`, 1);
      }
      return cmdService.get(this.node, args);
    },

    // 🚧 avoid hard-coded single QueryClient
    //@ts-expect-error
    getCached(queryKey: string | string[]) {
      return null;
    },

    getKillError(exitCode?: number) {
      return killError(this.meta, exitCode);
    },

    getOpts,

    getProcess(meta?: Parameters<typeof sessionApi.getProcess>[0]) {
      return sessionApi.getProcess(meta ?? this.meta);
    },

    getShError(message: string, exitCode = 1) {
      return new ShError(message, exitCode);
    },

    /** Returns a string e.g. `60f5bfdb9b9` */
    getUid() {
      return crypto.randomUUID();
    },

    /**
     * Optionally add cleanup, onSuspend, onResume.
     * Returns dispose.
     */
    handleStatus(handlers: HandleStatusHandlers) {
      return cmdService.handleStatus(this.meta, handlers);
    },

    isDataChunk,

    /** Is the process paused? */
    isPaused() {
      return sessionApi.getProcess(this.meta).status === toProcessStatus.Suspended;
    },

    /** Is the process running? */
    isRunning() {
      return sessionApi.getProcess(this.meta).status === toProcessStatus.Running;
    },

    isTtyAt(fd = 0) {
      return isTtyAt(this.meta, fd);
    },

    jsArg,

    /** Create succinct JSON projections of JS values */
    json(x: any) {
      return safeJsonCompact(x);
    },

    /** 🔔 Use `cleanups() { asyncIterable.return?.() }` to support ctrl-c */
    observableToAsyncIterable,

    /** js parse with string fallback */
    parseJsArg,

    parseFnOrStr,

    pause() {
      sessionApi.kill(this.meta.sessionKey, [this.meta.pgid], {
        STOP: true,
        GROUP: true, // already follows because [pgid]
      });
    },

    /** Output 1, 2, ... at fixed intervals (minimum every 0.5s) */
    async *poll(args: string[]) {
      const seconds = args.length ? parseFloat(parseJsonArg(args[0])) || 1 : 1;
      const delaySecs = Math.max(seconds, 0.5);
      let count = 1;
      while (true) {
        yield count++;
        await cmdService.sleep(this.meta, delaySecs);
      }
    },

    /** Pretty print JS values */
    pretty(x: any) {
      return jsStringify(isProxy(x) ? { ...x } : x, true);
    },

    /** Read once from stdin. */
    read(chunks?: boolean) {
      return cmdService.read(this.meta, chunks);
    },

    redirect(fdUpdates: Record<number, string>) {
      redirectNode(this.node, fdUpdates);
    },

    redirectToVar(fd: number, varPath: string) {
      cmdService.redirectToVar(this.node, fd, varPath);
    },

    resume() {
      sessionApi.kill(this.meta.sessionKey, [this.meta.pgid], {
        CONT: true,
        GROUP: true, // already follows because [pgid]
      });
    },

    safeJsStringify,

    set(varPath: string, varValue: any) {
      sessionApi.setVarDeep(this.meta, varPath, varValue);
    },

    async sleep(seconds: number) {
      await cmdService.sleep(this.meta, seconds);
    },

    writeError(message: string) {
      const device = sessionApi.resolve(1, this.meta);
      device.writeData(`${ansi.Red}${message}${ansi.Reset}`); // do not wait for promise
    },
  };

  private readonly processApiKeys = Object.keys(this.processApi);

  provideProcessCtxt(node: JSh.ParsedSh, posPositionals: string[] = []) {
    const meta = node.meta;
    const session = sessionApi.getSession(meta.sessionKey);
    const cacheShortcuts = session.var.CACHE_SHORTCUTS ?? {};
    return new Proxy(
      {
        home: session.var, // see NPC.RunArg['home']
        etc: session.etc,
        // 🚧
        // lib: session.modules, // see NPC.RunArg['lib']
      },
      {
        get: (target, key) => {
          if (key === "api") {
            return new Proxy(this.processApi, {
              get(target, key: keyof CmdService["processApi"]) {
                if (typeof target[key] === "function") {
                  return (target[key] as Function).bind({ meta, node });
                }
                if (key === "meta") {
                  return meta;
                }
                return target[key];
              },
              // 🚧 ownKeys (requires getOwnPropertyDescriptor)
              getOwnPropertyDescriptor() {
                return { enumerable: true, configurable: true };
              },
              ownKeys: (_target) => {
                return this.processApiKeys;
              },
            });
          } else if (key === "args") {
            return posPositionals;
          } else if (key === "_") {
            // Can _ from anywhere e.g. inside root
            const lastValue = session.var._;
            return isProxy(lastValue) ? dataChunk([lastValue]) : lastValue;
          } else if (key in cacheShortcuts) {
            return getCached([session.var[cacheShortcuts[key as string]]] as any);
          } else {
            return (target as any)[key];
          }
        },
        set: (_, key, value) => {
          if (key === "args") {
            // Assume `posPositionals` is fresh i.e. just sliced
            posPositionals.length = 0;
            posPositionals.push(...value);
            return true;
          }
          return false;
        },
        deleteProperty(_target, _key) {
          return false;
        },
        // getOwnPropertyDescriptor(target, prop) {
        //   return { enumerable: true, configurable: true };
        // },
        ownKeys(target) {
          // return Reflect.ownKeys(target).concat('api', 'args', 'site');
          return Reflect.ownKeys(target);
        },
      },
    ) as ProcessContext;
  }

  async read(meta: JSh.BaseMeta, chunks = false) {
    const result = await this.readOnce(meta, chunks);
    return result?.eof === true ? EOF : result.data;
  }

  private async *readLoop(
    meta: JSh.BaseMeta,
    /** Read exactly one item of data? */
    once = false,
    chunks: boolean,
  ) {
    const process = sessionApi.getProcess(meta);
    const device = sessionApi.resolve(0, meta);

    if (device === undefined) {
      return;
    } else if (device instanceof TtyShell && meta.background) {
      throw new ShError("background process tried to read tty", 1);
    }

    let result = {} as ReadResult;
    while (!(result = await device.readData(once, chunks)).eof) {
      if (result.data !== undefined) {
        yield result;
        if (once) break;
      }
      await preProcessRead(process, device);
    }
  }

  /**
   * Reading once often means two outputs i.e. `{ data }` then `{ eof: true }`.
   * If there is any real data we return `{ data }`,
   * otherwise we (possibly eventually) return `{ eof: true }`.
   */
  private async readOnce(meta: JSh.BaseMeta, chunks: boolean): Promise<ReadResult> {
    for await (const data of this.readLoop(meta, true, chunks)) {
      return data;
    }
    return { eof: true };
  }

  redirectToVar(
    node: JSh.ParsedSh,
    fd: number,
    varPath: string,
    varDeviceMode = "last" satisfies VarDeviceMode as VarDeviceMode,
  ) {
    const varDevice = sessionApi.createVarDevice(node.meta, varPath, varDeviceMode);
    return redirectNode(node, { [fd]: varDevice.key });
  }

  // 🚧
  //@ts-expect-error
  async *runCmd(node: JSh.CallExpr | JSh.DeclClause, command: CommandName, args: string[]) {
    // const { meta } = node;
  }

  async sleep(meta: JSh.BaseMeta, seconds: number) {
    const process = sessionApi.getProcess(meta);

    let resolve = emptyResolve;
    let reject = emptyReject;
    let durationMs = 1000 * seconds;
    let startedAt = 0;
    let timeoutId = 0;

    const handlers = this.handleStatus(meta, {
      onResumes() {
        startedAt = Date.now();
        timeoutId = window.setTimeout(resolve, durationMs);
        return true;
      },
      onSuspends() {
        window.clearTimeout(timeoutId);
        durationMs -= Date.now() - startedAt;
        return true;
      },
      cleanups() {
        reject(killError(meta));
      },
    });

    try {
      await new Promise<void>((resolveSleep, rejectSleep) => {
        resolve = resolveSleep;
        reject = rejectSleep; // cannot resume until now:
        if (process.status === toProcessStatus.Running) handlers.onResumes!();
        if (process.status === toProcessStatus.Killed) handlers.cleanups!();
      });
    } finally {
      handlers.dispose();
    }
  }
}

export const cmdService = new CmdService();

/** Shell builtins */
const commandKeys = {
  /** Alias for `array` */
  "[]": true,
  /** Array of interpreted args */
  array: true,
  /** Object.assign of parsed JS or variable-values */
  assign: true,
  /** Break loop(s) */
  break: true,
  /** Change current key prefix */
  cd: true,
  /**
   * Write tty message with markdown links and associated actions.
   * ```sh
   * choice '[ hi ]()'
   * ```
   */
  choice: true,
  /** Skip iteration(s) */
  continue: true,
  /** List function definitions */
  declare: true,
  /** Output arguments as space-separated string */
  echo: true,
  /** Exit with code 1 */
  false: true,
  /** Get each arg from __TODO__ */
  get: true,
  /** Convert (possibly named) args to a single JavaScript object */
  jsArg: true,
  /** List commands */
  help: true,
  /** List previous commands */
  history: true,
  /** Import shell function(s) induced by JavaScript module */
  import: true,
  /** Kill a process */
  kill: true,
  /** Local variables */
  local: true,
  /** List variables */
  ls: true,
  /** List running processes */
  ps: true,
  /** List, add, remove session ptags for subsequent spawned processes */
  ptags: true,
  /** Print current key prefix */
  pwd: true,
  /** Exit from a function */
  return: true,
  /** Remove variable(s) */
  rm: true,
  /** Run a javascript generator */
  run: true,
  /** Echo session key */
  session: true,
  /** Set something */
  set: true,
  /** Left-shift positional parameters */
  shift: true,
  /** Wait for specified number of seconds */
  sleep: true,
  /** Run shell code stored as a string somewhere */
  source: true,
  /** Evaluate javascript expression and exit code 1 <=> truthy */
  test: true,
  /** Exit with code 0 */
  true: true,
  /** Unset top-level variables and shell functions */
  unset: true,
};

type CommandName = keyof typeof commandKeys;

export interface HandleStatusHandlers {
  /* An optional cleanup */
  cleanups?: ProcessMeta["cleanups"][0];
  /* An optional resume */
  onResumes?: ProcessMeta["onResumes"][0];
  /* An optional suspend */
  onSuspends?: ProcessMeta["onSuspends"][0];
}

export type HandleStatusReturns = ReturnType<CmdService["handleStatus"]>;

export type ProcessApi = CmdService["processApi"];

export type ProcessContext = {
  home: Session["var"]; // see RunArg['home']
  etc: Session["etc"];
  lib: Session["modules"]; // see RunArg['lib']
} & {
  set args(args: string[]);
  get api(): ProcessApi;
};

export function isTtyAt(meta: JSh.BaseMeta, fd: number) {
  return meta.fd[fd]?.startsWith("/dev/tty-");
}

export async function preProcessWrite(process: ProcessMeta, device: Device) {
  if (process.status === toProcessStatus.Killed || device.finishedReading(true) === true) {
    throw killError(process);
  } else if (process.status === toProcessStatus.Suspended) {
    await cmdService.awaitResume({ sessionKey: process.sessionKey, pid: process.key });
  }
}

export async function preProcessRead(process: ProcessMeta, _device: Device) {
  if (process.status === toProcessStatus.Killed) {
    throw killError(process);
  } else if (process.status === toProcessStatus.Suspended) {
    await cmdService.awaitResume({ sessionKey: process.sessionKey, pid: process.key });
  }
}

const emptyResolve = () => {};
const emptyReject = (_e: any) => {};

// 🚧 avoid hard-coded single QueryClient
function getCached(_queryKey: string | string[]) {
  return null;
}
