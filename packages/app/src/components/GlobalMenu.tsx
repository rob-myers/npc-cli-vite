import { Menu } from "@base-ui/react/menu";
import { themeApi, useThemeName } from "@npc-cli/theme";
import { isTrackingDisabled, setTrackingDisabled } from "@npc-cli/ui-sdk/analytics";
import { cn, useStateRef } from "@npc-cli/util";
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
  SunIcon,
  WarningIcon,
} from "@phosphor-icons/react";
import { motion, useMotionValue } from "motion/react";
import { useEffect, useState } from "react";
import { AboutModal } from "./AboutModal";
import { resetPanes, splitRoot } from "./pane-service";

const storageKey = "allotment-menu-y";
const minY = 120;
const touchDevice = isTouchDevice();

/** same box as WorldSpeech's trigger */
const triggerCls = touchDevice ? "size-12" : "size-9";
const triggerPx = touchDevice ? 48 : 36;
const gearCls = touchDevice ? "size-6" : "size-5";
const itemCls = cn(
  "flex items-center gap-2 px-3 text-slate-300 hover:bg-slate-700 cursor-pointer",
  touchDevice ? "py-2.5 text-sm" : "py-1.5 text-xs",
);
const iconCls = "size-4 shrink-0";
const separatorCls = "my-1 border-t border-slate-700";

export function GlobalMenu() {
  const y = useMotionValue(getInitialY());
  const vpOffset = useVisualViewportOffset();
  const theme = useThemeName();

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
            className={cn("grid place-items-center cursor-pointer", triggerCls)}
            render={<span />}
            nativeButton={false}
            onClick={state.onTriggerClick}
          >
            <GearIcon className={gearCls} weight="bold" />
          </Menu.Trigger>

          <Menu.Portal>
            <Menu.Positioner className="z-9999" alignOffset={0} sideOffset={2} side="left" collisionPadding={0}>
              <Menu.Popup className="bg-slate-800 border border-slate-700 rounded-md shadow-lg py-1 min-w-40">
                <Menu.Item className={itemCls} closeOnClick={false} onClick={() => themeApi.setOther()}>
                  {theme === "dark" ? <SunIcon className={iconCls} /> : <MoonIcon className={iconCls} />}
                  {theme === "dark" ? "Light theme" : "Dark theme"}
                </Menu.Item>

                <Menu.Separator className={separatorCls} />

                <div className={cn(itemCls, "cursor-default hover:bg-transparent")}>
                  Split
                  <span className="ml-auto flex gap-1">
                    <Menu.Item
                      className="p-1 rounded hover:bg-slate-700 cursor-pointer"
                      aria-label="Split side by side"
                      title="Split side by side"
                      onClick={() => splitRoot(false)}
                    >
                      <SquareHalfIcon className={iconCls} />
                    </Menu.Item>
                    <Menu.Item
                      className="p-1 rounded hover:bg-slate-700 cursor-pointer"
                      aria-label="Split top and bottom"
                      title="Split top and bottom"
                      onClick={() => splitRoot(true)}
                    >
                      <SquareHalfBottomIcon className={iconCls} />
                    </Menu.Item>
                  </span>
                </div>

                <Menu.Item
                  className={cn(itemCls, state.resetArmed && "text-red-300")}
                  closeOnClick={false}
                  onClick={state.onReset}
                >
                  {state.resetArmed ? (
                    <WarningIcon className={iconCls} />
                  ) : (
                    <ArrowCounterClockwiseIcon className={iconCls} />
                  )}
                  {/* both labels share a cell, so the item is as wide as the wider whichever shows */}
                  <span className="grid *:col-start-1 *:row-start-1">
                    <span className={cn(state.resetArmed && "invisible")}>Reset layout</span>
                    <span className={cn(!state.resetArmed && "invisible")}>Confirm reset</span>
                  </span>
                </Menu.Item>

                <Menu.Separator className={separatorCls} />

                <Menu.Item className={itemCls} onClick={() => state.set({ aboutOpen: true })}>
                  <InfoIcon className={iconCls} />
                  About
                </Menu.Item>

                {import.meta.env.DEV && (
                  <Menu.Item
                    className={cn(itemCls, state.trackingOff && "text-slate-500")}
                    closeOnClick={false}
                    onClick={state.onToggleTracking}
                  >
                    <ChartLineIcon className={iconCls} />
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

function getInitialY() {
  try {
    const stored = Number(localStorage.getItem(storageKey));
    return Number.isFinite(stored) ? Math.max(minY, stored) : minY;
  } catch {
    return minY;
  }
}
