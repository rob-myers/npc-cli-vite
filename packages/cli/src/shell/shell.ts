import { computeJShSource, type JSh } from "@npc-cli/parse-sh";
import { ExhaustiveError } from "@npc-cli/util";
import { debug, error, warn } from "@npc-cli/util/legacy/generic";
import { ansi, ProcessTag, spawnBgPausedDefault, toProcessStatus } from "./const";
import type { MessageFromShell, MessageFromXterm, ReadResult, ShellIo } from "./io";
import { parseService } from "./parse";
import { jShSemantics } from "./semantics";
import { type ProcessMeta, type Ptags, sessionApi } from "./session";
import { applyPtagUpdates, killError, ShError, SigKillError } from "./util";
import type { TtyXterm } from "./xterm";

export class TtyShell {
  key: string;
  sessionKey: string;
  io: ShellIo<MessageFromXterm, MessageFromShell>;
  history: string[];
  xterm!: TtyXterm;
  /** Is corresponding component `<Tty>` disabled? */
  disabled = false;
  /** While `this.disabled` spawn background processes paused? */
  spawnBgPaused = spawnBgPausedDefault;

  private profileFinished = false;

  private process!: ProcessMeta;
  private oneTimeReaders = [] as {
    resolve: (msg: any) => void;
    reject: (e: any) => void;
  }[];
  private cleanups = [] as (() => void)[];

  /** Lines received from a TtyXterm. */
  private inputs = [] as { line: string; resolve(): void }[];
  private input = null as null | { line: string; resolve(): void };
  /** Lines in current interactive parse */
  private buffer = [] as string[];

  private readonly maxLines = 500;

  constructor(
    sessionKey: string,
    io: ShellIo<MessageFromXterm, MessageFromShell>,
    /** Source code entered interactively, most recent last. */
    history: string[],
  ) {
    this.sessionKey = sessionKey;
    this.io = io;
    this.history = history;
    this.key = `/dev/tty-${sessionKey}`;
  }

  //#region Device
  async readData(): Promise<ReadResult> {
    return await new Promise((resolve, reject) => {
      this.oneTimeReaders.push({
        resolve: (msg: string) => resolve({ data: msg }),
        reject,
      });
      this.input?.resolve();
      this.input = null;
    });
  }
  async writeData(data: any) {
    this.io.write(data);
  }
  finishedWriting() {
    // NOOP
  }
  /**
   * Background processes are not allowed to read from TTY.
   * We further assume there is at most one interactive process reading it.
   */
  finishedReading() {
    this.buffer.length = 0;
    // this.oneTimeReaders.forEach(({ reject }) => reject());
    this.oneTimeReaders.forEach(({ resolve }) => void resolve(undefined));
    this.oneTimeReaders.length = 0;
  }
  //#endregion

  dispose() {
    this.xterm.dispose();
    this.cleanups.forEach((cleanup) => void cleanup());
    this.cleanups.length = 0;
  }

  getHistory() {
    return this.history.slice();
  }

  private getHistoryLine(lineIndex: number) {
    const maxIndex = this.history.length - 1;
    return {
      line: this.history[maxIndex - lineIndex] ?? "",
      nextIndex: Math.min(Math.max(0, lineIndex), maxIndex),
    };
  }

  async initialise(xterm: TtyXterm) {
    this.xterm = xterm;

    // Connect
    this.cleanups.push(this.io.read(this.onMessage.bind(this)));

    // The session corresponds to leading process where pid = ppid = pgid = 0
    this.process = sessionApi.createProcess({
      sessionKey: this.sessionKey,
      ppid: 0,
      pgid: 0,
      src: "",
      ptags: this.sessionLeaderPtags,
    });
  }

  isInitialized() {
    return !!this.process;
  }

  /**
   * The shell is "interactive" iff the profile has run and the prompt is ready.
   * This should happen exactly when the leading process is NOT running.
   *
   * We also tag processes with `ProcessTag.interactive`,
   * where the session leader is always tagged.
   */
  isInteractive() {
    return this.profileFinished === true && this.xterm.isPromptReady() === true;
  }

  private onMessage(msg: MessageFromXterm) {
    switch (msg.key) {
      case "req-history-line": {
        const { line, nextIndex } = this.getHistoryLine(msg.historyIndex);
        this.io.write({
          key: "send-history-line",
          line,
          nextIndex,
        });
        break;
      }
      case "send-kill-sig": {
        this.buffer.length = 0;
        this.oneTimeReaders.forEach(
          ({ reject }) => void reject(new SigKillError({ pid: 0, sessionKey: this.sessionKey })),
        );
        this.oneTimeReaders.length = 0;

        break;
      }
      case "send-line": {
        const reader = this.oneTimeReaders.shift();

        if (reader === undefined) {
          this.inputs.push({
            line: msg.line,
            // xterm won't send another line until resolved
            resolve: () => this.io.write({ key: "tty-received-line" }),
          });
          this.tryParse();
        } else {
          reader.resolve(msg.line);
          this.io.write({ key: "tty-received-line" });
        }

        break;
      }
      default:
        throw new ExhaustiveError(msg);
    }
  }

  /** `prompt` must not contain non-readable characters e.g. ansi color codes */
  private prompt(prompt: string) {
    this.io.write({
      key: "send-xterm-prompt",
      prompt: `${prompt} `,
    });
  }

  private provideContextToParsed(parsed: JSh.FileWithMeta) {
    Object.assign<JSh.BaseMeta, JSh.BaseMeta>(parsed.meta, {
      sessionKey: this.sessionKey,
      pid: 0,
      ppid: 0,
      pgid: 0,
      fd: { 0: this.key, 1: this.key, 2: this.key },
      stack: [],
      verbose: false,
    });
  }

  /**
   * We run the profile by pasting it into the terminal.
   * This explicit approach can be avoided via `source`.
   *
   * Importantly this sets `this.profileHasRun` as `true`.
   */
  async runProfile() {
    const profile =
      sessionApi.getVar({ pid: 0, sessionKey: this.sessionKey } as JSh.BaseMeta, "PROFILE") || "";

    try {
      this.xterm.historyEnabled = false;
      sessionApi.writeMsg(
        this.sessionKey,
        `${ansi.BlueBold}${this.sessionKey}${ansi.White} running ${ansi.BlueBold}/home/PROFILE${ansi.Reset}`,
        "info",
      );

      await this.xterm.pasteAndRunLines(profile.split("\n"), true);
    } catch {
      // see tryParse catch
    } finally {
      this.profileFinished = true;
      this.process.status = toProcessStatus.Suspended;
      this.xterm.historyEnabled = true;
      this.prompt("$");
    }
  }

  /**
   * `ptags.interactive` inherited until overwritten via `&` (background operator).
   * Pipes don't overwrite, despite having their own process group.
   */
  private get sessionLeaderPtags() {
    return { [ProcessTag.interactive]: true };
  }

  /**
   * Spawn a process, assigning:
   * - new pid
   * - ppid as term.meta.ppid
   * - pgid as term.meta.pgid
   */
  async spawn(
    term: JSh.FileWithMeta,
    opts: {
      /**
       * Spawned by:
       * - `&` -- running a background operator.
       * - `|` -- running a shell pipeline.
       * - `()` -- running a subshell.
       * - `$()` -- running a command substitution.
       * - `function` -- invoking shell function.
       * - `root` -- the session leader right after parsing shell code.
       * - `source` -- the builtin `source` in cmd.service.
       * - `source-external` -- an externally triggered "source".
       */
      by: "&" | "|" | "()" | "$()" | "function" | "root" | "source" | "source-external";
      cleanups?: (() => void)[];
      localVar?: boolean;
      posPositionals?: string[];
      /** Process tags overriding those inherited from parent */
      ptags?: Ptags;
    },
  ) {
    const { meta } = term;

    /** An "interactive spawn" runs by re-using the session leader i.e. `this.process`. */
    const interactive = meta.pgid === 0 && (opts.by === "root" || opts.by === "source");

    let process = this.process;

    if (this.profileFinished === true) {
      if (interactive === true) {
        // - Only reachable by interactively specifying a command after profile has run
        // - We ensure session leader has status Running
        process.status = toProcessStatus.Running;
      }
    } else {
      if (process.status === toProcessStatus.Suspended && opts.by !== "source-external") {
        // - Only reachable if session leader paused "externally" during profile
        // - We halt
        await new Promise<void>((resolve, reject) => {
          process.cleanups.push(() => reject(killError(meta, 130)));
          process.onResumes.push(resolve);
        });
      }
    }

    if (interactive !== true) {
      // Create subprocess
      const { ppid, pgid, sessionKey } = meta;
      const session = sessionApi.getSession(sessionKey);
      const parent = session.process[ppid]; // Exists
      process = sessionApi.createProcess({
        ppid,
        pgid,
        sessionKey,
        src: computeJShSource.src(term),
        posPositionals: opts.posPositionals || parent.positionals.slice(1),
        ptags: applyPtagUpdates({ ...parent.ptags }, opts.ptags ?? {}),
      });
      meta.pid = process.key;

      if (opts.cleanups !== undefined) {
        process.cleanups.push(...opts.cleanups);
      }

      if (parent.pgid === 0 && opts.by !== "source-external") {
        // reset session leader ptags after non-interactive spawn,
        // except e.g. external sources triggered by hot-module-reload
        this.process.ptags = this.sessionLeaderPtags;
      }

      if (
        this.disabled === true &&
        // processes not tagged with 'always' are paused,
        // except those which are tagged interactive
        !(ProcessTag.always in process.ptags) &&
        !(ProcessTag.interactive in process.ptags) &&
        this.spawnBgPaused === true
      ) {
        process.status = toProcessStatus.Suspended;
      }

      // Shallow clone avoids mutation by descendants
      process.inheritVar = { ...parent.inheritVar, ...parent.localVar };
      if (opts.localVar === true) {
        // Some processes need their own PWD e.g. background, subshell
        process.localVar.PWD = parent.inheritVar.PWD ?? session.var.PWD;
        process.localVar.OLDPWD = parent.inheritVar.OLDPWD ?? session.var.OLDPWD;
      }

      if (opts.by === "&") {
        session.lastBg = process.key;
      }
    }

    /**
     * This spawn is leading if either:
     * 1. `pgid === 0` and it was spawned by session leader (not `source`).
     * 2. `pid === pgid !== 0`
     */
    const leading = interactive === true ? opts.by === "root" : meta.pid === meta.pgid;

    if (leading === true) {
      // Process leaders emit external events
      process.src !== "" &&
        this.io.write({
          key: "external",
          msg: {
            key: "process-leader",
            pid: meta.pid,
            act: "started",
            profileRunning: this.profileFinished === false ? true : undefined,
            // src: process.src,
          },
        });

      process.onSuspends.push(() => {
        this.io.write({
          key: "external",
          msg: {
            key: "process-leader",
            pid: meta.pid,
            act: "paused",
            profileRunning: this.profileFinished === false ? true : undefined,
          },
        });
        return true;
      });

      process.onResumes.push(() => {
        this.io.write({
          key: "external",
          msg: {
            key: "process-leader",
            pid: meta.pid,
            act: "resumed",
            profileRunning: this.profileFinished === false ? true : undefined,
          },
        });
        return true;
      });
    }

    try {
      // Run process
      for await (const _ of jShSemantics.File(term)) {
        // Unreachable: yielded values already sent to devices:
        // - (tty, fifo, null, var, voice)
      }
      term.meta.verbose === true &&
        warn(
          `${meta.sessionKey}${meta.background ? " (background)" : ""}: ${meta.pid}: exit ${
            term.exitCode
          }`,
        );
    } catch (e) {
      if (e instanceof SigKillError) {
        // possibly via preProcessWrite
        ttyError(`${meta.sessionKey}${meta.pgid ? " (background)" : ""}: ${meta.pid}: SIGKILL`);
        // Ctrl-C code is 130 unless overridden
        term.exitCode = e.exitCode ?? 130; // 🚧 or 137?
      } else if (e instanceof ShError) {
        term.exitCode = e.exitCode;
      }
      throw e;
    } finally {
      sessionApi.setLastExitCode(term.meta, term.exitCode);

      if (!interactive) {
        sessionApi.removeProcess(meta.pid, this.sessionKey);
      }

      if (leading) {
        process.src !== "" &&
          this.io.write({
            key: "external",
            msg: {
              key: "process-leader",
              pid: meta.pid,
              act: "ended",
              profileRunning: this.profileFinished === false ? true : undefined,
            },
          });

        // must clear in case of session leader (reused)
        process.cleanups.length = 0;
        process.onResumes.length = 0;
        process.onSuspends.length = 0;
      }
    }
  }

  /**
   * 🔔 This runs code `src` in a process whose parent is the session leader.
   * @param src should only contain shell function declarations
   */
  async sourceExternal(src: string) {
    const term = await parseService.parse(src);
    this.provideContextToParsed(term);
    await this.spawn(term, { by: "source-external" });
  }

  private storeSrcLine(srcLine: string) {
    const prev = this.history.pop();
    if (prev !== undefined) {
      this.history.push(prev);
    }
    if (prev !== srcLine) {
      this.history.push(srcLine);
      while (this.history.length > this.maxLines) {
        this.history.shift();
      }
      sessionApi.persistHistory(this.sessionKey);
    }
  }

  private async tryParse() {
    this.input = this.inputs.pop() ?? null;
    if (this.input === null) {
      return;
    }
    try {
      this.buffer.push(this.input.line);
      const result = await parseService.tryParseBuffer(this.buffer.slice());

      switch (result.key) {
        case "complete":
          {
            this.buffer.length = 0;

            const singleLineSrc = computeJShSource.src(result.parsed);
            if (singleLineSrc !== "" && this.xterm.historyEnabled === true) {
              this.storeSrcLine(singleLineSrc); // Store command in history
            }

            // Run command
            this.process.src = singleLineSrc;
            this.provideContextToParsed(result.parsed);
            await this.spawn(result.parsed, { by: "root" });

            this.prompt("$");
          }
          break;
        case "incomplete":
          this.prompt(">");
          break;
        case "failed": {
          const errMsg = `mvdan-sh: ${result.error.replace(/^src\.sh:/, "")}`;
          error(errMsg);
          this.io.write({ key: "error", msg: errMsg });

          // store mvdan-sh parse errors in history
          this.storeSrcLine(this.buffer.join("\n"));

          this.buffer.length = 0;
          this.prompt("$");
          break;
        }
      }
    } catch (e) {
      if (e instanceof SigKillError) {
        jShSemantics.handleTopLevelProcessError(e);
      } else {
        ttyError("unexpected error propagated to tty.shell", e);
      }
      this.prompt("$");
    } finally {
      this.input.resolve();
      this.input = null;
    }
  }
}

/** Avoid clogging logs with "pseudo errors" */
export function ttyError(...args: unknown[]) {
  debug("[ttyError]", ...args);
}
