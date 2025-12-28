import { useEffectNonStrict, useStateRef } from "@npc-cli/util";
import { detectTabPrevNextShortcut } from "@npc-cli/util/legacy/generic";
import { FitAddon } from "@xterm/addon-fit";
// debugging "Cannot read properties of undefined" onRequestRedraw
// import { WebglAddon } from "xterm-addon-webgl";
import { WebglAddon } from "@xterm/addon-webgl";
// import { css } from '@emotion/react';
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
  const state = useStateRef(
    (): State => ({
      container: null as unknown as HTMLDivElement,
      fitAddon: new FitAddon(),
      // `undefined` for change detection
      session: undefined as unknown as Session,
      webglAddon: new WebglAddon(),
      xterm: null as unknown as TtyXterm,
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

    xterm.open(state.container);

    // 🚧 try improve mobile predictive text e.g. firefox
    xterm.textarea?.setAttribute("enterkeyhint", "send");

    return () => {
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
    // biome-ignore lint/a11y/noStaticElementInteractions: whatevs!
    <div
      ref={state.ref("container")}
      onKeyDown={stopKeysPropagating}
      className="h-[inherit] bg-black [&_>_div]:w-full [&_.xterm-helper-textarea]:top-0! min-w-[100px] [&_.xterm-screen]:min-w-[100px]"
    />
  );
});

interface Props {
  sessionKey: `tty-${number}`;
  env: Partial<Session["var"]>;
  onUnmount?(): void;
}

export interface State {
  container: HTMLDivElement;
  fitAddon: FitAddon;
  session: Session;
  webglAddon: WebglAddon;
  xterm: TtyXterm;
}

function stopKeysPropagating(e: React.KeyboardEvent) {
  if (detectTabPrevNextShortcut(e)) {
    return;
  }
  e.stopPropagation();
}

const xtermJsTheme: ITheme = {
  background: "black",
  foreground: "#41FF00",
};
