import { type RefObject, useContext, useLayoutEffect } from "react";
import { SkipNetContext } from "../context";
import type { SkipNetWindow } from "../schema";
import { cellPx, pxOfRows, rowsOfPx } from "./windows";

/**
 * Fits a window to its loaded content: its height within `maxRows`, and its width within `maxCols` if given.
 * The window is hidden and unanimated whilst `fit`, so it shows once the grid has drawn its new size. Stacked, it waits.
 */
export function FitWindow(props: {
  contentRef: RefObject<null | HTMLElement>;
  win: SkipNetWindow;
  maxRows: number;
  maxCols?: number;
}) {
  const { contentRef, win, maxRows, maxCols } = props;
  const state = useContext(SkipNetContext);

  useLayoutEffect(() => {
    const contentEl = contentRef.current;
    /** Its scrolling parent, whose own ref is not yet set when both mount at once */
    const scrollEl = contentEl?.parentElement;
    if (state.narrow) return;
    if (contentEl == null || scrollEl == null) return state.setWindow(win.id, { fit: undefined }); // else hidden for good
    const pad = getComputedStyle(scrollEl);
    const bodyH = contentEl.offsetHeight + px(pad.paddingTop) + px(pad.paddingBottom);
    const bodyW = contentEl.offsetWidth + px(pad.paddingLeft) + px(pad.paddingRight);
    /** Its bar and borders, the rest of the frame */
    const chromeH = pxOfRows(win.h) - scrollEl.clientHeight;
    const chromeW = win.w * cellPx - scrollEl.clientWidth;
    const h = Math.max(minRows, Math.min(maxRows, rowsOfPx(chromeH + bodyH)));
    const w =
      maxCols === undefined ? win.w : Math.max(minCols, Math.min(maxCols, Math.ceil((chromeW + bodyW) / cellPx)));

    const itemEl = contentEl.closest<HTMLElement>(".react-grid-item");
    let frames = 0;
    /** Shows it once the grid has drawn its new size, or given up waiting */
    const settle = () => {
      const drawn =
        itemEl === null || (itemEl.offsetHeight === pxOfRows(h) && Math.abs(itemEl.offsetWidth - w * cellPx) < 2);
      if (drawn || ++frames > maxFrames) {
        state.setWindow(win.id, { fit: undefined });
      } else {
        frameId = requestAnimationFrame(settle);
      }
    };
    /** A frame on, else the grid misses it, being in the commit that added the window */
    let frameId = requestAnimationFrame(() => {
      state.setWindow(win.id, { h, w });
      frameId = requestAnimationFrame(settle);
    });
    return () => cancelAnimationFrame(frameId);
  }, []);

  return null;
}

const px = (value: string) => Number.parseFloat(value) || 0;

const minRows = 6;
/** Room for a title and the bar's boxes */
const minCols = 10;
/** How long it waits for the grid, in frames */
const maxFrames = 30;
