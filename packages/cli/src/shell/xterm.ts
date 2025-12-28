import { ExhaustiveError } from "@npc-cli/util";
import { jsStringify, warn } from "@npc-cli/util/legacy/generic";
import type { Terminal } from "@xterm/xterm";
import debounce from "debounce";
import { ansi, scrollback } from "./const";
import { highlight } from "./highlight";
import {
  type DataChunk,
  isDataChunk,
  isProxy,
  type MessageFromShell,
  type MessageFromXterm,
  type ShellIo,
} from "./io";
import { formatMessage } from "./util";

export class TtyXterm {
  /**
   * History will be disabled during initial profile,
   * which is actually pasted into the terminal.
   */
  historyEnabled = true;

  maxStringifyLength = 2 * scrollback * 100;
  /** sugar-high can be slow for strings of length `maxStringifyLength`  */
  maxHighlightLength = 2 * 50 * 100;

  cleanups = [] as (() => void)[];
  session: SessionInput;
  xterm: Terminal;

  /**
   * Commands include writing a line, clearing the screen.
   * They're induced by user input and/or processes in respective session.
   */
  private commandBuffer: XtermOutputCommand[];

  /**
   * The current user input line before pressing enter.
   */
  private input: string;
  /**
   * Number of characters from char after prompt
   * to the current cursor position.
   */
  private cursor: number;
  /**
   * User-input prompt e.g. '$ '.
   * We do not support escape chars in prompt.
   */
  private prompt: string;
  /** Has the tty received the last line sent? */
  private readyForInput: boolean;
  /** Has the tty prompted for input and we haven't sent yet? */
  private promptReady: boolean;
  /** Timeout id for next drain of {commandBuffer} to screen. */
  private nextPrintId: null | number;

  private historyIndex = -1;
  private preHistory: string;
  private linesPerUpdate = 500;
  private refreshMs = 0;

  constructor(xterm: Terminal, session: SessionInput) {
    this.xterm = xterm;
    this.session = session;

    this.input = "";
    this.cursor = 0;
    this.prompt = "";
    this.readyForInput = true;
    this.promptReady = false;
    this.commandBuffer = [];
    this.nextPrintId = null;
    this.historyIndex = -1;
    this.preHistory = this.input;
  }

  /**
   * Compute actual cursor (1-dimensional), taking prompt into account.
   */
  private actualCursor(input: string, cursor: number) {
    return this.actualLine(input.slice(0, cursor)).length;
  }

  /**
   * Compute whole 'line' including prompt.
   */
  private actualLine(input: string) {
    return this.prompt + input;
  }

  canType() {
    return this.xterm.textarea!.disabled === false;
  }

  /**
   * Clears the input possibly over many lines.
   * Returns the cursor to the start of the input.
   */
  clearInput() {
    this.setCursor(0);

    // Compute number of lines to clear, starting at current
    const numLines = Math.max(
      this.numLines(),
      /**
       * Cover case where terminal width resized narrow,
       * causing pending input to wrap over many lines.
       * Why is `this.numLines()` insufficient? Maybe out of sync?
       */
      this.xterm.rows - this.xterm.buffer.active.cursorY - 1,
    );

    // https://xtermjs.org/docs/api/vtfeatures/
    // ESC[E means Cursor Next Line
    // ESC[F means Cursor Backward (upwards) -- but why not ESC[A?
    // ESC[2K means Erase In Line (2 means Erase entire line)
    if (numLines > 1) {
      this.xterm.write("\x1b[2K\x1b[E".repeat(numLines - 1));
      this.xterm.write("\x1b[2K"); // Ensure final line deleted too
      this.xterm.write("\x1b[F".repeat(numLines - 1)); // Return to start
    } else {
      // Seems to solve issue at final line of viewport,
      // i.e. `\x1b[E` did nothing, and `\x1b[F` moved cursor up.
      this.xterm.write("\x1b[2K\r");
    }
    this.input = "";
  }

  /**
   * Clear the screen without creating a new line.
   * Any pending input is preserved.
   */
  clearScreen() {
    // Writing a line for each row moves visible lines just offscreen
    for (let i = 0; i < this.xterm.rows - 1; i++) {
      this.xterm.writeln("");
    }
    // Return to start of viewport
    this.xterm.write("\x1b[F".repeat(this.xterm.rows));
    this.xterm.scrollToBottom();

    this.showPendingInput();
  }

  /**
   * Find closest word-boundary to the left of cursor.
   */
  private closestLeftBoundary(input: string, cursor: number) {
    const found = this.wordBoundaries(input, true)
      .reverse()
      .find((x) => x < cursor);
    return found || 0;
  }

  /**
   * Find closest word-boundary to the right of cursor.
   */
  private closestRightBoundary(input: string, cursor: number) {
    const found = this.wordBoundaries(input, false).find((x) => x > cursor);
    return found || input.length;
  }

  /**
   * Delete right-most word to the left of cursor.
   */
  deletePreviousWord() {
    const cursor = this.closestLeftBoundary(this.input, this.cursor);
    if (cursor != null) {
      const nextInput = this.input.slice(0, cursor) + this.input.slice(this.cursor);
      this.clearInput();
      this.setInput(nextInput);
      this.setCursor(cursor);
    }
  }

  dispose() {
    this.sendSigKill();
    this.cleanups.forEach((cleanup) => void cleanup());
    this.cleanups.length = 0;
    try {
      this.xterm.dispose();
    } catch (e) {
      // xterm-addon-webgl throws `Cannot read properties of undefined (reading 'onRequestRedraw')`
      warn(`xterm.dispose: ignoring error: "${((e as any) || {}).message || e}"`);
    }
  }

  getCursor() {
    return this.cursor;
  }

  getInput() {
    return this.input;
  }

  /**
   * If xterm invisible and we paste exceeding scroll bounds for first time,
   * then scrollbars do not appear (nor does fitAddon.fit() help).
   * This hack makes them appear.
   */
  forceResize() {
    this.xterm.resize(this.xterm.cols + 1, this.xterm.rows);
    this.xterm.resize(this.xterm.cols - 1, this.xterm.rows);
  }

  /**
   * Erase a character at cursor location.
   */
  private handleCursorErase(backspace: boolean) {
    const { cursor, input } = this;

    if (backspace) {
      // console.log({ input, cursor });
      if (cursor <= 0) {
        return;
      }

      // when deleting a newline, need to delete \r\n
      const delta = input.charAt(cursor - 1) === "\n" ? -2 : -1;
      const newInput = input.slice(0, cursor + delta) + input.slice(cursor);
      this.clearInput();
      this.setInput(newInput);
      this.setCursor(cursor + delta);
      // console.log({ input, cursor, newInput, nextCursor: cursor + delta });
    } else {
      const newInput = input.slice(0, cursor) + input.slice(cursor + 1);
      this.clearInput();
      this.setInput(newInput);
      this.setCursor(cursor);
    }
  }

  /**
   * Insert characters at cursor location
   */
  private handleCursorInsert(data: string) {
    const { input, cursor } = this;
    const newInput = input.slice(0, cursor) + data + input.slice(cursor);
    // Store cursor
    const nextCursor = this.cursor + data.length;
    this.clearInput();
    this.setInput(newInput);
    // Update cursor
    this.setCursor(nextCursor);
  }

  /**
   * Move cursor forwards/backwards (+1/-1).
   */
  private handleCursorMove(dir: -1 | 1) {
    // Assume newlines always occur as \r\n
    const clampedCursor = Math.min(this.input.length, Math.max(0, this.cursor + dir));
    if (dir === 1 && this.input[clampedCursor] === "\r") {
      this.setCursor(clampedCursor + 1);
    } else if (dir === -1 && this.input[clampedCursor] === "\n") {
      this.setCursor(clampedCursor - 1);
    } else {
      this.setCursor(clampedCursor);
    }
  }

  private async handleXtermInput(data: string) {
    if (this.readyForInput === false && data !== "\x03") {
      return;
    }

    if (data.length === 1 || data.includes("\r") === false) {
      this.handleXtermKeypresses(data);
    } else if (data === "\u001b\r") {
      // "Alt + Enter" -> newline (see Ctrl + J)
      this.handleXtermKeypresses("\n");
    } else {
      // Handle multi-line paste
      // since convertEol: true we don't need \r
      const text = data.replace(/\r/g, "\n");
      const { input, cursor } = this;
      this.clearInput();
      this.setInput(`${input.slice(0, cursor)}${text}${input.slice(cursor)}`);
    }
  }

  /**
   * Handle:
   * - individual characters (including escape sequences)
   * - multiple characters via a paste without newline
   * - ℹ️ alt means Option on MacOS
   */
  private handleXtermKeypresses(data: string) {
    const ord = data.charCodeAt(0);
    let cursor: number;

    // if (data.length > 1 && this.input.startsWith(data)) {
    //   // Ignore input-replacement deletes,
    //   // because cannot handle them properly (ambiguous)
    //   return;
    // }

    if (ord == 0x1b) {
      // ansi escape sequences
      switch (data.slice(1)) {
        case "[A": // Up arrow
          if (this.promptReady === true) {
            this.reqHistoryLine(+1);
          }
          break;
        case "[B": // Down arrow
          if (this.promptReady === true) {
            this.reqHistoryLine(-1);
          }
          break;
        case "[D": // Left Arrow
          this.handleCursorMove(-1);
          break;
        case "[C": // Right Arrow
          this.handleCursorMove(1);
          break;
        case "[3~": // Delete
          this.handleCursorErase(false);
          break;
        case "[F": // End
          this.setCursor(this.input.length);
          break;
        case "[H": // Home (?)
          this.setCursor(0);
          break;
        // case "b": // Alt + Left
        case "[1;5D": // Alt + Left
          cursor = this.closestLeftBoundary(this.input, this.cursor);
          if (cursor != null) {
            this.setCursor(cursor);
          }
          break;
        // case "f": // Alt + Right
        case "[1;5C": // Alt + Right
          cursor = this.closestRightBoundary(this.input, this.cursor);
          if (cursor != null) {
            this.setCursor(cursor);
          }
          break;
        case "3": // Alt + 3
          this.handleCursorInsert("#"); // British
          break;
        case "\x7F": // Ctrl + Backspace
          this.deletePreviousWord();
          break;
        case "[1;3A": // Alt + Up
          this.xterm.scrollToTop();
          break;
        case "[1;3B": // Alt + Down
          this.xterm.scrollToBottom();
          break;
      }
    } else if (ord < 32 || ord === 0x7f) {
      // Handle special characters
      switch (data) {
        case "\r": // Enter i.e. send command
          this.queueCommands([{ key: "newline" }]);
          break;
        case "\n": {
          // Ctrl + J i.e. literal newline (readline Ctrl+V, Ctrl+J)
          const input = this.input;
          const cursor = this.cursor;
          this.clearInput();
          this.setInput(`${input.slice(0, cursor)}\r\n${input.slice(cursor)}`);
          this.setCursor(cursor + 2);
          break;
        }
        case "\x7F": // Backspace
          this.handleCursorErase(true);
          break;
        case "\t": // Tab
          // We don't support autocompletion
          this.handleCursorInsert("  ");
          break;
        case "\x03": // Ctrl + C
          this.sendSigKill();
          break;
        case "\x17": // Ctrl + W
          // Delete previous word
          this.deletePreviousWord();
          break;
        case "\x01": // Ctrl + A
          // Goto line start
          this.setCursor(0);
          break;
        case "\x05": // Ctrl + E
          // Goto EOL; do not collect £200
          this.setCursor(this.input.length);
          break;
        case "\x0C": // Ctrl + L
          // Clear screen
          this.clearScreen();
          break;
        case "\x0b": {
          // Ctrl + K
          // Erase from cursor to EOL.
          const nextInput = this.input.slice(0, this.cursor);
          this.clearInput();
          this.setInput(nextInput);
          break; // Cursor already at EOL
        }
        case "\x15": {
          // Ctrl + U
          // Erase from start of line to cursor.
          const nextInput = this.input.slice(this.cursor);
          this.clearInput();
          this.setInput(nextInput);
          this.setCursor(0);
          break;
        }
      }
    } else {
      // Visible characters
      this.handleCursorInsert(data);
    }
  }

  initialise() {
    const xtermDisposable = this.xterm.onData(this.handleXtermInput.bind(this));
    const unregisterWriters = this.session.io.handleWriters(this.onMessage.bind(this));
    this.cleanups.push(() => {
      xtermDisposable.dispose();
      unregisterWriters();
    });
    // user indication after xterm has loaded but session hasn't
    this.xterm.writeln(`${ansi.Italic}${ansi.WhiteBright}Loading...${ansi.Reset}`);
  }

  /**
   * Suppose we're about to write `nextInput` possibly after prompt.
   * If real input ends _exactly_ at right-hand edge, the cursor doesn't wrap.
   * This method detects this so we can append `\r\n`.
   */
  private inputEndsAtEdge(nextInput: string) {
    const realInput = this.actualLine(nextInput);
    const realCursor = this.actualCursor(nextInput, nextInput.length);
    const { col } = this.offsetToColRow(realInput, realCursor);
    return col === 0;
  }

  /** Has the tty prompted for input and we haven't sent yet? */
  isPromptReady() {
    return this.promptReady;
  }

  /**
   * Count the number of lines in the current input, including prompt.
   */
  numLines() {
    return 1 + this.offsetToColRow(this.actualLine(this.input), this.input.length + 2).row;
  }

  /**
   * Convert 0-based `cursor` in `input` to
   * a relative 0-based row/col location.
   */
  private offsetToColRow(input: string, cursor: number) {
    const { cols } = this.xterm;
    let row = 0,
      col = 0;
    for (let i = 0; i < cursor; ++i) {
      const chr = input.charAt(i);
      if (col === 0 && chr === "\n") {
        row++;
      } else if (chr === "\r") {
        // Assume newlines always occur as \r\n
      } else if (chr === "\n") {
        col = 0;
        row++;
      } else {
        col++;
        if (col >= cols) {
          col = 0;
          row++;
        }
      }
    }
    return { row, col };
  }

  private onMessage(msg: MessageFromShell | string) {
    if (typeof msg === "string") {
      const lines = msg.split("\n");
      const commands = lines.map((line) => ({
        key: "line" as const,
        line: `${ansi.White}${line}${ansi.Reset}`,
      }));
      // this.session.rememberLastValue(lines[lines.length - 1]);
      return this.queueCommands(commands);
    } else if (msg === null) {
      this.session.rememberLastValue(null);
      return this.queueCommands([{ key: "line", line: `${ansi.YellowBright}null${ansi.Reset}` }]);
    } else if (msg === undefined) {
      return;
    } else if (isProxy(msg)) {
      this.session.rememberLastValue(msg);
      return this.queueCommands([
        {
          key: "line",
          line: `${ansi.YellowBright}${jsStringify({ ...msg }).slice(-this.maxStringifyLength)}${
            ansi.Reset
          }`,
        },
      ]);
    }

    switch (msg.key) {
      case "send-xterm-prompt": {
        this.setPrompt(msg.prompt);
        return;
      }
      case "clear-xterm": {
        this.clearScreen();
        return;
      }
      case "tty-received-line": {
        /**
         * The tty inode has received the line sent from this xterm.
         * We now resume listening for input, even without prompt.
         */
        this.input = "";
        this.readyForInput = true;
        return;
      }
      case "send-history-line":
        if (msg.line) {
          const line = msg.line.split(/\r?\n/).join("\r\n");
          if (this.historyIndex === -1) {
            this.preHistory = this.input;
          }
          this.clearInput();
          this.setInput(line);
          this.historyIndex = msg.nextIndex;
        } else if (msg.nextIndex === 0) {
          // Since msg.line empty we must've gone below
          this.clearInput();
          this.setInput(this.input !== this.preHistory ? this.preHistory : "");
          this.historyIndex = -1;
          this.preHistory = "";
        }
        return;
      case "error":
        this.queueCommands([
          {
            key: "line",
            line: formatMessage(msg.msg, "error"),
          },
        ]);
        break;
      case "info":
        this.queueCommands([
          {
            key: "line",
            line: formatMessage(msg.msg, "info"),
          },
        ]);
        break;
      case "external":
        // 🔔 handled elsewhere e.g. by <Tty>
        break;
      default: {
        const other = msg as any;

        if (isDataChunk(other) === true) {
          /**
           * We'll only process the last `2 * scrollback` items.
           * This makes sense if screen rows no larger than scrollback.
           * The buffer length consists of the screen rows (on resize)
           * plus the scrollback.
           */
          const { items } = other as DataChunk;
          // Pretend we outputted them all
          items.slice(-2 * scrollback).forEach((x) => void this.onMessage(x));
        } else if (other instanceof HTMLElement) {
          this.queueCommands([
            {
              key: "line",
              line: `${ansi.Yellow}<${other.tagName.toLowerCase()}>${ansi.Reset}`,
            },
          ]);
        } else {
          const stringifiedTail = jsStringify(other).slice(-this.maxStringifyLength);
          const highlighted =
            stringifiedTail.length > this.maxHighlightLength
              ? `${ansi.Yellow}${stringifiedTail}`
              : // syntax highlighting based on cli-high
                highlight(stringifiedTail.slice(-this.maxHighlightLength));
          this.queueCommands([
            {
              key: "line",
              line: `${highlighted}${ansi.Reset}`,
            },
          ]);
          this.session.rememberLastValue(other);
        }
      }
    }
  }

  /**
   * Paste lines, greedily running them as soon as a newline is encountered.
   */
  async pasteAndRunLines(lines: string[], fromProfile = false) {
    this.clearInput();
    this.xterm.write(this.prompt);

    for (const line of lines) {
      await new Promise<void>((resolve, reject) => {
        this.queueCommands([
          { key: "paste-line", line },
          { key: "await-prompt", noPrint: fromProfile, resolve, reject },
        ]);
      });
    }
  }

  reqHistoryLine(dir: -1 | 1) {
    if (this.promptReady === true) {
      this.session.io.writeToReaders({
        key: "req-history-line",
        historyIndex: this.historyIndex + dir,
      });
    }
  }

  private printPending() {
    if (this.commandBuffer.length && !this.nextPrintId) {
      // console.log('about to print', this.commandBuffer);
      this.nextPrintId = window.setTimeout(this.runCommands, this.refreshMs);
    }
  }

  queueCommands(commands: XtermOutputCommand[]) {
    for (const command of commands) {
      this.commandBuffer.push(command);
    }
    this.printPending();
  }

  /**
   * Print part of command buffer to the screen.
   */
  private runCommands = () => {
    let command: XtermOutputCommand | undefined;
    let numLines = 0;
    this.nextPrintId = null;

    while ((command = this.commandBuffer.shift()) && numLines <= this.linesPerUpdate) {
      // console.log({ command });
      switch (command.key) {
        case "await-prompt": {
          /**
           * Blocks other commands except 'line' and 'resolve'.
           */
          if (this.commandBuffer[0]?.key === "line") {
            this.commandBuffer.splice(1, 0, command);
            break;
          } else if (this.commandBuffer[0]?.key === "resolve") {
            this.commandBuffer[0].resolve();
            this.commandBuffer.splice(0, 1, command);
            break;
          }

          this.commandBuffer.unshift(command);
          return;
        }
        case "clear": {
          this.clearScreen();
          break;
        }
        case "line": {
          this.xterm.writeln(command.line);
          numLines++;
          break;
        }
        case "newline": {
          // Might have pressed enter on earlier line in multiline input
          let { row: currentRow } = this.offsetToColRow(this.input, this.cursor);
          const { row: finalRow } = this.offsetToColRow(this.input, this.input.length);
          while (currentRow++ < finalRow) this.xterm.write("\r\n");

          this.xterm.write("\r\n");
          this.sendLine();
          return;
        }
        case "paste-line": {
          this.xterm.writeln(command.line);
          this.input = command.line;
          this.sendLine();
          return;
        }
        case "resolve": {
          command.resolve();
          break;
        }
        case "prompt": {
          this.promptReady = true;
          this.showPendingInput();
          break;
        }
        default:
          throw new ExhaustiveError(command);
      }
    }

    this.printPending();
  };

  /**
   * Send line to reader.
   */
  private sendLine() {
    this.prompt = "";
    this.readyForInput = this.promptReady = false;
    this.historyIndex = -1;
    this.preHistory = "";

    this.session.io.writeToReaders({
      key: "send-line",
      line: this.input,
    });
  }

  /**
   * Send kill signal to foreground process group.
   */
  sendSigKill() {
    this.input = "";
    this.setCursor(0);
    this.xterm.write("^C\r\n");
    this.cursor = 0;
    // Immediately forget any pending output
    this.commandBuffer.forEach(
      (cmd) => void (cmd.key === "resolve" || (cmd.key === "await-prompt" && cmd.reject?.())),
    );
    this.commandBuffer.length = 0;
    // Reset controlling process
    this.session.io.writeToReaders({ key: "send-kill-sig" });
  }

  setCanType(canType: boolean) {
    this.xterm.textarea!.disabled = !canType;
  }

  /**
   * Move the terminal's cursor and update `this.cursor`.
   */
  setCursor(newCursor: number) {
    newCursor = Math.min(this.input.length, Math.max(0, newCursor));

    // const active = this.active;
    // const pagePrevChars = active.cursorX + (active.cursorY * this.cols);
    // newCursor = Math.max(newCursor, this.input.length - pagePrevChars + 1)

    // Compute actual input with prompt(s)
    const inputWithPrompt = this.actualLine(this.input);
    // Get previous cursor position
    const prevPromptOffset = this.actualCursor(this.input, this.cursor);
    const { col: prevCol, row: prevRow } = this.offsetToColRow(inputWithPrompt, prevPromptOffset);
    // Get next cursor position
    const newPromptOffset = this.actualCursor(this.input, newCursor);
    const { col: nextCol, row: nextRow } = this.offsetToColRow(inputWithPrompt, newPromptOffset);

    // console.log({ input: this.input, newCursor, inputWithPrompt, prevPromptOffset, newPromptOffset, prevCol, prevRow, nextCol, nextRow });

    // Adjust vertically
    if (nextRow > prevRow) {
      // Cursor Down
      for (let i = prevRow; i < nextRow; ++i) this.xterm.write("\x1b[B");
    } else {
      // Cursor Up
      for (let i = nextRow; i < prevRow; ++i) this.xterm.write("\x1b[A");
    }

    // Adjust horizontally
    if (nextCol > prevCol) {
      // Cursor Forward
      for (let i = prevCol; i < nextCol; ++i) this.xterm.write("\x1b[C");
    } else {
      // Cursor Backward
      for (let i = nextCol; i < prevCol; ++i) this.xterm.write("\x1b[D");
    }
    this.cursor = newCursor;
  }

  /**
   * Writes the input which may span over multiple lines.
   * Updates {this.input}. Finishes with cursor at end of input.
   */
  setInput(newInput: string) {
    this.setCursor(0); // Return to start of input.
    const realNewInput = this.actualLine(newInput);
    this.xterm.write(realNewInput);

    /**
     * If cursor at right-edge and press key it does not move (🤔 why?),
     * so we force it to jump to next line.
     *
     * Exceptions:
     * (a) delete 1st character of multiline input.
     * (b) delete 1st character while TTY connected to process e.g. `map 'x => 2 ** x'`
     */
    if (!(realNewInput.endsWith("\n") || this.promptReady) && this.inputEndsAtEdge(newInput)) {
      this.xterm.write("\r\n");
    }
    this.input = newInput;
    this.cursor = newInput.length;
  }

  /** Set and print prompt, unblocking any 'await-prompt'. */
  setPrompt(prompt: string) {
    this.prompt = prompt;
    const [first] = this.commandBuffer;
    if (first?.key === "await-prompt") {
      this.commandBuffer.shift();
      first.resolve();
      this.queueCommands(first.noPrint ? [] : [{ key: "prompt", prompt }]);
    } else {
      this.queueCommands([{ key: "prompt", prompt }]);
    }
  }

  // 🔔 breaks `ps` if we remove delay
  // 🔔 comes before "resumed session" if remove delay
  showPendingInput = debounce(() => this.showPendingInputImmediately(), 30);

  showPendingInputImmediately() {
    if (this.readyForInput) {
      const input = this.input;
      this.clearInput(); // Clear to avoid double prompt
      this.setInput(input);
    }
  }

  /**
   * Splice `input` into `this.input`.
   */
  spliceInput(input: string) {
    if (this.promptReady === true) {
      const prevInput = this.input;
      const prevCursor = this.cursor;
      this.clearInput();
      this.setInput(prevInput.slice(0, prevCursor) + input + prevInput.slice(prevCursor));
    } else {
      this.warnIfNotReady();
    }
  }

  warnIfNotReady() {
    if (this.promptReady === false) {
      this.queueCommands([{ key: "line", line: formatMessage("not ready", "info") }]);
      return true; // not ready
    } else {
      return false;
    }
  }

  /**
   * Find all word boundaries.
   */
  private wordBoundaries(input: string, leftSide = true) {
    let match: null | RegExpExecArray;
    const words = [] as number[];
    const boundaryRegex = /\w+/g;

    // eslint-disable-next-line no-cond-assign
    while ((match = boundaryRegex.exec(input))) {
      words.push(leftSide ? match.index : match.index + match[0].length);
    }
    return words;
  }
}

type SessionInput = {
  key: string;
  io: ShellIo<MessageFromXterm, MessageFromShell>;
  /** Write last interactive non-string returned value to `home/_` */
  rememberLastValue: (msg: any) => void;
};

type XtermOutputCommand =
  | {
      /**
       * Wait for next prompt from tty.
       * - ≤ 1 in commandBuffer
       * - blocks other commands except 'line'
       * - unblocked by prompt from tty; invokes `resolve`
       * - `reject` invoked on Ctrl-C
       */
      key: "await-prompt";
      /** Should we suppress the prompt?  */
      noPrint?: boolean;
      resolve(): void;
      reject(): void;
    }
  | {
      /** Clear the screen */
      key: "clear";
    }
  | {
      /** Write a single line of text including final newline */
      key: "line";
      line: string;
    }
  | {
      /** Write a newline and send `this.input` to tty */
      key: "newline";
    }
  | {
      /**
       * Write a pasted line of text and send it to tty.
       * - Currently this only happens in PROFILE.
       * - These are not interactively specified.
       */
      key: "paste-line";
      line: string;
    }
  | {
      /**
       * - Invoke the function `resolve`.
       * - Optional function `reject` invoked on Ctrl-C.
       */
      key: "resolve";
      resolve(): void;
      reject?(): void;
    }
  | {
      /** Write prompt */
      key: "prompt";
      prompt: string;
    };
