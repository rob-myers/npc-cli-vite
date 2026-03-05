import { enableDragDropTouch } from "@dragdroptouch/drag-drop-touch";

enableDragDropTouch();

import {
  type StarshipSymbolImageKey,
  type StarshipSymbolPngsManifest,
  StarshipSymbolPngsManifestSchema,
  sguScalePngToSvgFactor,
} from "@npc-cli/media/starship-symbol";
import { type ThemeName, UiContext, uiClassName } from "@npc-cli/ui-sdk";
import { cn, ExhaustiveError, type UseStateRef, useStateRef } from "@npc-cli/util";
import { fetchParsed } from "@npc-cli/util/fetch-parsed";
import { isTouchDevice } from "@npc-cli/util/legacy/dom";
import { tryLocalStorageGetParsed, tryLocalStorageSet, warn } from "@npc-cli/util/legacy/generic";
import { CaretLeftIcon, CaretRightIcon } from "@phosphor-icons/react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { type PointerEvent, useContext, useEffect, useMemo } from "react";
import { useBeforeunload } from "react-beforeunload";

import { FileMenu } from "./FileMenu";
import { ImagePickerModal } from "./ImagePickerModal";
import { InspectorNode } from "./InspectorNode";
import { MainMenu } from "./MainMenu";
import { MapEditSvg } from "./MapEditSvg";
import {
  areFileSpecifiersEqual,
  type BaseRect,
  baseSvgSize,
  computeNodeCssTransform,
  extendCurrentFileSpecifierMapping,
  findNode,
  findNodeWithDepth,
  getAllNodeIds,
  getFileSpecifierLocalStorageKey,
  getLocalStorageSavedFiles,
  getNodeBounds,
  imageOffsetValues,
  insertNodeAt,
  LOCAL_STORAGE_UI_ID_TO_FILE_SPECIFIER,
  labelledImageOffsetValue,
  type MapEditFileSpecifier,
  type MapEditSavedFile,
  MapEditSavedFileSchema,
  type MapNode,
  type MapNodeMap,
  type MapNodeType,
  type MapsManifest,
  MapsManifestSchema,
  mapNodes,
  removeNodeFromParent,
  type SymbolsManifest,
  SymbolsManifestSchema,
  type Transform,
  templateNodeByKey,
  traverseNodesSync,
} from "./map-node-api";
import type { MapEditUiMeta } from "./schema";

const CAN_SAVE_TO_FILESYSTEM_IN_DEV = true;

export default function MapEdit(props: { meta: MapEditUiMeta }) {
  const { theme } = useContext(UiContext);

  const { mutateAsync: loadMapEditFile } = useMutation({
    mutationKey: ["map-edit-load"],
    async mutationFn(file: MapEditFileSpecifier) {
      return fetchParsed(`/${file.type}/${file.filename}`, MapEditSavedFileSchema);
    },
  });

  const { mutateAsync: deleteMapEditFile } = useMutation({
    mutationKey: ["map-edit-delete"],
    async mutationFn(file: MapEditFileSpecifier) {
      await fetch(`/api/map-edit/file/${file.type}/${file.filename}`, {
        method: "DELETE",
      });
    },
    onSuccess(_data, _vars, _onMutateResult, context) {
      context.client.invalidateQueries({ exact: true, queryKey: ["map-edit-manifests"] });
    },
  });

  const state = useStateRef(
    (): State => ({
      theme,

      isPanning: false,
      isPinching: false,
      pan: { x: baseSvgSize, y: 1.25 * baseSvgSize },
      zoom: 3,
      firstPointerPos: { x: 0, y: 0 },
      lastPointerPos: { x: 0, y: 0 },
      lastTouchDist: 0,
      lastTouchMid: { x: 0, y: 0 },

      svgWidth: baseSvgSize,
      svgHeight: baseSvgSize,

      nodes: emptyNodes,
      selectedIds: new Set<string>(),
      selectionBox: null as SelectionBox | null,
      editingId: null,
      asideWidth: defaultAsideWidth,
      lastAsideWidth: defaultAsideWidth,
      isResizing: false,
      isAsideCollapsed: false,
      undoStack: [] as HistoryEntry[],
      redoStack: [] as HistoryEntry[],

      containerEl: null,
      dragEl: null,
      svgEl: null,
      wrapperEl: null,

      mapsManifest: null,
      pngsManifest: null,
      pickImageForId: null,
      symbolsManifest: null,

      currentFile: tryLocalStorageGetParsed<{ [uiId: string]: MapEditFileSpecifier }>(
        LOCAL_STORAGE_UI_ID_TO_FILE_SPECIFIER,
      )?.[props.meta.id] ?? {
        type: "symbol",
        filename: "untitled.json",
      },
      isDirty: false,

      // will extend with symbol/manifest.json
      savedFileSpecifiers: getLocalStorageSavedFiles(),

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
        const res = findNode(state.nodes, id);
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
          traverseNodesSync(state.nodes, (el) => void flat.push(el.id));
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
          traverseNodesSync(res.node.children, (el) => void descendantIds.push(el.id));
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
          nodes: mapNodes(state.nodes, id, (el) => ({ ...el, visible: !el.visible })),
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
            newItem.transform = { a: 1, b: 0, c: 0, d: 1, e: rect.x, f: rect.y };
            newItem.baseRect = { width: rect.width, height: rect.height };
          } else {
            // Place new item centered in viewport
            // newItem.transform = { x: 0, y: 0, dx: 0, dy: 0, scale: 1 };
            const svgRect = state.svgEl.getBoundingClientRect();
            const center = state.clientToSvg(svgRect.x + svgRect.width / 2, svgRect.y + svgRect.height / 2);
            newItem.transform = {
              ...newItem.transform,
              e: center.x - newItem.baseRect.width / 2,
              f: center.y - newItem.baseRect.height / 2,
            };
          }
          newItem.cssTransform = computeNodeCssTransform(newItem);
        }

        if (!parent) {
          state.set({
            nodes: [...state.nodes, newItem],
            selectedIds: new Set([newItem.id]),
            editingId: null,
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
        switch (node.type) {
          case "group": {
            return {
              ...baseProps,
              type: "group" as const,
              children: node.children.map((c) => state.cloneNode(c, seenDuringClone)),
            };
          }
          case "rect": {
            return {
              ...baseProps,
              type: "rect" as const,
              baseRect: { ...node.baseRect },
              cssTransform: computeNodeCssTransform(node),
            };
          }
          case "image": {
            return {
              ...baseProps,
              type: "image" as const,
              imageKey: node.imageKey,
              baseRect: { ...node.baseRect },
              offset: { ...node.offset },
              cssTransform: computeNodeCssTransform(node),
            };
          }
          case "symbol": {
            return {
              ...baseProps,
              type: "symbol" as const,
              symbolKey: node.symbolKey,
              baseRect: { ...node.baseRect },
              offset: { ...node.offset },
              cssTransform: computeNodeCssTransform(node),
            };
          }
          default:
            throw new ExhaustiveError(node);
        }
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
      deleteNodes(nodeIds) {
        for (const id of nodeIds) {
          const result = findNode(state.nodes, id);
          if (result) {
            removeNodeFromParent(result.parent?.children ?? state.nodes, id);
          }
        }
      },
      deleteSelectedNodes() {
        if (state.selectedIds.size === 0) return;
        if (state.editingId) return;
        state.pushHistory();
        state.deleteNodes(Array.from(state.selectedIds));
        state.set({ selectedIds: new Set(), selectionBox: null });
      },
      duplicate(rootNodeId, seenDuringClone) {
        const result = findNode(state.nodes, rootNodeId);
        if (!result) return null;
        const clone = state.cloneNode(result.node, seenDuringClone);
        state.nodes.push(clone);
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
      rotateNode(nodeId, deltaDegrees) {
        const result = findNode(state.nodes, nodeId);
        if (!result) return;

        if (result.node.type === "image") {
          const node = result.node;
          const { width: W, height: H } = node.baseRect;
          const [cx, cy] = [W / 2, H / 2];
          const { a, b, c, d, e, f } = node.transform;

          const m = new DOMMatrix([a, b, c, d, e, f]);
          m.translateSelf(cx, cy).rotateSelf(deltaDegrees).translateSelf(-cx, -cy);
          node.transform.a = m.a;
          node.transform.b = m.b;
          node.transform.c = m.c;
          node.transform.d = m.d;
          node.transform.e = m.e;
          node.transform.f = m.f;

          node.cssTransform = computeNodeCssTransform(node);
        } else if (result.node.type === "rect") {
          const node = result.node;
          const { width: W, height: H } = node.baseRect;
          const { e, f } = node.transform;

          // Swap width and height
          node.baseRect.width = H;
          node.baseRect.height = W;

          // Adjust translation to keep center in same place
          node.transform.e = e + W / 2 - H / 2;
          node.transform.f = f + H / 2 - W / 2;

          node.cssTransform = computeNodeCssTransform(node);
        }
      },
      rotateSelected(degrees) {
        if (state.selectedIds.size === 0) return;
        state.pushHistory();
        for (const id of state.selectedIds) state.rotateNode(id, degrees);
        state.update();
      },
      getNextName(type, prefix = `${type.charAt(0).toUpperCase()}${type.slice(1)} `) {
        return `${prefix}${state.getNextSuffix(type, prefix)}`;
      },
      getNextSuffix(type, prefix) {
        const usedNums = new Set<number>();
        traverseNodesSync(state.nodes, (el) => {
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
        const result = findNode(state.nodes, selectedId);
        return result?.node ?? null;
      },
      groupSelected() {
        if (state.selectedIds.size === 0) return;
        state.pushHistory();
        let shallowest: ReturnType<typeof findNodeWithDepth> = null;
        for (const id of state.selectedIds) {
          const r = findNodeWithDepth(state.nodes, id);
          if (r && (!shallowest || r.depth < shallowest.depth)) shallowest = r;
        }
        if (!shallowest) return;

        const newGroup = state.create("group");
        const insertArray = shallowest.parent?.children ?? state.nodes;
        const insertIndex = insertArray.indexOf(shallowest.node);
        const seen = new Set<string>();

        for (const id of state.selectedIds) {
          if (seen.has(id)) continue;
          const result = findNode(state.nodes, id);
          if (!result) continue;
          removeNodeFromParent(result.parent?.children ?? state.nodes, id);
          newGroup.children.push(result.node);
          traverseNodesSync([result.node], (el) => void seen.add(el.id));
        }
        insertArray.splice(insertIndex, 0, newGroup);
        state.set({ selectedIds: new Set([newGroup.id]), selectionBox: null });
      },
      moveNode(srcId, dstId, edge) {
        if (srcId === dstId) return;

        const srcResult = findNode(state.nodes, srcId);
        const dstResult = findNode(state.nodes, dstId);
        if (
          !srcResult ||
          !dstResult ||
          findNode([srcResult.node], dstId) // cannot move into self
        ) {
          return;
        }

        removeNodeFromParent(srcResult.parent?.children ?? state.nodes, srcId);

        if (edge === "inside" && dstResult.node.type === "group") {
          dstResult.node.children.push(srcResult.node);
        } else {
          insertNodeAt(
            srcResult.node,
            dstResult.parent?.children ?? state.nodes,
            dstId,
            edge === "inside" ? "bottom" : edge,
          );
        }

        state.update();
      },

      onRename(id, newName) {
        state.set({
          nodes: mapNodes(state.nodes, id, (el) => ({ ...el, name: newName })),
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

        const { node } = findNode(state.nodes, nodeId) ?? {};
        const meta = state.pngsManifest?.byKey[imageKey];
        if (!(node?.type === "image" && meta)) return;

        node.imageKey = imageKey;

        const scaleFactor = sguScalePngToSvgFactor;
        node.offset.x = labelledImageOffsetValue.halfLineWidth;
        node.offset.y = labelledImageOffsetValue.halfLineWidth;

        // scale down so 1 sgu ~ 60px
        node.baseRect.width = meta.width * scaleFactor;
        node.baseRect.height = meta.height * scaleFactor;
        node.cssTransform = computeNodeCssTransform(node);

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
            const result = findNode(state.nodes, id);
            if (result?.node.type === "rect" || result?.node.type === "image") {
              const node = result.node;
              node.transform.e = Math.round((startPos.x + dx) / increment) * increment;
              node.transform.f = Math.round((startPos.y + dy) / increment) * increment;
              node.cssTransform = computeNodeCssTransform(node);
            }
          }
          state.update();
          return;
        }

        if (state.selectedIds.size !== 1) return;
        const [selectedId] = state.selectedIds;
        const result = findNode(state.nodes, selectedId);
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
        transform.e = isW ? snap(startBounds.x + startBounds.width - newWidth) : startTransform.e;
        transform.f = isN ? snap(startBounds.y + startBounds.height - newHeight) : startTransform.f;

        result.node.cssTransform = computeNodeCssTransform(result.node);

        state.update();
      },
      onSvgPointerUp(e) {
        if (!state.dragEl) return;
        e.stopPropagation();

        (e.target as SVGElement).releasePointerCapture(e.pointerId);

        if (state.dragEl.type === "selection-box" && state.selectionBox) {
          const selectedIds = new Set<string>();
          const box = state.selectionBox;
          traverseNodesSync(state.nodes, (el) => {
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
            const result = findNode(state.nodes, id);
            return result?.node.type === "rect" || result?.node.type === "image"
              ? [[id, { x: result.node.transform.e, y: result.node.transform.f }]]
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
        const result = findNode(state.nodes, selectedId);
        if (result?.node.type !== "rect") return;
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
        const nodesJson = JSON.stringify(state.nodes);
        const prev = state.undoStack.at(-1)?.nodes;
        if (prev === nodesJson) return;

        state.isDirty = true;
        state.undoStack.push({
          nodes: nodesJson,
          selectedIds: new Set(state.selectedIds),
          width: state.svgWidth,
          height: state.svgHeight,
        });
        state.redoStack.length = 0;
        state.update();
      },
      undo() {
        const entry = state.undoStack.pop();
        if (!entry) return;
        state.redoStack.push({
          nodes: JSON.stringify(state.nodes),
          selectedIds: new Set(state.selectedIds),
          width: state.svgWidth,
          height: state.svgHeight,
        });
        state.set({
          nodes: JSON.parse(entry.nodes) as MapNode[],
          selectedIds: entry.selectedIds,
          selectionBox: null,
          svgWidth: entry.width,
          svgHeight: entry.height,
        });
      },
      redo() {
        const entry = state.redoStack.pop();
        if (!entry) return;
        state.undoStack.push({
          nodes: JSON.stringify(state.nodes),
          selectedIds: new Set(state.selectedIds),
          width: state.svgWidth,
          height: state.svgHeight,
        });
        state.set({
          nodes: JSON.parse(entry.nodes) as MapNode[],
          selectedIds: entry.selectedIds,
          selectionBox: null,
          svgWidth: entry.width,
          svgHeight: entry.height,
        });
      },

      save(file = state.currentFile) {
        const savedFile: MapEditSavedFile = {
          type: file.type,
          filename: file.filename,
          width: state.svgWidth,
          height: state.svgHeight,
          nodes: state.nodes,
        };

        // save to local storage: (prod) only way to "save", (dev) provides "draft"
        tryLocalStorageSet(getFileSpecifierLocalStorageKey(file), JSON.stringify(savedFile));

        // remember current file for this MapEdit instance
        tryLocalStorageSet(
          LOCAL_STORAGE_UI_ID_TO_FILE_SPECIFIER,
          JSON.stringify(extendCurrentFileSpecifierMapping(props.meta.id, file)),
        );

        if (!state.savedFileSpecifiers.some((other) => areFileSpecifiersEqual(other, file))) {
          state.savedFileSpecifiers.push(file);
        }
        state.set({
          currentFile: file,
          savedFileSpecifiers: state.savedFileSpecifiers,
          isDirty: false,
        });

        if (import.meta.env.DEV && CAN_SAVE_TO_FILESYSTEM_IN_DEV) {
          // save to filesystem in development
          fetch(`/api/map-edit/file/${file.type}/${file.filename}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(savedFile),
          }).catch(console.error);
        }
      },
      async load(file = state.currentFile) {
        if (state.isDirty && !confirm("You have unsaved changes. Discard and load?")) {
          return;
        }

        // localStorage (draft) takes precedence
        const savedFile =
          tryLocalStorageGetParsed<MapEditSavedFile>(getFileSpecifierLocalStorageKey(file)) ??
          (await loadMapEditFile(file));

        if (!savedFile) return;

        state.set({
          nodes: savedFile.nodes,
          selectedIds: new Set(),
          selectionBox: null,
          currentFile: file,
          undoStack: [],
          redoStack: [],
          isDirty: false,
          svgWidth: savedFile.width,
          svgHeight: savedFile.height,
        });
      },
      async deleteFile(file) {
        // remove draft
        localStorage.removeItem(getFileSpecifierLocalStorageKey(file));

        // useful in prod: clears drafts with no corresponding file in manifest
        state.updateSavedFileSpecifiers(getLocalStorageSavedFiles());

        // in dev actually delete from filesystem
        if (import.meta.env.DEV) {
          await deleteMapEditFile(file);
        }

        if (areFileSpecifiersEqual(state.currentFile, file)) {
          state.load(state.savedFileSpecifiers.find((f) => !areFileSpecifiersEqual(f, file)));
        }
      },
      updateSavedFileSpecifiers(drafts) {
        if (!state.symbolsManifest || !state.mapsManifest) {
          return warn("manifests not ready");
        }

        state.set({
          savedFileSpecifiers: Array.from(
            new Map<string, MapEditFileSpecifier>([
              ...Object.values(state.symbolsManifest.byFilename).map(
                (f) => [`symbol/${f.filename}`, { type: "symbol", filename: f.filename }] as const,
              ),
              ...Object.values(state.mapsManifest.byFilename).map(
                (f) => [`map/${f.filename}`, { type: "map", filename: f.filename }] as const,
              ),
              ...drafts.map((f) => [`${f.type}/${f.filename}`, f] as const),
            ]).values(),
          ),
        });
      },
    }),
    { deps: [loadMapEditFile, deleteMapEditFile] },
  );
  state.theme = theme;

  useEffect(() => {
    if (state.nodes === emptyNodes) {
      state.load();
      isTouchDevice() && state.set({ isAsideCollapsed: true });
    }
  }, []);

  useQuery({
    queryKey: ["map-edit-images-manifest"],
    queryFn: async () => {
      state.pngsManifest = await fetchParsed("/starship-symbol/manifest.json", StarshipSymbolPngsManifestSchema);
      return null;
    },
  });

  useQuery({
    queryKey: ["map-edit-manifests"],
    queryFn: async () => {
      state.symbolsManifest = await fetchParsed("/symbol/manifest.json", SymbolsManifestSchema);
      state.mapsManifest = await fetchParsed("/map/manifest.json", MapsManifestSchema);
      state.updateSavedFileSpecifiers(state.savedFileSpecifiers);
      return null;
    },
  });

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
        if (state.selectedIds.size > 0) state.deleteSelectedNodes();
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

      if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key) && state.selectedIds.size > 0) {
        e.preventDefault();
        state.pushHistory();
        const dx = e.key === "ArrowLeft" ? -increment : e.key === "ArrowRight" ? increment : 0;
        const dy = e.key === "ArrowUp" ? -increment : e.key === "ArrowDown" ? increment : 0;
        for (const id of state.selectedIds) {
          const result = findNode(state.nodes, id);
          if (result?.node.type === "rect" || result?.node.type === "image") {
            const node = result.node;
            node.transform.e += dx;
            node.transform.f += dy;
            node.cssTransform = computeNodeCssTransform(node);
          }
        }
        state.set({ nodes: state.nodes });
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
        state.set({ selectedIds: getAllNodeIds(state.nodes) });
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [state.wrapperEl]);

  // save draft in both dev/prod
  useBeforeunload(() => state.save());

  const selectedImageNode = useMemo(() => {
    if (state.selectedIds.size !== 1) return null;
    const [id] = state.selectedIds;
    const result = findNode(state.nodes, id);
    return result?.node.type === "image" ? result.node : null;
  }, [state.selectedIds, state.nodes]);

  const isMobile = isTouchDevice();

  return (
    <div
      ref={state.ref("wrapperEl")}
      tabIndex={0}
      className="overflow-auto size-full flex justify-center items-start outline-none relative"
    >
      {/* Mobile toggle button */}
      {isMobile && (
        <>
          <button
            className={cn(
              uiClassName,
              "md:hidden fixed top-4 left-4 z-50 p-2 bg-slate-800 border border-slate-700 rounded-md shadow-lg",
              "hover:bg-slate-700 transition-colors",
            )}
            onClick={() => state.set({ isAsideCollapsed: !state.isAsideCollapsed })}
          >
            {state.isAsideCollapsed ? <CaretRightIcon className="size-5" /> : <CaretLeftIcon className="size-5" />}
          </button>

          {!state.isAsideCollapsed && (
            <div
              className={cn(uiClassName, "md:hidden fixed inset-0 bg-black/50 z-30 transition-opacity")}
              onClick={() => state.set({ isAsideCollapsed: true })}
            />
          )}
        </>
      )}

      <aside
        className={cn(
          "relative h-full border-r border-slate-800 flex flex-col bg-background",
          ...(isMobile
            ? [
                "md:relative md:translate-x-0",
                "max-md:absolute max-md:top-0 max-md:left-0 max-md:z-40 max-md:shadow-2xl",
                "transition-transform duration-300",
                state.isAsideCollapsed && "max-md:-translate-x-full",
              ]
            : []),
        )}
        style={{ width: state.asideWidth, minWidth: state.asideWidth }}
      >
        <div className="overflow-auto grid grid-cols-[1fr_auto] gap-1 items-center px-2 pr-4 py-2 border-b border-slate-800 bg-slate-900/20">
          <MainMenu state={state} />
          <FileMenu state={state} />
        </div>

        <div className={cn(uiClassName, "h-full bg-background")}>
          {state.nodes.map((el) => (
            <InspectorNode key={el.id} element={el} level={0} root={state} />
          ))}
        </div>

        {selectedImageNode && <SelectedImageNodeUI selectedImageNode={selectedImageNode} state={state} />}

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
            state.pickImageForId && state.deleteNodes([state.pickImageForId]);
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
  nodes: string;
  selectedIds: Set<string>;
  width: number;
  height: number;
};

export type State = {
  theme: ThemeName;
  zoom: number;
  pan: { x: number; y: number };
  isPanning: boolean;
  isPinching: boolean;
  firstPointerPos: { x: number; y: number };
  lastPointerPos: { x: number; y: number };
  containerEl: HTMLDivElement | null;
  lastTouchDist: number;
  lastTouchMid: { x: number; y: number };

  svgWidth: number;
  svgHeight: number;

  selectedIds: Set<string>;
  selectionBox: SelectionBox | null;
  editingId: string | null;
  asideWidth: number;
  lastAsideWidth: number;
  isResizing: boolean;
  isAsideCollapsed: boolean;
  nodes: MapNode[];
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
  pngsManifest: StarshipSymbolPngsManifest | null;
  pickImageForId: string | null;
  mapsManifest: MapsManifest | null;
  symbolsManifest: SymbolsManifest | null;

  /** {folder}/{filename} */
  currentFile: MapEditFileSpecifier;
  isDirty: boolean;
  savedFileSpecifiers: MapEditFileSpecifier[];

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
  deleteNodes: (nodeIds: string[]) => void;
  deleteSelectedNodes: () => void;
  pushHistory: () => void;
  undo: () => void;
  redo: () => void;
  cloneNode: (node: MapNode, seenDuringClone?: Set<string>) => MapNode;
  /** Must manually update state to see changes. */
  duplicate: (rootNodeId: string, seenDuringClone?: Set<string>) => MapNode | null;
  duplicateSelected: () => void;
  rotateNode: (nodeId: string, degrees: -90 | 90) => void;
  rotateSelected: (degrees: -90 | 90) => void;
  moveNode: (srcId: string, dstId: string, edge: "top" | "bottom" | "inside") => void;
  save: (file?: MapEditFileSpecifier) => void;
  load: (file?: MapEditFileSpecifier) => Promise<void>;
  deleteFile: (file: MapEditFileSpecifier) => void;
  updateSavedFileSpecifiers: (drafts: MapEditFileSpecifier[]) => void;
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
        "overflow-auto flex items-center justify-start gap-1 px-2 py-1 border-t border-slate-700/50 text-xs",
      )}
    >
      <label className="flex h-6">
        <div className="flex items-center px-1 border border-white/30 border-r-0 rounded rounded-r-none text-white bg-black">
          dx
        </div>
        <select
          className="px-1 bg-slate-700 border border-slate-600 text-slate-200 text-xs"
          title="dx"
          value={selectedImageNode.offset.x}
          onChange={(e) => {
            selectedImageNode.offset.x = Number(e.target.value) || 0;
            selectedImageNode.cssTransform = computeNodeCssTransform(selectedImageNode);
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
        <div className="flex items-center px-1 border border-white/30 border-r-0 rounded rounded-r-none text-white bg-black">
          dy
        </div>
        <select
          className="px-1 bg-slate-700 border border-slate-600 text-slate-200 text-xs"
          title="dy"
          value={selectedImageNode.offset.y}
          onChange={(e) => {
            selectedImageNode.offset.y = Number(e.target.value) || 0;
            selectedImageNode.cssTransform = computeNodeCssTransform(selectedImageNode);
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
        "max-md:hidden", // Hide on mobile
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

const emptyNodes = [] as MapNode[];

const minAsideWidth = 200;
const maxAsideWidth = 300;
const defaultAsideWidth = minAsideWidth;
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
