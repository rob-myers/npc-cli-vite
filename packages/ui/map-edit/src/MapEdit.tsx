import { enableDragDropTouch } from "@dragdroptouch/drag-drop-touch";

enableDragDropTouch();

import {
  isHullSymbolImageKey,
  type StarshipSymbolImageKey,
  type StarshipSymbolPngsManifest,
  StarshipSymbolPngsManifestSchema,
  sguScalePngToSvgFactor,
} from "@npc-cli/media/starship-symbol";
import { assetsJsonChangedEvent, mapEditSymbolSavedEvent } from "@npc-cli/ui__world/const";
import type { ThemeName } from "@npc-cli/ui-sdk";
import { uiClassName } from "@npc-cli/ui-sdk/const";
import { UiContext } from "@npc-cli/ui-sdk/UiContext";
import { cn, ExhaustiveError, Rect, type UseStateRef, useStateRef, Vect } from "@npc-cli/util";
import { fetchParsed } from "@npc-cli/util/fetch-parsed";
import { jsonParser } from "@npc-cli/util/json-parser";
import { isTouchDevice } from "@npc-cli/util/legacy/dom";
import {
  entries,
  toPrecision,
  tryLocalStorageGet,
  tryLocalStorageGetParsed,
  tryLocalStorageSet,
  warn,
} from "@npc-cli/util/legacy/generic";
import { CaretLeftIcon, CaretRightIcon } from "@phosphor-icons/react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { type PointerEvent, useCallback, useContext, useEffect, useMemo } from "react";
import { useBeforeunload } from "react-beforeunload";
import z from "zod";
import { queryClientApi } from "../../../cli/src/shell/query-client";
import {
  type BaseRect,
  type DecorManifest,
  DecorManifestSchema,
  type ImageMapNode,
  type MapEditFileSpecifier,
  type MapEditSavedFile,
  MapEditSavedFileSchema,
  type MapNode,
  type MapNodeMap,
  MapNodeSchema,
  type MapNodeType,
  type MapsManifest,
  MapsManifestSchema,
  type PathManifest,
  PathManifestSchema,
  type SymbolsManifest,
  SymbolsManifestSchema,
  type Transform,
} from "./editor.schema";
import { FileMenu } from "./FileMenu";
import { ImagePickerModal, type ImagePickerSelection } from "./ImagePickerModal";
import { InspectorNode } from "./InspectorNode";
import { MainMenu } from "./MainMenu";
import { MapEditSvg } from "./MapEditSvg";
import {
  areFileSpecifiersEqual,
  baseSvgSize,
  computeNodeCssTransform,
  defaultSymbolKey,
  devMessageFromServer,
  extendCurrentFileSpecifierMapping,
  findNodeById,
  findNodeByIdWithDepth,
  getFileSpecifierLocalStorageKey,
  getLocalStorageFileSpecs,
  getNodeBounds,
  getRecursiveNodes,
  imageOffsetValues,
  insertNodeAt,
  isNodeReflectable,
  isNodeTransformable,
  LOCAL_STORAGE_UI_ID_TO_FILE_SPECIFIER,
  mapNodes,
  migrateMapEditSavedFile,
  removeNodeFromParent,
  shouldUseOriginalName,
  templateNodeByKey,
  traverseNodesSync,
} from "./map-node-api";
import { type ParsedPath, PathPickerModal } from "./PathPickerModal";
import { SymbolPickerModalMemo } from "./SymbolPickerModal";
import type { MapEditUiMeta } from "./schema";

export default function MapEdit(props: { meta: MapEditUiMeta }) {
  const { theme, uiStoreApi } = useContext(UiContext);

  const { mutateAsync: loadMapEditFile } = useMutation({
    mutationKey: ["map-edit-load"],
    async mutationFn(file: MapEditFileSpecifier) {
      return fetchParsed(
        `/${file.type}/${file.filename}`,
        z.preprocess(migrateMapEditSavedFile, MapEditSavedFileSchema),
      );
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

  const { mutateAsync: saveMapEditFile } = useMutation({
    mutationKey: ["map-edit-save"],
    async mutationFn(file: MapEditFileSpecifier) {
      await fetch(`/api/map-edit/file/${file.type}/${file.filename}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(file),
      });
    },
    onSuccess(_data, _vars, _onMutateResult, context) {
      context.client.invalidateQueries({ exact: true, queryKey: ["map-edit-manifests"] });
    },
  });

  const state = useStateRef(
    (): State => ({
      //#region forwarded from ui meta
      theme,
      localVersion: 0,
      //#endregion

      devForceReadOnly: false,
      isReadOnly() {
        return (
          isTouchDevice() ||
          ((import.meta.env.PROD || (import.meta.env.DEV && state.devForceReadOnly)) &&
            state.currentFile.type === "symbol" &&
            !isHullSymbolImageKey(state.currentFile.key))
        );
      },

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

      pngsManifest: null,
      mapsManifest: null,
      symbolsManifest: null,
      pathManifest: null,
      decorManifest: null,

      pickImageForId: null,
      pickSymbolForId: null,
      pickPathOpen: false,

      currentFile: tryLocalStorageGetParsed<{ [uiId: string]: MapEditFileSpecifier }>(
        LOCAL_STORAGE_UI_ID_TO_FILE_SPECIFIER,
      )?.[props.meta.id] ?? {
        type: "symbol",
        filename: `${defaultSymbolKey}.json`,
        key: defaultSymbolKey,
      },
      isDirty: false,

      // will extend with symbol/manifest.json
      savedFileSpecifiers: getLocalStorageFileSpecs(),

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
        const dx = -(e.clientX - state.lastPointerPos.x);
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
        const [node] = findNodeById(state.nodes, id);
        if (!node) return;

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

        if (node.type === "group") {
          // select (a) group and descendants, or (b) only group itself
          const descendantIds: string[] = [];
          traverseNodesSync(node.children, (el) => void descendantIds.push(el.id));
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
        if (state.isReadOnly()) return;
        if (!state.svgEl) return;

        if (type === "path") {
          state.set({ pickPathOpen: true });
          return;
        }

        state.pushHistory();
        const selection = selectionAsParent ? state.getSelectedNode() : null;
        const parent = selection?.type === "group" ? selection : null;
        const newItem = state.createNode(type);

        if ("baseRect" in newItem) {
          if (rect) {
            // Use selection box dimensions
            newItem.transform = { a: 1, b: 0, c: 0, d: 1, e: rect.x, f: rect.y };
            newItem.baseRect = { width: toPrecision(rect.width, 6), height: toPrecision(rect.height, 6) };
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
            pickSymbolForId: newItem.type === "symbol" ? newItem.id : null,
          });
        } else {
          parent.children.push(newItem);
          state.set({
            selectedIds: new Set([newItem.id]),
            pickImageForId: newItem.type === "image" ? newItem.id : null,
            pickSymbolForId: newItem.type === "symbol" ? newItem.id : null,
          });
        }
      },
      cloneNode(node, seenDuringClone) {
        seenDuringClone?.add(node.id);
        const baseProps = {
          id: crypto.randomUUID(),
          name: shouldUseOriginalName(node) ? node.name : state.getNextName(node.type, `${node.name.split(" ")[0]} `),
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
              srcType: node.srcType,
              srcKey: node.srcKey,
              baseRect: { ...node.baseRect },
              offset: node.offset.clone(),
              cssTransform: computeNodeCssTransform(node),
            };
          }
          case "symbol": {
            return {
              ...baseProps,
              type: "symbol" as const,
              srcKey: node.srcKey,
              baseRect: { ...node.baseRect },
              offset: node.offset.clone(),
              cssTransform: computeNodeCssTransform(node),
            };
          }
          case "path": {
            return {
              ...baseProps,
              type: "path" as const,
              d: node.d,
              baseRect: { ...node.baseRect },
              cssTransform: computeNodeCssTransform(node),
            };
          }
          default:
            throw new ExhaustiveError(node);
        }
      },
      createNode(type) {
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
          ...("offset" in templateNode && { offset: templateNode.offset.clone() }),
        };
      },
      deleteNodes(nodeIds) {
        if (state.isReadOnly()) return;
        for (const id of nodeIds) {
          const [node, parent] = findNodeById(state.nodes, id);
          node !== null && removeNodeFromParent(parent?.children ?? state.nodes, id);
        }
      },
      deleteSelectedNodes() {
        if (state.isReadOnly()) return;
        if (state.selectedIds.size === 0) return;
        if (state.editingId) return;
        state.pushHistory();
        state.deleteNodes(Array.from(state.selectedIds));
        state.set({ selectedIds: new Set(), selectionBox: null });
      },
      duplicateNode(rootNodeId, seenDuringClone) {
        if (state.isReadOnly()) return null;
        const [node] = findNodeById(state.nodes, rootNodeId);
        if (!node) return null;
        const clone = state.cloneNode(node, seenDuringClone);
        state.nodes.push(clone);
        return clone;
      },
      duplicateSelected() {
        if (state.isReadOnly()) return;
        if (state.selectedIds.size === 0) return;
        state.pushHistory();
        const seenDuringClone = new Set<string>();
        const duplicatedIds = new Set<string>();
        for (const id of state.selectedIds) {
          if (seenDuringClone.has(id)) continue;
          const clone = state.duplicateNode(id, seenDuringClone);
          if (clone) getRecursiveNodes([clone]).forEach(({ id }) => duplicatedIds.add(id));
        }
        state.set({ selectedIds: duplicatedIds, selectionBox: null });
      },
      ensureSelectionDescendants(selectedIds) {
        const extended = new Set<MapNode>();
        for (const id of selectedIds) {
          const [node] = findNodeById(state.nodes, id);
          if (!node || extended.has(node)) continue;
          for (const otherNode of getRecursiveNodes([node])) {
            extended.add(otherNode);
          }
        }
        return extended;
      },
      copySelected() {
        if (state.selectedIds.size === 0) return;
        const nodesToCopy = [...state.ensureSelectionDescendants(state.selectedIds)];
        const clipboardData = JSON.stringify({ mapEditNodes: nodesToCopy });
        void navigator.clipboard.writeText(clipboardData);
      },
      async pasteFromClipboard() {
        if (state.isReadOnly()) return;
        const parsed = jsonParser
          .pipe(z.object({ mapEditNodes: z.array(MapNodeSchema) }))
          .safeParse(await navigator.clipboard.readText().catch());
        if (!parsed.success) return;

        state.pushHistory();
        const seen = new Set<string>();
        const clones = parsed.data.mapEditNodes.flatMap((node) =>
          seen.has(node.id) ? [] : state.cloneNode(node, seen),
        );
        state.nodes.push(...clones);
        state.set({ selectedIds: new Set([...getRecursiveNodes(clones)].map((node) => node.id)), selectionBox: null });
      },
      rotateNode(nodeId, deltaDegrees) {
        if (state.isReadOnly()) return;
        const [node] = findNodeById(state.nodes, nodeId);
        if (!isNodeTransformable(node)) return;

        if (node.type === "image" || node.type === "symbol" || node.type === "path") {
          const { width: W, height: H } = node.baseRect;
          const [cx, cy] = [W / 2, H / 2];
          const { a, b, c, d, e, f } = node.transform;
          // negate rotation when reflected (det < 0) so direction stays consistent
          const det = a * d - b * c;
          const degrees = det < 0 ? -deltaDegrees : deltaDegrees;
          const m = new DOMMatrix([a, b, c, d, e, f]);
          m.translateSelf(cx, cy).rotateSelf(degrees).translateSelf(-cx, -cy);
          Object.assign(node.transform, { a: m.a, b: m.b, c: m.c, d: m.d, e: m.e, f: m.f });
          node.cssTransform = computeNodeCssTransform(node);
        }
        if (node.type === "rect" && Math.abs(deltaDegrees) === 90) {
          const { width: W, height: H } = node.baseRect;
          node.baseRect.width = H;
          node.baseRect.height = W;
          node.transform.e = node.transform.e + W / 2 - H / 2;
          node.transform.f = node.transform.f + H / 2 - W / 2;
          node.cssTransform = computeNodeCssTransform(node);
        }
      },
      rotateSelected(degrees) {
        if (state.isReadOnly()) return;
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
        const [node] = findNodeById(state.nodes, selectedId);
        return node;
      },
      groupSelected() {
        if (state.isReadOnly()) return;
        if (state.selectedIds.size === 0) return;
        state.pushHistory();
        let shallowest: ReturnType<typeof findNodeByIdWithDepth> = null;
        for (const id of state.selectedIds) {
          const r = findNodeByIdWithDepth(state.nodes, id);
          if (r && (!shallowest || r.depth < shallowest.depth)) shallowest = r;
        }
        if (!shallowest) return;

        const newGroup = state.createNode("group");
        const insertArray = shallowest.parent?.children ?? state.nodes;
        const insertIndex = insertArray.indexOf(shallowest.node);
        const seen = new Set<string>();

        for (const id of state.selectedIds) {
          if (seen.has(id)) continue;
          const [node, parent] = findNodeById(state.nodes, id);
          if (!node) continue;
          removeNodeFromParent(parent?.children ?? state.nodes, id);
          newGroup.children.push(node);
          traverseNodesSync([node], (el) => void seen.add(el.id));
        }
        insertArray.splice(insertIndex, 0, newGroup);
        state.set({ selectedIds: new Set([newGroup.id]), selectionBox: null });
      },
      moveNode(srcId, dstId, edge) {
        if (state.isReadOnly()) return;
        if (srcId === dstId) return;

        const [srcNode, srcParent] = findNodeById(state.nodes, srcId);
        const [dstNode, dstParent] = findNodeById(state.nodes, dstId);
        if (
          !srcNode ||
          !dstNode ||
          findNodeById([srcNode], dstId)[0] // cannot move into self
        ) {
          return;
        }

        removeNodeFromParent(srcParent?.children ?? state.nodes, srcId);

        if (edge === "inside" && dstNode.type === "group") {
          dstNode.children.push(srcNode);
        } else {
          insertNodeAt(srcNode, dstParent?.children ?? state.nodes, dstId, edge === "inside" ? "bottom" : edge);
        }

        state.update();
      },
      reflectNode(id, type) {
        if (state.isReadOnly()) return;
        const [node] = findNodeById(state.nodes, id);
        if (!isNodeReflectable(node)) return;

        const { a, b, c, d, e, f } = node.transform;
        const m = new DOMMatrix();
        const [cx, cy] = [node.baseRect.width / 2, node.baseRect.height / 2];

        m.translateSelf(cx, cy)
          .scaleSelf(type === "horizontal" ? -1 : 1, type === "vertical" ? -1 : 1)
          .translateSelf(-cx, -cy)
          .preMultiplySelf(new DOMMatrix([a, b, c, d, e, f]));
        Object.assign(node.transform, { a: m.a, b: m.b, c: m.c, d: m.d, e: m.e, f: m.f });

        if ("offset" in node) {
          if (type === "horizontal") node.offset.x = -node.offset.x;
          if (type === "vertical") node.offset.y = -node.offset.y;
        }

        node.cssTransform = computeNodeCssTransform(node);
      },
      reflectSelected(type) {
        if (state.isReadOnly()) return;
        if (state.selectedIds.size === 0) return;
        state.pushHistory();
        for (const id of state.selectedIds) {
          state.reflectNode(id, type);
        }
        state.update();
      },
      translateSelected(dx, dy, snapToGrid) {
        if (state.isReadOnly()) return;
        const increment = Math.abs(dx || dy);
        for (const id of state.selectedIds) {
          const [node] = findNodeById(state.nodes, id);
          if (isNodeTransformable(node)) {
            if (snapToGrid && increment > 0) {
              // 🔔 transform must not include `node.offset` (cssTransform does though)
              node.transform.e = snap(node.transform.e + dx, increment);
              node.transform.f = snap(node.transform.f + dy, increment);
            } else {
              node.transform.e += dx;
              node.transform.f += dy;
            }
            node.cssTransform = computeNodeCssTransform(node);
          }
        }
        state.set({ nodes: state.nodes });
      },

      onRename(id, newName) {
        if (state.isReadOnly()) return;
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
      setImageKey(nodeId, selection) {
        if (state.isReadOnly()) return;
        state.set({ pickImageForId: null });

        const [node] = findNodeById(state.nodes, nodeId) ?? {};
        if (!(node?.type === "image")) return;

        if (selection.type === "decor") {
          const meta = state.decorManifest?.byKey[selection.key];
          if (!meta) return;

          node.srcType = "decor";
          node.srcKey = selection.key;
          node.offset.x = 0;
          node.offset.y = 0;
          node.baseRect.width = meta.width;
          node.baseRect.height = meta.height;
        } else {
          const imageKey = selection.key;
          const meta = state.pngsManifest?.byKey[imageKey];
          if (!meta) return;

          node.srcType = "symbol";
          node.srcKey = selection.key;
          // scale down so 1 sgu ~ 60px
          // BUT hull-symbol pngs are already scaled down (in original source)
          const scaleFactor = isHullSymbolImageKey(imageKey) ? 1 : sguScalePngToSvgFactor;
          node.offset.x = 0;
          node.offset.y = 0;
          node.baseRect.width = meta.width * scaleFactor;
          node.baseRect.height = meta.height * scaleFactor;
        }

        node.cssTransform = computeNodeCssTransform(node);

        if (node.name.match(/^(Image \d+)$/)) {
          node.name = state.getNextName("image", `${selection.key} `);
        }

        state.update();
      },
      setSymbolKey(nodeId, symbolKey) {
        if (state.isReadOnly()) return;
        state.set({ pickSymbolForId: null });

        const [node] = findNodeById(state.nodes, nodeId) ?? {};
        const meta = state.symbolsManifest?.byKey[symbolKey];
        if (!(node?.type === "symbol" && meta)) return;

        node.srcKey = symbolKey;
        node.baseRect.width = meta.width;
        node.baseRect.height = meta.height;
        node.cssTransform = computeNodeCssTransform(node);

        node.offset = new Vect(meta.bounds.x, meta.bounds.y);

        node.name = symbolKey;

        state.update();
      },
      addPaths(paths) {
        if (state.isReadOnly()) return;
        if (!state.svgEl || paths.length === 0) return;
        state.pushHistory();

        // const svgRect = state.svgEl.getBoundingClientRect();
        // const center = state.clientToSvg(svgRect.x + svgRect.width / 2, svgRect.y + svgRect.height / 2);
        const selection = state.getSelectedNode();
        const parent = selection?.type === "group" ? selection : null;

        const newNodes: MapNode[] = paths.map((p) => {
          const node = state.createNode("path");
          node.d = p.d;
          node.name = p.name;
          node.baseRect = { width: p.svgWidth, height: p.svgHeight };
          // node.transform = { ...node.transform, e: center.x - p.svgWidth / 2, f: center.y - p.svgHeight / 2 };
          node.transform = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
          node.cssTransform = computeNodeCssTransform(node);
          return node;
        });

        if (parent) {
          parent.children.push(...newNodes);
        } else {
          state.nodes.push(...newNodes);
        }
        state.set({
          selectedIds: new Set(newNodes.map((n) => n.id)),
          editingId: null,
          pickPathOpen: false,
        });
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
            const increment = e.ctrlKey ? inc.small : inc.default;
            state.startSelectionBox(e, increment);
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

        const svgPos = state.clientToSvg(e.clientX, e.clientY);
        const { startSvg } = state.dragEl;

        switch (state.dragEl.type) {
          case "selection-box": {
            const increment = e.ctrlKey ? inc.small : inc.default;
            const snapDir = (v: number, ref: number) => (v >= ref ? Math.ceil : Math.floor)(v / increment) * increment;
            const snappedX = snapDir(svgPos.x, startSvg.x);
            const snappedY = snapDir(svgPos.y, startSvg.y);
            state.set({
              selectionBox: {
                x: Math.min(startSvg.x, snappedX),
                y: Math.min(startSvg.y, snappedY),
                width: Math.abs(snappedX - startSvg.x),
                height: Math.abs(snappedY - startSvg.y),
              },
            });
            break;
          }
          case "move-selection": {
            // always small: use shift+arrow to snap
            const increment = inc.small;
            const dx = svgPos.x - startSvg.x;
            const dy = svgPos.y - startSvg.y;
            for (const [id, startPos] of state.dragEl.starts) {
              const [node] = findNodeById(state.nodes, id);
              if (!isNodeTransformable(node)) continue;
              node.transform.e = Math.round((startPos.x + dx) / increment) * increment;
              node.transform.f = Math.round((startPos.y + dy) / increment) * increment;
              node.cssTransform = computeNodeCssTransform(node);
            }
            state.update();
            break;
          }
          case "resize-rect": {
            const increment = e.shiftKey ? inc.default : inc.small;
            if (state.selectedIds.size !== 1) return;
            const [selectedId] = state.selectedIds;
            const [node] = findNodeById(state.nodes, selectedId);
            if (node?.type !== "rect" && node?.type !== "image") return;

            const dx = svgPos.x - startSvg.x;
            const dy = svgPos.y - startSvg.y;
            const { transform, baseRect } = node;
            const { handle, startTransform, startBounds } = state.dragEl;
            const isW = handle.includes("w");
            const isN = handle.includes("n");

            if (node.type === "image") {
              // project drag delta onto image's local x-axis
              const axisLen = Math.sqrt(startTransform.a ** 2 + startTransform.b ** 2);
              const axisX = startTransform.a / axisLen;
              const axisY = startTransform.b / axisLen;
              const projectedDelta = dx * axisX + dy * axisY;

              // uniform scaling: use actual image width (not AABB)
              const { baseRect: startBaseRect } = state.dragEl;
              const startWidth = startBaseRect.width * axisLen;
              const newWidth = snap(
                Math.max(increment, startWidth + (isW ? -projectedDelta : projectedDelta)),
                increment,
              );
              const k = newWidth / startWidth;

              // scale all matrix components uniformly (preserves rotation)
              transform.a = startTransform.a * k;
              transform.b = startTransform.b * k;
              transform.c = startTransform.c * k;
              transform.d = startTransform.d * k;

              // anchor the opposite corner: local coords of anchor point
              const anchorX = isW ? startBaseRect.width : 0;
              const anchorY = isN ? startBaseRect.height : 0;
              transform.e = startTransform.e + (startTransform.a * anchorX + startTransform.c * anchorY) * (1 - k);
              transform.f = startTransform.f + (startTransform.b * anchorX + startTransform.d * anchorY) * (1 - k);
            } else {
              if (handle.includes("e") || isW) {
                const newWidth = snap(Math.max(increment, startBounds.width + (isW ? -dx : dx)), increment);
                baseRect.width = newWidth;
                transform.e = isW ? snap(startBounds.x + startBounds.width - newWidth, increment) : startTransform.e;
              }
              if (handle.includes("n") || handle.includes("s")) {
                const newHeight = snap(Math.max(increment, startBounds.height + (isN ? -dy : dy)), increment);
                baseRect.height = newHeight;
                transform.f = isN ? snap(startBounds.y + startBounds.height - newHeight, increment) : startTransform.f;
              }
            }

            node.cssTransform = computeNodeCssTransform(node);
            state.update();
            break;
          }
        }
      },
      onSvgPointerUp(e) {
        if (!state.dragEl) return;
        e.stopPropagation();

        (e.target as SVGElement).releasePointerCapture(e.pointerId);

        if (state.dragEl.type === "selection-box" && state.selectionBox) {
          const selectedIds = new Set<string>();
          const box = state.selectionBox;
          traverseNodesSync(state.nodes, (el) => {
            if (isNodeTransformable(el)) {
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
      },
      startDragSelection(e) {
        if (state.isReadOnly()) return;
        state.pushHistory();
        e.stopPropagation();
        const svgPos = state.clientToSvg(e.clientX, e.clientY);

        /** Collect start positions for all selected rects */
        const starts = new Map(
          Array.from(state.selectedIds.values()).flatMap((id) => {
            const [node] = findNodeById(state.nodes, id);
            return isNodeTransformable(node) ? [[id, { x: node.transform.e, y: node.transform.f }]] : [];
          }),
        );

        if (starts.size === 0) return;

        state.dragEl = { type: "move-selection", startSvg: svgPos, starts };
        (e.target as SVGElement).setPointerCapture(e.pointerId);
        state.set({ selectionBox: null });
      },
      startResizeRect(e, handle) {
        if (state.isReadOnly()) return;
        if (state.selectedIds.size !== 1) return;
        const [selectedId] = state.selectedIds;

        const [node] = findNodeById(state.nodes, selectedId);
        if (!node) return;

        // can only resize "rect" and decor "image"
        if (!(node.type === "rect" || (node.type === "image" && node.srcType === "decor"))) {
          return;
        }

        e.stopPropagation();
        const svgPos = state.clientToSvg(e.clientX, e.clientY);
        const { transform, baseRect } = node;
        const bounds = getNodeBounds(node);
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
      startSelectionBox(e, increment) {
        e.stopPropagation();
        const svgPos = state.clientToSvg(e.clientX, e.clientY);
        const snappedPoint = { x: snap(svgPos.x, increment), y: snap(svgPos.y, increment) };
        state.dragEl = { type: "selection-box", startSvg: { ...snappedPoint } };
        state.set({
          selectionBox: { ...snappedPoint, width: 0, height: 0 },
          selectedIds: new Set(),
        });
        (e.target as SVGElement).setPointerCapture(e.pointerId);
      },

      pushHistory() {
        if (state.isReadOnly()) return;
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
        if (state.isReadOnly()) return;
        const entry = state.undoStack.pop();
        if (!entry) return;
        state.redoStack.push({
          nodes: JSON.stringify(state.nodes),
          selectedIds: new Set(state.selectedIds),
          width: state.svgWidth,
          height: state.svgHeight,
        });
        state.set({
          // revive classes like Vect
          nodes: z.array(MapNodeSchema).decode(JSON.parse(entry.nodes)),
          selectedIds: entry.selectedIds,
          selectionBox: null,
          svgWidth: entry.width,
          svgHeight: entry.height,
        });
      },
      redo() {
        if (state.isReadOnly()) return;
        const entry = state.redoStack.pop();
        if (!entry) return;
        state.undoStack.push({
          nodes: JSON.stringify(state.nodes),
          selectedIds: new Set(state.selectedIds),
          width: state.svgWidth,
          height: state.svgHeight,
        });
        state.set({
          nodes: z.array(MapNodeSchema).decode(JSON.parse(entry.nodes)),
          selectedIds: entry.selectedIds,
          selectionBox: null,
          svgWidth: entry.width,
          svgHeight: entry.height,
        });
      },

      openFresh(file) {
        state.set({
          nodes: [],
          selectedIds: new Set(),
          selectionBox: null,
          currentFile: file,
          undoStack: [],
          redoStack: [],
          isDirty: true,
        });
      },
      save(fileSpecifier = state.currentFile, { saveToDiskInDev = true } = {}) {
        if (state.isReadOnly()) return;

        // symbol files should have a partially transparent image node (underlay)
        const underlayImageNode = [...getRecursiveNodes(state.nodes)].find(
          (n): n is ImageMapNode => n.type === "image" && n.srcKey === fileSpecifier.key,
        );
        if (fileSpecifier.type === "symbol") {
          if (!underlayImageNode) warn(`symbol ${fileSpecifier.key}: no underlying image node found`);
          else if (underlayImageNode.transform.e !== 0 || underlayImageNode.transform.f !== 0)
            warn(`symbol ${fileSpecifier.key}: underlying image node transform.{e,f} should equal 0`);
        }

        const savedFile: MapEditSavedFile = {
          ...fileSpecifier,
          width: state.svgWidth,
          height: state.svgHeight,
          nodes: state.nodes,
          bounds: (underlayImageNode
            ? Rect.fromJson(getNodeBounds(underlayImageNode))
            : Rect.fromJson(getNodeBounds(...state.nodes)).union({
                x: 0,
                y: 0,
                width: state.svgWidth,
                height: state.svgHeight,
              })
          ).precision(6),
          // bounds: Rect.fromJson(getNodeBounds(...state.nodes))
          //   .union({ x: 0, y: 0, width: state.svgWidth, height: state.svgHeight })
          //   .precision(6),
        };

        // save to local storage: (prod) only way to "save", (dev) provides "draft"
        tryLocalStorageSet(getFileSpecifierLocalStorageKey(fileSpecifier), JSON.stringify(savedFile));

        // remember current file for this MapEdit instance
        tryLocalStorageSet(
          LOCAL_STORAGE_UI_ID_TO_FILE_SPECIFIER,
          JSON.stringify(extendCurrentFileSpecifierMapping(props.meta.id, fileSpecifier)),
        );

        if (!state.savedFileSpecifiers.some((other) => areFileSpecifiersEqual(other, fileSpecifier))) {
          state.savedFileSpecifiers.push(fileSpecifier);
        }
        state.set({
          currentFile: fileSpecifier,
          savedFileSpecifiers: state.savedFileSpecifiers,
          isDirty: false,
        });

        // notify World to recompute layouts from localStorage drafts
        window.dispatchEvent(new CustomEvent(mapEditSymbolSavedEvent, { detail: { key: fileSpecifier.key } }));

        if (import.meta.env.DEV && saveToDiskInDev) {
          void saveMapEditFile(savedFile);
        }

        // // 🚧 too early i.e. need to wait for thumbnail to be redrawn
        // uiStoreApi.setUiMeta(props.meta.id, (state) => {
        //   const currentVersion = (state as MapEditUiMeta).localVersion ?? 0;
        //   (state as MapEditUiMeta).localVersion = currentVersion + 1;
        // });
      },
      async load(file = state.currentFile, { askToRestore = true, ignoreDraft = false } = {}) {
        if (askToRestore && state.isDirty && !confirm("You have unsaved changes. Discard and load?")) {
          return;
        }

        // localStorage (draft) takes precedence
        const localStorageResult = ignoreDraft
          ? { data: null }
          : jsonParser
              .pipe(z.preprocess(migrateMapEditSavedFile, MapEditSavedFileSchema))
              .safeParse(tryLocalStorageGet(getFileSpecifierLocalStorageKey(file)));

        const savedFile = localStorageResult.data ?? (await loadMapEditFile(file));
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
        if (state.isReadOnly()) return;
        // remove draft
        localStorage.removeItem(getFileSpecifierLocalStorageKey(file));

        // useful in prod: clears drafts with no corresponding file in manifest
        state.updateSavedFileSpecifiers(getLocalStorageFileSpecs());

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
              ...entries(state.symbolsManifest.byKey).map(
                ([key, f]) => [`symbol/${f.filename}`, { type: "symbol", filename: f.filename, key }] as const,
              ),
              ...entries(state.mapsManifest.byKey).map(
                ([key, f]) => [`map/${f.filename}`, { type: "map", filename: f.filename, key }] as const,
              ),
              ...drafts.map((f) => [`${f.type}/${f.filename}`, f] as const),
            ]).values(),
          ),
        });
      },
    }),
    { deps: [loadMapEditFile, deleteMapEditFile], reset: { devForceReadOnly: true } },
  );
  state.theme = theme;
  state.localVersion = props.meta.localVersion ?? 0;

  useEffect(() => {
    if (state.nodes === emptyNodes) {
      state.load(undefined, { askToRestore: false });
      isTouchDevice() && state.set({ isAsideCollapsed: true });
    }
  }, []);

  [state.pngsManifest, state.symbolsManifest, state.mapsManifest, state.pathManifest, state.decorManifest] = useQuery({
    queryKey: ["map-edit-manifests"],
    queryFn: async () => {
      const pngsManifest = await fetchParsed("/starship-symbol/manifest.json", StarshipSymbolPngsManifestSchema);
      const symbolsManifest = await fetchParsed("/symbol/manifest.json", SymbolsManifestSchema);
      const mapsManifest = await fetchParsed("/map/manifest.json", MapsManifestSchema);
      const pathManifest = await fetchParsed("/path/manifest.json", PathManifestSchema);
      const decorManifest = await fetchParsed("/decor/manifest.json", DecorManifestSchema);
      return [pngsManifest, symbolsManifest, mapsManifest, pathManifest, decorManifest] as const;
    },
  }).data ?? [null, null, null, null, null];

  useEffect(() => {
    state.updateSavedFileSpecifiers(state.savedFileSpecifiers);
  }, [state.symbolsManifest, state.mapsManifest]);

  // Refresh manifests on dev server signal
  useEffect(() => {
    if (!import.meta.hot) return;
    const onRecomputedPathManifest = () => {
      queryClientApi.queryClient.invalidateQueries({ exact: true, queryKey: ["map-edit-manifests"] });
    };
    import.meta.hot.on(devMessageFromServer.recomputedPathManifest, onRecomputedPathManifest);

    // onchange assets updating localVersion updates thumbnails
    const onAssetsChanged = () => {
      uiStoreApi.setUiMeta(props.meta.id, (state) => {
        const currentVersion = (state as MapEditUiMeta).localVersion ?? 0;
        (state as MapEditUiMeta).localVersion = currentVersion + 1;
      });
    };
    import.meta.hot.on(assetsJsonChangedEvent, onAssetsChanged);

    return () => {
      import.meta.hot?.off(devMessageFromServer.recomputedPathManifest, onRecomputedPathManifest);
      import.meta.hot?.off(assetsJsonChangedEvent, onAssetsChanged);
    };
  }, []);

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

      // Delete
      if (e.key === "Backspace") {
        e.preventDefault();
        if (state.selectedIds.size > 0) state.deleteSelectedNodes();
        state.wrapperEl?.focus();
        return;
      }

      // Fill selection rect
      if (e.key === "r" && !e.metaKey) {
        e.preventDefault();
        if (state.selectionBox && state.selectionBox.width > 0 && state.selectionBox.height > 0) {
          state.add("rect", { rect: state.selectionBox });
          state.set({ selectionBox: null });
        }
        return;
      }

      // Rotate
      if (e.key === "e" || e.key === "q") {
        if (state.selectedIds.size > 0) state.rotateSelected(e.key === "e" ? 90 : -90);
        return;
      }
      if (e.key === "E" || e.key === "Q") {
        if (state.selectedIds.size > 0) state.rotateSelected(e.key === "E" ? 15 : -15);
        return;
      }

      if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key) && state.selectedIds.size > 0) {
        if (e.shiftKey && (e.ctrlKey || e.metaKey)) {
          state.reflectSelected(e.key === "ArrowUp" || e.key === "ArrowDown" ? "vertical" : "horizontal");
        } else {
          e.preventDefault();
          state.pushHistory();
          const increment = e.shiftKey ? inc.default : inc.small;
          state.translateSelected(
            e.key === "ArrowLeft" ? -increment : e.key === "ArrowRight" ? increment : 0,
            e.key === "ArrowUp" ? -increment : e.key === "ArrowDown" ? increment : 0,
            e.shiftKey,
          );
        }
        return;
      }

      const modified = e.metaKey || e.ctrlKey;
      if (!modified) return;

      switch (e.key) {
        case "z":
          if (e.shiftKey) {
            state.redo();
          } else {
            state.undo();
          }
          break;
        case "y":
          state.redo();
          break;
        case "s":
          state.save();
          break;
        case "g":
          state.selectedIds.size > 0 && state.groupSelected();
          break;
        case "c":
          state.copySelected();
          break;
        case "v":
          void state.pasteFromClipboard();
          break;
        case "d":
          state.selectedIds.size > 0 && state.duplicateSelected();
          break;
        case "i":
          state.add("image", { selectionAsParent: true });
          break;
        case "a":
          // Select all
          state.set({ selectedIds: new Set([...getRecursiveNodes(state.nodes)].map((node) => node.id)) });
          break;
        case "o":
          // Instantiate symbol
          state.add("symbol", { selectionAsParent: true });
          break;
        // Open path picker
        case "p":
          state.add("path", { selectionAsParent: true });
          break;
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [state.wrapperEl]);

  // autosave draft in dev/prod
  useBeforeunload(() => state.save(state.currentFile, { saveToDiskInDev: false }));

  const selectedImageNode = useMemo(() => {
    if (state.selectedIds.size !== 1) return null;
    const [id] = state.selectedIds;
    const [node] = findNodeById(state.nodes, id);
    return node && node.type === "image" ? node : null;
  }, [state.selectedIds, state.nodes]);

  const isMobile = isTouchDevice();

  return (
    <div
      ref={state.ref("wrapperEl")}
      tabIndex={0}
      className="overflow-auto size-full flex justify-center items-start outline-none relative"
    >
      {isMobile &&
        (state.isAsideCollapsed ? (
          <button
            className={cn(
              uiClassName,
              "md:hidden left-4 z-50 p-2 bg-slate-800 text-white border border-slate-700 rounded-md shadow-lg",
            )}
            onClick={() => state.set({ isAsideCollapsed: !state.isAsideCollapsed })}
          >
            {state.isAsideCollapsed ? <CaretRightIcon className="size-5" /> : <CaretLeftIcon className="size-5" />}
          </button>
        ) : (
          <div
            className={cn(uiClassName, "md:hidden absolute inset-0 bg-black/50 z-30 transition-opacity")}
            onClick={() => state.set({ isAsideCollapsed: true })}
          />
        ))}
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
        <MapEditSvg root={state} uiId={props.meta.id} />
      </div>

      <aside
        className={cn(
          uiClassName, // avoid losing key focus
          "relative h-full border-r border-slate-800 flex flex-col",
          ...(isMobile
            ? [
                "md:relative md:translate-x-0",
                "max-md:absolute max-md:top-0 max-md:left-0 max-md:z-40 max-md:shadow-2xl",
                "transition-transform duration-300",
                state.isAsideCollapsed && "max-md:-translate-x-full",
                "bg-background",
              ]
            : []),
        )}
        style={{ width: state.asideWidth, minWidth: state.asideWidth }}
      >
        <div className="overflow-auto grid grid-cols-[1fr_auto] gap-1 items-center pl-3 pr-2 py-2 bg-slate-900/20">
          <MainMenu state={state} />
          <FileMenu state={state} />
        </div>

        {/* inspector must scroll */}
        <div className={cn("overflow-auto pl-1")}>
          {state.nodes.map((node) => (
            <InspectorNode key={node.id} node={node} level={0} root={state} />
          ))}
        </div>

        {selectedImageNode && <SelectedImageNodeUI node={selectedImageNode} state={state} />}

        <InspectorResizer state={state} />
      </aside>

      <ImagePickerModal
        open={state.pickImageForId !== null}
        onOpenChange={(open) => {
          if (!open) {
            state.pickImageForId && state.deleteNodes([state.pickImageForId]);
            state.set({ pickImageForId: null });
          }
        }}
        onSelect={(selection) => {
          if (state.pickImageForId) {
            state.setImageKey(state.pickImageForId, selection);
          }
        }}
        decorManifest={state.decorManifest}
      />

      <SymbolPickerModalMemo
        open={state.pickSymbolForId !== null}
        onOpenChange={useCallback(
          (open) => {
            if (!open) {
              state.pickSymbolForId && state.deleteNodes([state.pickSymbolForId]);
              state.set({ pickSymbolForId: null });
            }
          },
          [state],
        )}
        onSelect={useCallback(
          (symbolKey) => {
            if (state.pickSymbolForId) {
              state.setSymbolKey(state.pickSymbolForId, symbolKey);
            }
          },
          [state],
        )}
        symbolsManifest={state.symbolsManifest}
      />

      <PathPickerModal
        open={state.pickPathOpen}
        onOpenChange={(open) => {
          if (!open) state.set({ pickPathOpen: false });
        }}
        onSelect={(paths) => state.addPaths(paths)}
        pathManifest={state.pathManifest}
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
  localVersion: number;
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
  pickSymbolForId: string | null;
  pickPathOpen: boolean;
  mapsManifest: MapsManifest | null;
  symbolsManifest: SymbolsManifest | null;
  pathManifest: PathManifest | null;
  decorManifest: DecorManifest | null;

  devForceReadOnly: boolean;
  isReadOnly: () => boolean;

  /** {folder}/{filename} */
  currentFile: MapEditFileSpecifier;
  isDirty: boolean;
  /** All saved file specifiers including drafts */
  savedFileSpecifiers: MapEditFileSpecifier[];

  startDragSelection: (e: React.PointerEvent<SVGSVGElement>) => void;
  startResizeRect: (e: React.PointerEvent<SVGSVGElement>, handle: ResizeHandle) => void;
  startSelectionBox: (e: React.PointerEvent<SVGSVGElement>, increment: number) => void;

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
  setImageKey: (nodeId: string, selection: ImagePickerSelection) => void;
  setSymbolKey: (nodeId: string, symbolKey: StarshipSymbolImageKey) => void;
  addPaths: (paths: ParsedPath[]) => void;
  createNode: <T extends MapNodeType>(type: T) => MapNodeMap[T];
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
  duplicateNode: (rootNodeId: string, seenDuringClone?: Set<string>) => MapNode | null;
  duplicateSelected: () => void;
  ensureSelectionDescendants: (selectedIds: Set<string>) => Set<MapNode>;
  copySelected: () => void;
  pasteFromClipboard: () => Promise<void>;
  rotateNode: (nodeId: string, degrees: -90 | 90 | -15 | 15) => void;
  rotateSelected: (degrees: -90 | 90 | -15 | 15) => void;
  moveNode: (srcId: string, dstId: string, edge: "top" | "bottom" | "inside") => void;
  reflectNode: (nodeId: string, type: "horizontal" | "vertical") => void;
  reflectSelected: (type: "horizontal" | "vertical") => void;
  translateSelected: (dx: number, dy: number, snapToGrid?: boolean) => void;
  openFresh: (file: MapEditFileSpecifier) => void;
  save: (file?: MapEditFileSpecifier, options?: { saveToDiskInDev?: boolean }) => void;
  load: (file?: MapEditFileSpecifier, opts?: { askToRestore?: boolean; ignoreDraft?: boolean }) => Promise<void>;
  deleteFile: (file: MapEditFileSpecifier) => void;
  updateSavedFileSpecifiers: (drafts: MapEditFileSpecifier[]) => void;
  clientToSvg: (clientX: number, clientY: number) => { x: number; y: number };
  onSvgPointerDown: (e: React.PointerEvent<SVGSVGElement>) => void;
  onSvgPointerMove: (e: React.PointerEvent<SVGSVGElement>) => void;
  onSvgPointerUp: (e: React.PointerEvent<SVGSVGElement>) => void;
};

function SelectedImageNodeUI({ node, state }: { node: ImageMapNode; state: UseStateRef<State> }) {
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
          value={node.offset.x}
          onChange={(e) => {
            node.offset.x = Number(e.target.value) || 0;
            console.log("🚧");
            node.cssTransform = computeNodeCssTransform(node);
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
          value={node.offset.y}
          onChange={(e) => {
            node.offset.y = Number(e.target.value) || 0;
            node.cssTransform = computeNodeCssTransform(node);
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
        "z-2 w-1 absolute left-0 top-0 h-full cursor-ew-resize hover:bg-blue-500/50 transition-colors touch-none",
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
          <CaretLeftIcon className="size-4" />
        ) : (
          <CaretRightIcon className="size-4" />
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
const minZoomScale = 0.25;
const maxZoomScale = 40;

export type ResizeHandle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";

const inc = {
  small: 0.5,
  // 🚧 needed when snapping but maybe too small when moving into place
  default: 2.5,
};

const snap = (v: number, increment = inc.small) => Math.round(v / increment) * increment;

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
  c: true,
  d: true,
  g: true,
  i: true,
  v: true,
  // r: true,
  o: true,
  p: true,
  s: true,
  y: true,
  z: true,
} as const;
