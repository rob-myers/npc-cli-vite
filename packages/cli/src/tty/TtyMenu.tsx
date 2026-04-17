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
import { motion, useMotionValue } from "motion/react";
import React, { useRef } from "react";
import { localStorageKey, spawnBgPausedDefault } from "../shell/const";
import type { Session } from "../shell/session";
import { sessionApi } from "../shell/session";

export function TtyMenu(props: Props) {
  const dragged = useRef(false);
  const [visible, setVisible] = React.useState(false);
  React.useEffect(() => {
    requestAnimationFrame(() => setVisible(true));
  }, []);

  const getMaxY = () => Math.max(60, (props.constraintsRef.current?.clientHeight ?? 400) - 300);
  const storedY = Number(tryLocalStorageGetParsed(menuYStorageKey)) || 0;
  const y = useMotionValue(Math.max(0, Math.min(storedY, getMaxY())));

  const state = useStateRef(
    () => ({
      rootEl: null as HTMLDivElement | null,
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
    state.xterm.setCanType(true);
    state.touchMenuOpen = tryLocalStorageGetParsed(localStorageKey.touchTtyOpen) === true;
  }, []);

  return (
    <motion.div
      ref={state.ref("rootEl")}
      className={cn(
        "pointer-events-none",
        "absolute z-2 top-0 right-0 touch-none transition-opacity duration-300",
        "[--menu-width:32px]",
        "text-sm leading-1 border-none text-white/80",
        visible ? "opacity-100" : "opacity-0",
      )}
      style={{ y }}
      drag="y"
      dragConstraints={{ top: 0, bottom: getMaxY() }}
      dragMomentum={false}
      onDragStart={() => {
        dragged.current = true;
      }}
      onDragEnd={() => {
        const clamped = Math.max(0, Math.min(y.get(), getMaxY()));
        y.set(clamped);
        tryLocalStorageSet(menuYStorageKey, String(clamped));
        requestAnimationFrame(() => {
          dragged.current = false;
        });
      }}
      onClick={(e: React.MouseEvent) => {
        if (dragged.current) {
          dragged.current = false;
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
        <div className="*:pointer-events-auto">
          <div
            className={
              "h-8 pr-2 flex justify-center items-center cursor-pointer text-[1rem] font-['Segoe_UI',Tahoma,Geneva,Verdana,sans-serif] bg-[rgba(0,0,0,0.5)] text-[#ddd] border-none"
            }
            onClick={(e) => {
              e.stopPropagation();
              if (!dragged.current) state.toggleTouchMenu();
            }}
          >
            {state.touchMenuOpen ? ">" : "<"}
          </div>
          {props.canContOrStop != null && (
            <div
              className="pr-1 flex items-center writing-vertical-rl text-upright cursor-pointer py-2 border-none text-[#0f0b] bg-[rgba(0,0,0,0.5)] font-600 text-[0.6rem] tracking-[2px]"
              onClick={(e) => {
                e.stopPropagation();
                if (!dragged.current) state.contOrStopInteractive();
              }}
              title={props.canContOrStop === "CONT" ? "resume interactive" : "pause interactive"}
            >
              {props.canContOrStop}
            </div>
          )}
          {props.disabled && (
            <div
              className={cn("cursor-pointer pr-2 pt-1 text-[#777]", !state.spawnBgPaused && "text-[#cc6]")}
              onClick={(e) => {
                e.stopPropagation();
                if (!dragged.current) state.setSpawnBgPaused();
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
            "*:pointer-events-auto",
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

const icon = cn("flex justify-center h-6 cursor-pointer");
const menuYStorageKey = "tty-menu-y";
