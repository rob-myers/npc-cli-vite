import { cn, Tip, tw, useStateRef } from "@npc-cli/util";
import { isTouchDevice } from "@npc-cli/util/legacy/dom";
import { CaretLeftIcon, XIcon } from "@phosphor-icons/react";
import { useContext, useEffect, useMemo } from "react";
import { GridLayout } from "react-grid-layout";
import { SkipNetContext } from "../context";
import { deskStyle } from "./classes";
import { DesktopIcons } from "./DesktopIcons";
import { Window } from "./Window";
import {
  cellPx,
  desktopCols,
  desktopPadPx,
  desktopPx,
  freeCompactor,
  frontOf,
  rowGapPx,
  showAllSlots,
  titleOf,
  toLayout,
} from "./windows";

import "react-grid-layout/css/styles.css";
import "./desktop.css";

/**
 * A dithered desktop, larger than its panel, so it scrolls. Icons lie under the windows.
 * In Show All every window is tiled in view. A click on one fronts it, elsewhere or Escape just ends it.
 */
export function Desktop() {
  const state = useContext(SkipNetContext);
  const { showAll } = state;
  const { windows } = state.meta;
  /** Only the geometry, so fronting a window leaves the grid's layout be */
  const geometry = windows.map((x) => `${x.id}:${x.x},${x.y},${x.w},${x.h},${x.shadedH !== undefined}`).join(" ");
  const layout = useMemo(() => toLayout(windows), [geometry]);
  const front = frontOf(windows);
  const desk = useStateRef(
    (): DeskState => ({
      animate: false,
      el: null,
      height: 0,
      scrolledCols: 0,
      settled: false,

      onKeyDown(e) {
        if (e.key === "Escape" && state.showAll) state.toggleShowAll(false);
      },
      onResize() {
        if (desk.el !== null) desk.set({ height: desk.el.clientHeight });
      },
      onScroll() {
        const cols = desk.el === null ? 0 : Math.round(desk.el.scrollLeft / cellPx);
        if (cols !== desk.scrolledCols) desk.set({ scrolledCols: cols });
      },
      scrollToLeft() {
        desk.el?.scrollTo({ left: 0, behavior: "smooth" });
      },
    }),
  );
  /** What is in view, which Show All fills. Scrolling is held meanwhile */
  const view = desk.el && {
    x: desk.el.scrollLeft + showAllPadPx,
    y: desk.el.scrollTop + showAllPadPx,
    width: desk.el.clientWidth - 2 * showAllPadPx,
    height: desk.el.clientHeight - 2 * showAllPadPx,
  };
  const slots = showAll && view !== null ? showAllSlots(windows, view) : null;

  /** Its scroll, size and keys, and Show All's badges once its tiles settle */
  useEffect(() => {
    const el = desk.el;
    if (el === null) return;
    desk.settled = false;
    const frameId = requestAnimationFrame(() => desk.animate || desk.set({ animate: true }));
    const timeoutId = showAll ? window.setTimeout(() => desk.set({ settled: true }), showAllMs) : 0;
    const observer = new ResizeObserver(desk.onResize);
    observer.observe(el);
    desk.onScroll();
    el.addEventListener("scroll", desk.onScroll, { passive: true });
    window.addEventListener("keydown", desk.onKeyDown);
    return () => {
      cancelAnimationFrame(frameId);
      window.clearTimeout(timeoutId);
      observer.disconnect();
      el.removeEventListener("scroll", desk.onScroll);
      window.removeEventListener("keydown", desk.onKeyDown);
    };
  }, [showAll]);

  return (
    <div
      ref={desk.ref("el")}
      data-skip-net-desk
      // a press on the bare desk ends distraction-free
      onPointerDown={(e) => (e.target as HTMLElement).closest(".react-grid-item") || state.toggleDistractionFree(false)}
      className={cn("relative flex-1 min-h-0 scrollbar-thin", showAll ? "overflow-hidden" : "overflow-auto")}
      style={deskStyle}
    >
      {desk.scrolledCols > 0 && !showAll && (
        // sticks to its top-left as it scrolls, taking no room, over every window. Its pill hangs to its foot
        <div className="sticky left-0 top-0 h-0 w-0" style={{ zIndex: (front?.z ?? 0) + 2 }}>
          <Tip content="scroll back to the left">
            <button
              type="button"
              className={scrolledClass}
              style={{ top: desk.height - scrolledPillOffsetPx }}
              onClick={desk.scrollToLeft}
            >
              <CaretLeftIcon weight="bold" className="size-3" />
              {desk.scrolledCols} cols
            </button>
          </Tip>
        </div>
      )}
      <DesktopIcons />
      {view !== null && slots !== null && (
        // dims the desk and icons under the windows, and a click on it ends Show All
        <div
          className="absolute z-1 bg-black/30 starting:opacity-0 transition-opacity duration-300"
          style={{
            left: view.x - showAllPadPx,
            top: view.y - showAllPadPx,
            width: desk.el?.clientWidth,
            height: desk.el?.clientHeight,
          }}
          onClick={() => state.toggleShowAll(false)}
        />
      )}
      <GridLayout
        className={cn(
          gridClass,
          touchDevice && "[&_.react-resizable-handle-se]:size-6!",
          !desk.animate && "[&_.react-grid-item]:transition-none!",
        )}
        style={{ width: desktopPx }}
        width={desktopPx}
        gridConfig={gridConfig}
        dragConfig={showAll ? offConfig : dragConfig}
        resizeConfig={showAll ? offConfig : resizeConfig}
        compactor={freeCompactor}
        layout={layout}
        onDragStop={(layout) => state.saveLayout(layout)}
        onResizeStop={(layout) => state.saveLayout(layout)}
      >
        {windows.map((win) => {
          const slot = slots?.get(win.id);
          return (
            // above the icons, which are `z-1`
            <div
              key={win.id}
              // its grid box stays put whilst its tile moves, so only the tile takes the pointer
              className={cn(slot && "group pointer-events-none", win.fit && fittingClass)}
              style={{ zIndex: win.z + 1 }}
              onPointerDownCapture={() => state.bringToFront(win.id)}
              onClickCapture={(e) => {
                if (!showAll || (e.target as HTMLElement).closest("[data-show-all-close]") !== null) return;
                e.stopPropagation();
                state.toggleShowAll(false);
              }}
            >
              <div
                className={cn(
                  "size-full origin-top-left transition-transform duration-300 ease-out",
                  slot && "pointer-events-auto cursor-pointer *:pointer-events-none",
                )}
                style={slot && { transform: `translate(${slot.dx}px, ${slot.dy}px) scale(${slot.scale})` }}
              >
                <Window win={win} front={win.id === front?.id} items={state.items} showAll={showAll} />
              </div>
              {slot && desk.settled && (
                // unscaled: its title in a badge at its tile's centre, and a close badge at its top-right whilst over it
                <>
                  <div
                    className={showAllTitleBoxClass}
                    style={{
                      width: slot.width,
                      height: slot.height,
                      transform: `translate(${slot.dx}px, ${slot.dy}px)`,
                    }}
                  >
                    <span className={showAllTitleClass}>{titleOf(win, state.items)}</span>
                  </div>
                  <Tip content="close">
                    <button
                      type="button"
                      data-show-all-close
                      className={cn(showAllCloseClass, touchDevice && "opacity-100")}
                      style={{ transform: `translate(${slot.dx + slot.width - 10}px, ${slot.dy - 10}px)` }}
                      onClick={() => state.close(win.id)}
                    >
                      <XIcon weight="bold" className="size-3" />
                    </button>
                  </Tip>
                </>
              )}
            </div>
          );
        })}
      </GridLayout>
    </div>
  );
}

type DeskState = {
  /** Off until mounted, else every window slides in from a corner */
  animate: boolean;
  el: null | HTMLDivElement;
  /** Its height in view, placing the scroll pill at its foot */
  height: number;
  /** How many columns it is scrolled right, shown by a pill whilst more than none */
  scrolledCols: number;
  /** Show All's tiles have finished moving, so their badges show */
  settled: boolean;
  /** Escape ends Show All */
  onKeyDown(e: KeyboardEvent): void;
  onResize(): void;
  onScroll(): void;
  scrollToLeft(): void;
};

const gridConfig = {
  cols: desktopCols,
  rowHeight: cellPx,
  /** Rows apart by `rowGapPx`, so windows one above another never touch */
  margin: [0, rowGapPx] as const,
  containerPadding: [desktopPadPx, desktopPadPx] as const,
};
const dragConfig = { handle: ".skip-net-drag", cancel: ".skip-net-no-drag" };
/** Centres a tile's title, fading in, then moving with it */
const showAllTitleBoxClass = tw(
  "absolute left-0 top-0 grid place-items-center p-2 transition-[transform,opacity] duration-300 ease-out starting:opacity-0",
);
/** A window's name in a badge over its tile in Show All, a click on which fronts it too */
const showAllTitleClass = tw(
  "max-w-full truncate px-3 py-1 rounded-full border border-mac-edge bg-mac-window/90 text-mac-text text-sm font-bold shadow pointer-events-auto cursor-pointer",
);
/** A window's close badge in Show All */
const showAllCloseClass = tw(
  "absolute left-0 top-0 grid place-items-center size-5 rounded-full border border-mac-edge bg-mac-window text-mac-text shadow pointer-events-auto cursor-pointer opacity-0 transition-[transform,opacity] duration-300 ease-out starting:opacity-0 group-hover:opacity-100 hover:bg-mac-select hover:text-mac-on-select",
);
/** From the desk's foot to the pill's top */
const scrolledPillOffsetPx = 30;
/** Its scroll right, in a pill at its bottom-left */
const scrolledClass = tw(
  "absolute left-2 flex items-center gap-1 whitespace-nowrap rounded-full border border-mac-edge bg-mac-window/90 px-2 py-0.5 font-mono text-[11px] text-mac-text shadow cursor-pointer hover:bg-mac-select hover:text-mac-on-select starting:opacity-0 transition-opacity duration-200",
);
/** Hidden whilst fitted to its article, and not animated, the grid's own transition overridden */
const fittingClass = tw("invisible transition-none!");
/** Show All neither drags nor resizes */
const offConfig = { enabled: false };
/** Room around the windows in Show All */
const showAllPadPx = 16;
/** How long a tile takes to move, as its `duration-300` */
const showAllMs = 300;
/** Every edge and corner, styled in `desktop.css` */
const resizeConfig = { handles: ["n", "e", "s", "w", "ne", "nw", "se", "sw"] as const };

const touchDevice = isTouchDevice();

/** Its look is in `desktop.css` */
const gridClass = tw("skip-net-grid min-h-full");
