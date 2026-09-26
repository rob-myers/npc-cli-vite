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

  const menu = useStateRef(() => ({
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
      menu.set({ menuOpen: false, resetArmed: false });
    },
    onPointerDown() {
      // base-ui opens on pointerdown, whereas we open on click, so a drag never opens us
      menu.canOpen = menu.menuOpen === false;
    },
    onDragStart() {
      menu.canOpen = false;
    },
    onDragEnd() {
      localStorage.setItem(storageKey, String(menu.y.get()));
    },
    onOpenChange(open: boolean) {
      if (open === false) {
        menu.close(); // opening is onTriggerClick's job
      }
    },
    onReset() {
      if (menu.resetArmed === false) {
        menu.set({ resetArmed: true });
      } else {
        resetPanes();
        menu.close();
      }
    },
    onToggleTracking() {
      // umami re-reads the key on every send, so this bites without a reload
      setTrackingDisabled(menu.trackingOff === false);
      menu.set({ trackingOff: isTrackingDisabled() });
    },
    onTriggerClick() {
      if (menu.canOpen === true) {
        menu.set({ menuOpen: true, resetArmed: false });
      }
    },
  }));

  return (
    <>
      <motion.div
        className="fixed text-white bg-gray-800 z-9999 touch-none flex flex-col gap-1"
        style={{
          y: menu.y,
          left: vpOffset.x + (window.visualViewport?.width ?? window.innerWidth) - triggerPx,
          top: vpOffset.y,
        }}
        drag="y"
        dragMomentum={false}
        dragConstraints={{ top: minY, bottom: window.innerHeight - minY }}
        onPointerDown={menu.onPointerDown}
        onDragStart={menu.onDragStart}
        onDragEnd={menu.onDragEnd}
      >
        <Menu.Root open={menu.menuOpen} onOpenChange={menu.onOpenChange} modal={false}>
          <Menu.Trigger
            className={cn("grid place-items-center cursor-pointer", triggerCls)}
            render={<span />}
            nativeButton={false}
            onClick={menu.onTriggerClick}
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
                  className={cn(itemCls, menu.resetArmed && "text-red-300")}
                  closeOnClick={false}
                  onClick={menu.onReset}
                >
                  {menu.resetArmed ? (
                    <WarningIcon className={iconCls} />
                  ) : (
                    <ArrowCounterClockwiseIcon className={iconCls} />
                  )}
                  {/* both labels share a cell, so the item is as wide as the wider whichever shows */}
                  <span className="grid *:col-start-1 *:row-start-1">
                    <span className={cn(menu.resetArmed && "invisible")}>Reset layout</span>
                    <span className={cn(!menu.resetArmed && "invisible")}>Confirm reset</span>
                  </span>
                </Menu.Item>

                <Menu.Separator className={separatorCls} />

                <Menu.Item className={itemCls} onClick={() => menu.set({ aboutOpen: true })}>
                  <InfoIcon className={iconCls} />
                  About
                </Menu.Item>

                {import.meta.env.DEV && (
                  <Menu.Item
                    className={cn(itemCls, menu.trackingOff && "text-slate-500")}
                    closeOnClick={false}
                    onClick={menu.onToggleTracking}
                  >
                    <ChartLineIcon className={iconCls} />
                    {menu.trackingOff ? "Tracking: off" : "Tracking: on"}
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
      <AboutModal open={menu.aboutOpen} onOpenChange={(aboutOpen) => menu.set({ aboutOpen })} />
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
