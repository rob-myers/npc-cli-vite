export const ansi = {
  Black: "\x1b[30m",
  /** Light but bold */
  BlueBold: "\x1b[1;34m",
  Blue: "\x1b[34m",
  Cyan: "\x1b[96m",
  GreenBgBright: "\x1b[102m\x1b[30m",
  GreenBright: "\x1b[92m",
  GreenDark: "\x1b[32m",
  Grey: "\x1b[38;5;248m",
  GreyBg: "\x1b[47m",
  GreyBgDark: "\x1b[100m",
  GreyDark: "\x1b[90m",
  Hex323232Bg: "\x1b[48;2;32;32;32m",
  Purple: "\x1b[35m",
  Red: "\x1b[1;38;2;255;100;100m",
  Yellow: "\x1b[38;2;255;255;100m",
  YellowBright: "\x1b[93m",
  White: "\x1b[37m",
  WhiteBright: "\x1b[97m",

  Bold: "\x1b[1m",
  BoldReset: "\x1b[22m",
  Italic: "\x1b[3m",
  Reverse: "\x1b[7m",
  ReverseReset: "\x1b[27m",
  Reset: "\x1b[0m",
  Strikethrough: "\x1b[9m",
  Underline: "\x1b[4m",
  UnderlineReset: "\x1b[24m",
};

export const bracesOpts: braces.Options = {
  expand: true,
  rangeLimit: Infinity,
  keepQuotes: true, // prevent where's -> wheres
};

export const EOF = Symbol.for("EOF");

export const ProcessTag = {
  /** STOP/CONT by ptags is based on this process tag */
  always: "always",
  /** Interactive processes e.g. a non-background pipeline spawned from shell */
  interactive: "interactive",
} as const;

export const ProcessTagPreview = {
  always: "a",
  interactive: "i",
} as const;

/**
 * Whilst paused, should spawned background processes also start paused?
 */
export const spawnBgPausedDefault = false;

export const toProcessStatus = {
  Suspended: 0,
  Running: 1,
  Killed: 2,
} as const;

/** `0` is suspended, `1` is running, `2` is killed */
export type ProcessStatus = (typeof toProcessStatus)[keyof typeof toProcessStatus];

export const scrollback = 200;

export const localStorageKey = {
  touchTtyCanType: "touch-tty-can-type",
  touchTtyOpen: "touch-tty-open",
} as const;
