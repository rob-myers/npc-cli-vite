import { uiClassName } from "@npc-cli/ui-sdk";
import { cn, type UseStateRef } from "@npc-cli/util";
import { warn } from "@npc-cli/util/legacy/generic";
import { memo, useMemo } from "react";
import type { ImageMapNode, MapNode, RectMapNode } from "./editor.schema";
import type { ResizeHandle, State } from "./MapEdit";
import { baseSvgSize, findNode, getNodeBounds } from "./map-node-api";

export function MapEditSvg({ root, uiId }: { root: UseStateRef<State>; uiId: string }) {
  const vbW = baseSvgSize / root.zoom;
  const vbH = baseSvgSize / root.zoom;
  const vbX = (baseSvgSize - vbW) / 2 - root.pan.x / root.zoom;
  const vbY = (baseSvgSize - vbH) / 2 - root.pan.y / root.zoom;

  const resizableNode = useMemo(() => {
    if (root.selectedIds.size !== 1) return null;
    const [selectedId] = root.selectedIds;
    const [node] = findNode(root.nodes, selectedId);
    if (!node) return null;
    if (node.type === "rect" || (node.type === "image" && node.srcType === "decor")) return node;
    return null;
  }, [root.selectedIds]);

  return (
    <svg
      ref={root.ref("svgEl")}
      viewBox={`${vbX} ${vbY} ${vbW} ${vbH}`}
      width={root.svgWidth}
      height={root.svgHeight}
      className={cn(uiClassName, "size-full drop-shadow-2xl border border-white/20 overflow-visible")}
      onPointerDown={root.onSvgPointerDown}
      onPointerMove={root.onSvgPointerMove}
      onPointerUp={root.onSvgPointerUp}
      preserveAspectRatio="xMidYMid meet"
    >
      <DefsAndGrid uiId={uiId} />
      <SvgBoundingBox width={root.svgWidth} height={root.svgHeight} zoom={root.zoom} />
      <RenderMapNodes nodes={root.nodes} root={root} />
      {root.selectionBox !== null && (
        <rect
          x={root.selectionBox.x}
          y={root.selectionBox.y}
          width={root.selectionBox.width}
          height={root.selectionBox.height}
          fill="rgba(100, 150, 255, 0.15)"
          stroke="rgba(100, 150, 255, 0.8)"
          strokeWidth={1 / root.zoom}
          strokeDasharray={`${4 / root.zoom} ${2 / root.zoom}`}
          className="pointer-events-none"
        />
      )}
      {resizableNode && <ResizeHandles selectedNode={resizableNode} root={root} />}
    </svg>
  );
}

export const RenderMapNodes = ({ nodes, root }: { nodes: MapNode[]; root: UseStateRef<State> }) => {
  return nodes.map((node) => {
    switch (node.type) {
      case "group": {
        // groups do not support transform i.e. folders only
        return (
          <g key={node.id} data-node-id={node.id} className={cn(node.locked && "pointer-events-none")}>
            <title>{node.name}</title>
            <RenderMapNodes nodes={node.children} root={root} />
          </g>
        );
      }
      case "image": {
        const { baseRect, cssTransform } = node;
        return node.srcKey !== null ? (
          <image
            key={node.id}
            data-node-id={node.id}
            href={node.srcType === "decor" ? `/decor/${node.srcKey}.svg` : `/starship-symbol/${node.srcKey}.png`}
            x={0}
            y={0}
            width={baseRect.width}
            height={baseRect.height}
            style={{ transform: cssTransform }}
            preserveAspectRatio="none"
            className={cn(
              "outline-1 outline-white/0",
              "origin-top-left",
              root.selectedIds.has(node.id) === true && "outline-blue-500 outline-solid",
              node.locked === true && "pointer-events-none opacity-25",
            )}
          >
            <title>{node.name}</title>
          </image>
        ) : null;
      }

      case "symbol": {
        if (node.srcKey === null || root.symbolsManifest === null) return null;

        const symbol = root.symbolsManifest.byKey[node.srcKey];
        if (!symbol) {
          warn(`Symbol with key "${node.srcKey}" not found in symbols manifest.`);
          return null;
        }

        return (
          <image
            key={node.id}
            data-node-id={node.id}
            href={`/symbol/${node.srcKey}.thumbnail.png`}
            x={symbol.bounds.x}
            y={symbol.bounds.y}
            width={symbol.bounds.width}
            height={symbol.bounds.height}
            style={{ transform: node.cssTransform }}
            preserveAspectRatio="none"
            className={cn(
              "outline-1 outline-white/0",
              "opacity-75 outline-green-500/50 outline-dotted",
              root.selectedIds.has(node.id) === true && "outline-blue-500 outline-solid",
              node.locked === true && "pointer-events-none opacity-25",
            )}
          >
            <title>{node.name}</title>
          </image>
        );
      }

      case "path": {
        return (
          <path
            key={node.id}
            data-node-id={node.id}
            d={node.d}
            style={{ transform: node.cssTransform }}
            className={cn(
              "fill-amber-500/50 stroke-amber-700 stroke-1",
              root.selectedIds.has(node.id) && "stroke-blue-500 stroke-2",
              node.locked && "pointer-events-none opacity-25",
            )}
          >
            <title>{node.name}</title>
          </path>
        );
      }

      case "rect": {
        const isSelected = root.selectedIds.has(node.id);
        return (
          <rect
            key={node.id}
            data-node-id={node.id}
            x={0}
            y={0}
            width={node.baseRect.width}
            height={node.baseRect.height}
            style={{ transform: node.cssTransform }}
            // fill="rgba(0, 0, 0, 0.25)"
            stroke={isSelected ? "rgba(50, 50, 255, 1)" : "rgba(0, 0, 0, 0.5)"}
            strokeWidth={0.01}
            className={cn(
              "fill-green-700/50",
              // isSelected && "outline outline-blue-500",
              isSelected && "stroke-blue-500",
              cn(node.locked && "pointer-events-none opacity-25"),
            )}
          >
            <title>{node.name}</title>
          </rect>
        );
      }
      default:
        return null;
    }
  });
};

const resizeHandleSize = 4;
const resizeHandles: { handle: ResizeHandle; getPos: (r: Rect) => { x: number; y: number } }[] = [
  { handle: "nw", getPos: (r) => ({ x: r.x, y: r.y }) },
  { handle: "n", getPos: (r) => ({ x: r.x + r.width / 2, y: r.y }) },
  { handle: "ne", getPos: (r) => ({ x: r.x + r.width, y: r.y }) },
  { handle: "e", getPos: (r) => ({ x: r.x + r.width, y: r.y + r.height / 2 }) },
  { handle: "se", getPos: (r) => ({ x: r.x + r.width, y: r.y + r.height }) },
  { handle: "s", getPos: (r) => ({ x: r.x + r.width / 2, y: r.y + r.height }) },
  { handle: "sw", getPos: (r) => ({ x: r.x, y: r.y + r.height }) },
  { handle: "w", getPos: (r) => ({ x: r.x, y: r.y + r.height / 2 }) },
];
const handleToCursor: Record<ResizeHandle, string> = {
  nw: "cursor-nwse-resize",
  n: "cursor-ns-resize",
  ne: "cursor-nesw-resize",
  e: "cursor-ew-resize",
  se: "cursor-nwse-resize",
  s: "cursor-ns-resize",
  sw: "cursor-nesw-resize",
  w: "cursor-ew-resize",
};

type Rect = { x: number; y: number; width: number; height: number };

function ResizeHandles({ selectedNode, root }: { selectedNode: RectMapNode | ImageMapNode; root: UseStateRef<State> }) {
  const handleSize = (4 * resizeHandleSize) / root.zoom;

  if (selectedNode.type === "image") {
    // Rotated UI: compute transformed corners from cssTransform
    const { width: w, height: h } = selectedNode.baseRect;
    const { a, b, c, d, e, f } = new DOMMatrix(selectedNode.cssTransform);
    const tp = (x: number, y: number) => ({ x: a * x + c * y + e, y: b * x + d * y + f });
    const nw = tp(0, 0);
    const ne = tp(w, 0);
    const se = tp(w, h);
    const sw = tp(0, h);
    const corners = { nw, ne, se, sw };
    const points = `${nw.x},${nw.y} ${ne.x},${ne.y} ${se.x},${se.y} ${sw.x},${sw.y}`;

    return (
      <g>
        <polygon points={points} strokeWidth={2 / root.zoom} className="stroke-blue-700 fill-none" />
        {(["nw", "ne", "se", "sw"] as const).map((handle) => {
          const pos = corners[handle];
          return (
            <rect
              key={handle}
              data-resize-handle={handle}
              x={pos.x - handleSize / 2}
              y={pos.y - handleSize / 2}
              width={handleSize}
              height={handleSize}
              stroke="rgba(100, 100, 100, 1)"
              strokeWidth={2 / root.zoom}
              className="stroke-white fill-blue-700 cursor-auto"
            />
          );
        })}
      </g>
    );
  }

  // Axis-aligned UI for rect nodes
  const rect = getNodeBounds(selectedNode);
  return (
    <g>
      <rect
        x={rect.x}
        y={rect.y}
        width={rect.width}
        height={rect.height}
        strokeWidth={2 / root.zoom}
        className="stroke-blue-700 fill-none"
      />
      {resizeHandles.map(({ handle, getPos }) => {
        const pos = getPos(rect);
        return (
          <rect
            key={handle}
            data-resize-handle={handle}
            x={pos.x - handleSize / 2}
            y={pos.y - handleSize / 2}
            width={handleSize}
            height={handleSize}
            stroke="rgba(100, 100, 100, 1)"
            strokeWidth={2 / root.zoom}
            className={cn("stroke-white fill-blue-700", handleToCursor[handle])}
          />
        );
      })}
    </g>
  );
}

const SvgBoundingBox = memo(({ width, height, zoom }: { width: number; height: number; zoom: number }) => (
  <rect
    x={0}
    y={0}
    width={width}
    height={height}
    fill="none"
    stroke="rgba(255, 165, 0, 0.6)"
    strokeWidth={2 / zoom}
    strokeDasharray={`${8 / zoom} ${4 / zoom}`}
    className="pointer-events-none"
  />
));

const DefsAndGrid = memo(({ uiId }: { uiId: string }) => (
  <>
    <defs>
      <pattern id={`smallgrid-${uiId}`} width="10" height="10" patternUnits="userSpaceOnUse">
        <path d="M 10 0 L 0 0 0 10" fill="none" stroke="rgba(100, 116, 139, 0.3)" strokeWidth="0.5" />
      </pattern>
      <pattern id={`grid-${uiId}`} width="60" height="60" patternUnits="userSpaceOnUse">
        <rect width="60" height="60" fill={`url(#smallgrid-${uiId})`} />
        <path d="M 60 0 L 0 0 0 60" fill="none" stroke="rgba(100, 116, 139, 0.5)" strokeWidth="1" />
      </pattern>
    </defs>
    <g>
      <rect
        x="-10000"
        y="-10000"
        width="20000"
        height="20000"
        fill={`url(#grid-${uiId})`}
        className="pointer-events-none"
      />
    </g>
  </>
));
