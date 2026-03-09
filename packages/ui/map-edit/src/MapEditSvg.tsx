import { uiClassName } from "@npc-cli/ui-sdk";
import { cn, type UseStateRef } from "@npc-cli/util";
import { memo, useMemo } from "react";
import type { ResizeHandle, State } from "./MapEdit";
import { baseSvgSize, findNode, getNodeBounds, type MapNode, type RectMapNode } from "./map-node-api";

export function MapEditSvg({ root }: { root: UseStateRef<State> }) {
  const vbW = baseSvgSize / root.zoom;
  const vbH = baseSvgSize / root.zoom;
  const vbX = (baseSvgSize - vbW) / 2 - root.pan.x / root.zoom;
  const vbY = (baseSvgSize - vbH) / 2 - root.pan.y / root.zoom;

  const resizableRectNode = useMemo(() => {
    if (root.selectedIds.size !== 1) return null;
    const [selectedId] = root.selectedIds;
    const [node] = findNode(root.nodes, selectedId);
    return node?.type === "rect" ? node : null;
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
      <Defs />
      <OriginAndGrid />
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
      {resizableRectNode && <RectResizeHandles selectedNode={resizableRectNode} root={root} />}
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
            href={`/starship-symbol/${node.srcKey}.png`}
            x={0}
            y={0}
            width={baseRect.width}
            height={baseRect.height}
            style={{ transform: cssTransform }}
            preserveAspectRatio="none"
            className={cn(
              "outline-1 outline-white/0",
              root.selectedIds.has(node.id) === true && "outline-blue-500 outline-solid",
              node.locked === true && "pointer-events-none opacity-25",
            )}
          >
            <title>{node.name}</title>
          </image>
        ) : null;
      }

      case "symbol": {
        const { baseRect, cssTransform } = node;

        // 🚧 for symbols need their bounds.width and height
        // const filename = node.srcKey === null ? null : `${node.srcKey}.json` as const;
        // const foo = filename ? root.symbolsManifest?.byFilename[filename] : null;

        return node.srcKey !== null ? (
          <image
            key={node.id}
            data-node-id={node.id}
            href={`/symbol/${node.srcKey}.thumbnail.png`}
            // force offset for symbols
            x={node.offset.x}
            y={node.offset.y}
            width={baseRect.width}
            height={baseRect.height}
            style={{ transform: cssTransform }}
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
        ) : null;
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
  { handle: "ne", getPos: (r) => ({ x: r.x + r.width, y: r.y }) },
  { handle: "sw", getPos: (r) => ({ x: r.x, y: r.y + r.height }) },
  { handle: "se", getPos: (r) => ({ x: r.x + r.width, y: r.y + r.height }) },
];
const handleToCursor: Record<ResizeHandle, string> = {
  nw: "cursor-nwse-resize",
  ne: "cursor-nesw-resize",
  sw: "cursor-nesw-resize",
  se: "cursor-nwse-resize",
};

type Rect = { x: number; y: number; width: number; height: number };

function RectResizeHandles({ selectedNode, root }: { selectedNode: RectMapNode; root: UseStateRef<State> }) {
  const rect = getNodeBounds(selectedNode);
  const handleSize = (4 * resizeHandleSize) / root.zoom;
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

const originLineLength = 4096;
const originLineColor = "rgba(255, 0, 0, 0.5)";
const OriginAndGrid = memo(() => (
  <g>
    {/* <line x1={-originLineLength} y1={0} x2={originLineLength} y2={0} stroke={originLineColor} strokeWidth={1} />
    <line x1={0} y1={-originLineLength} x2={0} y2={originLineLength} stroke={originLineColor} strokeWidth={1} /> */}
    <rect x="-10000" y="-10000" width="20000" height="20000" fill="url(#grid)" className="pointer-events-none" />
  </g>
));

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

const Defs = memo(() => (
  <defs>
    <pattern id="smallGrid" width="10" height="10" patternUnits="userSpaceOnUse">
      <path d="M 10 0 L 0 0 0 10" fill="none" stroke="rgba(100, 116, 139, 0.3)" strokeWidth="0.5" />
    </pattern>
    <pattern id="grid" width="60" height="60" patternUnits="userSpaceOnUse">
      <rect width="60" height="60" fill="url(#smallGrid)" />
      <path d="M 60 0 L 0 0 0 60" fill="none" stroke="rgba(100, 116, 139, 0.5)" strokeWidth="1" />
    </pattern>
  </defs>
));
