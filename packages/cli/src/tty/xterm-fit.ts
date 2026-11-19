/** A tty's font, which `fitOf` measures */
export const xtermFont = { fontSize: 16, fontFamily: "'Courier New', Courier, monospace" };

/**
 * The cols and rows `FitAddon` would give `el`, measured as xterm 6 does.
 * A WebGL terminal made this size never resizes at boot, which waits on the GPU.
 */
export function fitOf(el: HTMLElement): undefined | { cols: number; rows: number } {
  const { width, height } = getComputedStyle(el);
  const [w, h] = [Number.parseInt(width, 10), Number.parseInt(height, 10)];
  const ct = globalThis.OffscreenCanvas && new OffscreenCanvas(1, 1).getContext("2d");
  if (!ct || !(w > 0) || !(h > 0)) return undefined;
  ct.font = `${xtermFont.fontSize}px ${xtermFont.fontFamily}`;
  const m = ct.measureText("W");
  const dpr = devicePixelRatio;
  const cell = {
    w: Math.floor(m.width * dpr) / dpr,
    h: Math.ceil((m.fontBoundingBoxAscent + m.fontBoundingBoxDescent) * dpr) / dpr,
  };
  return { cols: Math.max(2, Math.floor((w - scrollBarWidth) / cell.w)), rows: Math.max(1, Math.floor(h / cell.h)) };
}

/** xterm's own, there being a scrollback */
const scrollBarWidth = 14;
