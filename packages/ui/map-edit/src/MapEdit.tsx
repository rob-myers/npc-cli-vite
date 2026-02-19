import { enableDragDropTouch } from "@dragdroptouch/drag-drop-touch";

enableDragDropTouch();

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
import { InspectorNode } from "./InspectorNode";
import { MapEditSvg } from "./MapEditSvg";
import {
  findNode,
  insertNodeAt,
  type MapNode,
  type MapNodeMap,
  type MapNodeType,
  mapElements,
  removeNodeFromParent,
  toTemplateNode,
  traverseElements,
} from "./map-node-api";
import type { MapEditUiMeta } from "./schema";

// ✅ can add group ui
// ✅ can edit group name

// ✅ cannot drag node into descendent
// ✅ when group selected added group should be child

// ✅ adding group adds a respective <g>
// ✅ can add rect
// ✅ can edit group/rect/path name

// ✅ selected rect has outline
// ✅ can drag a rect
// 🚧 can resize a rect

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
      isPinching: false,
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

      svgEl: null,
      dragEl: null,

      onPanPointerDown(e: PointerEvent<HTMLDivElement>) {
        if (e.button === 0 && !state.isPinching) {
          (e.target as HTMLDivElement).setPointerCapture(e.pointerId);
          state.isPanning = true;
          state.lastPointerPos = { x: e.clientX, y: e.clientY };
        }
      },
      onPanPointerMove(e: PointerEvent<HTMLDivElement>) {
        if (!state.isPanning || state.isPinching) return;
        const dx = e.clientX - state.lastPointerPos.x;
        const dy = e.clientY - state.lastPointerPos.y;
        state.lastPointerPos = { x: e.clientX, y: e.clientY };
        state.set({ pan: { x: state.pan.x + dx, y: state.pan.y + dy } });
      },
      onPanPointerUp(e: PointerEvent<HTMLDivElement>) {
        (e.target as HTMLDivElement).releasePointerCapture(e.pointerId);
        state.isPanning = false;
      },

      onTouchStart(e: TouchEvent) {
        if (e.touches.length !== 2) return;
        state.isPinching = true;
        state.isPanning = false;
        const [t0, t1] = [e.touches[0], e.touches[1]];
        state.lastTouchDist = Math.hypot(t1.clientX - t0.clientX, t1.clientY - t0.clientY);
        state.lastTouchMid = { x: (t0.clientX + t1.clientX) / 2, y: (t0.clientY + t1.clientY) / 2 };
      },
      onTouchMove(e: TouchEvent) {
        if (!(e.touches.length === 2 && state.containerEl && state.isPinching)) return;
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
      onTouchEnd() {
        state.isPinching = false;
        state.lastTouchDist = 0;
      },

      onResizePointerDown(e: PointerEvent<HTMLDivElement>) {
        e.preventDefault();
        e.stopPropagation();
        state.isResizing = true;
        state.firstPointerPos = { x: e.clientX, y: e.clientY };
        state.lastPointerPos = { x: e.clientX, y: e.clientY };
        document.body.addEventListener("pointermove", state.onResizePointerMove);
        document.body.addEventListener("pointerup", state.onResizePointerUp);
      },
      onResizePointerMove(e: globalThis.PointerEvent) {
        const dx = e.clientX - state.lastPointerPos.x;
        state.lastPointerPos = { x: e.clientX, y: e.clientY };
        state.set({
          asideWidth: Math.max(minAsideWidth, Math.min(maxAsideWidth, state.asideWidth + dx)),
        });
      },
      onResizePointerUp() {
        state.isResizing = false;
        document.body.removeEventListener("pointermove", state.onResizePointerMove);
        document.body.removeEventListener("pointerup", state.onResizePointerUp);
      },

      onSelect(id: string) {
        state.set({ selectedId: id === state.selectedId ? null : id });
      },
      onToggleVisibility(id: string) {
        state.set({
          elements: mapElements(state.elements, id, (el) => ({ ...el, visible: !el.visible })),
        });
      },

      add(type, { selectedGroupParent } = {}) {
        const selection = selectedGroupParent ? state.getSelectedNode() : null;
        const parent = selection?.type === "group" ? selection : null;
        const newItem = state.getNew(type);
        if (!parent) {
          state.set({
            elements: [...state.elements, newItem],
            selectedId: newItem.id,
            editingId: newItem.id,
          });
        } else {
          parent.children.push(newItem);
          state.update();
        }
      },
      getNew<T extends MapNodeType>(type: T) {
        const prefix = `${type.charAt(0).toUpperCase()}${type.slice(1)} `;
        const template = toTemplateNode[type];
        return {
          ...template,
          id: crypto.randomUUID(),
          name: `${prefix}${state.getNextSuffix(type, prefix)}`,
          visible: true,
          locked: false,
          // 🔔 deep objects must be fresh
          ...("children" in template && { children: [...template.children] }),
          ...("rect" in template && { rect: { ...template.rect } }),
        };
      },
      getNextSuffix(type: MapNodeType, prefix: string) {
        const usedNums = new Set<number>();
        traverseElements(state.elements, (el) => {
          if (el.type === type && el.name.startsWith(prefix)) {
            const num = Number(el.name.slice(prefix.length));
            if (!Number.isNaN(num)) usedNums.add(num);
          }
        });
        let nextNum = 1;
        while (usedNums.has(nextNum)) nextNum++;
        return nextNum;
      },
      getSelectedNode() {
        if (!state.selectedId) return null;
        const result = findNode(state.elements, state.selectedId);
        return result?.node ?? null;
      },
      groupNode(nodeId: string) {
        const result = findNode(state.elements, nodeId);
        if (!result) return;

        const newGroup = state.getNew("group");
        newGroup.children.push(result.node);

        const parentArray = result.parent?.children ?? state.elements;
        const oldChildIndex = removeNodeFromParent(parentArray, nodeId);
        parentArray.splice(oldChildIndex, 0, newGroup);

        state.set({ selectedId: newGroup.id });
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
      moveNode(srcId: string, dstId: string, edge: "top" | "bottom" | "inside") {
        if (srcId === dstId) return;

        const srcResult = findNode(state.elements, srcId);
        const dstResult = findNode(state.elements, dstId);
        if (
          !srcResult ||
          !dstResult ||
          findNode([srcResult.node], dstId) // cannot move into self
        ) {
          return;
        }

        removeNodeFromParent(srcResult.parent?.children ?? state.elements, srcId);

        if (edge === "inside" && dstResult.node.type === "group") {
          dstResult.node.children.push(srcResult.node);
        } else {
          insertNodeAt(srcResult.node, dstResult.parent?.children ?? state.elements, dstId, edge === "inside" ? "bottom" : edge);
        }

        state.update();
      },

      clientToSvg(clientX: number, clientY: number) {
        if (!state.svgEl) return { x: 0, y: 0 };
        const rect = state.svgEl.getBoundingClientRect();
        const baseSize = 500;
        const vbW = baseSize / state.zoom;
        const vbH = baseSize / state.zoom;
        const vbX = (baseSize - vbW) / 2 - state.pan.x / state.zoom;
        const vbY = (baseSize - vbH) / 2 - state.pan.y / state.zoom;
        return {
          x: vbX + ((clientX - rect.left) / rect.width) * vbW,
          y: vbY + ((clientY - rect.top) / rect.height) * vbH,
        };
      },
      onSvgPointerDown(e) {
        const target = e.target as SVGElement;
        const resizeHandle = target.dataset.resizeHandle as ResizeHandle | undefined;

        if (resizeHandle) {
          state.startResizeRect(e, resizeHandle);
        } else {
          const nodeId = target.dataset.nodeId;
          state.set({ selectedId: nodeId ?? null });
          if (nodeId) {
            state.startDragRect(e, nodeId);
          }
        }
      },
      startDragRect(e, nodeId) {
        const result = findNode(state.elements, nodeId);
        if (result?.node.type !== "rect") return;
        e.stopPropagation();
        const svgPos = state.clientToSvg(e.clientX, e.clientY);
        state.dragEl = {
          type: "move-rect",
          startSvg: svgPos,
          startRect: { x: result.node.rect.x, y: result.node.rect.y },
        };
        (e.target as SVGElement).setPointerCapture(e.pointerId);
      },
      startResizeRect(e, handle) {
        const result = state.selectedId ? findNode(state.elements, state.selectedId) : null;
        if (result?.node.type !== "rect") return;
        e.stopPropagation();
        const svgPos = state.clientToSvg(e.clientX, e.clientY);
        const { rect } = result.node;
        state.dragEl = {
          type: "resize-rect",
          handle,
          startSvg: svgPos,
          startRect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
        };
        (e.target as SVGElement).setPointerCapture(e.pointerId);
      },
      onSvgPointerMove(e) {
        if (!state.dragEl || !state.selectedId) return;
        e.stopPropagation();
        const result = findNode(state.elements, state.selectedId);
        if (!result || result.node.type !== "rect") return;

        const svgPos = state.clientToSvg(e.clientX, e.clientY);
        const dx = svgPos.x - state.dragEl.startSvg.x;
        const dy = svgPos.y - state.dragEl.startSvg.y;
        const increment = 10;
        const { rect } = result.node;

        if (state.dragEl.type === "move-rect") {
          rect.x = Math.round((state.dragEl.startRect.x + dx) / increment) * increment;
          rect.y = Math.round((state.dragEl.startRect.y + dy) / increment) * increment;
        } else {
          const { handle, startRect } = state.dragEl;
          const minSize = increment;

          if (handle.includes("w")) {
            const newX = Math.round((startRect.x + dx) / increment) * increment;
            const newWidth = startRect.width + (startRect.x - newX);
            if (newWidth >= minSize) {
              rect.x = newX;
              rect.width = newWidth;
            }
          } else {
            rect.width = Math.max(minSize, Math.round((startRect.width + dx) / increment) * increment);
          }

          if (handle.includes("n")) {
            const newY = Math.round((startRect.y + dy) / increment) * increment;
            const newHeight = startRect.height + (startRect.y - newY);
            if (newHeight >= minSize) {
              rect.y = newY;
              rect.height = newHeight;
            }
          } else {
            rect.height = Math.max(minSize, Math.round((startRect.height + dy) / increment) * increment);
          }
        }
        state.update();
      },
      onSvgPointerUp(e) {
        if (state.dragEl) {
          e.stopPropagation();
          (e.target as SVGElement).releasePointerCapture(e.pointerId);
          state.dragEl = null;
        }
      },
    }),
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
    container.addEventListener("touchstart", state.onTouchStart, { passive: true });
    container.addEventListener("touchmove", state.onTouchMove, { passive: false });
    container.addEventListener("touchend", state.onTouchEnd);
    return () => {
      container.removeEventListener("wheel", handleWheel);
      container.removeEventListener("touchstart", state.onTouchStart);
      container.removeEventListener("touchmove", state.onTouchMove);
      container.removeEventListener("touchend", state.onTouchEnd);
    };
  }, [state, state.containerEl]);

  return (
    <div className="overflow-auto size-full flex justify-center items-start">
      <aside
        className="relative h-full border-r border-slate-800 flex flex-col"
        style={{ width: state.asideWidth }}
      >
        <div className="grid grid-cols-[1fr_auto] items-center px-3 py-3 border-b border-slate-800 bg-slate-900/20">
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
                    onClick={() => {
                      state.add("group", { selectedGroupParent: true });
                    }}
                  >
                    <FolderIcon className="size-4" />
                    Group
                  </Menu.Item>
                  <Menu.Item
                    className="flex items-center gap-2 px-2 py-1 text-xs text-slate-300 hover:bg-slate-700 cursor-pointer"
                    closeOnClick
                    onClick={() => {
                      state.add("rect", { selectedGroupParent: true });
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
            <InspectorNode key={el.id} element={el} level={0} root={state} />
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
        <MapEditSvg root={state} />
      </div>
    </div>
  );
}

export type State = {
  zoom: number;
  pan: { x: number; y: number };
  isPanning: boolean;
  isPinching: boolean;
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
  svgEl: SVGSVGElement | null;
  dragEl: null | {
    type: "move-rect";
    startSvg: { x: number; y: number };
    startRect: { x: number; y: number };
  } | {
    type: "resize-rect";
    handle: ResizeHandle;
    startSvg: { x: number; y: number };
    startRect: { x: number; y: number; width: number; height: number };
  };

  startDragRect: (e: React.PointerEvent<SVGSVGElement>, nodeId: string) => void;
  startResizeRect: (e: React.PointerEvent<SVGSVGElement>, handle: ResizeHandle) => void;

  onPanPointerDown: (e: PointerEvent<HTMLDivElement>) => void;
  onPanPointerMove: (e: PointerEvent<HTMLDivElement>) => void;
  onPanPointerUp: (e: PointerEvent<HTMLDivElement>) => void;
  onTouchStart: (e: TouchEvent) => void;
  onTouchMove: (e: TouchEvent) => void;
  onTouchEnd: () => void;
  onResizePointerDown: (e: PointerEvent<HTMLDivElement>) => void;
  onResizePointerMove: (e: globalThis.PointerEvent) => void;
  onResizePointerUp: () => void;
  onSelect: (id: string) => void;
  onToggleVisibility: (id: string) => void;
  add: (type: MapNodeType, opts?: { selectedGroupParent?: boolean }) => void;
  onRename: (id: string, newName: string) => void;
  onStartEdit: (id: string) => void;
  onCancelEdit: () => void;
  getNew: <T extends MapNodeType>(type: T) => MapNodeMap[T];
  getNextSuffix: (type: MapNodeType, prefix: string) => number;
  getSelectedNode: () => MapNode | null;
  groupNode: (id: string) => void;
  moveNode: (srcId: string, dstId: string, edge: "top" | "bottom" | "inside") => void;
  clientToSvg: (clientX: number, clientY: number) => { x: number; y: number };
  onSvgPointerDown: (e: React.PointerEvent<SVGSVGElement>) => void;
  onSvgPointerMove: (e: React.PointerEvent<SVGSVGElement>) => void;
  onSvgPointerUp: (e: React.PointerEvent<SVGSVGElement>) => void;
};

function InspectorResizer({ state }: { state: UseStateRef<State> }) {
  return (
    <div
      className={cn(
        uiClassName,
        "z-2 w-1 absolute right-0 top-0 h-full cursor-ew-resize hover:bg-blue-500/50 transition-colors touch-none",
        "bg-blue-500/50",
      )}
      onPointerDown={state.onResizePointerDown}
    >
      <button
        className={cn(
          uiClassName,
          "px-1 h-5 top-[calc(100%-20px)] cursor-pointer bg-slate-700 text-slate-300",
          "hover:text-slate-300 transition-colors",
        )}
        onClick={() => {
          if (Math.abs(state.firstPointerPos.x - state.lastPointerPos.x) > 2) return;
          state.set({
            asideWidth: state.asideWidth <= minAsideWidth ? maxAsideWidth : minAsideWidth,
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

const minAsideWidth = 100;
const maxAsideWidth = 300;
const defaultAsideWidth = 192;

export type ResizeHandle = "nw" | "ne" | "sw" | "se";
