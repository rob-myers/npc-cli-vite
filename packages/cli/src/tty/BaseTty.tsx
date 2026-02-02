import { cn, useEffectNonStrict, useStateRef } from "@npc-cli/util";
import { FitAddon } from "@xterm/addon-fit";
import { WebglAddon } from "@xterm/addon-webgl";
import { type ITheme, Terminal as XTermTerminal } from "@xterm/xterm";
import React from "react";
import { useBeforeunload } from "react-beforeunload";
import { scrollback } from "../shell/const";
import { type Session, sessionApi } from "../shell/session";
import { stripAnsi } from "../shell/util";
import { TtyXterm } from "../shell/xterm";
import { LinkProvider } from "./xterm-link-provider";

import "@xterm/xterm/css/xterm.css";

export const BaseTty = React.forwardRef<State, Props>(function BaseTty(props: Props, ref) {
  const containerRef = React.useRef<HTMLDivElement>(null);

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
      theme: xtermJsTheme,
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

    // 🚧 try improve mobile predictive text e.g. firefox
    xterm.textarea?.setAttribute("enterkeyhint", "send");

    return () => {
      // 🚧 hack
      if (!state.session) {
        return console.warn("BaseTty: session already removed");
      }

      sessionApi.persistHistory(props.sessionKey);
      sessionApi.persistHome(props.sessionKey);
      sessionApi.removeSession(props.sessionKey);

      state.xterm.dispose();
      //@ts-expect-error
      state.session = state.xterm = null;

      props.onUnmount?.();
    };
  }, []);

  useBeforeunload(() => {
    sessionApi.persistHistory(props.sessionKey);
    sessionApi.persistHome(props.sessionKey);
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

const xtermJsTheme: ITheme = {
  background: "black",
  foreground: "#41FF00",
};
