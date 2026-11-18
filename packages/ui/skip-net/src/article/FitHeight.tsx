import { type RefObject, useContext, useLayoutEffect } from "react";
import { SkipNetContext } from "../context";
import { articleRows, pxOfRows, rowsOfPx } from "../desktop/windows";
import type { SkipNetWindow } from "../schema";

/**
 * Fits a window's height to its article, once shown, between `minRows` and `articleRows`.
 * Mounted inside the article's Suspense, so it measures loaded content. Stacked, it waits for the desktop.
 */
export function FitHeight(props: {
  articleRef: RefObject<null | HTMLElement>;
  scrollRef: RefObject<null | HTMLElement>;
  win: SkipNetWindow;
}) {
  const { articleRef, scrollRef, win } = props;
  const state = useContext(SkipNetContext);

  useLayoutEffect(() => {
    const [articleEl, scrollEl] = [articleRef.current, scrollRef.current];
    if (articleEl === null || scrollEl === null || state.narrow) return;
    const { paddingTop, paddingBottom } = getComputedStyle(scrollEl);
    const bodyPx = articleEl.offsetHeight + Number.parseFloat(paddingTop) + Number.parseFloat(paddingBottom);
    /** Its bar and borders, the rest of the frame */
    const chromePx = pxOfRows(win.h) - scrollEl.clientHeight;
    const h = Math.max(minRows, Math.min(articleRows, rowsOfPx(chromePx + bodyPx)));
    state.setWindow(win.id, { h, fit: undefined });
  }, []);

  return null;
}

const minRows = 6;
