import { cn, tw } from "@npc-cli/util";
import { isTouchDevice } from "@npc-cli/util/legacy/dom";
import { useContext, useEffect, useMemo, useState } from "react";
import { GridLayout, getCompactor, verticalCompactor } from "react-grid-layout";
import { SkipNetContext } from "../context";
import { deskStyle } from "./classes";
import { DesktopIcons } from "./DesktopIcons";
import { Window } from "./Window";
import { cellPx, desktopCols, desktopPadPx, desktopPx, frontOf, toLayout } from "./windows";

import "react-grid-layout/css/styles.css";
import "./desktop.css";

/** A dithered desktop, larger than its panel, so it scrolls. Icons lie under the windows */
export function Desktop() {
  const state = useContext(SkipNetContext);
  const { arrange, windows } = state.meta;
  /** Only the geometry, so fronting a window leaves the grid's layout be */
  const geometry = windows.map((x) => `${x.id}:${x.x},${x.y},${x.w},${x.h},${x.shadedH !== undefined}`).join(" ");
  const layout = useMemo(() => toLayout(windows), [geometry]);
  const front = frontOf(windows);
  /** Off until mounted, else every window slides in from a corner */
  const [animate, setAnimate] = useState(false);

  useEffect(() => {
    const frameId = requestAnimationFrame(() => setAnimate(true));
    return () => cancelAnimationFrame(frameId);
  }, []);

  return (
    <div className="relative flex-1 min-h-0 overflow-auto scrollbar-thin" style={deskStyle}>
      <DesktopIcons />
      <GridLayout
        className={cn(
          gridClass,
          touchDevice && "[&_.react-resizable-handle-se]:size-6!",
          !animate && "[&_.react-grid-item]:transition-none!",
        )}
        style={{ width: desktopPx }}
        width={desktopPx}
        gridConfig={gridConfig}
        dragConfig={dragConfig}
        resizeConfig={resizeConfig}
        compactor={arrange === "tidy" ? verticalCompactor : freeCompactor}
        layout={layout}
        onDragStop={(layout) => state.saveLayout(layout)}
        onResizeStop={(layout) => state.saveLayout(layout)}
      >
        {windows.map((win) => (
          // above the icons, which are `z-1`
          <div key={win.id} style={{ zIndex: win.z + 1 }} onPointerDownCapture={() => state.bringToFront(win.id)}>
            <Window win={win} front={win.id === front?.id} />
          </div>
        ))}
      </GridLayout>
    </div>
  );
}

/** Nothing moves out of the way, so windows overlap */
const freeCompactor = getCompactor(null, true);
/** Pixels between windows one above another */
const rowGapPx = 6;
const gridConfig = {
  cols: desktopCols,
  rowHeight: cellPx,
  /** Rows apart by `rowGapPx`, so windows one above another never touch */
  margin: [0, rowGapPx] as const,
  containerPadding: [desktopPadPx, desktopPadPx] as const,
};
const dragConfig = { handle: ".skip-net-drag", cancel: ".skip-net-no-drag" };
/** Every edge and corner, styled in `desktop.css` */
const resizeConfig = { handles: ["n", "e", "s", "w", "ne", "nw", "se", "sw"] as const };

const touchDevice = isTouchDevice();

/** Its look is in `desktop.css` */
const gridClass = tw("skip-net-grid min-h-full");
