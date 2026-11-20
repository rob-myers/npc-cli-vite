import { Menu } from "@base-ui/react/menu";
import { useThemeName } from "@npc-cli/theme";
import { isTrackingDisabled, setTrackingDisabled } from "@npc-cli/ui-sdk/analytics";
import { uiStore } from "@npc-cli/ui-sdk/ui.store";
import { cn, useStateRef } from "@npc-cli/util";
import { isTouchDevice } from "@npc-cli/util/legacy/dom";
import { ArrowsInIcon, GearIcon } from "@phosphor-icons/react";
import { lazy, Suspense, useEffect, useState } from "react";
import { useStore } from "zustand";
import { isWebMcpOn, setWebMcpOn } from "../web-mcp";
import type GlobalMenuItemsType from "./GlobalMenuItems";
import { countPanes, resetPanes } from "./pane-service";

/** Loaded on its first open */
const AboutModal = lazy(() => import("./AboutModal").then((m) => ({ default: m.AboutModal })));

export function GlobalMenu() {
  const vpOffset = useVisualViewportOffset();
  const theme = useThemeName();
  const paneCount = useStore(uiStore, (s) => countPanes(s.persistedPanes.root));

  const state = useStateRef(() => ({
    /** Its items, loaded on a first hover or press. It opens only once they are, so never empty */
    Items: null as null | typeof GlobalMenuItemsType,
    rootEl: null as null | HTMLDivElement,
    /** Its vertical offset, dragged and saved */
    y: getInitialY(),
    menuOpen: false,
    aboutOpen: false,
    /** Once opened, About stays mounted, so it can close as it opens */
    aboutMounted: false,
    /** Whether the current press may open the menu i.e. is neither a drag, nor the press which closed it */
    canOpen: false,
    /** Whether reset has been clicked once, so the next click is the confirmation */
    resetArmed: false,
    /** DEV only, see the analytics item */
    trackingOff: isTrackingDisabled(),
    /** Offers the ttys to a browser agent, where the browser has WebMCP */
    webMcpOn: isWebMcpOn(),

    close() {
      // a reset half-asked-for is forgotten with the menu
      state.set({ menuOpen: false, resetArmed: false });
    },
    async loadItems() {
      state.Items ??= (await import("./GlobalMenuItems")).default;
    },
    onAbout() {
      state.set({ aboutOpen: true, aboutMounted: true });
    },
    onOpenChange(open: boolean) {
      if (open === false) {
        state.close(); // opening is onTriggerClick's job
      }
    },
    onPointerDown(e: React.PointerEvent) {
      // base-ui opens on pointerdown, whereas we open on click, so a drag never opens us
      state.canOpen = state.menuOpen === false;
      void state.loadItems();
      const [startY, fromY] = [e.clientY, state.y];
      let dragging = false;
      const onMove = (e: PointerEvent) => {
        const dy = e.clientY - startY;
        if (dragging === false && Math.abs(dy) < dragThresholdPx) return;
        dragging = true;
        state.canOpen = false;
        state.y = Math.min(Math.max(fromY + dy, minY), window.innerHeight - minY);
        state.rootEl?.style.setProperty("transform", `translateY(${state.y}px)`);
      };
      const onUp = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onUp);
        dragging && localStorage.setItem(storageKey, String(state.y));
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onUp);
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
    onToggleWebMcp() {
      state.set({ webMcpOn: !state.webMcpOn });
      void setWebMcpOn(state.webMcpOn);
    },
    onTriggerClick() {
      if (state.canOpen === true) {
        state.canOpen = false;
        void state.open();
      }
    },
    onTriggerKeyDown(e: React.KeyboardEvent) {
      if ((e.key === "Enter" || e.key === " ") && state.menuOpen === false) {
        e.preventDefault();
        void state.open();
      }
    },
    async open() {
      await state.loadItems();
      state.set({ menuOpen: true, resetArmed: false });
    },
  }));

  return (
    <>
      <div
        ref={state.ref("rootEl")}
        className={cn(
          "fixed z-9999 touch-none select-none flex flex-col gap-1 shadow-md shadow-black/50",
          !state.menuOpen && "rounded-l-md",
          // a light tab on the dark page, where a dark one is lost among the panels
          theme === "dark" ? "text-slate-900 bg-slate-200 hover:bg-white" : "text-white bg-gray-800 hover:bg-gray-700",
        )}
        style={{
          transform: `translateY(${state.y}px)`,
          left: vpOffset.x + (window.visualViewport?.width ?? window.innerWidth) - triggerPx,
          top: vpOffset.y,
        }}
        onPointerDown={state.onPointerDown}
        onPointerEnter={state.loadItems}
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
                {state.Items && (
                  <state.Items
                    paneCount={paneCount}
                    resetArmed={state.resetArmed}
                    trackingOff={state.trackingOff}
                    webMcpOn={state.webMcpOn}
                    onAbout={state.onAbout}
                    onReset={state.onReset}
                    onToggleTracking={state.onToggleTracking}
                    onToggleWebMcp={state.onToggleWebMcp}
                  />
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
      </div>

      {/* not inside the draggable, which a press in the dialog would otherwise bubble to */}
      {state.aboutMounted && (
        <Suspense fallback={null}>
          <AboutModal open={state.aboutOpen} onOpenChange={(aboutOpen) => state.set({ aboutOpen })} />
        </Suspense>
      )}
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
/** How far a press moves before it drags, as motion's drag did */
const dragThresholdPx = 3;

/** Its trigger: the same box as WorldSpeech's */
const triggerPx = touchDevice ? 48 : 36;
const triggerClass = touchDevice ? "size-12" : "size-9";
const gearClass = touchDevice ? "size-6" : "size-5";
