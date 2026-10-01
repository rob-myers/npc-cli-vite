import { useThemeName } from "@npc-cli/theme";
import { cn, useBeforeUnloadOrVisibilityChange, useEffectNonStrict, useStateRef } from "@npc-cli/util";
import { FitAddon } from "@xterm/addon-fit";
import { WebglAddon } from "@xterm/addon-webgl";
import { type ITheme, Terminal as XTermTerminal } from "@xterm/xterm";
import React from "react";
import { scrollback } from "../shell/const";
import { type Session, sessionApi } from "../shell/session";
import { getSharedStore, getTtyStore } from "../shell/storage";
import { stripAnsi } from "../shell/util";
import { TtyXterm } from "../shell/xterm";
import { LinkProvider } from "./xterm-link-provider";

import "@xterm/xterm/css/xterm.css";

export const BaseTty = React.forwardRef<State, Props>(function BaseTty(props: Props, ref) {
  const containerRef = React.useRef<HTMLDivElement>(null);
  const themeName = useThemeName();

  const state = useStateRef(
    (): State => ({
      down: null,
      fitAddon: new FitAddon(),
      // `undefined` for change detection
      session: undefined as unknown as Session,
      webglAddon: new WebglAddon(),
      xterm: null as unknown as TtyXterm,

      //#region mobile scrolling
      onTouchStart(e) {
        if (e.touches.length !== 1) return;
        const clientY = e.touches[0].clientY;
        state.down = { firstClientY: clientY, lastClientY: clientY };
      },
      onTouchMove(e) {
        if (e.touches.length !== 1 || state.down === null) return;
        const clientY = e.touches[0].clientY;
        const deltaY = clientY - state.down.lastClientY;
        state.down.lastClientY = clientY;
        state.xterm.xterm.scrollLines(Math.sign(deltaY));
      },
      onTouchEnd() {
        state.down = null;
      },
      //#endregion
    }),
  );

  React.useImperativeHandle(ref, () => state);

  useEffectNonStrict(() => {
    state.session = sessionApi.createSession(props.sessionKey, props.env);

    const xterm = new XTermTerminal({
      allowProposedApi: true, // Needed for WebLinksAddon
      fontSize: 16,
      cursorBlink: true,
      fontFamily: "'Courier New', Courier, monospace",
      // lineHeight: 1.2,
      // letterSpacing: 2,
      // rendererType: "canvas",
      // mobile: can select single word via long press
      rightClickSelectsWord: true,
      theme: xtermThemes[themeName],
      convertEol: true, // fix mobile paste
      scrollback,
      rows: 50,
    });

    xterm.registerLinkProvider(
      new LinkProvider(
        xterm,
        /(\[ [^\]]+ \])/gi,
        async function callback(_event, linkText, { lineText, linkStartIndex, lineNumber }) {
          // console.log('clicked link', {
          //   sessionKey: props.sessionKey,
          //   linkText,
          //   lineText,
          //   linkStartIndex,
          //   lineNumber,
          // });
          sessionApi.onTtyLink({
            sessionKey: props.sessionKey,
            lineText: stripAnsi(lineText),
            // Omit square brackets and spacing:
            linkText: stripAnsi(linkText).slice(2, -2),
            linkStartIndex,
            lineNumber,
          });
        },
      ),
    );

    state.xterm = new TtyXterm(xterm, {
      key: state.session.key,
      io: state.session.ttyIo,
      rememberLastValue(msg) {
        state.session.var._ = msg;
      },
    });

    xterm.loadAddon((state.fitAddon = new FitAddon()));
    xterm.loadAddon((state.webglAddon = new WebglAddon()));
    state.webglAddon.onContextLoss(() => {
      state.webglAddon.dispose(); // 🚧 WIP
    });

    state.session.ttyShell.xterm = state.xterm;

    containerRef.current && xterm.open(containerRef.current);

    // try improve mobile predictive text e.g. firefox
    xterm.textarea?.setAttribute("enterkeyhint", "send");

    return () => {
      if (!state.session) {
        return console.warn("BaseTty: session already removed");
      }

      sessionApi.persistHistory(props.sessionKey);
      sessionApi.persistHome(props.sessionKey);
      getTtyStore(props.sessionKey).flush(); // the store's write is debounced
      sessionApi.removeSession(props.sessionKey);

      state.xterm.dispose();
      //@ts-expect-error
      state.session = state.xterm = null;

      props.onUnmount?.();
    };
  }, []);

  React.useEffect(() => {
    if (state.xterm) {
      state.xterm.xterm.options.theme = xtermThemes[themeName];
      state.xterm.xterm.options.fontWeight = themeName === "dark" ? "normal" : "600";
    }
  }, [themeName, state.xterm]);

  useBeforeUnloadOrVisibilityChange(() => {
    if (sessionApi.getSession(props.sessionKey) === undefined) return; // hmr fix
    sessionApi.persistHistory(props.sessionKey);
    sessionApi.persistHome(props.sessionKey);
    sessionApi.persistShared();
    getTtyStore(props.sessionKey).flush();
    getSharedStore().flush();
  });

  return (
    <div
      ref={containerRef}
      onKeyDown={stopPropagation}
      onTouchStart={state.onTouchStart}
      onTouchMove={state.onTouchMove}
      onTouchEnd={state.onTouchEnd}
      className={cn(
        "h-[inherit] touch-pan-x", // for scrolling
        // "[&_.xterm-helper-textarea]:top-0! min-w-[100px] [&_.xterm-screen]:min-w-[100px]",
        // thin scrollbar
        "[&_.scrollbar.vertical_.slider]:transform-[translateX(5px)_scale(0.5)]!",
      )}
    />
  );
});

interface Props {
  sessionKey: `tty-${number}`;
  env: Partial<Session["var"]>;
  onUnmount?(): void;
}

export interface State {
  fitAddon: FitAddon;
  /** For scrolling involving a single touch */
  down: { firstClientY: number; lastClientY: number } | null;
  session: Session;
  webglAddon: WebglAddon;
  xterm: TtyXterm;
  onTouchStart(e: React.TouchEvent): void;
  onTouchMove(e: React.TouchEvent): void;
  onTouchEnd(e: React.TouchEvent): void;
}

function stopPropagation(e: React.KeyboardEvent) {
  e.stopPropagation();
}

import type { ThemeName } from "@npc-cli/theme";

/** Sparse, from colour 16: only `ansi.Grey` (248) is too pale for paper */
const lightExtendedAnsi: string[] = [];
lightExtendedAnsi[248 - 16] = "#6b6b6b";

const xtermThemes: Record<ThemeName, ITheme> = {
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
