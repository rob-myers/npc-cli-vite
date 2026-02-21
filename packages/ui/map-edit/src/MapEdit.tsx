import { enableDragDropTouch } from "@dragdroptouch/drag-drop-touch";

enableDragDropTouch();

import { Menu } from "@base-ui/react/menu";
import { UiContext, uiClassName } from "@npc-cli/ui-sdk";
import { cn, type UseStateRef, useStateRef } from "@npc-cli/util";
import { tryLocalStorageGetParsed, tryLocalStorageSet } from "@npc-cli/util/legacy/generic";
import {
  CaretLeftIcon,
  CaretRightIcon,
  FolderIcon,
  PlusIcon,
  SquareIcon,
} from "@phosphor-icons/react";
import { type PointerEvent, useContext, useEffect } from "react";
import { useBeforeunload } from "react-beforeunload";
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

const localStorageKey = "map-edit-tree";

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
      undoStack: [] as HistoryEntry[],
      redoStack: [] as HistoryEntry[],

      svgEl: null,
      wrapperEl: null,
      dragEl: null,

      onPanPointerDown(e) {
        if (e.button === 0 && !state.isPinching) {
          (e.target as HTMLDivElement).setPointerCapture(e.pointerId);
          state.isPanning = true;
          state.lastPointerPos = { x: e.clientX, y: e.clientY };
        }
      },
      onPanPointerMove(e) {
        if (!state.isPanning || state.isPinching) return;
        const dx = e.clientX - state.lastPointerPos.x;
        const dy = e.clientY - state.lastPointerPos.y;
        state.lastPointerPos = { x: e.clientX, y: e.clientY };
        state.set({ pan: { x: state.pan.x + dx, y: state.pan.y + dy } });
      },
      onPanPointerUp(e) {
        (e.target as HTMLDivElement).releasePointerCapture(e.pointerId);
        state.isPanning = false;
      },

      onTouchStart(e) {
        if (e.touches.length !== 2) return;
        state.isPinching = true;
        state.isPanning = false;
        const [t0, t1] = [e.touches[0], e.touches[1]];
        state.lastTouchDist = Math.hypot(t1.clientX - t0.clientX, t1.clientY - t0.clientY);
        state.lastTouchMid = { x: (t0.clientX + t1.clientX) / 2, y: (t0.clientY + t1.clientY) / 2 };
      },
      onTouchMove(e) {
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

      onResizePointerDown(e) {
        e.preventDefault();
        e.stopPropagation();
        state.isResizing = true;
        state.firstPointerPos = { x: e.clientX, y: e.clientY };
        state.lastPointerPos = { x: e.clientX, y: e.clientY };
        document.body.addEventListener("pointermove", state.onResizePointerMove);
        document.body.addEventListener("pointerup", state.onResizePointerUp);
      },
      onResizePointerMove(e) {
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

      onSelect(id, opts) {
        state.pushHistory();
        const res = findNode(state.elements, id);
        if (!res) return;

        const current = new Set(opts?.shiftKey || opts?.metaKey ? state.selectedIds : []);

        if (opts?.metaKey) {
          current.add(id); // extend selection
          state.set({ selectedIds: current });
          return;
        }

        if (opts?.shiftKey && state.selectedIds.size > 0) {
          // select interval in flattened tree
          const flat: string[] = [];
          traverseElements(state.elements, (el) => flat.push(el.id));
          const i = flat.indexOf(id);
          const j = flat.findIndex((fid) => state.selectedIds.has(fid));
          if (i !== -1 && j !== -1) {
            for (let k = Math.min(i, j); k <= Math.max(i, j); k++) current.add(flat[k]);
            state.set({ selectedIds: current, selectionBox: null });
          }
          return;
        }

        if (res.node.type === "group") {
          // select (a) group and descendants, or (b) only group itself
          const descendantIds: string[] = [];
          traverseElements(res.node.children, (el) => descendantIds.push(el.id));
          const allDescendantsSelected = descendantIds.every((did) => state.selectedIds.has(did));

          if (state.selectedIds.has(id) && allDescendantsSelected && descendantIds.length > 0) {
            for (const did of descendantIds) current.delete(did);
            current.add(id);
          } else {
            current.add(id);
            for (const did of descendantIds) current.add(did);
          }
          state.set({ selectedIds: current, selectionBox: null });
          return;
        }

        // toggle selection
        current.has(id) ? current.delete(id) : current.add(id);
        state.set({ selectedIds: current, selectionBox: null });
      },
      onToggleVisibility(id) {
        state.set({
          elements: mapElements(state.elements, id, (el) => ({ ...el, visible: !el.visible })),
        });
      },

      clientToSvg(clientX, clientY) {
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
        state.pushHistory();
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
      cloneNode(node, seen) {
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
      create(type) {
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
        if (state.editingId) return;
        state.pushHistory();
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
        state.pushHistory();
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
      getNextName(type) {
        const prefix = `${type.charAt(0).toUpperCase()}${type.slice(1)} `;
        return `${prefix}${state.getNextSuffix(type, prefix)}`;
      },
      getNextSuffix(type, prefix) {
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
      groupSelected() {
        if (state.selectedIds.size === 0) return;
        state.pushHistory();
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
      moveNode(srcId, dstId, edge) {
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

      onRename(id, newName) {
        state.set({
          elements: mapElements(state.elements, id, (el) => ({ ...el, name: newName })),
          editingId: null,
        });
      },
      onStartEdit(id) {
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
          return;
        }

        if (!nodeId) {
          state.dragEl = null; // cancel any pending drag
          if (e.shiftKey) {
            // shift+drag empty space draws selection box
            state.startSelectionBox(e);
          } else {
            // clear
            state.set({ selectedIds: new Set(), selectionBox: null });
          }
          return;
        }

        if (e.shiftKey) {
          // Shift+click on item: toggle in selection
          const nextSel = new Set(state.selectedIds);
          nextSel.has(nodeId) ? nextSel.delete(nodeId) : nextSel.add(nodeId);
          state.set({ selectedIds: nextSel, selectionBox: null });
          return;
        }

        // Expand/contract selection
        if (!state.selectedIds.has(nodeId)) {
          state.set({ selectedIds: new Set([nodeId]), selectionBox: null });
        } else if (!nodeId) {
          state.set({ selectedIds: new Set(), selectionBox: null });
        }
        state.startDragSelection(e);
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
          for (const [id, startPos] of state.dragEl.starts) {
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
      startDragSelection(e) {
        e.stopPropagation();
        const svgPos = state.clientToSvg(e.clientX, e.clientY);

        /** Collect start positions for all selected rects */
        const starts = new Map(
          Array.from(state.selectedIds.values()).flatMap((id) => {
            const result = findNode(state.elements, id);
            return result?.node.type === "rect"
              ? [[id, { x: result.node.rect.x, y: result.node.rect.y }]]
              : [];
          }),
        );

        if (starts.size === 0) return;

        state.dragEl = { type: "move-selection", startSvg: svgPos, starts };
        (e.target as SVGElement).setPointerCapture(e.pointerId);
        state.set({ selectionBox: null });
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

      pushHistory() {
        state.undoStack.push({
          elements: JSON.parse(JSON.stringify(state.elements)),
          selectedIds: new Set(state.selectedIds),
        });
        state.redoStack.length = 0;
      },
      undo() {
        const entry = state.undoStack.pop();
        if (!entry) return;
        state.redoStack.push({
          elements: JSON.parse(JSON.stringify(state.elements)),
          selectedIds: new Set(state.selectedIds),
        });
        state.set({ elements: entry.elements, selectedIds: entry.selectedIds, selectionBox: null });
      },
      redo() {
        const entry = state.redoStack.pop();
        if (!entry) return;
        state.undoStack.push({
          elements: JSON.parse(JSON.stringify(state.elements)),
          selectedIds: new Set(state.selectedIds),
        });
        state.set({ elements: entry.elements, selectedIds: entry.selectedIds, selectionBox: null });
      },

      save() {
        tryLocalStorageSet(localStorageKey, JSON.stringify(state.elements));
      },
      load() {
        const elements = tryLocalStorageGetParsed<MapNode[]>(localStorageKey);
        if (elements) {
          state.set({ elements, selectedIds: new Set(), selectionBox: null });
        }
      },
    }),
  );

  useEffect(() => {
    state.load();
  }, []);

  useBeforeunload(() => {
    state.save();
  });

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
  }, [state.containerEl]);

  useEffect(() => {
    const wrapper = state.wrapperEl;
    if (!wrapper) return;

    const handleKeyUp = (e: KeyboardEvent) => {
      if (state.editingId || !wrapper.contains(e.target as Element)) return;
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

    const handleKeyDown = (e: KeyboardEvent) => {
      if (state.editingId || !wrapper.contains(e.target as Element)) return;
      if ((e.metaKey || e.ctrlKey) && e.key === "z" && !e.shiftKey) {
        e.preventDefault();
        state.undo();
      } else if ((e.metaKey || e.ctrlKey) && (e.key === "y" || (e.key === "z" && e.shiftKey))) {
        e.preventDefault();
        state.redo();
      } else if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault();
        state.save();
      }
    };

    document.addEventListener("keyup", handleKeyUp);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keyup", handleKeyUp);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [state.wrapperEl]);

  return (
    <div
      ref={state.ref("wrapperEl")}
      tabIndex={0}
      className="overflow-auto size-full flex justify-center items-start outline-none"
    >
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

        <div className={cn(uiClassName, "overflow-y-auto h-full custom-scrollbar bg-background")}>
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

export type SelectionBox = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type HistoryEntry = {
  elements: MapNode[];
  selectedIds: Set<string>;
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
  undoStack: HistoryEntry[];
  redoStack: HistoryEntry[];
  svgEl: SVGSVGElement | null;
  wrapperEl: HTMLDivElement | null;
  dragEl:
    | null
    | {
        type: "move-selection";
        startSvg: { x: number; y: number };
        starts: Map<string, { x: number; y: number }>;
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
  onSelect: (id: string, opts?: { shiftKey?: boolean; metaKey?: boolean }) => void;
  onToggleVisibility: (id: string) => void;
  add: (type: MapNodeType, opts?: { selectedGroupParent?: boolean; rect?: SelectionBox }) => void;
  onRename: (id: string, newName: string) => void;
  onStartEdit: (id: string) => void;
  onCancelEdit: () => void;
  create: <T extends MapNodeType>(type: T) => MapNodeMap[T];
  getNextName: (type: MapNodeType) => string;
  getNextSuffix: (type: MapNodeType, prefix: string) => number;
  getSelectedNode: () => MapNode | null;
  groupSelected: () => void;
  deleteSelected: () => void;
  pushHistory: () => void;
  undo: () => void;
  redo: () => void;
  cloneNode: (node: MapNode, seen: Set<string>) => MapNode;
  duplicateSelected: () => void;
  moveNode: (srcId: string, dstId: string, edge: "top" | "bottom" | "inside") => void;
  save: () => void;
  load: () => void;
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
