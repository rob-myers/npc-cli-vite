import { Menu } from "@base-ui/react/menu";
import { UiContext, uiClassName } from "@npc-cli/ui-sdk";
import { cn, type UseStateRef, useStateRef } from "@npc-cli/util";
import {
  CaretLeftIcon,
  CaretRightIcon,
  FolderIcon,
  PlusIcon,
  SquareIcon,
} from "@phosphor-icons/react";
import { type PointerEvent, useContext, useEffect } from "react";
import { extractNode, type MapNode, MapNodeUi, mapElements, traverseElements } from "./MapNodeUi";
import type { MapEditUiMeta } from "./schema";

// ✅ can add group ui
// ✅ can edit group name
// 🚧 adding group adds a respective <g>
// 🚧 can edit group/rect/path name
// 🚧 can add rect
// 🚧 can drag and resize a rect
// 🚧 can convert a rect into a path
// 🚧 unions of rects/paths is another path
// 🚧 can change colour of rect/path
// 🚧 can persist via meta and localStorage
// 🚧 can save file in dev env

export default function MapEdit(_props: { meta: MapEditUiMeta }) {
  const { theme } = useContext(UiContext);

  const state = useStateRef(
    (): State => ({
      zoom: 1,
      pan: { x: 0, y: 0 },
      isPanning: false,
      firstPointerPos: { x: 0, y: 0 },
      lastPointerPos: { x: 0, y: 0 },
      containerEl: null,
      lastTouchDist: 0,
      lastTouchMid: { x: 0, y: 0 },

      selectedId: null,
      editingId: null,
      asideWidth: defaultAsideWidth,
      lastAsideWidth: defaultAsideWidth,
      isResizing: false,
      elements: [],

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

      onTouchMove(e: TouchEvent) {
        if (e.touches.length !== 2 || !state.containerEl) return;
        e.preventDefault();
        const [t0, t1] = [e.touches[0], e.touches[1]];
        const dist = Math.hypot(t1.clientX - t0.clientX, t1.clientY - t0.clientY);
        const mid = { x: (t0.clientX + t1.clientX) / 2, y: (t0.clientY + t1.clientY) / 2 };

        if (state.lastTouchDist > 0) {
          const rect = state.containerEl.getBoundingClientRect();
          const pivot = {
            x: mid.x - rect.left - rect.width / 2,
            y: mid.y - rect.top - rect.height / 2,
          };
          const newZoom = Math.min(Math.max(state.zoom * (dist / state.lastTouchDist), 0.1), 10);
          const s = newZoom / state.zoom;
          state.set({
            zoom: newZoom,
            pan: {
              x: pivot.x - (pivot.x - state.pan.x) * s + mid.x - state.lastTouchMid.x,
              y: pivot.y - (pivot.y - state.pan.y) * s + mid.y - state.lastTouchMid.y,
            },
          });
        }
        state.lastTouchDist = dist;
        state.lastTouchMid = mid;
      },

      onResizePointerDown(e: PointerEvent<HTMLDivElement>) {
        e.preventDefault();
        e.stopPropagation();
        (e.target as HTMLDivElement).setPointerCapture(e.pointerId);
        state.isResizing = true;
        state.firstPointerPos = { x: e.clientX, y: e.clientY };
        state.lastPointerPos = { x: e.clientX, y: e.clientY };
      },
      onResizePointerMove(e: PointerEvent<HTMLDivElement>) {
        if (!state.isResizing) return;
        const dx = e.clientX - state.lastPointerPos.x;
        state.lastPointerPos = { x: e.clientX, y: e.clientY };
        state.set({
          asideWidth: Math.max(minAsideWidth, Math.min(maxAsideWidth, state.asideWidth + dx)),
        });
      },
      onResizePointerUp(e: PointerEvent<HTMLDivElement>) {
        (e.target as HTMLDivElement).releasePointerCapture(e.pointerId);
        state.isResizing = false;
      },

      onSelect(id: string) {
        state.set({ selectedId: id === state.selectedId ? null : id });
      },
      onToggleVisibility(id: string) {
        state.set({
          elements: mapElements(state.elements, id, (el) => ({ ...el, isVisible: !el.isVisible })),
        });
      },

      addGroup() {
        const nextNum = state.getNextGroupSuffix();
        const newGroup: MapNode = {
          id: crypto.randomUUID(),
          name: `Group ${nextNum}`,
          type: "group",
          isVisible: true,
          isLocked: false,
          children: [],
        };
        state.set({
          elements: [...state.elements, newGroup],
          selectedId: newGroup.id,
          editingId: newGroup.id,
        });
      },
      getNextGroupSuffix() {
        const usedNums = new Set<number>();
        traverseElements(state.elements, (el) => {
          if (el.type === "group" && el.name.startsWith("Group ")) {
            const num = Number.parseInt(el.name.slice(6), 10);
            if (!Number.isNaN(num)) usedNums.add(num);
          }
        });
        let nextNum = 1;
        while (usedNums.has(nextNum)) nextNum++;
        return nextNum;
      },
      onRename(id: string, newName: string) {
        state.set({
          elements: mapElements(state.elements, id, (el) => ({ ...el, name: newName })),
          editingId: null,
        });
      },
      onStartEdit(id: string) {
        state.set({ editingId: id });
      },
      onCancelEdit() {
        state.set({ editingId: null });
      },
      groupNode(id: string) {
        const { elements, node } = extractNode(state.elements, id);
        if (!node) return;
        const newGroup: MapNode = {
          id: crypto.randomUUID(),
          name: `Group ${state.getNextGroupSuffix()}`,
          type: "group",
          isVisible: true,
          isLocked: false,
          children: [node],
        };
        state.set({ elements: [...elements, newGroup], selectedId: newGroup.id });
      },
    }),
    { reset: { elements: false } },
  );

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
    container.addEventListener("touchmove", state.onTouchMove, { passive: false });
    container.addEventListener("touchend", () => (state.lastTouchDist = 0));
    return () => {
      container.removeEventListener("wheel", handleWheel);
      container.removeEventListener("touchmove", state.onTouchMove);
    };
  }, [state, state.containerEl]);

  return (
    <div className="overflow-auto size-full flex justify-center items-start">
      <aside
        className="relative h-full border-r border-slate-800 flex flex-col"
        style={{ width: state.asideWidth }}
      >
        <div className="grid [grid-template-columns:1fr_auto] items-center px-3 py-3 border-b border-slate-800 bg-slate-900/20">
          <h2 className="text-ellipsis line-clamp-1 text-xs font-bold uppercase tracking-wider text-slate-500">
            Layers
          </h2>
          <Menu.Root>
            <Menu.Trigger
              className={cn(
                uiClassName,
                "cursor-pointer text-slate-300",
                "hover:text-slate-300 transition-colors",
              )}
            >
              <PlusIcon className="size-5.5 p-0.5 rounded-lg bg-slate-700 border border-white/10" />
            </Menu.Trigger>
            <Menu.Portal>
              <Menu.Positioner className="z-50" sideOffset={4} align="start">
                <Menu.Popup className="bg-slate-800 border border-slate-700 rounded-md shadow-lg py-1 min-w-[120px]">
                  <Menu.Item
                    className="flex items-center gap-2 px-2 py-1 text-xs text-slate-300 hover:bg-slate-700 cursor-pointer"
                    closeOnClick
                    onClick={state.addGroup}
                  >
                    <FolderIcon className="size-4" />
                    Group
                  </Menu.Item>
                  <Menu.Item
                    className="flex items-center gap-2 px-2 py-1 text-xs text-slate-300 hover:bg-slate-700 cursor-pointer"
                    closeOnClick
                    onClick={() => {
                      console.log("Add Rect");
                    }}
                  >
                    <SquareIcon className="size-4" />
                    Rect
                  </Menu.Item>
                </Menu.Popup>
              </Menu.Positioner>
            </Menu.Portal>
          </Menu.Root>
        </div>

        <div className="overflow-y-auto h-full custom-scrollbar bg-background">
          {state.elements.map((el) => (
            <MapNodeUi key={el.id} element={el} level={0} root={state} />
          ))}
        </div>

        <InspectorResizer state={state} />
      </aside>

      <div
        ref={state.ref("containerEl")}
        className={cn(
          "w-full h-full flex items-center justify-center overflow-hidden relative cursor-grab active:cursor-grabbing touch-none",
          theme === "dark" ? "bg-gray-700/30" : "bg-white",
        )}
        onPointerDown={state.onPanPointerDown}
        onPointerMove={state.onPanPointerMove}
        onPointerUp={state.onPanPointerUp}
      >
        <MapEditSvg state={state} />
      </div>
    </div>
  );
}

export type State = {
  zoom: number;
  pan: { x: number; y: number };
  isPanning: boolean;
  firstPointerPos: { x: number; y: number };
  lastPointerPos: { x: number; y: number };
  containerEl: HTMLDivElement | null;
  lastTouchDist: number;
  lastTouchMid: { x: number; y: number };

  selectedId: string | null;
  editingId: string | null;
  asideWidth: number;
  lastAsideWidth: number;
  isResizing: boolean;
  elements: MapNode[];

  onPanPointerDown: (e: PointerEvent<HTMLDivElement>) => void;
  onPanPointerMove: (e: PointerEvent<HTMLDivElement>) => void;
  onPanPointerUp: (e: PointerEvent<HTMLDivElement>) => void;
  onTouchMove: (e: TouchEvent) => void;
  onResizePointerDown: (e: PointerEvent<HTMLDivElement>) => void;
  onResizePointerMove: (e: PointerEvent<HTMLDivElement>) => void;
  onResizePointerUp: (e: PointerEvent<HTMLDivElement>) => void;
  onSelect: (id: string) => void;
  onToggleVisibility: (id: string) => void;
  addGroup: () => void;
  onRename: (id: string, newName: string) => void;
  onStartEdit: (id: string) => void;
  onCancelEdit: () => void;
  getNextGroupSuffix: () => number;
  groupNode: (id: string) => void;
};

function MapEditSvg({ state }: { state: UseStateRef<State> }) {
  return (
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
  );
}

function InspectorResizer({ state }: { state: UseStateRef<State> }) {
  return (
    <div
      className={cn(
        uiClassName,
        "z-2 w-1 absolute right-0 top-0 h-full cursor-ew-resize hover:bg-blue-500/50 transition-colors touch-none",
        "bg-blue-500/50",
      )}
      onPointerDown={state.onResizePointerDown}
      onPointerMove={state.onResizePointerMove}
      onPointerUp={state.onResizePointerUp}
      onPointerOut={state.onResizePointerUp}
    >
      <button
        className={cn(
          uiClassName,
          "px-1 h-5 top-[calc(100%-20px)] cursor-pointer bg-slate-700 text-slate-300",
          "hover:text-slate-300 transition-colors",
        )}
        onClick={() => {
          if (state.firstPointerPos.x !== state.lastPointerPos.x) return;
          state.set({
            asideWidth: state.asideWidth <= minAsideWidth ? state.lastAsideWidth : minAsideWidth,
            lastAsideWidth: state.asideWidth,
          });
        }}
      >
        {state.asideWidth <= minAsideWidth ? (
          <CaretRightIcon className="size-4" />
        ) : (
          <CaretLeftIcon className="size-4" />
        )}
      </button>
    </div>
  );
}

const minAsideWidth = 50 - 1;
const maxAsideWidth = 300;
const defaultAsideWidth = 192;

const _demoElements: MapNode[] = [
  {
    id: "root-group",
    name: "Main",
    type: "group",
    isVisible: true,
    isLocked: false,
    children: [
      {
        id: "bg-rect",
        name: "Bg",
        type: "rect",
        isVisible: true,
        isLocked: false,
      },
      {
        id: "sun",
        name: "Sun",
        type: "circle",
        isVisible: true,
        isLocked: false,
      },
      {
        id: "root-group-2",
        name: "Main",
        type: "group",
        isVisible: true,
        isLocked: false,
        children: [
          {
            id: "sun-2",
            name: "Sun",
            type: "circle",
            isVisible: true,
            isLocked: false,
          },
        ],
      },
    ],
  },
];
