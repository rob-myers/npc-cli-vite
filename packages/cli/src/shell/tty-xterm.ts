import { scrollback } from "./io";

export class TtyXterm {
  /**
   * History will be disabled during initial profile,
   * which is actually pasted into the terminal.
   */
  historyEnabled = true;

  maxStringifyLength = 2 * scrollback * 100;

  xterm: any;
}
