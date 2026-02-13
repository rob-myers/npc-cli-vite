import { uiClassName } from "@npc-cli/ui-sdk";
import { cn } from "@npc-cli/util";
import { PlusIcon } from "@phosphor-icons/react";
import { type PointerEvent, useCallback, useEffect, useRef, useState } from "react";
import type { MapEditUiMeta } from "./schema";
import { type SVGElementWrapper, TreeItem } from "./TreeItem";

// 🚧 clean via useStateRef

export default function MapEdit(_props: { meta: MapEditUiMeta }) {
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const lastMousePos = useRef({ x: 0, y: 0 });
  const containerRef = useRef<HTMLDivElement>(null);
  const zoomRef = useRef(zoom);
  const panRef = useRef(pan);
  zoomRef.current = zoom;
  panRef.current = pan;

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [asideWidth, setAsideWidth] = useState(192); // w-48 = 192px
  const [isResizing, setIsResizing] = useState(false);
  const asideWidthRef = useRef(asideWidth);
  asideWidthRef.current = asideWidth;
  const [elements, setElements] = useState<SVGElementWrapper[]>([
    {
      id: "root-group",
      name: "Main Illustration",
      type: "group",
      props: { fill: "none" },
      isVisible: true,
      isLocked: false,
      children: [
        {
          id: "bg-rect",
          name: "Background",
          type: "rect",
          props: { x: 50, y: 50, width: 400, height: 400, fill: "#1e293b", rx: 20 },
          isVisible: true,
          isLocked: false,
        },
        {
          id: "sun",
          name: "Sun",
          type: "circle",
          props: { cx: 400, cy: 100, r: 40, fill: "#fbbf24" },
          isVisible: true,
          isLocked: false,
        },
      ],
    },
  ]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = container.getBoundingClientRect();
      // Mouse position relative to container center
      const mouseX = e.clientX - rect.left - rect.width / 2;
      const mouseY = e.clientY - rect.top - rect.height / 2;

      const currentZoom = zoomRef.current;
      const currentPan = panRef.current;
      const delta = e.deltaY > 0 ? 1 - 0.02 : 1 + 0.02;
      const newZoom = Math.min(Math.max(currentZoom * delta, 0.1), 10);

      // Adjust pan to keep the point under the mouse stationary
      const scaleFactor = newZoom / currentZoom;
      const newPan = {
        x: mouseX - (mouseX - currentPan.x) * scaleFactor,
        y: mouseY - (mouseY - currentPan.y) * scaleFactor,
      };
      setPan(newPan);
      setZoom(newZoom);
    };

    container.addEventListener("wheel", handleWheel, { passive: false });
    return () => container.removeEventListener("wheel", handleWheel);
  }, []);

  const handlePanPointerDown = useCallback((e: PointerEvent<HTMLDivElement>) => {
    if (e.button === 0) {
      (e.target as HTMLDivElement).setPointerCapture(e.pointerId);
      setIsPanning(true);
      lastMousePos.current = { x: e.clientX, y: e.clientY };
    }
  }, []);

  const handlePanPointerMove = useCallback(
    (e: PointerEvent<HTMLDivElement>) => {
      if (!isPanning) return;
      const dx = e.clientX - lastMousePos.current.x;
      const dy = e.clientY - lastMousePos.current.y;
      lastMousePos.current = { x: e.clientX, y: e.clientY };
      setPan((prev) => ({ x: prev.x + dx, y: prev.y + dy }));
    },
    [isPanning],
  );

  const handlePanPointerUp = useCallback((e: PointerEvent<HTMLDivElement>) => {
    (e.target as HTMLDivElement).releasePointerCapture(e.pointerId);
    setIsPanning(false);
  }, []);

  const handleResizePointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    (e.target as HTMLDivElement).setPointerCapture(e.pointerId);
    setIsResizing(true);
    lastMousePos.current = { x: e.clientX, y: 0 };
  }, []);

  const handleResizePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!isResizing) return;
      const dx = e.clientX - lastMousePos.current.x;
      lastMousePos.current = { x: e.clientX, y: 0 };
      setAsideWidth((prev) => Math.max(120, Math.min(400, prev + dx)));
    },
    [isResizing],
  );

  const handleResizePointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    (e.target as HTMLDivElement).releasePointerCapture(e.pointerId);
    setIsResizing(false);
  }, []);

  const handleSelect = (id: string) => {
    setSelectedId(id === selectedId ? null : id);
  };

  const handleToggleVisibility = (id: string) => {
    const toggle = (list: SVGElementWrapper[]): SVGElementWrapper[] => {
      return list.map((item) => {
        if (item.id === id) {
          return { ...item, isVisible: !item.isVisible };
        }
        if (item.children) {
          return { ...item, children: toggle(item.children) };
        }
        return item;
      });
    };
    setElements((prev) => toggle(prev));
  };

  return (
    <div className="overflow-auto size-full flex justify-center items-start">
      <aside
        className="h-full border-r border-slate-800 flex flex-col relative"
        style={{ width: asideWidth }}
      >
        <div className="px-4 py-3 border-b border-slate-800 flex justify-between items-center bg-slate-900/20">
          <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500">Layers</h2>
          <button className="flex text-slate-500 hover:text-slate-300 transition-colors">
            <PlusIcon />
          </button>
        </div>
        <div className="overflow-y-auto py-2 h-full custom-scrollbar">
          {elements.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-slate-600 px-8 text-center">
              <p className="text-xs italic">No elements found. Try generating a scene above.</p>
            </div>
          ) : (
            elements.map((el) => (
              <TreeItem
                key={el.id}
                element={el}
                level={0}
                selectedId={selectedId}
                onSelect={handleSelect}
                onToggleVisibility={handleToggleVisibility}
              />
            ))
          )}
        </div>
        <div
          className={cn(
            uiClassName,
            "absolute right-0 top-0 h-full w-1 cursor-ew-resize hover:bg-blue-500/50 transition-colors touch-none",
            isResizing && "bg-blue-500/50",
          )}
          onPointerDown={handleResizePointerDown}
          onPointerMove={handleResizePointerMove}
          onPointerUp={handleResizePointerUp}
        />
      </aside>

      <div
        ref={containerRef}
        className="w-full h-full flex items-center justify-center overflow-hidden relative cursor-grab active:cursor-grabbing touch-none"
        onPointerDown={handlePanPointerDown}
        onPointerMove={handlePanPointerMove}
        onPointerUp={handlePanPointerUp}
      >
        {/* Grid Pattern Background */}
        <div className="absolute inset-0 opacity-10 pointer-events-none" />

        <svg
          viewBox="0 0 500 500"
          className={cn(uiClassName, " drop-shadow-2xl border border-white/20 overflow-visible")}
          preserveAspectRatio="xMidYMid meet"
          style={{
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
            transformOrigin: "center center",
          }}
        >
          <defs>
            <pattern id="smallGrid" width="10" height="10" patternUnits="userSpaceOnUse">
              <path
                d="M 10 0 L 0 0 0 10"
                fill="none"
                stroke="rgba(100, 116, 139, 0.3)"
                strokeWidth="0.5"
              />
            </pattern>
            <pattern id="grid" width="50" height="50" patternUnits="userSpaceOnUse">
              <rect width="50" height="50" fill="url(#smallGrid)" />
              <path
                d="M 50 0 L 0 0 0 50"
                fill="none"
                stroke="rgba(100, 116, 139, 0.5)"
                strokeWidth="1"
              />
            </pattern>
          </defs>
          <rect x="-10000" y="-10000" width="20000" height="20000" fill="url(#grid)" />
          {/* {elements.map((el) => (
          <RenderElement
            key={el.id}
            element={el}
            isSelected={selectedId === el.id}
            onSelect={onSelect}
          />
        ))} */}
        </svg>
      </div>
    </div>
  );
}
