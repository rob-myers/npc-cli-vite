import { cn, useStateRef } from "@npc-cli/util";
import { tryLocalStorageGet, tryLocalStorageGetParsed, tryLocalStorageSet } from "@npc-cli/util/legacy/generic";
import {
  ArrowArcLeftIcon,
  ArrowDownIcon,
  ArrowUpIcon,
  EraserIcon,
  KeyReturnIcon,
  PaintBrushIcon,
  SkullIcon,
} from "@phosphor-icons/react";
import { type MotionValue, motion, useMotionValue } from "motion/react";
import React from "react";
import { localStorageKey, spawnBgPausedDefault } from "../shell/const";
import type { Session } from "../shell/session";
import { sessionApi } from "../shell/session";

export function TtyMenu(props: Props & { stateRef?: React.RefObject<State | null> }) {
  const state = useStateRef<State>(
    (): State => ({
      dragged: false,
      minY: 40,
      motionY: null as any,
      rootEl: null as any,
      /**
       * Given `props.disabled`, should interactively spawned
       * background processes also start paused?
       */
      spawnBgPaused: spawnBgPausedDefault,
      touchMenuOpen: true,
      xterm: props.session.ttyShell.xterm,

      getMaxY() {
        return Math.max(state.minY, (props.constraintsRef.current?.clientHeight ?? 400) - 300);
      },
      getClampedY(v: number) {
        return Math.min(state.getMaxY(), Math.max(state.minY, v));
      },
      onResize() {
        state.motionY.set(state.getClampedY(state.motionY.get()));
        state.update();
      },
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

  const storedY = Number(tryLocalStorageGetParsed(menuYStorageKey)) || 0;
  const y = useMotionValue(state.getClampedY(storedY));
  state.motionY = y;
  state.xterm = props.session.ttyShell.xterm;
  if (props.stateRef) (props.stateRef as React.RefObject<State | null>).current = state;

  React.useMemo(() => {
    if (!tryLocalStorageGet(localStorageKey.touchTtyCanType)) {
      tryLocalStorageSet(localStorageKey.touchTtyCanType, JSON.stringify(false));
    }
    if (!tryLocalStorageGet(localStorageKey.touchTtyOpen)) {
      tryLocalStorageSet(localStorageKey.touchTtyOpen, JSON.stringify(false));
    }
    state.xterm.setCanType(true);
    state.touchMenuOpen = tryLocalStorageGetParsed(localStorageKey.touchTtyOpen) === true;
  }, []);

  return (
    <motion.div
      ref={state.ref("rootEl")}
      className={cn(
        "pointer-events-none",
        "absolute z-2 top-0 right-0 touch-none",
        "transition-opacity duration-300 delay-300 opacity-100 starting:opacity-0",
        "[--menu-width:32px]",
        "text-sm leading-1 border-none text-on-background/80",
      )}
      style={{ y }}
      drag="y"
      dragConstraints={{ top: state.minY, bottom: state.getMaxY() }}
      dragMomentum={false}
      onDragStart={() => {
        state.dragged = true;
      }}
      onDragEnd={() => {
        const clamped = state.getClampedY(y.get());
        y.set(clamped);
        tryLocalStorageSet(menuYStorageKey, String(clamped));
        requestAnimationFrame(() => {
          state.dragged = false;
        });
      }}
      onClick={(e: React.MouseEvent) => {
        if (state.dragged) {
          state.dragged = false;
          return;
        }
        state.onClickMenu(e);
      }}
    >
      <div
        className={cn(
          "flex transition-transform duration-500",
          state.touchMenuOpen ? "translate-x-0" : "translate-x-(--menu-width)",
        )}
      >
        <div className="touch-none *:pointer-events-auto">
          <div
            className="h-8 flex justify-center items-center cursor-pointer text-[1rem] font-['Segoe_UI',Tahoma,Geneva,Verdana,sans-serif] bg-background text-on-background border border-black/50"
            onClick={(e) => {
              e.stopPropagation();
              if (!state.dragged) state.toggleTouchMenu();
            }}
          >
            {state.touchMenuOpen ? ">" : "<"}
          </div>
          {props.canContOrStop != null && (
            <div
              className="size-8 flex items-center justify-center writing-vertical-rl text-upright cursor-pointer border-none text-[#0f0b] bg-black text-[0.6rem]"
              onClick={(e) => {
                e.stopPropagation();
                if (!state.dragged) state.contOrStopInteractive();
              }}
              title={props.canContOrStop === "CONT" ? "resume interactive" : "pause interactive"}
            >
              {props.canContOrStop}
            </div>
          )}
          {props.disabled && (
            <div
              className={cn(
                "cursor-pointer size-8 flex justify-center items-center bg-black text-[#777] text-[0.8rem]",
                !state.spawnBgPaused && "text-[#cc6]",
              )}
              onClick={(e) => {
                e.stopPropagation();
                if (!state.dragged) state.setSpawnBgPaused();
              }}
              title={state.spawnBgPaused ? "spawning background paused" : "spawning background unpaused"}
            >
              BG
            </div>
          )}
        </div>

        <div
          className={cn(
            "max-h-full overflow-auto flex flex-col gap-1 border border-solid border-[#444]/60 py-2 filter backdrop-blur-[2px]",
            "mb-8 w-(--menu-width)",
            "*:pointer-events-auto touch-none",
          )}
        >
          <div className={cn(icon, "paste")} title="paste (Cmd+V)">
            <PaintBrushIcon weight="light" />
          </div>
          <div className={cn(icon, "enter")} title="or press Enter">
            <KeyReturnIcon size={18} weight="fill" />
          </div>
          <div className={cn(icon, "up")} title="or press Up">
            <ArrowUpIcon weight="fill" />
          </div>
          <div className={cn(icon, "down")} title="or press Down">
            <ArrowDownIcon weight="fill" />
          </div>
          <div className={cn(icon, "ctrl-c")} title="or press Ctrl+C">
            <SkullIcon weight="fill" />
          </div>
          <div className={cn(icon, "clear")} title="or press Ctrl+L">
            <ArrowArcLeftIcon weight="fill" />
          </div>
          <div className={cn(icon, "delete")} title="or press Backspace">
            <EraserIcon weight="fill" />
          </div>
        </div>
      </div>
    </motion.div>
  );
}

interface Props {
  canContOrStop: null | "CONT" | "STOP";
  constraintsRef: React.RefObject<HTMLDivElement | null>;
  disabled?: boolean;
  session: Session;
  setTabsEnabled(next: boolean): void;
}

export type State = {
  dragged: boolean;
  minY: number;
  motionY: MotionValue<number>;
  rootEl: HTMLDivElement | null;
  spawnBgPaused: boolean;
  touchMenuOpen: boolean;
  xterm: Session["ttyShell"]["xterm"];

  getMaxY(): number;
  getClampedY(v: number): number;
  onResize(): void;
  contOrStopInteractive(): void;
  onClickMenu(e: React.MouseEvent): Promise<void>;
  setSpawnBgPaused(next?: boolean): void;
  toggleTouchMenu(): void;
};

const icon = cn("flex justify-center h-6 cursor-pointer");
const menuYStorageKey = "tty-menu-y";
