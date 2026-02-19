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
  findNodeWithDepth,
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
// ✅ can resize a rect

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

      selectedIds: new Set<string>(),
      selectionBox: null as SelectionBox | null,
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

      onSelect(id: string, opts?: { add?: boolean }) {
        const current = new Set(opts?.add ? state.selectedIds : []);
        if (current.has(id)) {
          current.delete(id);
        } else {
          current.add(id);
        }
        state.set({ selectedIds: current, selectionBox: null });
      },
      onToggleVisibility(id: string) {
        state.set({
          elements: mapElements(state.elements, id, (el) => ({ ...el, visible: !el.visible })),
        });
      },

      clientToSvg(clientX: number, clientY: number) {
        if (!state.svgEl) return { x: 0, y: 0 };
        const rect = state.svgEl.getBoundingClientRect();
        const baseSize = 500;
        const vbW = baseSize / state.zoom;
        const vbH = baseSize / state.zoom;
        const vbX = (baseSize - vbW) / 2 - state.pan.x / state.zoom;
        const vbY = (baseSize - vbH) / 2 - state.pan.y / state.zoom;

        // Account for preserveAspectRatio="xMidYMid meet" centering
        // The viewBox is square (vbW === vbH), so we need to find the actual rendered size
        const containerAspect = rect.width / rect.height;
        const viewBoxAspect = vbW / vbH; // 1 since vbW === vbH

        let renderWidth: number, renderHeight: number, offsetX: number, offsetY: number;
        if (containerAspect > viewBoxAspect) {
          // Container is wider - height is the limiting dimension
          renderHeight = rect.height;
          renderWidth = rect.height * viewBoxAspect;
          offsetX = (rect.width - renderWidth) / 2;
          offsetY = 0;
        } else {
          // Container is taller - width is the limiting dimension
          renderWidth = rect.width;
          renderHeight = rect.width / viewBoxAspect;
          offsetX = 0;
          offsetY = (rect.height - renderHeight) / 2;
        }

        return {
          x: vbX + ((clientX - rect.left - offsetX) / renderWidth) * vbW,
          y: vbY + ((clientY - rect.top - offsetY) / renderHeight) * vbH,
        };
      },

      add(type, { selectedGroupParent, rect } = {}) {
        const selection = selectedGroupParent ? state.getSelectedNode() : null;
        const parent = selection?.type === "group" ? selection : null;
        const newItem = state.create(type);
        if (rect && newItem.type === "rect") {
          newItem.rect = rect;
        }
        if (!parent) {
          state.set({
            elements: [...state.elements, newItem],
            selectedIds: new Set([newItem.id]),
            editingId: newItem.id,
          });
        } else {
          parent.children.push(newItem);
          state.set({ selectedIds: new Set([newItem.id]) });
        }
      },
      cloneNode(node: MapNode, seen: Set<string>): MapNode {
        seen.add(node.id);
        const base = {
          ...node,
          id: crypto.randomUUID(),
          name: state.getNextName(node.type),
        };
        if (node.type === "group") {
          return {
            ...base,
            type: "group",
            children: node.children.map((c) => state.cloneNode(c, seen)),
          };
        }
        if (node.type === "rect") {
          return { ...base, type: "rect", rect: { ...node.rect } };
        }
        return base;
      },
      create<T extends MapNodeType>(type: T) {
        const template = toTemplateNode[type];
        return {
          ...template,
          id: crypto.randomUUID(),
          name: state.getNextName(type),
          visible: true,
          locked: false,
          // 🔔 deep objects must be fresh
          ...("children" in template && { children: [...template.children] }),
          ...("rect" in template && { rect: { ...template.rect } }),
        };
      },
      deleteSelected() {
        if (state.selectedIds.size === 0) return;
        for (const id of state.selectedIds) {
          const result = findNode(state.elements, id);
          if (result) {
            removeNodeFromParent(result.parent?.children ?? state.elements, id);
          }
        }
        state.set({ selectedIds: new Set(), selectionBox: null });
      },
      duplicateSelected() {
        if (state.selectedIds.size === 0) return;
        const seen = new Set<string>();
        const newIds = new Set<string>();
        for (const id of state.selectedIds) {
          if (seen.has(id)) continue;
          const result = findNode(state.elements, id);
          if (!result) continue;
          const clone = state.cloneNode(result.node, seen);
          state.elements.push(clone);
          newIds.add(clone.id);
        }
        state.set({ selectedIds: newIds, selectionBox: null });
      },
      getNextName(type: MapNodeType) {
        const prefix = `${type.charAt(0).toUpperCase()}${type.slice(1)} `;
        return `${prefix}${state.getNextSuffix(type, prefix)}`;
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
        if (state.selectedIds.size !== 1) return null;
        const [selectedId] = state.selectedIds;
        const result = findNode(state.elements, selectedId);
        return result?.node ?? null;
      },
      groupNode(nodeId: string) {
        const result = findNode(state.elements, nodeId);
        if (!result) return;

        const newGroup = state.create("group");
        newGroup.children.push(result.node);

        const parentArray = result.parent?.children ?? state.elements;
        const oldChildIndex = removeNodeFromParent(parentArray, nodeId);
        parentArray.splice(oldChildIndex, 0, newGroup);

        state.set({ selectedIds: new Set([newGroup.id]) });
      },
      groupSelected() {
        if (state.selectedIds.size === 0) return;
        let shallowest: ReturnType<typeof findNodeWithDepth> = null;
        for (const id of state.selectedIds) {
          const r = findNodeWithDepth(state.elements, id);
          if (r && (!shallowest || r.depth < shallowest.depth)) shallowest = r;
        }
        if (!shallowest) return;

        const newGroup = state.create("group");
        const insertArray = shallowest.parent?.children ?? state.elements;
        const insertIndex = insertArray.indexOf(shallowest.node);
        const seen = new Set<string>();

        for (const id of state.selectedIds) {
          if (seen.has(id)) continue;
          const result = findNode(state.elements, id);
          if (!result) continue;
          removeNodeFromParent(result.parent?.children ?? state.elements, id);
          newGroup.children.push(result.node);
          traverseElements([result.node], (el) => seen.add(el.id));
        }
        insertArray.splice(insertIndex, 0, newGroup);
        state.set({ selectedIds: new Set([newGroup.id]), selectionBox: null });
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
          insertNodeAt(
            srcResult.node,
            dstResult.parent?.children ?? state.elements,
            dstId,
            edge === "inside" ? "bottom" : edge,
          );
        }

        state.update();
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

      onSvgPointerDown(e) {
        const target = e.target as SVGElement;
        const resizeHandle = target.dataset.resizeHandle as ResizeHandle | undefined;
        const nodeId = target.dataset.nodeId;

        if (resizeHandle) {
          state.startResizeRect(e, resizeHandle);
        } else if (e.shiftKey && nodeId) {
          // Shift+click on item: toggle in selection
          const newSet = new Set(state.selectedIds);
          if (newSet.has(nodeId)) {
            newSet.delete(nodeId);
          } else {
            newSet.add(nodeId);
          }
          state.set({ selectedIds: newSet, selectionBox: null });
        } else if (e.shiftKey) {
          // Shift+drag on empty space: draw selection box
          state.startSelectionBox(e);
        } else {
          // Keep selection if clicking on already-selected item, otherwise select just this item
          if (nodeId && !state.selectedIds.has(nodeId)) {
            state.set({ selectedIds: new Set([nodeId]), selectionBox: null });
          } else if (!nodeId) {
            state.set({ selectedIds: new Set(), selectionBox: null });
          }
          if (nodeId) {
            state.startDragSelection(e);
          }
        }
      },
      startDragSelection(e) {
        e.stopPropagation();
        const svgPos = state.clientToSvg(e.clientX, e.clientY);
        // Collect start positions for all selected rects
        const startRects = new Map<string, { x: number; y: number }>();
        for (const id of state.selectedIds) {
          const result = findNode(state.elements, id);
          if (result?.node.type === "rect") {
            startRects.set(id, { x: result.node.rect.x, y: result.node.rect.y });
          }
        }
        if (startRects.size === 0) return;
        state.dragEl = {
          type: "move-selection",
          startSvg: svgPos,
          startRects,
        };
        (e.target as SVGElement).setPointerCapture(e.pointerId);
      },
      startResizeRect(e, handle) {
        if (state.selectedIds.size !== 1) return;
        const [selectedId] = state.selectedIds;
        const result = findNode(state.elements, selectedId);
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
      startSelectionBox(e) {
        e.stopPropagation();
        const svgPos = state.clientToSvg(e.clientX, e.clientY);
        const increment = 10;
        const snappedX = Math.floor(svgPos.x / increment) * increment;
        const snappedY = Math.floor(svgPos.y / increment) * increment;
        state.dragEl = {
          type: "selection-box",
          startSvg: { x: snappedX, y: snappedY },
        };
        state.set({
          selectionBox: { x: snappedX, y: snappedY, width: 0, height: 0 },
          selectedIds: new Set(),
        });
        (e.target as SVGElement).setPointerCapture(e.pointerId);
      },
      onSvgPointerMove(e) {
        if (!state.dragEl) return;
        e.stopPropagation();

        if (state.dragEl.type === "selection-box") {
          const svgPos = state.clientToSvg(e.clientX, e.clientY);
          const increment = 10;
          const { startSvg } = state.dragEl;
          const snappedX =
            svgPos.x - startSvg.x >= 0
              ? Math.ceil(svgPos.x / increment) * increment
              : Math.floor(svgPos.x / increment) * increment;
          const snappedY =
            svgPos.y - startSvg.y >= 0
              ? Math.ceil(svgPos.y / increment) * increment
              : Math.floor(svgPos.y / increment) * increment;
          state.set({
            selectionBox: {
              x: Math.min(startSvg.x, snappedX),
              y: Math.min(startSvg.y, snappedY),
              width: Math.abs(snappedX - startSvg.x),
              height: Math.abs(snappedY - startSvg.y),
            },
          });
          return;
        }

        const svgPos = state.clientToSvg(e.clientX, e.clientY);
        const dx = svgPos.x - state.dragEl.startSvg.x;
        const dy = svgPos.y - state.dragEl.startSvg.y;
        const increment = 10;

        if (state.dragEl.type === "move-selection") {
          for (const [id, startPos] of state.dragEl.startRects) {
            const result = findNode(state.elements, id);
            if (result?.node.type === "rect") {
              result.node.rect.x = Math.round((startPos.x + dx) / increment) * increment;
              result.node.rect.y = Math.round((startPos.y + dy) / increment) * increment;
            }
          }
        } else {
          if (state.selectedIds.size !== 1) return;
          const [selectedId] = state.selectedIds;
          const result = findNode(state.elements, selectedId);
          if (!result || result.node.type !== "rect") return;
          const { rect } = result.node;
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
            rect.width = Math.max(
              minSize,
              Math.round((startRect.width + dx) / increment) * increment,
            );
          }

          if (handle.includes("n")) {
            const newY = Math.round((startRect.y + dy) / increment) * increment;
            const newHeight = startRect.height + (startRect.y - newY);
            if (newHeight >= minSize) {
              rect.y = newY;
              rect.height = newHeight;
            }
          } else {
            rect.height = Math.max(
              minSize,
              Math.round((startRect.height + dy) / increment) * increment,
            );
          }
        }
        state.update();
      },
      onSvgPointerUp(e) {
        if (state.dragEl) {
          e.stopPropagation();
          (e.target as SVGElement).releasePointerCapture(e.pointerId);

          if (state.dragEl.type === "selection-box" && state.selectionBox) {
            const selectedIds = new Set<string>();
            const box = state.selectionBox;
            traverseElements(state.elements, (el) => {
              if (el.type === "rect") {
                const r = el.rect;
                // Check if rects intersect
                if (
                  r.x < box.x + box.width &&
                  r.x + r.width > box.x &&
                  r.y < box.y + box.height &&
                  r.y + r.height > box.y
                ) {
                  selectedIds.add(el.id);
                }
              }
            });
            state.set({ selectedIds });
          }

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
      const newZoom = Math.min(Math.max(state.zoom * delta, 0.25), 5);

      const scaleFactor = newZoom / state.zoom;
      const newPan = {
        x: mouseX - (mouseX - state.pan.x) * scaleFactor,
        y: mouseY - (mouseY - state.pan.y) * scaleFactor,
      };
      state.set({ pan: newPan, zoom: newZoom });
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (
        e.key === "r" &&
        state.selectionBox &&
        state.selectionBox.width > 0 &&
        state.selectionBox.height > 0
      ) {
        state.add("rect", { rect: state.selectionBox });
        state.set({ selectionBox: null });
      } else if (e.key === "d" && state.selectedIds.size > 0) {
        state.duplicateSelected();
      } else if (e.key === "g" && state.selectedIds.size > 0) {
        state.groupSelected();
      } else if (e.key === "Backspace" && state.selectedIds.size > 0) {
        state.deleteSelected();
      }
    };

    container.addEventListener("wheel", handleWheel, { passive: false });
    container.addEventListener("touchstart", state.onTouchStart, { passive: true });
    container.addEventListener("touchmove", state.onTouchMove, { passive: false });
    container.addEventListener("touchend", state.onTouchEnd);
    document.addEventListener("keyup", handleKeyUp);
    return () => {
      container.removeEventListener("wheel", handleWheel);
      container.removeEventListener("touchstart", state.onTouchStart);
      container.removeEventListener("touchmove", state.onTouchMove);
      container.removeEventListener("touchend", state.onTouchEnd);
      document.removeEventListener("keyup", handleKeyUp);
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
          "w-full h-full flex items-center justify-center overflow-hidden relative active:cursor-grabbing touch-none",
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

export type SelectionBox = {
  x: number;
  y: number;
  width: number;
  height: number;
};

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

  selectedIds: Set<string>;
  selectionBox: SelectionBox | null;
  editingId: string | null;
  asideWidth: number;
  lastAsideWidth: number;
  isResizing: boolean;
  elements: MapNode[];
  svgEl: SVGSVGElement | null;
  dragEl:
    | null
    | {
        type: "move-selection";
        startSvg: { x: number; y: number };
        startRects: Map<string, { x: number; y: number }>;
      }
    | {
        type: "resize-rect";
        handle: ResizeHandle;
        startSvg: { x: number; y: number };
        startRect: { x: number; y: number; width: number; height: number };
      }
    | {
        type: "selection-box";
        startSvg: { x: number; y: number };
      };

  startDragSelection: (e: React.PointerEvent<SVGSVGElement>) => void;
  startResizeRect: (e: React.PointerEvent<SVGSVGElement>, handle: ResizeHandle) => void;
  startSelectionBox: (e: React.PointerEvent<SVGSVGElement>) => void;

  onPanPointerDown: (e: PointerEvent<HTMLDivElement>) => void;
  onPanPointerMove: (e: PointerEvent<HTMLDivElement>) => void;
  onPanPointerUp: (e: PointerEvent<HTMLDivElement>) => void;
  onTouchStart: (e: TouchEvent) => void;
  onTouchMove: (e: TouchEvent) => void;
  onTouchEnd: () => void;
  onResizePointerDown: (e: PointerEvent<HTMLDivElement>) => void;
  onResizePointerMove: (e: globalThis.PointerEvent) => void;
  onResizePointerUp: () => void;
  onSelect: (id: string, opts?: { add?: boolean }) => void;
  onToggleVisibility: (id: string) => void;
  add: (type: MapNodeType, opts?: { selectedGroupParent?: boolean; rect?: SelectionBox }) => void;
  onRename: (id: string, newName: string) => void;
  onStartEdit: (id: string) => void;
  onCancelEdit: () => void;
  create: <T extends MapNodeType>(type: T) => MapNodeMap[T];
  getNextName: (type: MapNodeType) => string;
  getNextSuffix: (type: MapNodeType, prefix: string) => number;
  getSelectedNode: () => MapNode | null;
  groupNode: (id: string) => void;
  groupSelected: () => void;
  deleteSelected: () => void;
  cloneNode: (node: MapNode, seen: Set<string>) => MapNode;
  duplicateSelected: () => void;
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
