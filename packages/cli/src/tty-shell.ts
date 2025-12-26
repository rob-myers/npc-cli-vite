import { computeJShSource, type JSh } from "@npc-cli/parse-sh";
import type { MessageFromShell, MessageFromXterm, ShellIo } from "./io";
import { parseService } from "./parse";
import { type ProcessMeta, type Ptags, sessionApi } from "./store/session.store";
import type { TtyXterm } from "./tty-xterm";

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

  // 🚧
  //@ts-expect-error
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

            // 🚧
          }
          break;
        case "incomplete":
          break;
        case "failed":
          break;
      }
    } catch (e) {
    } finally {
      this.input.resolve();
      this.input = null;
    }
  }
}
