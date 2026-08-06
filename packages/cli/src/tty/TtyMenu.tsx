import { cn, useStateRef } from "@npc-cli/util";
import { isTouchDevice } from "@npc-cli/util/legacy/dom";
import { tryLocalStorageGet, tryLocalStorageGetParsed, tryLocalStorageSet } from "@npc-cli/util/legacy/generic";
import {
  ArrowArcLeftIcon,
  ArrowDownIcon,
  ArrowUpIcon,
  CaretRightIcon,
  ClipboardTextIcon,
  EraserIcon,
  KeyReturnIcon,
  PauseIcon,
  PlayIcon,
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
        const act = (e.target as HTMLElement).closest<HTMLElement>("[data-act]")?.dataset.act;
        if (act === undefined) {
          return; // e.g. the gap between buttons
        }
        state.xterm.xterm.scrollToBottom();

        switch (act) {
          case "paste":
            try {
              state.xterm.spliceInput(await navigator.clipboard.readText());
            } catch {}
            break;
          case "ctrl-c":
            sessionApi.killSessionLeader(props.session.key);
            break;
          case "enter":
            if (!state.xterm.warnIfNotReady()) {
              // avoid sending 'newline' whilst 'await-prompt'
              state.xterm.queueCommands([{ key: "newline" }]);
            }
            break;
          case "delete":
            state.xterm.deletePreviousWord();
            break;
          case "clear":
            state.xterm.clearScreen();
            break;
          case "up":
            state.xterm.reqHistoryLine(+1);
            break;
          case "down":
            state.xterm.reqHistoryLine(-1);
            break;
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
        "text-sm leading-none border-none",
      )}
      // one square per button, enlarged for fingers
      style={{ y, ...({ "--menu-width": isTouchDevice() ? "44px" : "32px" } as React.CSSProperties) }}
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
          "flex items-start transition-transform duration-500",
          state.touchMenuOpen ? "translate-x-0" : "translate-x-(--menu-width)",
        )}
      >
        {/* stays put when the menu slides away, so it can bring it back */}
        <div className="flex flex-col touch-none *:pointer-events-auto">
          <div
            className={cn(itemCss, "rounded-l bg-term-surface/90 border border-term-border backdrop-blur-xs")}
            title={state.touchMenuOpen ? "hide controls" : "show controls"}
            onClick={(e) => {
              e.stopPropagation();
              if (!state.dragged) state.toggleTouchMenu();
            }}
          >
            <CaretRightIcon className={cn(iconSizeCss, !state.touchMenuOpen && "rotate-180")} weight="bold" />
          </div>

          {props.canContOrStop != null && (
            <div
              className={cn(itemCss, statusCss, "text-term-ok")}
              onClick={(e) => {
                e.stopPropagation();
                if (!state.dragged) state.contOrStopInteractive();
              }}
              title={props.canContOrStop === "CONT" ? "resume interactive" : "pause interactive"}
            >
              {props.canContOrStop === "CONT" ? (
                <PlayIcon className={iconSizeCss} weight="fill" />
              ) : (
                <PauseIcon className={iconSizeCss} weight="fill" />
              )}
            </div>
          )}

          {props.disabled && (
            <div
              className={cn(
                itemCss,
                statusCss,
                "font-mono text-[0.7rem] tracking-wider",
                state.spawnBgPaused ? "text-term-faint" : "text-term-accent",
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
            "max-h-full overflow-auto flex flex-col mb-8 w-(--menu-width)",
            "rounded-bl border border-r-0 border-term-border bg-term-surface/90 backdrop-blur-xs",
            "divide-y divide-term-border-subtle",
            "*:pointer-events-auto touch-none",
          )}
        >
          <div className={itemCss} data-act="paste" title="paste (Cmd+V)">
            <ClipboardTextIcon className={iconSizeCss} />
          </div>
          <div className={itemCss} data-act="enter" title="or press Enter">
            <KeyReturnIcon className={iconSizeCss} weight="fill" />
          </div>
          <div className={itemCss} data-act="up" title="or press Up">
            <ArrowUpIcon className={iconSizeCss} weight="bold" />
          </div>
          <div className={itemCss} data-act="down" title="or press Down">
            <ArrowDownIcon className={iconSizeCss} weight="bold" />
          </div>
          <div className={itemCss} data-act="delete" title="or press Backspace">
            <EraserIcon className={iconSizeCss} weight="fill" />
          </div>
          <div className={itemCss} data-act="clear" title="or press Ctrl+L">
            <ArrowArcLeftIcon className={iconSizeCss} weight="fill" />
          </div>
          <div className={cn(itemCss, "text-term-danger")} data-act="ctrl-c" title="or press Ctrl+C">
            <SkullIcon className={iconSizeCss} weight="fill" />
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

/** One square button, sized by `--menu-width` so touch devices get bigger targets */
const itemCss = cn(
  "shrink-0 size-(--menu-width) flex justify-center items-center",
  "cursor-pointer text-term-muted transition-colors hover:bg-term-hover hover:text-term-foreground",
);
/** The always-visible column, distinguished from the sliding one */
const statusCss = cn("border-l border-y border-term-border bg-term-inset/90 backdrop-blur-xs");
const iconSizeCss = "size-[calc(var(--menu-width)*0.45)]";
const menuYStorageKey = "tty-menu-y";
