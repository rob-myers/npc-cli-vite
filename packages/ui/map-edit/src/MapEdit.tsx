import { enableDragDropTouch } from "@dragdroptouch/drag-drop-touch";

enableDragDropTouch();

import { Menu } from "@base-ui/react/menu";
import {
  type StarshipSymbolImageKey,
  type StarshipSymbolPngsMetadata,
  sguScalePngToSvgFactor,
} from "@npc-cli/media/starship-symbol";
import { UiContext, uiClassName } from "@npc-cli/ui-sdk";
import { cn, type UseStateRef, useStateRef } from "@npc-cli/util";
import { tryLocalStorageGetParsed, tryLocalStorageSet } from "@npc-cli/util/legacy/generic";
import {
  CaretLeftIcon,
  CaretRightIcon,
  CopyIcon,
  FloppyDiskIcon,
  FolderIcon,
  FolderOpenIcon,
  ImageIcon,
  ListIcon,
  SquareIcon,
  TrashIcon,
} from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { type PointerEvent, useContext, useEffect, useMemo } from "react";
import { useBeforeunload } from "react-beforeunload";
import { FileMenu } from "./FileMenu";
import { ImagePickerModal } from "./ImagePickerModal";
import { InspectorNode } from "./InspectorNode";
import { MapEditSvg } from "./MapEditSvg";
import {
  type BaseRect,
  baseSvgSize,
  findNode,
  findNodeWithDepth,
  getAllNodeIds,
  getNodeBounds,
  imageOffsetValues,
  insertNodeAt,
  labelledImageOffsetValue,
  type MapNode,
  type MapNodeMap,
  type MapNodeType,
  mapElements,
  recomputeImageCssTransform,
  removeNodeFromParent,
  type Transform,
  templateNodeByKey,
  traverseElements,
} from "./map-node-api";
import type { MapEditUiMeta } from "./schema";

export default function MapEdit(props: { meta: MapEditUiMeta }) {
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
      elements: emptyElements,
      undoStack: [] as HistoryEntry[],
      redoStack: [] as HistoryEntry[],

      svgEl: null,
      wrapperEl: null,
      dragEl: null,

      pngsMetadata: null,
      pickImageForId: null,

      currentFilename:
        tryLocalStorageGetParsed<Record<string, string>>(localStorageUiIdToFilenameKey)?.[
          props.meta.id
        ] ?? "symbol/untitled",
      isDirty: false,
      savedFiles: getSavedFilenames(),

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

      onResizeInspectorPointerDown(e) {
        e.preventDefault();
        e.stopPropagation();
        state.isResizing = true;
        state.firstPointerPos = { x: e.clientX, y: e.clientY };
        state.lastPointerPos = { x: e.clientX, y: e.clientY };
        document.body.addEventListener("pointermove", state.onResizeInspectorPointerMove);
        document.body.addEventListener("pointerup", state.onResizeInspectorPointerUp);
      },
      onResizeInspectorPointerMove(e) {
        const dx = e.clientX - state.lastPointerPos.x;
        state.lastPointerPos = { x: e.clientX, y: e.clientY };
        state.set({
          asideWidth: Math.max(minAsideWidth, Math.min(maxAsideWidth, state.asideWidth + dx)),
        });
      },
      onResizeInspectorPointerUp() {
        state.isResizing = false;
        document.body.removeEventListener("pointermove", state.onResizeInspectorPointerMove);
        document.body.removeEventListener("pointerup", state.onResizeInspectorPointerUp);
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
        const vbW = baseSvgSize / state.zoom;
        const vbH = baseSvgSize / state.zoom;
        const vbX = (baseSvgSize - vbW) / 2 - state.pan.x / state.zoom;
        const vbY = (baseSvgSize - vbH) / 2 - state.pan.y / state.zoom;

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

      add(type, { selectionAsParent, rect } = {}) {
        if (!state.svgEl) return;

        state.pushHistory();
        const selection = selectionAsParent ? state.getSelectedNode() : null;
        const parent = selection?.type === "group" ? selection : null;
        const newItem = state.create(type);

        if ("baseRect" in newItem) {
          if (rect) {
            // Use selection box dimensions
            newItem.transform = { x: rect.x, y: rect.y, scale: 1, degrees: 0 };
            newItem.baseRect = { width: rect.width, height: rect.height };
          } else {
            // Place new item centered in viewport
            // newItem.transform = { x: 0, y: 0, dx: 0, dy: 0, scale: 1 };
            const svgRect = state.svgEl.getBoundingClientRect();
            const center = state.clientToSvg(
              svgRect.x + svgRect.width / 2,
              svgRect.y + svgRect.height / 2,
            );
            newItem.transform = {
              ...newItem.transform,
              x: center.x - (newItem.baseRect.width * newItem.transform.scale) / 2,
              y: center.y - (newItem.baseRect.height * newItem.transform.scale) / 2,
            };
          }
        }

        if (!parent) {
          state.set({
            elements: [...state.elements, newItem],
            selectedIds: new Set([newItem.id]),
            editingId: newItem.type === "image" ? null : newItem.id,
            pickImageForId: newItem.type === "image" ? newItem.id : null,
          });
        } else {
          parent.children.push(newItem);
          state.set({
            selectedIds: new Set([newItem.id]),
            pickImageForId: newItem.type === "image" ? newItem.id : null,
          });
        }
      },
      cloneNode(node, seenDuringClone) {
        seenDuringClone?.add(node.id);
        const baseProps = {
          id: crypto.randomUUID(),
          name: state.getNextName(node.type, `${node.name.split(" ")[0]} `),
          locked: node.locked,
          visible: node.visible,
          transform: { ...node.transform },
        };
        if (node.type === "group") {
          return {
            ...baseProps,
            type: "group" as const,
            children: node.children.map((c) => state.cloneNode(c, seenDuringClone)),
          };
        }
        if (node.type === "rect") {
          return {
            ...baseProps,
            type: "rect" as const,
            baseRect: { ...node.baseRect },
          };
        }
        if (node.type === "image") {
          return {
            ...baseProps,
            type: "image" as const,
            imageKey: node.imageKey,
            baseRect: { ...node.baseRect },
            offset: { ...node.offset },
            cssTransform: recomputeImageCssTransform(node),
          };
        }
        return { ...baseProps, type: node.type } as MapNode;
      },
      create(type) {
        const templateNode = templateNodeByKey[type];
        return {
          ...templateNode,
          id: crypto.randomUUID(),
          name: state.getNextName(type),
          visible: true,
          locked: false,
          // 🔔 deep objects must be fresh
          transform: { ...templateNode.transform },
          ...("children" in templateNode && { children: [...templateNode.children] }),
          ...("baseRect" in templateNode && { baseRect: { ...templateNode.baseRect } }),
          ...("offset" in templateNode && { offset: { ...templateNode.offset } }),
        };
      },
      delete(nodeIds) {
        for (const id of nodeIds) {
          const result = findNode(state.elements, id);
          if (result) {
            removeNodeFromParent(result.parent?.children ?? state.elements, id);
          }
        }
      },
      deleteSelected() {
        if (state.selectedIds.size === 0) return;
        if (state.editingId) return;
        state.pushHistory();
        state.delete(Array.from(state.selectedIds));
        state.set({ selectedIds: new Set(), selectionBox: null });
      },
      duplicate(rootNodeId, seenDuringClone) {
        const result = findNode(state.elements, rootNodeId);
        if (!result) return null;
        const clone = state.cloneNode(result.node, seenDuringClone);
        state.elements.push(clone);
        return clone;
      },
      duplicateSelected() {
        if (state.selectedIds.size === 0) return;
        state.pushHistory();
        const seenDuringClone = new Set<string>();
        const duplicatedIds = new Set<string>();
        for (const id of state.selectedIds) {
          if (seenDuringClone.has(id)) continue;
          const clone = state.duplicate(id, seenDuringClone);
          if (clone) getAllNodeIds([clone]).forEach((id) => duplicatedIds.add(id));
        }
        state.set({ selectedIds: duplicatedIds, selectionBox: null });
      },
      rotate(nodeId, degrees) {
        const result = findNode(state.elements, nodeId);
        if (result?.node.type !== "image") return;
        const node = result.node;
        const current = node.transform.degrees ?? 0;
        const nextDegrees = (current + degrees) % 360;
        node.transform.degrees = nextDegrees < 0 ? nextDegrees + 360 : nextDegrees;
        recomputeImageCssTransform(node);
      },
      rotateSelected(degrees) {
        if (state.selectedIds.size === 0) return;
        state.pushHistory();
        for (const id of state.selectedIds) state.rotate(id, degrees);
        state.update();
      },
      getNextName(type, prefix = `${type.charAt(0).toUpperCase()}${type.slice(1)} `) {
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
      setImageKey(nodeId, imageKey) {
        state.set({ pickImageForId: null });

        const { node } = findNode(state.elements, nodeId) ?? {};
        const meta = state.pngsMetadata?.byKey[imageKey];
        if (!(node?.type === "image" && meta)) return;

        node.imageKey = imageKey;

        const scaleFactor = sguScalePngToSvgFactor;
        node.offset.x = labelledImageOffsetValue.halfLineWidth;
        node.offset.y = labelledImageOffsetValue.halfLineWidth;

        // scale down so 1 sgu ~ 60px
        node.baseRect.width = meta.width * scaleFactor;
        node.baseRect.height = meta.height * scaleFactor;
        recomputeImageCssTransform(node);

        if (node.name.match(/^(Image \d+)$/)) {
          node.name = state.getNextName("image", `${imageKey} `);
        }

        state.update();
      },

      onSvgPointerDown(e) {
        const target = e.target as SVGElement;
        const resizeHandle = target.dataset.resizeHandle as ResizeHandle | undefined;
        const nodeId = target.dataset.nodeId;

        if (resizeHandle) {
          state.pushHistory();
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

        if (state.dragEl.type === "move-selection") {
          for (const [id, startPos] of state.dragEl.starts) {
            const result = findNode(state.elements, id);
            if (result?.node.type === "rect" || result?.node.type === "image") {
              const node = result.node;
              node.transform.x = Math.round((startPos.x + dx) / increment) * increment;
              node.transform.y = Math.round((startPos.y + dy) / increment) * increment;
              if (node.type === "image") {
                recomputeImageCssTransform(node);
              }
            }
          }
          state.update();
          return;
        }

        if (state.selectedIds.size !== 1) return;
        const [selectedId] = state.selectedIds;
        const result = findNode(state.elements, selectedId);
        if (result?.node.type !== "rect") return;

        // scale a single rect
        const { transform, baseRect } = result.node;
        const { handle, startTransform, startBounds } = state.dragEl;
        const isW = handle.includes("w");
        const isN = handle.includes("n");

        const widthDelta = isW ? -dx : dx;
        const heightDelta = isN ? -dy : dy;

        const newWidth = snap(Math.max(increment, startBounds.width + widthDelta));
        const newHeight = snap(Math.max(increment, startBounds.height + heightDelta));
        baseRect.width = newWidth;
        baseRect.height = newHeight;
        transform.scale = 1;
        transform.x = isW ? snap(startBounds.x + startBounds.width - newWidth) : startTransform.x;
        transform.y = isN ? snap(startBounds.y + startBounds.height - newHeight) : startTransform.y;

        state.update();
      },
      onSvgPointerUp(e) {
        if (!state.dragEl) return;
        e.stopPropagation();

        (e.target as SVGElement).releasePointerCapture(e.pointerId);

        if (state.dragEl.type === "selection-box" && state.selectionBox) {
          const selectedIds = new Set<string>();
          const box = state.selectionBox;
          traverseElements(state.elements, (el) => {
            if (el.type === "rect" || el.type === "image") {
              const r = getNodeBounds(el);
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
        state.pushHistory();
      },
      startDragSelection(e) {
        e.stopPropagation();
        const svgPos = state.clientToSvg(e.clientX, e.clientY);

        /** Collect start positions for all selected rects */
        const starts = new Map(
          Array.from(state.selectedIds.values()).flatMap((id) => {
            const result = findNode(state.elements, id);
            return result?.node.type === "rect" || result?.node.type === "image"
              ? [[id, { x: result.node.transform.x, y: result.node.transform.y }]]
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
        if (result?.node.type !== "rect" && result?.node.type !== "image") return;
        e.stopPropagation();
        const svgPos = state.clientToSvg(e.clientX, e.clientY);
        const { transform, baseRect } = result.node;
        const bounds = getNodeBounds(result.node);
        state.dragEl = {
          type: "resize-rect",
          handle,
          startSvg: svgPos,
          startTransform: { ...transform },
          startBounds: bounds,
          baseRect: { ...baseRect },
        };
        (e.target as SVGElement).setPointerCapture(e.pointerId);
      },
      startSelectionBox(e) {
        e.stopPropagation();
        const svgPos = state.clientToSvg(e.clientX, e.clientY);

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
        const elementsJson = JSON.stringify(state.elements);
        const prev = state.undoStack.at(-1)?.elements;
        if (prev === elementsJson) return;

        state.isDirty = true;
        state.undoStack.push({ elements: elementsJson, selectedIds: new Set(state.selectedIds) });
        state.redoStack.length = 0;
        state.update();
      },
      undo() {
        const entry = state.undoStack.pop();
        if (!entry) return;
        state.redoStack.push({
          elements: JSON.stringify(state.elements),
          selectedIds: new Set(state.selectedIds),
        });
        state.set({
          elements: JSON.parse(entry.elements) as MapNode[],
          selectedIds: entry.selectedIds,
          selectionBox: null,
        });
      },
      redo() {
        const entry = state.redoStack.pop();
        if (!entry) return;
        state.undoStack.push({
          elements: JSON.stringify(state.elements),
          selectedIds: new Set(state.selectedIds),
        });
        state.set({
          elements: JSON.parse(entry.elements) as MapNode[],
          selectedIds: entry.selectedIds,
          selectionBox: null,
        });
      },

      save(filename = state.currentFilename) {
        // save to local storage
        tryLocalStorageSet(`${localStoragePrefix}${filename}`, JSON.stringify(state.elements));
        // save current filename for this instance of MapEdit
        tryLocalStorageSet(
          localStorageUiIdToFilenameKey,
          JSON.stringify({
            ...tryLocalStorageGetParsed<Record<string, string>>(localStorageUiIdToFilenameKey),
            [props.meta.id]: filename,
          }),
        );
        state.set({ currentFilename: filename, savedFiles: getSavedFilenames(), isDirty: false });

        // save to filesystem in development
        if (import.meta.env.DEV) {
          fetch(`/api/map-edit/file/${encodeURIComponent(filename)}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ content: state.elements }),
          }).catch(console.error);
        }
      },
      async load(filename?: string) {
        if (state.isDirty && !confirm("You have unsaved changes. Discard and load?")) {
          return;
        }
        const name = filename ?? state.currentFilename;
        let elements = tryLocalStorageGetParsed<MapNode[]>(`${localStoragePrefix}${name}`);
        // Try loading from filesystem in development if not in localStorage
        if (!elements && import.meta.env.DEV) {
          try {
            const res = await fetch(`/api/map-edit/file/${encodeURIComponent(name)}`);
            if (res.ok) {
              const data = await res.json();
              elements = data.content;
            }
          } catch {
            // ignore
          }
        }
        if (elements) {
          state.set({
            elements,
            selectedIds: new Set(),
            selectionBox: null,
            currentFilename: name,
            undoStack: [],
            redoStack: [],
            isDirty: false,
          });
        }
      },
      deleteFile(filename: string) {
        localStorage.removeItem(`${localStoragePrefix}${filename}`);
        state.set({ savedFiles: getSavedFilenames().filter((x) => x !== filename) });

        // delete from filesystem in development
        if (import.meta.env.DEV) {
          fetch(`/api/map-edit/file/${encodeURIComponent(filename)}`, {
            method: "DELETE",
          }).catch(console.error);
        }
      },
      async mergeFilesFromFilesystem() {
        try {
          const { files } = (await fetch("/api/map-edit/files").then((x) => x.json())) as {
            files: string[];
          };
          state.set({ savedFiles: [...new Set([...state.savedFiles, ...files])].sort() });
        } catch (error) {
          console.error(error);
        }
      },
    }),
  );

  useEffect(() => {
    if (state.elements === emptyElements) {
      state.load();
      import.meta.env.DEV && void state.mergeFilesFromFilesystem();
    }
  }, []);

  state.pngsMetadata = useQuery({
    queryKey: ["map-edit-images-metadata"],
    queryFn: async () => await fetch("/starship-symbol/metadata.json").then((x) => x.json()),
  }).data;

  // Pointer events
  useEffect(() => {
    const container = state.containerEl;
    if (!container) return;

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = container.getBoundingClientRect();

      // Account for preserveAspectRatio="xMidYMid meet" letterboxing
      const renderSize = Math.min(rect.width, rect.height);
      const offsetX = (rect.width - renderSize) / 2;
      const offsetY = (rect.height - renderSize) / 2;

      // Mouse position relative to the rendered SVG center, scaled to pan coordinate system
      const scale = baseSvgSize / renderSize;
      const mouseX = (e.clientX - rect.left - offsetX - renderSize / 2) * scale;
      const mouseY = (e.clientY - rect.top - offsetY - renderSize / 2) * scale;

      const delta = e.deltaY > 0 ? 1 - zoomDelta : 1 + zoomDelta;
      const newZoom = Math.min(Math.max(state.zoom * delta, minZoomScale), maxZoomScale);

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

  // Key events
  useEffect(() => {
    const wrapper = state.wrapperEl;
    if (!wrapper) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (state.editingId || !wrapper.contains(e.target as Element)) return;

      if (e.key in keyShouldPreventDefault) e.preventDefault();

      if (e.key === "Backspace") {
        if (state.selectedIds.size > 0) state.deleteSelected();
        state.wrapperEl?.focus();
        return;
      }

      if (e.key === "r" && !e.metaKey) {
        e.preventDefault();
        if (state.selectionBox && state.selectionBox.width > 0 && state.selectionBox.height > 0) {
          state.add("rect", { rect: state.selectionBox });
          state.set({ selectionBox: null });
        }
        return;
      }

      if (e.key === "e" || e.key === "q") {
        if (state.selectedIds.size > 0) state.rotateSelected(e.key === "e" ? 90 : -90);
        return;
      }

      const modified = e.metaKey || e.ctrlKey;
      if (!modified) return;

      if (e.key === "z" && !e.shiftKey) {
        state.undo();
      } else if (e.key === "y" || (e.key === "z" && e.shiftKey)) {
        state.redo();
      } else if (e.key === "s") {
        state.save();
      } else if (e.key === "g") {
        state.selectedIds.size > 0 && state.groupSelected();
      } else if (e.key === "d") {
        state.selectedIds.size > 0 && state.duplicateSelected();
      } else if (e.key === "i") {
        state.add("image", { selectionAsParent: true });
      } else if (e.key === "a") {
        state.set({ selectedIds: getAllNodeIds(state.elements) });
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [state.wrapperEl]);

  useBeforeunload(() => state.save());

  const selectedImageNode = useMemo(() => {
    if (state.selectedIds.size !== 1) return null;
    const [id] = state.selectedIds;
    const result = findNode(state.elements, id);
    return result?.node.type === "image" ? result.node : null;
  }, [state.selectedIds, state.elements]);

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
        <div className="grid grid-cols-[1fr_auto] gap-1 items-center px-3 py-2 border-b border-slate-800 bg-slate-900/20">
          <FileMenu state={state} />
          <Menu.Root>
            <Menu.Trigger
              className={cn(
                uiClassName,
                "cursor-pointer text-slate-300",
                "hover:text-slate-300 transition-colors",
              )}
            >
              <ListIcon className="size-5.5 p-0.5 bg-slate-700 border border-white/10" />
            </Menu.Trigger>

            <Menu.Portal>
              <Menu.Positioner className="z-50" sideOffset={4} align="start">
                <Menu.Popup className="bg-slate-800 border border-slate-700 rounded-md shadow-lg py-1 min-w-[120px]">
                  {state.selectedIds.size > 0 && (
                    <>
                      <div className="my-1 border-t border-slate-700" />
                      <Menu.Item
                        className="flex items-center gap-2 px-2 py-1 text-xs text-slate-300 hover:bg-slate-700 cursor-pointer"
                        closeOnClick
                        onClick={() => state.duplicateSelected()}
                      >
                        <CopyIcon className="size-4" />
                        Duplicate
                      </Menu.Item>
                      <Menu.Item
                        className="flex items-center gap-2 px-2 py-1 text-xs text-red-400 hover:bg-slate-700 cursor-pointer"
                        closeOnClick
                        onClick={() => state.deleteSelected()}
                      >
                        <TrashIcon className="size-4" />
                        Delete
                      </Menu.Item>
                    </>
                  )}
                  <div className="my-1 border-t border-slate-700" />

                  <Menu.Item
                    className="flex items-center gap-2 px-2 py-1 text-xs text-slate-300 hover:bg-slate-700 cursor-pointer"
                    closeOnClick
                    onClick={() => {
                      state.add("group", { selectionAsParent: true });
                    }}
                  >
                    <FolderIcon className="size-4" />
                    Group
                  </Menu.Item>
                  <Menu.Item
                    className="flex items-center gap-2 px-2 py-1 text-xs text-slate-300 hover:bg-slate-700 cursor-pointer"
                    closeOnClick
                    onClick={() => {
                      state.add("rect", { selectionAsParent: true });
                    }}
                  >
                    <SquareIcon className="size-4" />
                    Rect
                  </Menu.Item>
                  <Menu.Item
                    className="flex items-center gap-2 px-2 py-1 text-xs text-slate-300 hover:bg-slate-700 cursor-pointer"
                    closeOnClick
                    onClick={() => {
                      state.add("image", { selectionAsParent: true });
                    }}
                  >
                    <ImageIcon className="size-4" />
                    Image
                  </Menu.Item>

                  <div className="my-1 border-t border-slate-700" />

                  <Menu.Item
                    className="flex items-center gap-2 px-2 py-1 text-xs text-slate-300 hover:bg-slate-700 cursor-pointer"
                    closeOnClick
                    onClick={() => state.save()}
                  >
                    <FloppyDiskIcon className="size-4" />
                    Save
                  </Menu.Item>

                  <Menu.SubmenuRoot>
                    <Menu.SubmenuTrigger className="flex items-center gap-2 px-2 py-1 text-xs text-slate-300 hover:bg-slate-700 cursor-pointer w-full">
                      <FolderOpenIcon className="size-4" />
                      Open
                    </Menu.SubmenuTrigger>
                    <Menu.Portal>
                      <Menu.Positioner className="z-50" sideOffset={4}>
                        <Menu.Popup className="bg-slate-800 border border-slate-700 rounded-md shadow-lg py-1 min-w-40 max-h-[300px] overflow-y-auto">
                          {state.savedFiles.length === 0 ? (
                            <div className="px-3 py-2 text-xs text-slate-500 italic">
                              No saved files
                            </div>
                          ) : (
                            state.savedFiles.map((file) => (
                              <Menu.Item
                                key={file}
                                className="flex items-center justify-between gap-2 px-2 py-1 text-xs text-slate-300 hover:bg-slate-700 cursor-pointer group"
                                closeOnClick
                                onClick={() => state.load(file)}
                              >
                                <span className="truncate">{file}</span>
                                <button
                                  className="opacity-0 group-hover:opacity-100 p-0.5 hover:text-red-400"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    if (confirm(`Delete "${file}"?`)) {
                                      state.deleteFile(file);
                                    }
                                  }}
                                >
                                  <TrashIcon className="size-3" />
                                </button>
                              </Menu.Item>
                            ))
                          )}
                        </Menu.Popup>
                      </Menu.Positioner>
                    </Menu.Portal>
                  </Menu.SubmenuRoot>
                </Menu.Popup>
              </Menu.Positioner>
            </Menu.Portal>
          </Menu.Root>
        </div>

        <div className={cn(uiClassName, "h-full bg-background")}>
          {state.elements.map((el) => (
            <InspectorNode key={el.id} element={el} level={0} root={state} />
          ))}
        </div>

        {selectedImageNode && (
          <SelectedImageNodeUI selectedImageNode={selectedImageNode} state={state} />
        )}

        <InspectorResizer state={state} />
      </aside>

      <div
        ref={state.ref("containerEl")}
        className={cn(
          "w-full h-full flex items-center justify-center overflow-hidden cursor-grab active:cursor-grabbing touch-none",
          theme === "dark" ? "bg-gray-700/30" : "bg-white",
        )}
        onPointerDown={state.onPanPointerDown}
        onPointerMove={state.onPanPointerMove}
        onPointerUp={state.onPanPointerUp}
      >
        <MapEditSvg root={state} />
      </div>

      <ImagePickerModal
        open={state.pickImageForId !== null}
        onOpenChange={(open) => {
          if (!open) {
            state.pickImageForId && state.delete([state.pickImageForId]);
            state.set({ pickImageForId: null });
          }
        }}
        onSelect={(imageKey) => {
          if (state.pickImageForId) {
            state.setImageKey(state.pickImageForId, imageKey);
          }
        }}
      />
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
  /** `MapNode[]` */
  elements: string;
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
        startTransform: Transform;
        startBounds: { x: number; y: number; width: number; height: number };
        baseRect: BaseRect;
      }
    | {
        type: "selection-box";
        startSvg: { x: number; y: number };
      };
  pngsMetadata: StarshipSymbolPngsMetadata | null;
  pickImageForId: string | null;

  currentFilename: string;
  isDirty: boolean;
  savedFiles: string[];

  startDragSelection: (e: React.PointerEvent<SVGSVGElement>) => void;
  startResizeRect: (e: React.PointerEvent<SVGSVGElement>, handle: ResizeHandle) => void;
  startSelectionBox: (e: React.PointerEvent<SVGSVGElement>) => void;

  onPanPointerDown: (e: PointerEvent<HTMLDivElement>) => void;
  onPanPointerMove: (e: PointerEvent<HTMLDivElement>) => void;
  onPanPointerUp: (e: PointerEvent<HTMLDivElement>) => void;
  onTouchStart: (e: TouchEvent) => void;
  onTouchMove: (e: TouchEvent) => void;
  onTouchEnd: () => void;
  onResizeInspectorPointerDown: (e: PointerEvent<HTMLDivElement>) => void;
  onResizeInspectorPointerMove: (e: globalThis.PointerEvent) => void;
  onResizeInspectorPointerUp: () => void;
  onSelect: (id: string, opts?: { shiftKey?: boolean; metaKey?: boolean }) => void;
  onToggleVisibility: (id: string) => void;
  add: (type: MapNodeType, opts?: { selectionAsParent?: boolean; rect?: SelectionBox }) => void;
  onRename: (id: string, newName: string) => void;
  onStartEdit: (id: string) => void;
  onCancelEdit: () => void;
  setImageKey: (nodeId: string, imageKey: StarshipSymbolImageKey) => void;
  create: <T extends MapNodeType>(type: T) => MapNodeMap[T];
  getNextName: (type: MapNodeType, prefix?: string) => string;
  getNextSuffix: (type: MapNodeType, prefix: string) => number;
  getSelectedNode: () => MapNode | null;
  groupSelected: () => void;
  /** Must manually update state to see changes. */
  delete: (nodeIds: string[]) => void;
  deleteSelected: () => void;
  pushHistory: () => void;
  undo: () => void;
  redo: () => void;
  cloneNode: (node: MapNode, seenDuringClone?: Set<string>) => MapNode;
  /** Must manually update state to see changes. */
  duplicate: (rootNodeId: string, seenDuringClone?: Set<string>) => MapNode | null;
  duplicateSelected: () => void;
  rotate: (nodeId: string, degrees: -90 | 90) => void;
  rotateSelected: (degrees: -90 | 90) => void;
  moveNode: (srcId: string, dstId: string, edge: "top" | "bottom" | "inside") => void;
  save: (filename?: string) => void;
  load: (filename?: string) => Promise<void>;
  deleteFile: (filename: string) => void;
  mergeFilesFromFilesystem: () => void;
  clientToSvg: (clientX: number, clientY: number) => { x: number; y: number };
  onSvgPointerDown: (e: React.PointerEvent<SVGSVGElement>) => void;
  onSvgPointerMove: (e: React.PointerEvent<SVGSVGElement>) => void;
  onSvgPointerUp: (e: React.PointerEvent<SVGSVGElement>) => void;
};

function SelectedImageNodeUI({
  selectedImageNode,
  state,
}: {
  selectedImageNode: Extract<MapNode, { type: "image" }>;
  state: UseStateRef<State>;
}) {
  return (
    <div
      className={cn(
        uiClassName,
        "overflow-auto flex items-center gap-1 px-2 py-1 border-t border-slate-700/50 text-xs",
      )}
    >
      <label className="flex h-6">
        <div className="flex items-center px-1 border border-white/30 border-r-0 rounded rounded-r-none bg-black">
          dx
        </div>
        <select
          className="px-1 bg-slate-700 border border-slate-600 text-slate-200 text-xs"
          title="dx"
          value={selectedImageNode.offset.x}
          onChange={(e) => {
            selectedImageNode.offset.x = Number(e.target.value) || 0;
            recomputeImageCssTransform(selectedImageNode);
            state.update();
          }}
        >
          {imageOffsetValues.map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
      </label>
      <label className="flex h-6">
        <div className="flex items-center px-1 border border-white/30 border-r-0 rounded rounded-r-none bg-black">
          dy
        </div>
        <select
          className="px-1 bg-slate-700 border border-slate-600 text-slate-200 text-xs"
          title="dy"
          value={selectedImageNode.offset.y}
          onChange={(e) => {
            selectedImageNode.offset.y = Number(e.target.value) || 0;
            recomputeImageCssTransform(selectedImageNode);
            state.update();
          }}
        >
          {imageOffsetValues.map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
      </label>
    </div>
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
      onPointerDown={state.onResizeInspectorPointerDown}
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

const emptyElements = [] as MapNode[];
const localStoragePrefix = "map-edit:";
const localStorageUiIdToFilenameKey = "map-edit-to-current-filename";

function getSavedFilenames(): string[] {
  const files: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key?.startsWith(localStoragePrefix)) {
      files.push(key.slice(localStoragePrefix.length));
    }
  }
  return files.sort();
}

const minAsideWidth = 0;
const maxAsideWidth = 300;
const defaultAsideWidth = 192;
const zoomDelta = 0.04;
const minZoomScale = 0.5;
const maxZoomScale = 20;

export type ResizeHandle = "nw" | "ne" | "sw" | "se";

const increment = 10;
const snap = (v: number) => Math.round(v / increment) * increment;

/**
    - d: Duplicate
    - g: Group
    - r: Redo
    - s: Save
    - y: Undo
    - z: Undo
    */
const keyShouldPreventDefault = {
  a: true,
  d: true,
  g: true,
  i: true,
  // r: true,
  s: true,
  y: true,
  z: true,
} as const;
