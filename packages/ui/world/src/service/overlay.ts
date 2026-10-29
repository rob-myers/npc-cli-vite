import type * as THREE from "three/webgpu";

/** Fades a mark in or out. Out, it is left where it was, and takes no presses */
export function showMark(el: null | HTMLElement, shown: boolean) {
  if (el === null) return;
  el.toggleAttribute("data-off", !shown);
  el.inert = !shown;
}

/** Centres `el` on `at`, in overlay pixels */
export function pin(el: HTMLElement, { x, y }: Geom.VectJson) {
  el.style.transform = `translate(${x}px,${y}px) translate(-50%,-50%)`;
}

/** A world point's place in the overlay, in pixels. Projects `point` in place */
export function toScreen(point: THREE.Vector3, camera: THREE.Camera, canvas: Box, box: Box) {
  point.project(camera);
  return {
    x: canvas.left - box.left + ((point.x + 1) / 2) * canvas.width,
    y: canvas.top - box.top + ((1 - point.y) / 2) * canvas.height,
  };
}

/** How far from `at` a press at `down` was, in overlay pixels. `down` is relative to the canvas */
export function offsetUnder(down: Geom.VectJson, at: Geom.VectJson, canvas: Box, box: Box) {
  return { x: canvas.left - box.left + down.x - at.x, y: canvas.top - box.top + down.y - at.y };
}

/** A client rect, or as much of one as placing needs */
export type Box = Pick<DOMRect, "left" | "top" | "width" | "height">;

/** Its own rect, as `toScreen` takes it */
export function boxOf(el: Element): Box {
  const { left, top, width, height } = el.getBoundingClientRect();
  return { left, top, width, height };
}

/** The canvas and an overlay's box, measured only as either resizes, so a frame loop reads no layout */
export class OverlayBounds {
  canvas: null | Box = null;
  box: null | Box = null;
  /** Run after a resize is measured, e.g. to ask for a frame */
  onResize: () => void;
  #els: [null | Element, null | Element] = [null, null];
  #observer = new ResizeObserver(() => (this.measure(), this.onResize()));

  constructor(onResize = () => {}) {
    this.onResize = onResize;
  }
  /** Watches `overlay` and `canvas`, measuring at once if either is new: `false` until both exist */
  sync(overlay: null | Element, canvas: null | Element): this is { canvas: Box; box: Box } {
    if (overlay !== this.#els[0] || canvas !== this.#els[1]) {
      this.#observer.disconnect();
      this.#els = [overlay, canvas];
      for (const el of this.#els) if (el !== null) this.#observer.observe(el);
      this.measure();
    }
    return this.canvas !== null && this.box !== null;
  }
  measure() {
    const [overlay, canvas] = this.#els;
    [this.box, this.canvas] = overlay !== null && canvas !== null ? [boxOf(overlay), boxOf(canvas)] : [null, null];
  }
  dispose() {
    this.#observer.disconnect();
    this.#els = [null, null];
  }
}

export const markClass = "absolute top-0 left-0 transition-opacity duration-150 data-off:opacity-0";

/** A menu's row, e.g. a psi action */
export const actionClass =
  "pointer-events-auto cursor-pointer rounded bg-black/60 px-1.5 py-0.5 text-left font-mono text-[11px] text-white opacity-80 hover:opacity-100";

/** A menu's Cancel, opened under the press */
export const cancelClass =
  "pointer-events-auto cursor-pointer rounded border border-red-500/50 bg-blue-950/40 px-1.5 py-0.5 text-left font-mono text-[11px] text-white hover:bg-red-900/50";
