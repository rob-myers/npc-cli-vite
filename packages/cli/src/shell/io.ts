import { type JSh, traverseParsed } from "@npc-cli/parse-sh";
import { deepClone, last } from "@npc-cli/util/legacy/generic";
import type * as GetOpts from "getopts";
//@ts-expect-error
import getopts from "getopts";
import { Subject, type Subscription } from "rxjs";
import { sessionApi } from "./session.store";
import type { FifoStatus } from "./types";
import { simplifyGetOpts } from "./util";

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

export interface Device {
  /** Uid used to 'resolve' device */
  key: string;
  /**
   * Read data from device
   * - When eof is `true` we may assume no more data
   * - Can specify that exactly one item is read
   * - Can specify if data chunks are forwarded
   */
  readData: (exactlyOne?: boolean, chunks?: boolean) => Promise<ReadResult>;
  /** Write data to device. */
  writeData: (data: any) => Promise<void>;
  /** Query/inform device we have finished all writes. */
  finishedWriting: (query?: boolean) => void | undefined | boolean;
  /** Query/Inform device we have finished all reads. */
  finishedReading: (query?: boolean) => void | undefined | boolean;
}

/**
 * Supports exactly one writer and one reader.
 */
export class FifoDevice implements Device {
  key: string;
  size: number;
  private buffer: any[];
  private readerStatus: FifoStatus = "Initial";
  private writerStatus: FifoStatus = "Initial";
  /** Invoked to resume pending reader */
  private readerResolver = null as null | (() => void);
  /** Invoked to resume pending writer */
  private writerResolver = null as null | (() => void);

  private readonly defaultBuffer = 10000;

  constructor(key: string, size = this.defaultBuffer) {
    this.key = key;
    this.size = size;
    this.buffer = [];
  }

  public async readData(exactlyOnce?: boolean, chunks?: boolean): Promise<ReadResult> {
    this.readerStatus = this.readerStatus || "Connected";

    if (this.buffer.length) {
      this.writerResolver?.(); // Unblock writer
      this.writerResolver = null;

      if (exactlyOnce) {
        if (isDataChunk(this.buffer[0]) === false) {
          // Standard case
          return { data: this.buffer.shift() };
        } else if (chunks) {
          // Forward chunk
          return { data: this.buffer.shift() };
        } else {
          // Handle chunk
          if (this.buffer[0].items.length <= 1) {
            // returns `{ data: undefined }` for empty chunks
            return { data: this.buffer.shift()!.items[0] };
          } else {
            return { data: this.buffer[0].items.shift() };
          }
        }
      } else {
        return { data: this.buffer.shift() };
      }
    } else if (this.writerStatus === "Disconnected") {
      return { eof: true };
    }
    // Reader is blocked
    return new Promise<void>((resolve) => {
      this.readerResolver = resolve;
    }).then(
      // data `undefined` will be filtered by reader
      () => ({ data: undefined }),
    );
  }

  public async writeData(data: any) {
    this.writerStatus = "Connected";
    if (this.readerStatus === "Disconnected") {
      this.buffer.length = 0;
      return;
    }
    this.buffer.push(data);
    this.readerResolver?.(); // Unblock reader
    this.readerResolver = null;
    if (this.buffer.length >= this.size) {
      // Writer is blocked
      return new Promise<void>((resolve) => {
        this.writerResolver = resolve;
      });
    }
  }

  public finishedReading(query?: boolean) {
    if (query === true) {
      return this.readerStatus === "Disconnected";
    }
    this.readerStatus = "Disconnected";
    this.writerResolver?.();
    this.writerResolver = null;
  }

  public finishedWriting(query?: boolean) {
    if (query === true) {
      return this.writerStatus === "Disconnected";
    }
    this.writerStatus = "Disconnected";
    this.readerResolver?.();
    this.readerResolver = null;
  }

  public readAll() {
    const contents = [] as any[];
    this.buffer.forEach((x) => {
      if (x === undefined) {
        return; // 🤔 should undefined ever be in buffer?
      }
      if (isDataChunk(x) === true) {
        x.items.forEach((y) => void contents.push(y));
      } else {
        contents.push(x);
      }
    });
    this.buffer.length = 0;
    return contents;
  }
}

export type ReadResult = {
  eof?: boolean;
  data?: any;
};

export type VarDeviceMode = "array" | "fresh-array" | "last";

export class VarDevice implements Device {
  public key: string;
  private buffer: null | any[];
  private meta: JSh.BaseMeta;
  private varPath: string;
  private mode: VarDeviceMode;

  constructor(meta: JSh.BaseMeta, varPath: string, mode: VarDeviceMode) {
    this.key = `${varPath}@${meta.sessionKey}(${meta.pid})`;
    this.buffer = null;
    this.meta = meta;
    this.varPath = varPath;
    this.mode = mode;
  }

  public async writeData(data: any) {
    if (this.mode === "array" || this.mode === "fresh-array") {
      if (!this.buffer) {
        if (this.mode === "array") {
          this.buffer = sessionApi.getVarDeep(this.meta, this.varPath);
          if (!Array.isArray(this.buffer)) {
            sessionApi.setVarDeep(this.meta, this.varPath, (this.buffer = []));
          }
        } else {
          // "fresh-array"
          sessionApi.setVarDeep(this.meta, this.varPath, (this.buffer = []));
        }
      }
      if (data === undefined) {
        return;
      } else if (isDataChunk(data)) {
        this.buffer.push(...data.items);
      } else {
        this.buffer.push(data);
      }
    } else {
      if (data === undefined) {
        return;
      } else if (isDataChunk(data)) {
        sessionApi.setVarDeep(this.meta, this.varPath, last(data.items));
      } else {
        sessionApi.setVarDeep(this.meta, this.varPath, data);
      }
    }
  }

  public async readData(): Promise<ReadResult> {
    return { eof: true };
  }

  public finishedReading() {
    // NOOP
  }
  public finishedWriting() {
    // NOOP
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

//#region data chunk
export const dataChunkKey = "__chunk__";

export function isDataChunk(data: any): data is DataChunk {
  return (
    data !== undefined &&
    data !== null &&
    // && dataChunkKey in data
    !!data[dataChunkKey]
  );
}
export function dataChunk(items: any[]): DataChunk {
  return { __chunk__: true, items };
}

export interface DataChunk<T = any> {
  [dataChunkKey]: true;
  items: T[];
}
//#endregion

export function getOpts(args: string[], options?: GetOpts.Options) {
  const sortedOpts = args
    .filter((x) => x[0] === "-")
    // -a1 --> -1a (avoid short-opt-assigns)
    // --foo is preserved
    .map((x) => (x[1] === "-" ? x : Array.from(x).sort().join("")));
  const operands = args.filter((x) => x[0] !== "-");
  return {
    opts: simplifyGetOpts(getopts(sortedOpts, options)),
    operands,
  };
}

/**
 * Redirect a node and its descendants e.g.
 * - `echo foo; echo bar >/dev/null; echo baz`.
 * - `echo foo; { echo bar; } >/dev/null; echo baz`.
 *
 * We clone to avoid mutating ancestors.
 */
export function redirectNode(node: JSh.ParsedSh, fdUpdates: Record<number, string>) {
  const newMeta = deepClone(node.meta);
  Object.assign(newMeta.fd, fdUpdates);
  traverseParsed(node, (descendant) => (descendant.meta = newMeta));
}

/** `Proxy`s sent as messages should implement `msg[proxyKey] = true` */
export const proxyKey = "__proxy__";
/** `Proxy`s sent as messages should implement `msg[proxyKey] = true` */
export function isProxy(msg: any): boolean {
  return !!(msg && msg[proxyKey]);
}
