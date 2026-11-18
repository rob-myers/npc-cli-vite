import { type RefObject, useContext, useLayoutEffect } from "react";
import { SkipNetContext } from "../context";
import { articleRows, pxOfRows, rowsOfPx } from "../desktop/windows";
import type { SkipNetWindow } from "../schema";

/**
 * Fits a window's height to its loaded article, between `minRows` and `articleRows`. Stacked, it waits for the desktop.
 * The window is hidden and unanimated whilst `fit`, so it shows only once the grid has drawn its new height.
 */
export function FitHeight(props: { articleRef: RefObject<null | HTMLElement>; win: SkipNetWindow }) {
  const { articleRef, win } = props;
  const state = useContext(SkipNetContext);

  useLayoutEffect(() => {
    const articleEl = articleRef.current;
    /** Its scrolling parent, whose own ref is not yet set when both mount at once */
    const scrollEl = articleEl?.parentElement;
    if (state.narrow) return;
    if (articleEl == null || scrollEl == null) return state.setWindow(win.id, { fit: undefined }); // else hidden for good
    const { paddingTop, paddingBottom } = getComputedStyle(scrollEl);
    const bodyPx = articleEl.offsetHeight + Number.parseFloat(paddingTop) + Number.parseFloat(paddingBottom);
    /** Its bar and borders, the rest of the frame */
    const chromePx = pxOfRows(win.h) - scrollEl.clientHeight;
    const h = Math.max(minRows, Math.min(articleRows, rowsOfPx(chromePx + bodyPx)));

    const itemEl = articleEl.closest<HTMLElement>(".react-grid-item");
    let frames = 0;
    /** Shows it once the grid has drawn its new height, or given up waiting */
    const settle = () => {
      if (itemEl === null || itemEl.offsetHeight === pxOfRows(h) || ++frames > maxFrames) {
        state.setWindow(win.id, { fit: undefined });
      } else {
        frameId = requestAnimationFrame(settle);
      }
    };
    /** A frame on, else the grid misses it, being in the commit that added the window */
    let frameId = requestAnimationFrame(() => {
      state.setWindow(win.id, { h });
      frameId = requestAnimationFrame(settle);
    });
    return () => cancelAnimationFrame(frameId);
  }, []);

  return null;
}

const minRows = 6;
/** How long it waits for the grid, in frames */
const maxFrames = 30;
