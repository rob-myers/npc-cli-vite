import { Menu } from "@base-ui/react/menu";
import { useThemeName } from "@npc-cli/theme";
import { isTrackingDisabled, setTrackingDisabled } from "@npc-cli/ui-sdk/analytics";
import { uiStore, uiStoreApi } from "@npc-cli/ui-sdk/ui.store";
import { cn, tw, useStateRef } from "@npc-cli/util";
import { isTouchDevice } from "@npc-cli/util/legacy/dom";
import { ArrowsInIcon, CaretRightIcon, GearIcon } from "@phosphor-icons/react";
import { lazy, Suspense, useEffect, useState } from "react";
import { useStore } from "zustand";
import { isWebMcpOn, setWebMcpOn } from "../web-mcp";
import type GlobalMenuItemsType from "./GlobalMenuItems";
import { countPanes, getSplittable, resetPanes } from "./pane-service";

/** Loaded on its first open */
const AboutModal = lazy(() => import("./AboutModal").then((m) => ({ default: m.AboutModal })));

export function GlobalMenu() {
  const vpOffset = useVisualViewportOffset();
  const theme = useThemeName();
  const paneCount = useStore(uiStore, (s) => countPanes(s.persistedPanes.root));
  const canSplit = useStore(uiStore, () => getSplittable() !== null);

  const state = useStateRef(() => ({
    /** Its items, loaded on a first hover or press. It opens only once they are, so never empty */
    Items: null as null | typeof GlobalMenuItemsType,
    rootEl: null as null | HTMLDivElement,
    /** Its vertical offset, dragged and saved */
    y: getInitialY(),
    menuOpen: false,
    /** Counts opens, so the wait of one since superseded shows nothing */
    openCount: 0,
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
    /** The tab picked in `switchTabs` whilst Ctrl is held */
    pick: 0,
    /** Whether focus goes back to the trigger as it closes: not once a tab is chosen */
    returnFocus: true,
    /** Opened by Ctrl+`, and Ctrl still held: letting go chooses `pick` */
    switching: false,
    /** The tabs it offers — see `getSwitchTabs` */
    switchTabs: [] as SwitchTab[],
    /** Whether its tabs are shown, saved under `tabsShownKey`. Switching shows them anyway */
    tabsShown: getInitialTabsShown(),

    chooseTab(tabId: string) {
      state.close(false);
      uiStoreApi.focusTab(tabId);
    },
    close(returnFocus = true) {
      // a reset half-asked-for is forgotten with the menu
      state.set({ menuOpen: false, resetArmed: false, returnFocus, switching: false });
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
    onToggleTabs() {
      state.set({ tabsShown: !state.tabsShown });
      try {
        localStorage.setItem(tabsShownKey, String(state.tabsShown));
      } catch {}
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
    onWindowBlur() {
      if (state.switching === true) state.close();
    },
    /** Ctrl+` opens it to switch tab, and again steps down them. Shift steps back */
    onWindowKeyDown(e: KeyboardEvent) {
      if (e.code !== "Backquote" || e.ctrlKey === false || e.metaKey === true || e.altKey === true) return;
      e.preventDefault();
      e.stopPropagation(); // not for the World, nor a tty
      if (e.repeat === true) return; // held, it steps once
      if (state.switching === false) return void state.open(true);
      const n = state.switchTabs.length;
      if (n > 0) state.set({ pick: (state.pick + (e.shiftKey === true ? n - 1 : 1)) % n });
    },
    onWindowKeyUp(e: KeyboardEvent) {
      if (e.key !== "Control" || state.switching === false) return;
      const tab = state.switchTabs[state.pick];
      tab === undefined ? state.close() : state.chooseTab(tab.id);
    },
    async open(switching = false) {
      // set at once: Ctrl may be let go before the items load
      Object.assign(state, { pick: 0, switching, switchTabs: getSwitchTabs() });
      const count = ++state.openCount;
      await Promise.all([state.loadItems(), switching && new Promise((r) => setTimeout(r, switchShowMs))]);
      if (count !== state.openCount) return; // opened again meanwhile
      if (switching === true && state.switching === false) return; // let go already, and chosen
      state.set({ menuOpen: true, resetArmed: false, returnFocus: true });
    },
  }));

  /** Its tabs are listed: shown by the header, or whilst switching */
  const tabsOpen = state.tabsShown || state.switching;

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => state.onWindowKeyDown(e);
    const onKeyUp = (e: KeyboardEvent) => state.onWindowKeyUp(e);
    const onBlur = () => state.onWindowBlur();
    // capturing, so it comes before the World or a tty
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("keyup", onKeyUp, true);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("keyup", onKeyUp, true);
      window.removeEventListener("blur", onBlur);
    };
  }, []);

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
              <Menu.Popup
                className="bg-slate-800 border border-slate-700 rounded-md shadow-lg py-1 min-w-40"
                finalFocus={state.returnFocus}
              >
                {state.switchTabs.length > 0 && (
                  <>
                    <Menu.Item
                      className={cn(tabItemClass, "gap-2 hover:bg-slate-700 data-[highlighted]:bg-slate-700")}
                      closeOnClick={false}
                      onClick={state.onToggleTabs}
                    >
                      <CaretRightIcon className={cn("size-4 shrink-0 transition-transform", tabsOpen && "rotate-90")} />
                      Tabs
                      <span className="ml-auto text-slate-500">{state.switchTabs.length}</span>
                    </Menu.Item>
                    {tabsOpen && (
                      <div className="py-0.5 bg-slate-950/60">
                        {state.switchTabs.map((tab, i) => (
                          <Menu.Item
                            key={tab.id}
                            className={cn(tabItemClass, "group py-0.5")}
                            closeOnClick={false} // `chooseTab` closes it, keeping focus on the tab
                            onClick={() => state.chooseTab(tab.id)}
                          >
                            <span
                              className={cn(
                                tabPillClass,
                                state.switching && i === state.pick && "bg-slate-600 border-slate-400 text-white",
                              )}
                            >
                              {tab.title}
                            </span>
                          </Menu.Item>
                        ))}
                      </div>
                    )}
                    <Menu.Separator className="my-1 border-t border-slate-700" />
                  </>
                )}
                {state.Items && (
                  <state.Items
                    canSplit={canSplit}
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

type SwitchTab = { id: string; title: string };

/** Tabs to switch to, those focused lately first, then the rest. Not the one focused, nor any in a hidden pane */
function getSwitchTabs(): SwitchTab[] {
  const { byId, persistedPanes } = uiStore.getState();
  const recent = (persistedPanes.focusedTabIds ?? []).filter((id) => byId[id] !== undefined);
  const focused = document.activeElement?.closest("[data-tab-content]")?.getAttribute("data-tab-content");
  const current = focused ?? recent[0];
  return [...recent, ...Object.keys(byId).filter((id) => recent.includes(id) === false)]
    .filter((id) => id !== current && uiStoreApi.canFocusTab(id))
    .map((id) => ({ id, title: byId[id].meta.title ?? id }));
}

/** Whether the tabs were left shown, else not */
function getInitialTabsShown() {
  try {
    return localStorage.getItem(tabsShownKey) === "true";
  } catch {
    return false;
  }
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
const tabsShownKey = "global-menu-tabs-shown";
const minY = 120;
/** How far a press moves before it drags, as motion's drag did */
const dragThresholdPx = 3;
/** Ctrl+` shows its tabs only once held this long, so a quick press and release switches unseen */
const switchShowMs = 500;

/** Its trigger: the same box as WorldSpeech's */
const triggerPx = touchDevice ? 48 : 36;
const triggerClass = touchDevice ? "size-12" : "size-9";
const gearClass = touchDevice ? "size-6" : "size-5";
/** A row of its tabs section, as `GlobalMenuItems`' items but unlit: the header lights its row, a tab its pill */
const tabItemClass = cn(
  "flex items-center px-3 text-slate-300 cursor-pointer",
  touchDevice ? "py-2.5 text-sm" : "py-1.5 text-xs",
);
/** Its title, as wide as its row so all align, lit as the row is hovered or highlighted */
const tabPillClass = tw(
  "w-full px-2.5 py-0.5 rounded-sm text-center border border-slate-600/60 group-hover:bg-slate-700 group-data-[highlighted]:bg-slate-700",
);
