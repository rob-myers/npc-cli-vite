import { useEffect } from "react";
import { useStateRef } from "./use-state-ref.js";

/** A popup that pans and zooms: the page must not scroll or pinch-zoom under it */
export function preventPopupGestures(el: HTMLElement | SVGElement | null) {
  if (!el) return;
  const preventTouch = (e: Event) => {
    if ((e as TouchEvent).touches.length >= 2) e.preventDefault();
  };
  el.addEventListener("touchstart", preventTouch, { passive: false });
  el.addEventListener("touchmove", preventTouch, { passive: false });
  el.addEventListener("wheel", (e) => e.preventDefault(), { passive: false });
}

/**
 * Pan and zoom for an SVG whose viewBox is in world units: wheel about the cursor, drag, pinch.
 * Shared by the World's debug modals and `@npc-cli/ui__decorator`. `initial` is where to start,
 * e.g. as persisted, and `onChange` hears every change, e.g. to persist it.
 *
 * One rule serves all three: the map point that was grabbed stays under the pointer. It is worked
 * out off the SVG's own screen transform, since `preserveAspectRatio` letterboxes the viewBox and
 * the element's rect says nothing of where the map is inside it
 */
export function useSvgZoom(
  bounds: Bounds,
  opts: { initial?: SvgZoomState; onChange?: (next: SvgZoomState) => void } = {},
) {
  const state = useStateRef(() => ({
    zoom: opts.initial?.zoom ?? 1,
    pan: opts.initial?.pan ?? { x: 0, y: 0 },
    bounds,
    onChange: opts.onChange,
    viewBox: "",
    drag: null as null | Grab,
    pinch: null as null | (Grab & { dist: number }),
    /** `centreOn`'s glide: its frame, and where it has got to. A gesture stops it there */
    glide: { frame: 0, at: null as null | SvgZoomState },
    /** The svg, whose viewBox each change sets directly, so a gesture never re-renders the map */
    svg: null as null | SVGSVGElement,
    /** `onChange` waits for this, so a gesture stores where it ends, not each step */
    settle: 0,

    /**
     * Glides the point to the centre, at least this far in, or `offsetPx` from it on screen e.g. clear of a sidebar.
     * The svg is moved directly, and React told once at the end
     */
    centreOn(x: number, y: number, minZoom = 1, offsetPx = { x: 0, y: 0 }) {
      state.stopGlide();
      const { bounds: b, glide } = state;
      const from = { zoom: state.zoom, pan: state.pan };
      const zoom = Math.max(from.zoom, minZoom);
      /** Screen px per world unit once there */
      const pxPerUnit = (state.svg?.getScreenCTM()?.a ?? 1) * (zoom / from.zoom);
      const to = {
        pan: {
          x: x - offsetPx.x / pxPerUnit - (b.minX + b.width / 2),
          y: y - offsetPx.y / pxPerUnit - (b.minY + b.height / 2),
        },
        zoom,
      };
      const startMs = performance.now();
      const step = (nowMs: number) => {
        const t = Math.min(1, (nowMs - startMs) / centreOnMs);
        const eased = t < 0.5 ? 4 * t ** 3 : 1 - (2 - 2 * t) ** 3 / 2;
        const at = {
          pan: { x: from.pan.x + (to.pan.x - from.pan.x) * eased, y: from.pan.y + (to.pan.y - from.pan.y) * eased },
          zoom: from.zoom * (to.zoom / from.zoom) ** eased, // by ratio, so no lurch at either end
        };
        if (t < 1 && state.svg !== null) {
          glide.at = at;
          state.svg.setAttribute("viewBox", viewBoxOf(state.bounds, at.zoom, at.pan));
          glide.frame = requestAnimationFrame(step);
          return;
        }
        glide.at = null;
        state.show(to);
      };
      glide.frame = requestAnimationFrame(step);
    },
    /** The map rect in view, as the viewBox before letterboxing */
    getViewRect(): { x: number; y: number; width: number; height: number } {
      const { bounds: b, zoom, pan } = state;
      const [width, height] = [b.width / zoom, b.height / zoom];
      return { x: b.minX + (b.width - width) / 2 + pan.x, y: b.minY + (b.height - height) / 2 + pan.y, width, height };
    },
    /** What is under the pointer now, and the scale it is seen at */
    grabAt(svg: SVGSVGElement, clientX: number, clientY: number): Grab | null {
      const ctm = svg.getScreenCTM();
      if (ctm === null) return null;
      const { x, y } = new DOMPoint(clientX, clientY).matrixTransform(ctm.inverse());
      return { x, y, pxPerUnit: ctm.a, zoom: state.zoom };
    },
    onPointerDown(e: React.PointerEvent<SVGSVGElement>) {
      // text is left to be selected; `data-no-pan` marks what handles its own presses e.g. a draggable item
      if ((e.target as Element).closest?.("text, [data-no-pan]")) return;
      state.stopGlide();
      e.currentTarget.setPointerCapture(e.pointerId);
      state.drag = state.grabAt(e.currentTarget, e.clientX, e.clientY);
    },
    onPointerMove(e: React.PointerEvent<SVGSVGElement>) {
      if (state.drag === null || state.pinch !== null) return;
      state.panTo(e.currentTarget, state.drag, e.clientX, e.clientY, state.drag.zoom);
    },
    onPointerUp() {
      state.drag = null;
    },
    onTouchEnd() {
      state.pinch = null;
    },
    onTouchMove(e: React.TouchEvent<SVGSVGElement>) {
      const { pinch } = state;
      if (e.touches.length !== 2 || pinch === null) return;
      const [t0, t1] = [e.touches[0], e.touches[1]];
      const dist = Math.hypot(t1.clientX - t0.clientX, t1.clientY - t0.clientY);
      // the point between the fingers stays between them, as they spread and as they move
      const [cx, cy] = [(t0.clientX + t1.clientX) / 2, (t0.clientY + t1.clientY) / 2];
      state.panTo(e.currentTarget, pinch, cx, cy, clampZoom(pinch.zoom * (dist / pinch.dist)));
    },
    onTouchStart(e: React.TouchEvent<SVGSVGElement>) {
      if (e.touches.length !== 2) return;
      state.stopGlide();
      state.drag = null;
      const [t0, t1] = [e.touches[0], e.touches[1]];
      const grab = state.grabAt(e.currentTarget, (t0.clientX + t1.clientX) / 2, (t0.clientY + t1.clientY) / 2);
      if (grab !== null) state.pinch = { ...grab, dist: Math.hypot(t1.clientX - t0.clientX, t1.clientY - t0.clientY) };
    },
    onWheel(e: React.WheelEvent<SVGSVGElement>) {
      state.stopGlide();
      const grab = state.grabAt(e.currentTarget, e.clientX, e.clientY);
      if (grab === null) return;
      const factor = e.deltaY < 0 ? 1.05 : 1 / 1.05;
      state.panTo(e.currentTarget, grab, e.clientX, e.clientY, clampZoom(state.zoom * factor));
    },
    /** Puts the grabbed point under `(clientX, clientY)` at `zoom` */
    panTo(svg: SVGSVGElement, grab: Grab, clientX: number, clientY: number, zoom: number) {
      const rect = svg.getBoundingClientRect();
      const b = state.bounds;
      // the viewBox is centred in the element, so its centre is the element's, whatever the letterbox
      const pxPerUnit = grab.pxPerUnit * (zoom / grab.zoom);
      state.show({
        zoom,
        pan: {
          x: grab.x - (clientX - (rect.left + rect.width / 2)) / pxPerUnit - (b.minX + b.width / 2),
          y: grab.y - (clientY - (rect.top + rect.height / 2)) / pxPerUnit - (b.minY + b.height / 2),
        },
      });
    },
    reset() {
      state.show({ zoom: 1, pan: { x: 0, y: 0 } });
    },
    /** Shows `next`, and tells `onChange` once changes stop */
    show(next: SvgZoomState) {
      Object.assign(state, next);
      if (state.svg === null) state.update();
      else state.svg.setAttribute("viewBox", viewBoxOf(state.bounds, state.zoom, state.pan));
      clearTimeout(state.settle);
      state.settle = window.setTimeout(() => state.onChange?.({ zoom: state.zoom, pan: state.pan }), settleMs);
    },
    /** Stops a glide where it has got to, so the view does not jump back */
    stopGlide() {
      const { glide } = state;
      cancelAnimationFrame(glide.frame);
      if (glide.at !== null) state.show(glide.at);
      glide.at = null;
    },
    svgRef(el: SVGSVGElement | null) {
      state.svg = el;
      preventPopupGestures(el);
    },
    /** A map point on screen, as the svg is drawn now: `null` before it mounts */
    toClient(x: number, y: number): null | { x: number; y: number } {
      const ctm = state.svg?.getScreenCTM();
      return ctm == null ? null : new DOMPoint(x, y).matrixTransform(ctm);
    },
  }));

  state.bounds = bounds;
  state.onChange = opts.onChange;
  state.viewBox = viewBoxOf(bounds, state.zoom, state.pan);
  useEffect(() => () => (cancelAnimationFrame(state.glide.frame), clearTimeout(state.settle)), []);
  return state;
}

export type SvgZoomState = { zoom: number; pan: { x: number; y: number } };

type Bounds = { minX: number; minY: number; width: number; height: number };

/** A map point under the pointer, with the zoom and screen scale it was seen at */
type Grab = { x: number; y: number; pxPerUnit: number; zoom: number };

const clampZoom = (zoom: number) => Math.min(20, Math.max(0.5, zoom));

/** How long `centreOn` takes to glide there */
const centreOnMs = 550;

/** Ms without a change before `onChange` hears of it */
const settleMs = 200;

function viewBoxOf(bounds: Bounds, zoom: number, pan: { x: number; y: number }) {
  const w = bounds.width / zoom;
  const h = bounds.height / zoom;
  const cx = bounds.minX + bounds.width / 2 + pan.x;
  const cy = bounds.minY + bounds.height / 2 + pan.y;
  return `${cx - w / 2} ${cy - h / 2} ${w} ${h}`;
}
