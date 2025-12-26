export class SigKillError extends Error {
  pid: number;
  sessionKey: string;
  exitCode?: number;
  /** If defined, the number of ancestral processes to terminate */
  depth?: number;
  /** If true, skip current iteration */
  skip?: boolean;
  constructor(opts: {
    pid: number;
    sessionKey: string;
    exitCode?: number;
    depth?: number;
    skip?: boolean;
  }) {
    super("SIGKILL");
    this.pid = opts.pid;
    this.sessionKey = opts.sessionKey;
    this.exitCode = opts.exitCode;
    this.depth = opts.depth;
    this.skip = opts.skip;
  }
}
