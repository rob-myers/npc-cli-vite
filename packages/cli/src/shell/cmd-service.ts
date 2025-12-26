import type { JSh } from "@npc-cli/parse-sh";
import { ExhaustiveError, observableToAsyncIterable } from "@npc-cli/util";
import {
  deepGet,
  entries,
  generateSelector,
  jsArg,
  jsStringify,
  keysDeep,
  parseJsArg,
  parseJsonArg,
  removeLast,
  safeJsonCompact,
  safeJsStringify,
  tagsToMeta,
  truncateOneLine,
  warn,
} from "@npc-cli/util/legacy/generic";
import cliColumns from "cli-columns";
import { ansi, EOF, type ProcessStatus, toProcessStatus } from "./const";
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
import jsFunctionToShellFunction from "./js-to-shell-function";
import { cloneParsed, type NamedFunction, parseService } from "./parse";
import { type ProcessMeta, type Session, sessionApi } from "./session";
import { TtyShell, ttyError } from "./shell";
import { computeChoiceTtyLinkFactory } from "./tty-link-factory";
import {
  absPath,
  addStdinToArgs,
  applyPtagUpdates,
  computeNormalizedParts,
  getPtagsPreview,
  handleProcessError,
  killError,
  normalizeAbsParts,
  parseFnOrStr,
  resolveNormalized,
  resolvePath,
  ShError,
  SigKillError,
} from "./util";

class CmdService {
  absPath(meta: JSh.BaseMeta, path: string) {
    const pwd = sessionApi.getVar<string>(meta, "PWD");
    return absPath(path, pwd);
  }

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

  private computeCwd(meta: JSh.BaseMeta, root: any) {
    const pwd = sessionApi.getVar(meta, "PWD");
    return resolveNormalized(pwd.split("/"), root);
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

  async *runCmd(node: JSh.CallExpr | JSh.DeclClause, command: CommandName, args: string[]) {
    const { meta } = node;
    switch (command) {
      case "[]":
      case "array":
        yield args.map(parseJsArg);
        break;
      case "assign": {
        const { opts, operands } = getOpts(args, {
          boolean: ["out"], // write to stdout
        });

        const values = operands.map((arg) => {
          const parsed = parseJsArg(arg);
          return typeof parsed === "string"
            ? // strings are assumed to be variables
              sessionApi.getVarDeep(meta, arg)
            : parsed;
        });

        if (isTtyAt(meta, 0)) {
          Object.assign(values[0], ...values.slice(1));
          if (opts.out === true) yield values[0];
        } else {
          let datum: any;
          while ((datum = await cmdService.read(meta)) !== EOF) {
            Object.assign(datum, ...values);
            if (opts.out === true) yield datum;
          }
        }
        break;
      }
      case "break": {
        const depth = parseInt(args[0] || "1");
        if (!Number.isFinite(depth)) {
          throw new ShError("numeric argument required", 2);
        }
        throw killError(meta, 0, depth);
      }
      case "cd": {
        if (args.length > 1) {
          throw new ShError(
            "usage: `cd /`, `cd`, `cd foo/bar`, `cd /foo/bar`, `cd ..` and `cd -`",
            1,
          );
        }
        const prevPwd: string = sessionApi.getVar(meta, "OLDPWD");
        const currPwd: string = sessionApi.getVar(meta, "PWD");
        sessionApi.setVar(meta, "OLDPWD", currPwd);

        try {
          if (!args[0]) {
            sessionApi.setVar(meta, "PWD", "/home");
          } else if (args[0] === "-") {
            sessionApi.setVar(meta, "PWD", prevPwd);
          } else if (args[0].startsWith("/")) {
            const parts = normalizeAbsParts(args[0].split("/"));
            if (resolveNormalized(parts, this.provideProcessCtxt(node)) === undefined) {
              throw Error();
            }
            sessionApi.setVar(meta, "PWD", ["", ...parts].join("/"));
          } else {
            const parts = normalizeAbsParts(currPwd.split("/").concat(args[0].split("/")));
            if (resolveNormalized(parts, this.provideProcessCtxt(node)) === undefined) {
              throw Error();
            }
            sessionApi.setVar(meta, "PWD", ["", ...parts].join("/"));
          }
        } catch {
          sessionApi.setVar(meta, "OLDPWD", prevPwd);
          throw new ShError(`${args[0]} not found`, 1);
        }
        break;
      }
      case "choice": {
        if (isTtyAt(meta, 1) === false) {
          throw Error("stdout must be a tty");
        }
        if (isTtyAt(meta, 0) === true) {
          // `choice {textWithLinks}+` where text may contain newlines
          const text = args.join(" ");
          yield* this.choice(node, text);
        } else {
          // `choice` expects to read `ChoiceReadValue`s
          let datum: string;
          while ((datum = await cmdService.read(meta)) !== EOF) yield* this.choice(node, datum);
        }
        break;
      }
      case "continue": {
        throw killError(meta, 0, undefined, true);
      }
      case "declare": {
        // 🔔 see DeclClause
        const { opts, operands } = getOpts(args, {
          boolean: [
            "f", // list functions [matching prefixes]
            "F", // list function names [matching prefixes]
            "x", // list variables [matching prefixes]
            "p", // list variables [matching prefixes]
          ],
        });

        const noOpts = [opts.x, opts.p, opts.f, opts.F].every((opt) => opt !== true);
        const showVars = opts.x === true || opts.p === true || noOpts;
        const showFuncs = opts.f === true || noOpts;
        const showFuncNames = opts.F === true;
        // Only match prefixes when some option specified
        const prefixes = operands.length && !noOpts ? operands : null;

        const {
          var: home,
          func,
          ttyShell: { xterm },
          process: {
            [meta.pid]: { inheritVar },
          },
        } = sessionApi.getSession(meta.sessionKey);

        const vars = { ...home, ...inheritVar };
        const funcs = Object.values(func);

        if (showVars) {
          for (const [key, value] of Object.entries(vars)) {
            if (prefixes && !prefixes.some((x) => key.startsWith(x))) continue;
            yield `${ansi.BlueBold}${key}${ansi.Reset}=${
              typeof value === "string" ? ansi.White : ansi.YellowBright
            }${jsStringify(value).slice(-xterm.maxStringifyLength)}${ansi.Reset}`;
          }
        }
        if (showFuncs) {
          // If 1 prefix and exact match, we'll only show exact match,
          // so that `declare -f foo` works as expected
          const exactMatch =
            // biome-ignore lint/suspicious/noDoubleEquals: intentional
            prefixes?.length == 1 ? prefixes.find((prefix) => func[prefix]) : undefined;
          for (const { key, src } of funcs) {
            if (prefixes && !prefixes.some((x) => key.startsWith(x))) continue;
            if (exactMatch && key !== exactMatch) continue;
            const lines =
              `${ansi.BlueBold}${key}${ansi.White} ()${ansi.BoldReset} ${src}${ansi.Reset}`.split(
                /\r?\n/,
              );
            yield* lines;
            yield "";
          }
        }
        if (showFuncNames) {
          for (const { key } of funcs) {
            if (prefixes && !prefixes.some((x) => key.startsWith(x))) continue;
            yield `${ansi.White}declare -f ${key}${ansi.Reset}`;
          }
        }
        break;
      }
      case "echo": {
        const { opts, operands } = getOpts(args, {
          boolean: [
            "a", // output array
            "n", // cast as numbers
          ],
        });
        if (opts.a === true) {
          yield opts.n ? operands.map(Number) : operands;
        } else if (opts.n === true) {
          for (const operand of operands) yield Number(operand);
        } else {
          yield args.join(" ");
        }
        break;
      }
      case "false": {
        node.exitCode = 1;
        break;
      }
      case "get": {
        yield* this.get(node, args);
        break;
      }
      case "help": {
        const { ttyShell } = sessionApi.getSession(meta.sessionKey);
        yield `The following commands are supported:`;
        const commands = cliColumns(Object.keys(commandKeys), {
          width: ttyShell.xterm.xterm.cols,
        }).split(/\r?\n/);
        for (const line of commands) yield `${ansi.BlueBold}${line}`;
        // yield `Traverse context via \`ls\` or \`ls -l var.foo.bar\` (Object.keys).`
        yield `\n\rView shell functions via ${ansi.BlueBold}declare -F${ansi.Reset}.`;
        // yield `Use Ctrl-c to interrupt and Ctrl-l to clear screen.`
        // yield `View history via up/down or \`history\`.`
        // yield `Traverse input using Option-left/right and Ctrl-{a,e}.`
        // yield `Delete input using Ctrl-{w,u,k}.`
        // yield `You can copy and paste.`
        // yield `Features: functions, pipes, command substitution, background processes, history, readline-esque shortcuts, copy-paste.`
        break;
      }
      case "history": {
        const { ttyShell } = sessionApi.getSession(meta.sessionKey);
        const history = ttyShell.getHistory();
        for (const line of history) yield line;
        break;
      }
      case "import": {
        const session = sessionApi.getSession(meta.sessionKey);
        const { modules } = session;
        const moduleKey = args.pop();
        if (typeof moduleKey !== "string") {
          throw Error(`format: import moduleName; import fn fn1:alias from moduleName`);
        }
        const module = modules[moduleKey as keyof typeof modules];

        if (!module) {
          throw Error(`unknown module: ${moduleKey}`);
        }

        const namesOrNamesAndAliases: Record<string, any> = (() => {
          if (args.length === 0) {
            // import qux

            return Object.fromEntries(Object.keys(module).map((key) => [key, true]));
          } else {
            // import moduleName moduleName1:moduleAlias from qux

            const from = args.pop();
            if (from !== "from") {
              throw Error(`format: import moduleName; import fn fn1:alias from moduleName`);
            }

            return jsArg(args);
          }
        })();

        const shellFuncs = [] as string[];
        for (const [fnName, fnAlias] of Object.entries(namesOrNamesAndAliases)) {
          const jsFunc = module[fnName as keyof typeof module];
          if (jsFunc === undefined) {
            throw Error(`unknown function: ${fnName} from ${moduleKey}`);
          }
          shellFuncs.push(
            jsFunctionToShellFunction({
              modules,
              moduleKey,
              fnKey: fnName,
              fnAliasKey: fnAlias !== true ? fnAlias : undefined,
              fn: jsFunc,
            }),
          );
        }

        // source functions
        const src = shellFuncs.join("\n\n");
        await session.ttyShell.sourceExternal(src);

        // 🚧 auto re-source?
        break;
      }
      case "jsArg": {
        const { opts, operands } = getOpts(args, {
          string: [
            "alias" /** e.g. '{ points: "ps" }' */,
            "opts" /** e.g. '{ array: { to: true } }' */,
          ],
        });
        yield jsArg(
          operands,
          opts.alias === "" ? undefined : parseJsArg(opts.alias),
          opts.opts === "" ? undefined : parseJsArg(opts.opts),
        );
        break;
      }
      case "kill": {
        const { opts, operands } = getOpts(args, {
          boolean: [
            "all" /** --all all processes */,
            "ALL" /** --ALL all processes */,
            "CONT" /** --CONT continues a paused process */,
            "GROUP" /** --GROUP extends pids to their process groups */,
            "STOP" /** --STOP pauses a process */,
          ],
        });

        /**
         * Actually kill (SIGINT) if we're not stopping or resuming.
         */
        const SIGINT = opts.STOP === false && opts.CONT === false;

        let pids = [] as number[];

        if (opts.all === true || opts.ALL === true) {
          const session = sessionApi.getSession(meta.sessionKey);
          pids = Object.keys(session.process).map(Number);
        } else {
          pids = operands
            .map((x) => parseJsonArg(x))
            .filter((x): x is number => Number.isFinite(x));
        }

        sessionApi.kill(meta.sessionKey, pids, {
          CONT: opts.CONT,
          GROUP: opts.GROUP,
          STOP: opts.STOP,
          SIGINT,
        });
        break;
      }
      case "local": {
        // 🔔 see DeclClause
        const process = sessionApi.getProcess(meta);
        if (process.key === 0) {
          throw new ShError("session leader doesn't support local variables", 1);
        }
        if (args.join(" ").includes("=")) {
          throw new ShError("usage: `local x y z` (assign values elsewhere)", 1);
        }
        for (const name of args) {
          if (name) {
            process.localVar[name] = undefined;
          }
        }
        break;
      }
      case "ls": {
        const { opts, operands } = getOpts(args, {
          boolean: [
            "1" /** One line per item */,
            "l" /** Detailed */,
            "r" /** Recursive properties (prototype) */,
            "a" /** Show capitalized vars at top level */,
          ],
        });
        const pwd = sessionApi.getVar(meta, "PWD");
        const queries = operands.length > 0 ? operands.slice() : [""];
        const root = this.provideProcessCtxt(node);
        const roots = queries.map((path) => resolvePath(path, root, pwd));

        const { ttyShell } = sessionApi.getSession(node.meta.sessionKey);
        for (const [i, obj] of roots.entries()) {
          if (obj === undefined) {
            sessionApi.writeMsg(meta.sessionKey, `ls: "${queries[i]}" is not defined`, "error");
            continue;
          }

          if (roots.length > 1) yield `${ansi.BlueBold}${queries[i]}:`;
          let keys = (opts.r ? keysDeep(obj) : Object.keys(obj)).sort();
          let items = [] as string[];
          if (pwd === "/home" && !opts.a) {
            keys = keys.filter((x) => x.toUpperCase() !== x || /^[0-9]/.test(x));
          }

          if (opts.l === true) {
            if (typeof obj === "function") {
              keys = keys.filter((x) => !["caller", "callee", "arguments"].includes(x));
            }
            const metas =
              opts.r !== undefined
                ? keys.map(
                    (x) =>
                      deepGet(obj, x.split("/"))?.constructor?.name ||
                      (obj[x] === null ? "null" : "undefined"),
                  )
                : keys.map(
                    (x) => obj[x]?.constructor?.name || (obj[x] === null ? "null" : "undefined"),
                  );
            const metasWidth = Math.max(...metas.map((x) => x.length));
            items = keys.map(
              (x, i) =>
                `${ansi.YellowBright}${metas[i].padEnd(metasWidth)}${ansi.White} ${x}${ansi.Reset}`,
            );
          } else if (opts[1]) {
            items = keys;
          } else {
            items = cliColumns(keys, { width: ttyShell.xterm.xterm.cols }).split(/\r?\n/);
          }
          for (const item of items) {
            yield item;
          }
        }
        break;
      }
      case "ps": {
        const { opts } = getOpts(args, {
          boolean: ["a" /** Show all processes */, "s" /** Show process src */],
        });

        /** Either all processes or all process leaders */
        let processes = sessionApi.getSession(meta.sessionKey).process;

        if (opts.a === false) {
          processes = Object.values(processes).reduce(
            (agg, p) => {
              if (p.key === p.pgid) agg[p.key] = p;
              return agg;
            },
            {} as Session["process"],
          );
        }

        const statusColour: Record<ProcessStatus, string> = {
          0: `${ansi.Grey}${ansi.Italic}`,
          1: ansi.White,
          2: ansi.Red,
        };

        function getProcessLine(p: ProcessMeta) {
          const info = [p.key, p.ppid, p.pgid].map((x) => `${x}`.padEnd(5)).join(" ");
          const ptagPreviews = opts.s === true ? [] : getPtagsPreview(p.ptags);
          const tagsOrEmpty = `${ansi.YellowBright}${opts.s === true ? jsStringify(p.ptags) : `${ptagPreviews.join("")}${ptagPreviews.length > 0 ? " " : ""}`}${ansi.Reset}`;
          const oneLineSrcOrEmpty = opts.s === false ? truncateOneLine(p.src.trimStart(), 30) : "";
          const oneLineSrcColour =
            p.status === toProcessStatus.Suspended ? statusColour[p.status] : "";
          const line = `${statusColour[p.status]}${info}${ansi.Reset}${tagsOrEmpty}${oneLineSrcColour}${oneLineSrcOrEmpty}`;
          return line;
        }

        const title = ["pid", "ppid", "pgid"].map((x) => x.padEnd(5)).join(" ");
        yield `${ansi.BlueBold}${title}${ansi.Reset}`;

        for (const process of Object.values(processes)) {
          yield getProcessLine(process);
          if (opts.s === true) {
            // Avoid multiline white in tty
            yield* process.src.split("\n").map((x) => `${ansi.Reset}${x}`);
          }
        }

        break;
      }
      case "ptags": {
        const process = sessionApi.getProcess(meta);
        if (args.length === 0) {
          yield process.ptags;
        } else {
          const ptagUpdates = tagsToMeta(args);
          applyPtagUpdates(process.ptags, ptagUpdates);
        }
        break;
      }
      case "pwd": {
        yield sessionApi.getVar(meta, "PWD");
        break;
      }
      case "return": {
        const exitCode = parseInt(args[0] || "0");
        if (!Number.isFinite(exitCode)) {
          throw new ShError("numeric argument required", 2);
        }
        // Terminate parent e.g. a shell function
        throw killError(meta, exitCode, 1);
      }
      case "rm": {
        const { opts, operands } = getOpts(args, {
          boolean: ["f"],
        });

        const root = this.provideProcessCtxt(node);
        const pwd = sessionApi.getVar<string>(meta, "PWD");
        const force = opts.f === true;

        for (const path of operands) {
          const parts = computeNormalizedParts(path, pwd);
          if (parts[0] === "home" && parts.length > 1) {
            const last = parts.pop() as string;
            const parent = resolveNormalized(parts, root);
            if (last in parent) {
              delete resolveNormalized(parts, root)[last];
            } else if (!force) {
              throw new ShError(`${path}: not found`, 1);
            }
          } else if (!force) {
            throw new ShError(`${path}: only /home/* writable`, 1);
          }
        }
        break;
      }
      /**
       * ```sh
       * run '({ api:{read} }) { yield "foo"; yield await read(); }'
       * run game move npcKey:rob to:$( click 1 )
       * ```
       */
      case "run": {
        try {
          const ct = this.provideProcessCtxt(node, args.slice(1));

          if (args[0] in ct.lib) {
            // 🔔 support process hot-reloading
            // ℹ️ e.g. call '({ api }) => api.getProcess({ sessionKey: "tty-0", pid: 11 }).reboot.apply()'
            const process = sessionApi.getProcess(meta);
            process.reboot = {
              apply() {
                if (this.applying === true)
                  return warn(`already rebooting process ${process.key}: ${process.src}`);
                this.applying = true;
                const removed = process.cleanups.splice(
                  this.cleanupId,
                  process.cleanups.length - this.cleanupId,
                );
                removed.forEach((cleanup) => void cleanup());
              },
              applying: false,
              cleanupId: process.cleanups.length,
            };
            meta.stack.push(`${args[0]}.${args[1]}`);

            while (true) {
              try {
                const func = (ct.lib as any)[args[0]]?.[args[1]];
                if (func === undefined) {
                  throw Error(`not found`);
                }

                ct.args = args.slice(2); // discard 2nd arg too

                if (functionOrAsync.includes(func.constructor.name)) {
                  yield await func(ct); // support all sh/src/* functions
                } else {
                  yield* func(ct);
                }

                break;
              } catch (e) {
                // 🔔 distinguish hot-reload from error
                if (
                  process.reboot.applying === false ||
                  process.status === toProcessStatus.Killed
                ) {
                  throw e;
                }
                process.reboot.applying = false;
              }
            }
          } else {
            // Function provided as argument
            const fnName = meta.stack.at(-1) || "generator";
            const func = Function("_", `return async function *${fnName} ${args[0]}`);
            yield* func()(ct);
          }
        } catch (e) {
          if (e instanceof SigKillError) {
            handleProcessError(node, e);
          } else if (e instanceof ShError) {
            node.exitCode = e.exitCode;
            // Permit silent errors i.e. just set exit code
            if (e.message.length > 0) {
              throw e;
            }
          } else {
            ttyError(e); // Provide JS stack
            node.exitCode = 1;
            throw new ShError(`${(e as Error)?.message ?? safeJsStringify(e)}`, 1);
          }
        }
        break;
      }
      case "session": {
        yield meta.sessionKey;
        break;
      }
      case "set": {
        const root = this.provideProcessCtxt(node);
        const value = parseJsArg(args[1]);
        if (args[0][0] === "/") {
          Function("__1", "__2", `return __1.${args[0].slice(1)} = __2`)(root, value);
        } else {
          const cwd = this.computeCwd(meta, root);
          Function("__1", "__2", `return __1.${args[0]} = __2`)(cwd, value);
        }
        break;
      }
      case "shift": {
        const shiftBy = Number(args[0] || "1");
        if (!(Number.isInteger(shiftBy) && shiftBy >= 0)) {
          throw new ShError("usage: `shift [n]` for non-negative integer n", 1);
        }
        const { positionals } = sessionApi.getProcess(meta);
        for (let i = 0; i < shiftBy; i++) positionals.shift();
        break;
      }
      case "sleep": {
        const seconds = args.length ? parseFloat(parseJsonArg(args[0])) || 0 : 1;
        await this.sleep(meta, seconds);
        break;
      }
      case "source": {
        for (const filepath of args) {
          const [script] = this.get(node, [filepath]);

          if (script === undefined) {
            throw Error(`source: "${filepath}" not found`);
          }
          if (typeof script !== "string") {
            throw Error(`source: "${filepath}" is not a string`);
          }

          const parsed = await parseService.parse(script, true); // we cache scripts

          // Mutate `parsed.meta` because it may occur many times deeply in tree
          // Note pid will be overwritten in `ttyShell.spawn`
          Object.assign(parsed.meta, {
            ...meta,
            ppid: meta.pid,
            fd: { ...meta.fd },
            stack: meta.stack.slice(),
          });

          const { ttyShell } = sessionApi.getSession(meta.sessionKey);
          await ttyShell.spawn(parsed, {
            by: "source",
            posPositionals: args.slice(1),
          });

          // On `source /etc/foo` we'll auto-re-source on hot-reload JavaScript code
          const absPath = cmdService.absPath(node.meta, filepath);
          if (absPath.startsWith("/etc/")) {
            sessionApi.getSession(meta.sessionKey).ttyShell.io.write({
              key: "external",
              msg: {
                key: "auto-re-source-file",
                absPath: `/etc/${absPath.slice("/etc/".length)}`,
              },
            });
          }
        }

        break;
      }
      case "test": {
        node.exitCode = !parseJsArg(args.join(" ")) ? 1 : 0;
        break;
      }
      case "true": {
        node.exitCode = 0;
        break;
      }
      case "unset": {
        const {
          var: home,
          func,
          process: { [meta.pid]: process },
        } = sessionApi.getSession(meta.sessionKey);

        for (const arg of args) {
          if (arg in process.localVar) {
            // NOTE cannot unset ancestral variables
            delete process.localVar[arg];
          } else {
            delete home[arg];
            delete func[arg];
          }
        }
        break;
      }
      default:
        throw new ExhaustiveError(command);
    }
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
const functionOrAsync = ["Function", "AsyncFunction"];

// 🚧 avoid hard-coded single QueryClient
function getCached(_queryKey: string | string[]) {
  return null;
}
