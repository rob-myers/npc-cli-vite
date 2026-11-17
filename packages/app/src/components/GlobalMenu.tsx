import { Menu } from "@base-ui/react/menu";
import { themeApi, useThemeName } from "@npc-cli/theme";
import { isTrackingDisabled, setTrackingDisabled } from "@npc-cli/ui-sdk/analytics";
import { uiStore } from "@npc-cli/ui-sdk/ui.store";
import { cn, tw, useStateRef } from "@npc-cli/util";
import { isTouchDevice } from "@npc-cli/util/legacy/dom";
import {
  ArrowCounterClockwiseIcon,
  ArrowsInIcon,
  ChartLineIcon,
  GearIcon,
  InfoIcon,
  MoonIcon,
  SquareHalfBottomIcon,
  SquareHalfIcon,
  StackSimpleIcon,
  SunIcon,
  WarningIcon,
} from "@phosphor-icons/react";
import { motion, useMotionValue } from "motion/react";
import { useEffect, useState } from "react";
import { useStore } from "zustand";
import { AboutModal } from "./AboutModal";
import { countPanes, flattenPanes, resetPanes, splitRoot } from "./pane-service";

export function GlobalMenu() {
  const y = useMotionValue(getInitialY());
  const vpOffset = useVisualViewportOffset();
  const theme = useThemeName();
  const paneCount = useStore(uiStore, (s) => countPanes(s.persistedPanes.root));

  const state = useStateRef(() => ({
    y,
    menuOpen: false,
    aboutOpen: false,
    /** Whether the current press may open the menu i.e. is neither a drag, nor the press which closed it */
    canOpen: false,
    /** Whether reset has been clicked once, so the next click is the confirmation */
    resetArmed: false,
    /** DEV only, see the analytics item below */
    trackingOff: isTrackingDisabled(),

    close() {
      // a reset half-asked-for is forgotten with the menu
      state.set({ menuOpen: false, resetArmed: false });
    },
    onPointerDown() {
      // base-ui opens on pointerdown, whereas we open on click, so a drag never opens us
      state.canOpen = state.menuOpen === false;
    },
    onDragStart() {
      state.canOpen = false;
    },
    onDragEnd() {
      localStorage.setItem(storageKey, String(state.y.get()));
    },
    onOpenChange(open: boolean) {
      if (open === false) {
        state.close(); // opening is onTriggerClick's job
      }
    },
    onReset() {
      if (state.resetArmed === false) {
        state.set({ resetArmed: true });
      } else {
        resetPanes();
        state.close();
      }
    },
    onToggleTracking() {
      // umami re-reads the key on every send, so this bites without a reload
      setTrackingDisabled(state.trackingOff === false);
      state.set({ trackingOff: isTrackingDisabled() });
    },
    onTriggerClick() {
      if (state.canOpen === true) {
        state.canOpen = false;
        state.set({ menuOpen: true, resetArmed: false });
      }
    },
    onTriggerKeyDown(e: React.KeyboardEvent) {
      if ((e.key === "Enter" || e.key === " ") && state.menuOpen === false) {
        e.preventDefault();
        state.set({ menuOpen: true, resetArmed: false });
      }
    },
  }));

  return (
    <>
      <motion.div
        className={cn(
          "fixed z-9999 touch-none flex flex-col gap-1 shadow-md shadow-black/50",
          !state.menuOpen && "rounded-l-md",
          // a light tab on the dark page, where a dark one is lost among the panels
          theme === "dark" ? "text-slate-900 bg-slate-200 hover:bg-white" : "text-white bg-gray-800 hover:bg-gray-700",
        )}
        style={{
          y: state.y,
          left: vpOffset.x + (window.visualViewport?.width ?? window.innerWidth) - triggerPx,
          top: vpOffset.y,
        }}
        drag="y"
        dragMomentum={false}
        dragConstraints={{ top: minY, bottom: window.innerHeight - minY }}
        onPointerDown={state.onPointerDown}
        onDragStart={state.onDragStart}
        onDragEnd={state.onDragEnd}
      >
        <Menu.Root open={state.menuOpen} onOpenChange={state.onOpenChange} modal={false}>
          <Menu.Trigger
            className={cn("grid place-items-center cursor-pointer", triggerClass)}
            render={<span />}
            nativeButton={false}
            onClick={state.onTriggerClick}
            onKeyDown={state.onTriggerKeyDown}
          >
            <GearIcon className={gearClass} weight="bold" />
          </Menu.Trigger>

          <Menu.Portal>
            <Menu.Positioner className="z-9999" alignOffset={0} sideOffset={2} side="left" collisionPadding={0}>
              <Menu.Popup className="bg-slate-800 border border-slate-700 rounded-md shadow-lg py-1 min-w-40">
                <Menu.Item className={itemClass} closeOnClick={false} onClick={() => themeApi.setOther()}>
                  {theme === "dark" ? <SunIcon className={iconClass} /> : <MoonIcon className={iconClass} />}
                  {theme === "dark" ? "Light theme" : "Dark theme"}
                </Menu.Item>

                <Menu.Separator className={separatorClass} />

                {/* a phone has no room for panes side by side */}
                <div className={cn(itemClass, touchDevice && "hidden", "cursor-default hover:bg-transparent")}>
                  Split
                  <span className="ml-auto flex gap-1">
                    <Menu.Item
                      className="p-1 rounded hover:bg-slate-700 cursor-pointer"
                      aria-label="Split side by side"
                      title="Split side by side"
                      onClick={() => splitRoot(false)}
                    >
                      <SquareHalfIcon className={iconClass} />
                    </Menu.Item>
                    <Menu.Item
                      className="p-1 rounded hover:bg-slate-700 cursor-pointer"
                      aria-label="Split top and bottom"
                      title="Split top and bottom"
                      onClick={() => splitRoot(true)}
                    >
                      <SquareHalfBottomIcon className={iconClass} />
                    </Menu.Item>
                  </span>
                </div>

                {paneCount > 1 && (
                  <Menu.Item className={itemClass} onClick={flattenPanes}>
                    <StackSimpleIcon className={iconClass} />
                    Flatten layout
                  </Menu.Item>
                )}

                <Menu.Item
                  className={cn(itemClass, state.resetArmed && "text-red-300")}
                  closeOnClick={false}
                  onClick={state.onReset}
                >
                  {state.resetArmed ? (
                    <WarningIcon className={iconClass} />
                  ) : (
                    <ArrowCounterClockwiseIcon className={iconClass} />
                  )}
                  {/* both labels share a cell, so the item is as wide as the wider whichever shows */}
                  <span className="grid *:col-start-1 *:row-start-1">
                    <span className={cn(state.resetArmed && "invisible")}>Reset layout</span>
                    <span className={cn(!state.resetArmed && "invisible")}>Confirm reset</span>
                  </span>
                </Menu.Item>

                <Menu.Separator className={separatorClass} />

                <Menu.Item className={itemClass} onClick={() => state.set({ aboutOpen: true })}>
                  <InfoIcon className={iconClass} />
                  About
                </Menu.Item>

                {import.meta.env.DEV && (
                  <Menu.Item
                    className={cn(itemClass, state.trackingOff && "text-slate-500")}
                    closeOnClick={false}
                    onClick={state.onToggleTracking}
                  >
                    <ChartLineIcon className={iconClass} />
                    {state.trackingOff ? "Tracking: off" : "Tracking: on"}
                  </Menu.Item>
                )}
              </Menu.Popup>
            </Menu.Positioner>
          </Menu.Portal>
        </Menu.Root>

        {vpOffset.zoomed && (
          <button type="button" className="cursor-pointer" onClick={() => location.reload()}>
            <ArrowsInIcon className="size-5" />
          </button>
        )}
      </motion.div>

      {/* not inside the draggable, which a press in the dialog would otherwise bubble to */}
      <AboutModal open={state.aboutOpen} onOpenChange={(aboutOpen) => state.set({ aboutOpen })} />
    </>
  );
}

function useVisualViewportOffset() {
  const [offset, setOffset] = useState({ x: 0, y: 0, zoomed: false });

  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const update = () => setOffset({ x: vv.offsetLeft, y: vv.offsetTop, zoomed: vv.scale > 1.05 });
    vv.addEventListener("scroll", update);
    vv.addEventListener("resize", update);
    return () => {
      vv.removeEventListener("scroll", update);
      vv.removeEventListener("resize", update);
    };
  }, []);

  return offset;
}

/** Where it was left, else near the top, or the foot on touch, within a thumb's reach */
function getInitialY() {
  const defaultY = touchDevice ? window.innerHeight - 2 * minY : 2 * minY;
  try {
    const stored = localStorage.getItem(storageKey);
    return stored === null || !Number.isFinite(Number(stored)) ? defaultY : Math.max(minY, Number(stored));
  } catch {
    return defaultY;
  }
}

const touchDevice = isTouchDevice();

/** The menu's place, saved under `storageKey`, at least `minY` from the top and foot */
const storageKey = "allotment-menu-y";
const minY = 120;

/** Its trigger: the same box as WorldSpeech's */
const triggerPx = touchDevice ? 48 : 36;
const triggerClass = touchDevice ? "size-12" : "size-9";
const gearClass = touchDevice ? "size-6" : "size-5";

/** Its items */
const itemClass = cn(
  "flex items-center gap-2 px-3 text-slate-300 hover:bg-slate-700 cursor-pointer",
  touchDevice ? "py-2.5 text-sm" : "py-1.5 text-xs",
);
const iconClass = tw("size-4 shrink-0");
const separatorClass = tw("my-1 border-t border-slate-700");
