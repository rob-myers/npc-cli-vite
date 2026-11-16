import type { ThemeName } from "@npc-cli/theme";
import type { ITheme } from "@xterm/xterm";

/** Sparse, from colour 16: only `ansi.Grey` (248) is too pale for paper */
const lightExtendedAnsi: string[] = [];
lightExtendedAnsi[248 - 16] = "#6b6b6b"; // grey -> darker grey
lightExtendedAnsi[179 - 16] = "#9a5b00"; // yellow faint -> orange

export const xtermThemes: Record<ThemeName, ITheme> = {
  dark: {
    background: "black",
    foreground: "#41FF00",
  },
  /** Ink on paper, after `theme.css`: each colour dark enough to read, `white` included */
  light: {
    background: "#ffffff",
    foreground: "#1a1a1a",
    cursor: "#1a1a1a",
    cursorAccent: "#ffffff",
    selectionBackground: "#6f86b5",
    selectionInactiveBackground: "#9a9a9a",

    black: "#1a1a1a",
    red: "#b3261e",
    green: "#15803d",
    yellow: "#8a6a00",
    blue: "#1449c4",
    magenta: "#7a3e9d",
    cyan: "#0b7285",
    white: "#3a3a3a",

    brightBlack: "#6b6b6b",
    brightRed: "#d1242f",
    brightGreen: "#116329",
    brightYellow: "#9a5b00",
    brightBlue: "#0b5fd8",
    brightMagenta: "#8f3fb8",
    brightCyan: "#0e7490",
    brightWhite: "#000000",

    extendedAnsi: lightExtendedAnsi,
  },
};
