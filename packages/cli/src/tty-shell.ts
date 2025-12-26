import { computeJShSource } from "@npc-cli/parse-sh";
import type { MessageFromShell, MessageFromXterm, ShellIo } from "./io";
import { parseService } from "./parse";
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
      // 🚧
      // useSession.api.persistHistory(this.sessionKey);
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
