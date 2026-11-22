import { getCompactor, type Layout, type LayoutItem } from "react-grid-layout";
import { articleKeyOf } from "../articles";
import type { SkipNetContent, SkipNetKind, SkipNetWindow } from "../schema";

/** Grid cells across the desktop */
export const desktopCols = 80;
/** A grid cell's side, so a shaded window is one row */
export const cellPx = 20;
export const desktopPadPx = 12;
export const desktopPx = desktopCols * cellPx + 2 * desktopPadPx;
/** Pixels between windows one above another */
export const rowGapPx = 6;
/** A panel narrower than this shows its windows stacked */
export const stackPx = 640;
/** Nothing moves out of the way, so windows overlap */
export const freeCompactor = getCompactor(null, true);

/** A new article window's height, which fitting to its article never exceeds */
export const articleRows = 24;
/** A new item window's width, which fitting to its item never exceeds */
export const itemCols = 20;

/** A window's height in pixels, `rows` tall */
export function pxOfRows(rows: number) {
  return rows * cellPx + (rows - 1) * rowGapPx;
}

/** The fewest rows at least `px` tall */
export function rowsOfPx(px: number) {
  return Math.ceil((px + rowGapPx) / (cellPx + rowGapPx));
}

/** `win`'s grid place centred in what is in view of the `desk`, kept on it */
export function centredIn(win: SkipNetWindow, desk: HTMLElement): Pick<SkipNetWindow, "x" | "y"> {
  const x = Math.round((desk.scrollLeft + desk.clientWidth / 2 - desktopPadPx) / cellPx - win.w / 2);
  const y = Math.round((desk.scrollTop + desk.clientHeight / 2 - desktopPadPx) / (cellPx + rowGapPx) - win.h / 2);
  return { x: Math.min(Math.max(0, x), desktopCols - win.w), y: Math.max(0, y) };
}

/** Where a window moves to in Show All, how far it shrinks, and its size once shrunk */
export type ShowAllSlot = { dx: number; dy: number; scale: number; width: number; height: number };

/**
 * Every window tiled within `view` (desktop pixels), shrunk to fit and never overlapping, as macOS's Mission Control.
 * Its columns are those showing the most window. They are taken in reading order, so each stays near where it was.
 */
export function showAllSlots(windows: SkipNetWindow[], view: Rect): Map<string, ShowAllSlot> {
  const ordered = [...windows].sort((a, b) => a.y - b.y || a.x - b.x);
  const rects = ordered.map(rectOf);
  const scaleIn = (r: Rect, cellW: number, cellH: number) =>
    Math.min(1, (cellW - showAllGapPx) / r.width, (cellH - showAllGapPx) / r.height);

  let cols = 1;
  let bestShown = -1;
  for (let c = 1; c <= ordered.length; c++) {
    const [cellW, cellH] = [view.width / c, view.height / Math.ceil(ordered.length / c)];
    const shown = rects.reduce((sum, r) => sum + scaleIn(r, cellW, cellH) ** 2 * r.width * r.height, 0);
    if (shown > bestShown) [cols, bestShown] = [c, shown];
  }

  const rows = Math.ceil(ordered.length / cols);
  const [cellW, cellH] = [view.width / cols, view.height / rows];
  return new Map(
    ordered.map((win, i) => {
      const r = rects[i];
      const scale = scaleIn(r, cellW, cellH);
      const [row, col] = [Math.floor(i / cols), i % cols];
      /** The last row is centred when short */
      const rowCols = row === rows - 1 ? ordered.length - row * cols : cols;
      const left = view.x + (view.width - rowCols * cellW) / 2 + col * cellW + (cellW - scale * r.width) / 2;
      const top = view.y + row * cellH + (cellH - scale * r.height) / 2;
      return [win.id, { dx: left - r.x, dy: top - r.y, scale, width: scale * r.width, height: scale * r.height }];
    }),
  );
}

/** What its bar names it, e.g. its article's key */
export function titleOf(win: SkipNetWindow, items: JshCli.SkipNetItem[]): string {
  switch (win.kind) {
    case "folder":
      return "files";
    case "chat":
      return "chat";
    case "article":
      return articleKeyOf(win.articleKey) ?? "article";
    case "item":
      return items.find((x) => x.key === win.itemKey)?.title ?? win.itemKey ?? "item";
    default:
      return win.kind;
  }
}

/** The window stacked over every other */
export function frontOf(windows: SkipNetWindow[]): undefined | SkipNetWindow {
  return windows.reduce<undefined | SkipNetWindow>(
    (front, x) => (front === undefined || x.z > front.z ? x : front),
    undefined,
  );
}

/** A stack's windows in order: by `stackOrder`, then any without one in the desktop's reading order */
export function stackOrdered(windows: SkipNetWindow[]): SkipNetWindow[] {
  const rank = (x: SkipNetWindow) => x.stackOrder ?? Number.POSITIVE_INFINITY;
  return [...windows].sort((a, b) => rank(a) - rank(b) || a.y - b.y || a.x - b.x);
}

/** A window showing `content`, cascaded from the last opened, in front */
export function newWindow(windows: SkipNetWindow[], content: SkipNetContent): SkipNetWindow {
  const last = windows.reduce<undefined | SkipNetWindow>(
    (a, b) => (a === undefined || idNum(b) > idNum(a) ? b : a),
    undefined,
  );
  const [w, h] = sizes[content.kind];
  const x = last === undefined || last.x + cascadeCells + w > desktopCols ? 0 : last.x + cascadeCells;
  const y = last === undefined ? 0 : last.y + cascadeCells;
  const z = (frontOf(windows)?.z ?? 0) + 1;
  const fit = content.kind === "article" || content.kind === "item" || undefined;
  return { ...content, id: `w${last === undefined ? 1 : idNum(last) + 1}`, x, y, w, h, z, fit };
}

/** `id` stacked over every other, the rest kept in order, numbered from 1 */
export function restack(windows: SkipNetWindow[], id: string): SkipNetWindow[] {
  const order = [...windows].sort((a, b) => a.z - b.z);
  const target = order.findIndex((x) => x.id === id);
  if (target !== -1) order.push(...order.splice(target, 1));
  const zOf = new Map(order.map((x, i) => [x.id, i + 1]));
  return windows.map((x) => ({ ...x, z: zOf.get(x.id) ?? x.z }));
}

export function toLayout(windows: SkipNetWindow[]): LayoutItem[] {
  return windows.map(({ id, x, y, w, h, shadedH }) => {
    const shaded = shadedH !== undefined;
    return { i: id, x, y, w, h, minW: 6, minH: shaded ? 1 : 3, isResizable: !shaded };
  });
}

export function toggleShade(win: SkipNetWindow): SkipNetWindow {
  if (win.shadedH === undefined) return { ...win, h: 1, shadedH: win.h };
  const { shadedH, ...rest } = win;
  return { ...rest, h: shadedH };
}

/** Each window placed as `layout` has it */
export function withLayout(windows: SkipNetWindow[], layout: Layout): SkipNetWindow[] {
  const byId = new Map(layout.map((item) => [item.i, item]));
  return windows.map((win) => {
    const item = byId.get(win.id);
    return item === undefined ? win : { ...win, x: item.x, y: item.y, w: item.w, h: item.h };
  });
}

function idNum(win: SkipNetWindow) {
  return Number(win.id.slice(1)) || 0;
}

/** A window's place on the desktop in pixels, as the grid lays it out. A folded one is its bar */
function rectOf(win: SkipNetWindow): Rect {
  return {
    x: desktopPadPx + win.x * cellPx,
    y: desktopPadPx + win.y * (cellPx + rowGapPx),
    width: win.w * cellPx,
    height: win.shadedH !== undefined ? foldedPx : pxOfRows(win.h),
  };
}

type Rect = { x: number; y: number; width: number; height: number };

/** A folded window's height: its bar and borders */
const foldedPx = 30;
/** Room around each window in Show All */
const showAllGapPx = 24;
/** How far each new window is offset from the last, in cells */
const cascadeCells = 2;
/** A new window's width and height, in cells. An article's height is then fitted to it, at most this */
const sizes: Record<SkipNetKind, [number, number]> = {
  article: [30, articleRows],
  folder: [20, 12],
  /** Tall enough for a thread with no comments yet */
  chat: [24, 17],
  item: [itemCols, 16],
};
