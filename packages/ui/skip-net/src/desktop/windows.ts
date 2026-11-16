import type { Layout, LayoutItem } from "react-grid-layout";
import type { SkipNetContent, SkipNetKind, SkipNetWindow } from "../schema";

/** Grid cells across the desktop */
export const desktopCols = 80;
/** A grid cell's side, so a shaded window is one row */
export const cellPx = 20;
export const desktopPadPx = 12;
export const desktopPx = desktopCols * cellPx + 2 * desktopPadPx;
/** A panel narrower than this shows its windows stacked */
export const stackPx = 640;

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
  return { ...content, id: `w${last === undefined ? 1 : idNum(last) + 1}`, x, y, w, h, z };
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

/** How far each new window is offset from the last, in cells */
const cascadeCells = 2;
/** A new window's width and height, in cells */
const sizes: Record<SkipNetKind, [number, number]> = {
  article: [30, 24],
  folder: [20, 12],
  item: [20, 16],
  jobs: [32, 14],
  library: [30, 24],
};
