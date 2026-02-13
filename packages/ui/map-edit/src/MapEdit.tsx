import { uiClassName } from "@npc-cli/ui-sdk";
import { cn, useStateRef } from "@npc-cli/util";
import { PlusIcon } from "@phosphor-icons/react";
import { type PointerEvent, useEffect } from "react";
import type { MapEditUiMeta } from "./schema";
import { type SVGElementWrapper, TreeItem } from "./TreeItem";

export default function MapEdit(_props: { meta: MapEditUiMeta }) {
  const state = useStateRef<State>(() => ({
    zoom: 1,
    pan: { x: 0, y: 0 },
    isPanning: false,
    lastPointerPos: { x: 0, y: 0 },
    containerEl: null,

    selectedId: null,
    asideWidth: 192,
    isResizing: false,
    elements: demoElements,

    onPanPointerDown(e: PointerEvent<HTMLDivElement>) {
      if (e.button === 0) {
        (e.target as HTMLDivElement).setPointerCapture(e.pointerId);
        state.isPanning = true;
        state.lastPointerPos = { x: e.clientX, y: e.clientY };
      }
    },
    onPanPointerMove(e: PointerEvent<HTMLDivElement>) {
      if (!state.isPanning) return;
      const dx = e.clientX - state.lastPointerPos.x;
      const dy = e.clientY - state.lastPointerPos.y;
      state.lastPointerPos = { x: e.clientX, y: e.clientY };
      state.set({ pan: { x: state.pan.x + dx, y: state.pan.y + dy } });
    },
    onPanPointerUp(e: PointerEvent<HTMLDivElement>) {
      (e.target as HTMLDivElement).releasePointerCapture(e.pointerId);
      state.isPanning = false;
    },

    onResizePointerDown(e: PointerEvent<HTMLDivElement>) {
      e.preventDefault();
      e.stopPropagation();
      (e.target as HTMLDivElement).setPointerCapture(e.pointerId);
      state.isResizing = true;
      state.lastPointerPos = { x: e.clientX, y: 0 };
    },
    onResizePointerMove(e: PointerEvent<HTMLDivElement>) {
      if (!state.isResizing) return;
      const dx = e.clientX - state.lastPointerPos.x;
      state.lastPointerPos = { x: e.clientX, y: 0 };
      state.set({ asideWidth: Math.max(120, Math.min(400, state.asideWidth + dx)) });
    },
    onResizePointerUp(e: PointerEvent<HTMLDivElement>) {
      (e.target as HTMLDivElement).releasePointerCapture(e.pointerId);
      state.isResizing = false;
    },

    onSelect(id: string) {
      state.set({ selectedId: id === state.selectedId ? null : id });
    },
    onToggleVisibility(id: string) {
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
      state.set({ elements: toggle(state.elements) });
    },
  }));

  useEffect(() => {
    const container = state.containerEl;
    if (!container) return;

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = container.getBoundingClientRect();
      const mouseX = e.clientX - rect.left - rect.width / 2;
      const mouseY = e.clientY - rect.top - rect.height / 2;

      const delta = e.deltaY > 0 ? 1 - 0.02 : 1 + 0.02;
      const newZoom = Math.min(Math.max(state.zoom * delta, 0.1), 10);

      const scaleFactor = newZoom / state.zoom;
      const newPan = {
        x: mouseX - (mouseX - state.pan.x) * scaleFactor,
        y: mouseY - (mouseY - state.pan.y) * scaleFactor,
      };
      state.set({ pan: newPan, zoom: newZoom });
    };

    container.addEventListener("wheel", handleWheel, { passive: false });
    return () => container.removeEventListener("wheel", handleWheel);
  }, [state, state.containerEl]);

  return (
    <div className="overflow-auto size-full flex justify-center items-start">
      <aside
        className="h-full border-r border-slate-800 flex flex-col relative"
        style={{ width: state.asideWidth }}
      >
        <div className="px-4 py-3 border-b border-slate-800 flex justify-between items-center bg-slate-900/20">
          <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500">Layers</h2>
          <button
            className={cn(
              uiClassName,
              "cursor-pointer",
              "flex text-slate-500 hover:text-slate-300 transition-colors",
            )}
          >
            <PlusIcon />
          </button>
        </div>
        <div className="overflow-y-auto py-2 h-full custom-scrollbar">
          {state.elements.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-slate-600 px-8 text-center">
              <p className="text-xs italic">No elements found. Try generating a scene above.</p>
            </div>
          ) : (
            state.elements.map((el) => (
              <TreeItem
                key={el.id}
                element={el}
                level={0}
                selectedId={state.selectedId}
                onSelect={state.onSelect}
                onToggleVisibility={state.onToggleVisibility}
              />
            ))
          )}
        </div>
        <div
          className={cn(
            uiClassName,
            "absolute right-0 top-0 h-full w-1 cursor-ew-resize hover:bg-blue-500/50 transition-colors touch-none",
            state.isResizing && "bg-blue-500/50",
          )}
          onPointerDown={state.onResizePointerDown}
          onPointerMove={state.onResizePointerMove}
          onPointerUp={state.onResizePointerUp}
        />
      </aside>

      <div
        ref={state.ref("containerEl")}
        className="w-full h-full flex items-center justify-center overflow-hidden relative cursor-grab active:cursor-grabbing touch-none"
        onPointerDown={state.onPanPointerDown}
        onPointerMove={state.onPanPointerMove}
        onPointerUp={state.onPanPointerUp}
      >
        <div className="absolute inset-0 opacity-10 pointer-events-none" />

        <svg
          viewBox="0 0 500 500"
          className={cn(uiClassName, " drop-shadow-2xl border border-white/20 overflow-visible")}
          preserveAspectRatio="xMidYMid meet"
          style={{
            transform: `translate(${state.pan.x}px, ${state.pan.y}px) scale(${state.zoom})`,
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
        </svg>
      </div>
    </div>
  );
}

type State = {
  zoom: number;
  pan: { x: number; y: number };
  isPanning: boolean;
  lastPointerPos: { x: number; y: number };
  containerEl: HTMLDivElement | null;

  selectedId: string | null;
  asideWidth: number;
  isResizing: boolean;
  elements: SVGElementWrapper[];

  onPanPointerDown: (e: PointerEvent<HTMLDivElement>) => void;
  onPanPointerMove: (e: PointerEvent<HTMLDivElement>) => void;
  onPanPointerUp: (e: PointerEvent<HTMLDivElement>) => void;
  onResizePointerDown: (e: PointerEvent<HTMLDivElement>) => void;
  onResizePointerMove: (e: PointerEvent<HTMLDivElement>) => void;
  onResizePointerUp: (e: PointerEvent<HTMLDivElement>) => void;
  onSelect: (id: string) => void;
  onToggleVisibility: (id: string) => void;
};

const demoElements: SVGElementWrapper[] = [
  {
    id: "root-group",
    name: "Main",
    type: "group",
    props: { fill: "none" },
    isVisible: true,
    isLocked: false,
    children: [
      {
        id: "bg-rect",
        name: "Bg",
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
];
