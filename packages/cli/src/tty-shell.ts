import { computeJShSource, type JSh } from "@npc-cli/parse-sh";
import { ExhaustiveError } from "@npc-cli/util";
import { error } from "@npc-cli/util/legacy/generic";
import { ProcessTag } from "./const";
import type { MessageFromShell, MessageFromXterm, ShellIo } from "./io";
import { parseService } from "./parse";
import { type ProcessMeta, type Ptags, sessionApi } from "./store/session.store";
import type { TtyXterm } from "./tty-xterm";
import { SigKillError } from "./util";

export class TtyShell {
  key: string;
  sessionKey: string;
  io: ShellIo<MessageFromXterm, MessageFromShell>;
  history: string[];
  xterm!: TtyXterm;

  /** Lines received from a TtyXterm. */
  private inputs = [] as { line: string; resolve(): void }[];
  private input = null as null | { line: string; resolve(): void };
  /** Lines in current interactive parse */
  private buffer = [] as string[];

  private process!: ProcessMeta;
  private oneTimeReaders = [] as {
    resolve: (msg: unknown) => void;
    reject: (e: unknown) => void;
  }[];
  private cleanups = [] as (() => void)[];

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
   * `ptags.interactive` inherited until overwritten via `&` (background operator).
   * Pipes don't overwrite, despite having their own process group.
   */
  private get sessionLeaderPtags() {
    return { [ProcessTag.interactive]: true };
  }

  // 🚧
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
    // 🚧
    term;
    opts;
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
    } finally {
      this.input.resolve();
      this.input = null;
    }
  }
}
