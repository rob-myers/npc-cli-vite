import { Subject, type Subscription } from "rxjs";

/**
 * Two ShellSubjects i.e. the man in the middle.
 * Currently only used for TTY.
 */
export class ShellIo<R, W> {
  readable: ShellWire<R>;
  writable: ShellWire<W>;

  constructor(
    /** Readers will read from here */
    readable: ShellWire<R>,
    /** Writers will write to here */
    writable: ShellWire<W>,
  ) {
    this.readable = readable;
    this.writable = writable;
  }

  /**
   * Register a callback to handle writes to this file,
   * returning a cleanup function.
   */
  handleWriters(cb: (msg: W) => void) {
    this.writable.registerCallback(cb);
    return () => this.writable.unregisterCallback(cb);
  }

  /** Read from this file */
  read(cb: (msg: R) => void) {
    this.readable.registerCallback(cb);
    return () => this.readable.unregisterCallback(cb);
  }

  /** Write to this file */
  write(msg: W) {
    this.writable.write(msg);
  }

  /** Write to readers of this file */
  writeToReaders(msg: R) {
    this.readable.write(msg);
  }
}

/** A wire with two ends */
class ShellWire<T> {
  private internal: Subject<T>;
  private cbToSub: Map<(msg: T) => void, Subscription>;

  constructor() {
    this.internal = new Subject();
    this.internal.subscribe();
    this.cbToSub = new Map();
  }

  registerCallback(cb: (msg: T) => void) {
    this.cbToSub.set(cb, this.internal.subscribe(cb));
  }

  unregisterCallback(cb: (msg: T) => void) {
    this.cbToSub.get(cb)?.unsubscribe();
    this.cbToSub.delete(cb);
  }

  write(msg: T) {
    this.internal.next(msg);
  }
}

export type MessageFromXterm = RequestHistoryLine | SendLineToShell | SendKillSignalToShell;

type RequestHistoryLine = {
  key: "req-history-line";
  historyIndex: number;
};

/**
 * After the xterm receives line(s) from user,
 * it sends them to the shell using this message.
 */
type SendLineToShell = {
  key: "send-line";
  line: string;
};

type SendKillSignalToShell = {
  key: "send-kill-sig";
};

export type MessageFromShell =
  | SendXtermPrompt
  | SendXtermInfo
  | SendXtermError
  | ClearXterm
  | TtyReceivedLine
  | SendHistoryLine
  | ExternalMessage;

/** Tty sends and sets xterm prompt */
type SendXtermPrompt = {
  key: "send-xterm-prompt";
  prompt: string;
};

export type SendXtermInfo = {
  key: "info";
  msg: string;
};

export type SendXtermError = {
  key: "error";
  msg: string;
};

/** tty clears xterm */
type ClearXterm = {
  key: "clear-xterm";
};

/** tty informs xterm it received input line */
type TtyReceivedLine = {
  key: "tty-received-line";
};

type SendHistoryLine = {
  key: "send-history-line";
  line: string;
  nextIndex: number;
};

export type ExternalMessage = {
  key: "external";
  msg: ExternalAutoReSourceFile | ExternalMessageProcessLeader;
};

type ExternalAutoReSourceFile = {
  key: "auto-re-source-file";
  absPath: `/etc/${string}`;
};

/** Only sent when `process.src !== ''`. */
export type ExternalMessageProcessLeader = {
  key: "process-leader";
  pid: number;
  act: "started" | "paused" | "resumed" | "ended";
  /** Pid `0` only */
  profileRunning?: true;
};
