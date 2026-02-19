import { cn, useStateRef } from "@npc-cli/util";
import {
  tryLocalStorageGet,
  tryLocalStorageGetParsed,
  tryLocalStorageSet,
} from "@npc-cli/util/legacy/generic";
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  ArrowUpIcon,
  EraserIcon,
  KeyReturnIcon,
  PaintBrushIcon,
  SkullIcon,
} from "@phosphor-icons/react";
import React from "react";
import { localStorageKey, spawnBgPausedDefault } from "../shell/const";
import type { Session } from "../shell/session";
import { sessionApi } from "../shell/session";

export function TtyMenu(props: Props) {
  const state = useStateRef(
    () => ({
      /**
       * Given `props.disabled`, should interactively spawned
       * background processes also start paused?
       */
      spawnBgPaused: spawnBgPausedDefault,
      touchMenuOpen: true,
      xterm: props.session.ttyShell.xterm,

      contOrStopInteractive() {
        switch (props.canContOrStop) {
          case "CONT":
            sessionApi.kill(props.session.key, [0], { CONT: true, GROUP: true });
            break;
          case "STOP":
            sessionApi.kill(props.session.key, [0], { STOP: true, GROUP: true });
            break;
        }
      },
      async onClickMenu(e: React.MouseEvent) {
        const target = (e.target as HTMLElement).closest("div") as HTMLElement;
        state.xterm.xterm.scrollToBottom();
        if (target.classList.contains("paste")) {
          try {
            const textToPaste = await navigator.clipboard.readText();
            state.xterm.spliceInput(textToPaste);
          } catch {}
        } else if (target.classList.contains("can-type")) {
          const next = !state.xterm.canType();
          state.xterm.setCanType(next);
          tryLocalStorageSet(localStorageKey.touchTtyCanType, `${next}`);
          next && state.xterm.warnIfNotReady();
          state.update();
        } else if (target.classList.contains("ctrl-c")) {
          sessionApi.killSessionLeader(props.session.key);
        } else if (target.classList.contains("enter")) {
          if (!state.xterm.warnIfNotReady()) {
            // avoid sending 'newline' whilst 'await-prompt'
            state.xterm.queueCommands([{ key: "newline" }]);
          }
        } else if (target.classList.contains("delete")) {
          state.xterm.deletePreviousWord();
        } else if (target.classList.contains("clear")) {
          state.xterm.clearScreen();
        } else if (target.classList.contains("up")) {
          state.xterm.reqHistoryLine(+1);
        } else if (target.classList.contains("down")) {
          state.xterm.reqHistoryLine(-1);
        }
        // on mobile avoid close keyboard
        state.xterm.xterm.focus();
      },
      setSpawnBgPaused(next = !state.spawnBgPaused) {
        state.spawnBgPaused = next;
        props.session.ttyShell.spawnBgPaused = state.spawnBgPaused;
        state.update();
      },
      toggleTouchMenu() {
        const next = !state.touchMenuOpen;
        state.touchMenuOpen = next;
        tryLocalStorageSet(localStorageKey.touchTtyOpen, `${next}`);
        state.update();
      },
    }),
    { deps: [props.canContOrStop] },
  );

  state.xterm = props.session.ttyShell.xterm;

  React.useMemo(() => {
    if (!tryLocalStorageGet(localStorageKey.touchTtyCanType)) {
      tryLocalStorageSet(localStorageKey.touchTtyCanType, JSON.stringify(false));
    }
    if (!tryLocalStorageGet(localStorageKey.touchTtyOpen)) {
      tryLocalStorageSet(localStorageKey.touchTtyOpen, JSON.stringify(false));
    }
    // state.xterm.setCanType(tryLocalStorageGetParsed(localStorageKey.touchTtyCanType) === true);
    state.xterm.setCanType(true);
    state.touchMenuOpen = tryLocalStorageGetParsed(localStorageKey.touchTtyOpen) === true;
  }, []);

  return (
    <div
      className={cn(
        "absolute z-110 top-0 right-0",
        "[--menu-width:32px] w-(--menu-width) h-[calc(100%-32px)]",
        "flex flex-col text-sm leading-1 border-[0_0_2px_2px] border-none text-white/80",
        "transition-transform duration-500",
        state.touchMenuOpen
          ? "transform-[translate(0px,0px)] [&_.toggle]:bg-[rgba(0,0,0,0.5)]"
          : "transform-[translate(var(--menu-width),0px)]",
      )}
      onClick={state.onClickMenu}
    >
      <div className="absolute top-0 right-(--menu-width)">
        <div
          className="h-8 pr-2 flex justify-end items-center cursor-pointer text-[1rem] font-['Segoe_UI',Tahoma,Geneva,Verdana,sans-serif] bg-[rgba(0,0,0,0.5)] text-[#ddd] border-none"
          onClick={state.toggleTouchMenu}
        >
          {state.touchMenuOpen ? ">" : "<"}
        </div>
        {props.canContOrStop != null && (
          <div
            className="pr-1 flex items-center writing-vertical-rl text-upright cursor-pointer py-2 border-none text-[#0f0b] bg-[rgba(0,0,0,0.5)] font-600 text-[0.6rem] tracking-[2px]"
            onClick={state.contOrStopInteractive}
            title={props.canContOrStop === "CONT" ? "resume interactive" : "pause interactive"}
          >
            {props.canContOrStop}
          </div>
        )}
        {props.disabled && (
          <div
            className={cn(
              "cursor-pointer pr-2 pt-1 text-[#777]",
              !state.spawnBgPaused && "text-[#cc6]",
            )}
            onClick={state.setSpawnBgPaused.bind(null, undefined)}
            title={
              state.spawnBgPaused ? "spawning background paused" : "spawning background unpaused"
            }
          >
            BG
          </div>
        )}
      </div>

      <div
        className={cn(
          "max-h-full overflow-auto flex flex-col gap-1 border border-solid border-[#444]/60 py-2 filter backdrop-blur-[2px]",
        )}
      >
        {/* <div
          className={cn(icon, "can-type", state.xterm.canType() ? "text-[#cfc]" : "text-[#999]")}
          title={`text input ${state.xterm.canType() ? "enabled" : "disabled"}`}
        >
          $
        </div> */}
        <div className={cn(icon, "paste")} title="paste (Cmd+V)">
          <PaintBrushIcon weight="light" />
        </div>
        <div className={cn(icon, "enter")} title="or press Enter">
          <KeyReturnIcon size={18} weight="fill" />
        </div>
        <div className={cn(icon, "up")} title="or press Up">
          <ArrowLeftIcon weight="fill" />
        </div>
        <div className={cn(icon, "down")} title="or press Down">
          <ArrowRightIcon weight="fill" />
        </div>
        <div className={cn(icon, "ctrl-c")} title="or press Ctrl+C">
          <SkullIcon weight="fill" />
        </div>
        <div className={cn(icon, "clear")} title="or press Ctrl+L">
          <ArrowUpIcon weight="fill" />
        </div>
        <div className={cn(icon, "delete")} title="or press Backspace">
          <EraserIcon weight="fill" />
        </div>
      </div>
    </div>
  );
}

interface Props {
  canContOrStop: null | "CONT" | "STOP";
  disabled?: boolean;
  session: Session;
  setTabsEnabled(next: boolean): void;
}

const icon = cn("flex justify-center h-6 cursor-pointer");
