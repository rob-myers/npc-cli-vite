import { useCallback, useMemo, useRef, useState } from "react";

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
 * Shared by the World's debug modals and `@npc-cli/ui__nav-routes`.
 *
 * One rule serves all three: the map point that was grabbed stays under the pointer. It is worked
 * out off the SVG's own screen transform, since `preserveAspectRatio` letterboxes the viewBox and
 * the element's rect says nothing of where the map is inside it
 */
export function useSvgZoom(bounds: { minX: number; minY: number; width: number; height: number }) {
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const dragRef = useRef<Grab | null>(null);
  const pinchRef = useRef<(Grab & { dist: number }) | null>(null);

  const viewBox = useMemo(() => {
    const w = bounds.width / zoom;
    const h = bounds.height / zoom;
    const cx = bounds.minX + bounds.width / 2 + pan.x;
    const cy = bounds.minY + bounds.height / 2 + pan.y;
    return `${cx - w / 2} ${cy - h / 2} ${w} ${h}`;
  }, [bounds, zoom, pan]);

  /** The pan which puts the grabbed point under `(clientX, clientY)` at `nextZoom` */
  const panTo = useCallback(
    (svg: SVGSVGElement, grab: Grab, clientX: number, clientY: number, nextZoom: number) => {
      const rect = svg.getBoundingClientRect();
      // the viewBox is centred in the element, so its centre is the element's, whatever the letterbox
      const pxPerUnit = grab.pxPerUnit * (nextZoom / grab.zoom);
      setPan({
        x: grab.x - (clientX - (rect.left + rect.width / 2)) / pxPerUnit - (bounds.minX + bounds.width / 2),
        y: grab.y - (clientY - (rect.top + rect.height / 2)) / pxPerUnit - (bounds.minY + bounds.height / 2),
      });
      setZoom(nextZoom);
    },
    [bounds],
  );

  /** What is under the pointer now, and the scale it is seen at */
  const grabAt = useCallback(
    (svg: SVGSVGElement, clientX: number, clientY: number): Grab | null => {
      const ctm = svg.getScreenCTM();
      if (ctm === null) return null;
      const { x, y } = new DOMPoint(clientX, clientY).matrixTransform(ctm.inverse());
      return { x, y, pxPerUnit: ctm.a, zoom };
    },
    [zoom],
  );

  const onWheel = useCallback(
    (e: React.WheelEvent<SVGSVGElement>) => {
      const grab = grabAt(e.currentTarget, e.clientX, e.clientY);
      if (grab === null) return;
      const factor = e.deltaY < 0 ? 1.05 : 1 / 1.05;
      panTo(e.currentTarget, grab, e.clientX, e.clientY, clampZoom(zoom * factor));
    },
    [zoom, grabAt, panTo],
  );

  const onPointerDown = useCallback(
    (e: React.PointerEvent<SVGSVGElement>) => {
      if ((e.target as Element).closest?.("text")) return;
      e.currentTarget.setPointerCapture(e.pointerId);
      dragRef.current = grabAt(e.currentTarget, e.clientX, e.clientY);
    },
    [grabAt],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent<SVGSVGElement>) => {
      if (!dragRef.current || pinchRef.current) return;
      panTo(e.currentTarget, dragRef.current, e.clientX, e.clientY, dragRef.current.zoom);
    },
    [panTo],
  );

  const onPointerUp = useCallback(() => {
    dragRef.current = null;
  }, []);

  const onTouchStart = useCallback(
    (e: React.TouchEvent<SVGSVGElement>) => {
      if (e.touches.length !== 2) return;
      dragRef.current = null;
      const [t0, t1] = [e.touches[0], e.touches[1]];
      const grab = grabAt(e.currentTarget, (t0.clientX + t1.clientX) / 2, (t0.clientY + t1.clientY) / 2);
      if (grab === null) return;
      pinchRef.current = { ...grab, dist: Math.hypot(t1.clientX - t0.clientX, t1.clientY - t0.clientY) };
    },
    [grabAt],
  );

  const onTouchMove = useCallback(
    (e: React.TouchEvent<SVGSVGElement>) => {
      const pinch = pinchRef.current;
      if (e.touches.length !== 2 || !pinch) return;
      const [t0, t1] = [e.touches[0], e.touches[1]];
      const dist = Math.hypot(t1.clientX - t0.clientX, t1.clientY - t0.clientY);
      // the point between the fingers stays between them, as they spread and as they move
      panTo(
        e.currentTarget,
        pinch,
        (t0.clientX + t1.clientX) / 2,
        (t0.clientY + t1.clientY) / 2,
        clampZoom(pinch.zoom * (dist / pinch.dist)),
      );
    },
    [panTo],
  );

  const onTouchEnd = useCallback(() => {
    pinchRef.current = null;
  }, []);

  const reset = useCallback(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, []);

  return {
    viewBox,
    onWheel,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onTouchStart,
    onTouchMove,
    onTouchEnd,
    reset,
    zoom,
  };
}

/** A map point under the pointer, with the zoom and screen scale it was seen at */
type Grab = { x: number; y: number; pxPerUnit: number; zoom: number };

const clampZoom = (zoom: number) => Math.min(20, Math.max(0.5, zoom));
