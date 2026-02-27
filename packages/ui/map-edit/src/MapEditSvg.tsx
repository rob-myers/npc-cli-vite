import { uiClassName } from "@npc-cli/ui-sdk";
import { cn, type UseStateRef } from "@npc-cli/util";
import { QuestionIcon } from "@phosphor-icons/react";
import { memo, useMemo } from "react";
import type { ResizeHandle, State } from "./MapEdit";
import {
  baseSvgSize,
  findNode,
  getNodeBounds,
  type MapNode,
  type MapRectNode,
} from "./map-node-api";

export function MapEditSvg({ root }: { root: UseStateRef<State> }) {
  const vbW = baseSvgSize / root.zoom;
  const vbH = baseSvgSize / root.zoom;
  const vbX = (baseSvgSize - vbW) / 2 - root.pan.x / root.zoom;
  const vbY = (baseSvgSize - vbH) / 2 - root.pan.y / root.zoom;

  const resizableRectNode = useMemo(() => {
    if (root.selectedIds.size !== 1) return null;
    const [selectedId] = root.selectedIds;
    const node = findNode(root.elements, selectedId)?.node ?? null;
    return node?.type === "rect" ? node : null;
  }, [root.selectedIds]);

  return (
    <svg
      ref={root.ref("svgEl")}
      viewBox={`${vbX} ${vbY} ${vbW} ${vbH}`}
      className={cn(
        uiClassName,
        "size-full drop-shadow-2xl border border-white/20 overflow-visible",
      )}
      onPointerDown={root.onSvgPointerDown}
      onPointerMove={root.onSvgPointerMove}
      onPointerUp={root.onSvgPointerUp}
      preserveAspectRatio="xMidYMid meet"
    >
      <Defs />
      <OriginAndGrid />
      <RenderMapNodes selectedIds={root.selectedIds} elements={root.elements} />
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

export const RenderMapNodes = ({
  elements,
  selectedIds,
}: {
  elements: MapNode[];
  selectedIds: Set<string>;
}) => {
  return elements.map((el) => {
    switch (el.type) {
      case "group": {
        const cssTransform = `translate(${el.transform.x}, ${el.transform.y}) scale(${el.transform.scale})`;
        return (
          <g key={el.id} data-node-id={el.id} transform={cssTransform}>
            <title>{el.name}</title>
            <RenderMapNodes selectedIds={selectedIds} elements={el.children} />
          </g>
        );
      }
      case "image": {
        const { baseRect, imageKey, cssTransform } = el;
        const isSelected = selectedIds.has(el.id);

        return imageKey !== "unset" ? (
          <image
            key={el.id}
            data-node-id={el.id}
            href={`/starship-symbol/${imageKey}.png`}
            x={0}
            y={0}
            width={baseRect.width}
            height={baseRect.height}
            style={{ transform: cssTransform }}
            preserveAspectRatio="none"
            className={cn("outline outline-white/10", isSelected && "outline-blue-500")}
          >
            <title>{el.name}</title>
          </image>
        ) : (
          <QuestionIcon
            key={el.id}
            x={0}
            y={0}
            width={baseRect.width}
            height={baseRect.height}
            transform={cssTransform}
            preserveAspectRatio=""
          />
        );
      }
      case "rect": {
        const isSelected = selectedIds.has(el.id);
        const cssTransform = `translate(${el.transform.x}px, ${el.transform.y}px) scale(${el.transform.scale})`;
        return (
          <rect
            key={el.id}
            data-node-id={el.id}
            x={0}
            y={0}
            width={el.baseRect.width}
            height={el.baseRect.height}
            style={{ transform: cssTransform }}
            // fill="rgba(0, 0, 0, 0.25)"
            stroke={isSelected ? "rgba(50, 50, 255, 1)" : "rgba(0, 0, 0, 0.5)"}
            strokeWidth={0}
            className={cn(
              "fill-green-700/50 outline outline-black/80",
              isSelected && "outline-blue-500",
            )}
          >
            <title>{el.name}</title>
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

function RectResizeHandles({
  selectedNode,
  root,
}: {
  selectedNode: MapRectNode;
  root: UseStateRef<State>;
}) {
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
    <line
      x1={-originLineLength}
      y1={0}
      x2={originLineLength}
      y2={0}
      stroke={originLineColor}
      strokeWidth={1}
    />
    <line
      x1={0}
      y1={-originLineLength}
      x2={0}
      y2={originLineLength}
      stroke={originLineColor}
      strokeWidth={1}
    />
    <rect
      x="-10000"
      y="-10000"
      width="20000"
      height="20000"
      fill="url(#grid)"
      className="pointer-events-none"
    />
  </g>
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
