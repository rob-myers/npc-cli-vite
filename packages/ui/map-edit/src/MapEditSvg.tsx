import { uiClassName } from "@npc-cli/ui-sdk";
import { cn, type UseStateRef } from "@npc-cli/util";
import { memo } from "react";
import type { ResizeHandle, State } from "./MapEdit";
import type { MapNode } from "./map-node-api";

export function MapEditSvg({ root }: { root: UseStateRef<State> }) {
  const baseSize = 500;
  const vbW = baseSize / root.zoom;
  const vbH = baseSize / root.zoom;
  const vbX = (baseSize - vbW) / 2 - root.pan.x / root.zoom;
  const vbY = (baseSize - vbH) / 2 - root.pan.y / root.zoom;

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
      <DefsAndGrid />
      <Origin />
      <RenderMapNodes state={root} elements={root.elements} />
    </svg>
  );
}

const RenderMapNodes = ({
  state,
  elements,
}: {
  state: UseStateRef<State>;
  elements: MapNode[];
}) => {
  return elements.map((el) => {
    switch (el.type) {
      case "group":
        return (
          <g key={el.id} data-node-id={el.id} transform={el.transform}>
            <title>{el.name}</title>
            <RenderMapNodes state={state} elements={el.children} />
          </g>
        );
      case "rect": {
        const { rect } = el;
        const isSelected = el.id === state.selectedId;
        return (
          <g key={el.id}>
            <rect
              data-node-id={el.id}
              x={rect.x}
              y={rect.y}
              width={rect.width}
              height={rect.height}
              fill="rgba(0, 0, 0, 0.25)"
              stroke={isSelected ? "rgba(50, 50, 255, 1)" : "rgba(0, 0, 0, 0.5)"}
              strokeWidth={2}
            >
              <title>{el.name}</title>
            </rect>
            {isSelected && <RectResizeHandles rect={rect} />}
          </g>
        );
      }
      default:
        return null;
    }
  });
};

const resizeHandleSize = 8;
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

function RectResizeHandles({ rect }: { rect: Rect }) {
  return (
    <>
      {resizeHandles.map(({ handle, getPos }) => {
        const pos = getPos(rect);
        return (
          <rect
            key={handle}
            data-resize-handle={handle}
            x={pos.x - resizeHandleSize / 2}
            y={pos.y - resizeHandleSize / 2}
            width={resizeHandleSize}
            height={resizeHandleSize}
            stroke="rgba(100, 100, 100, 1)"
            strokeWidth={1}
            className={cn("fill-background", handleToCursor[handle])}
          />
        );
      })}
    </>
  );
}

const originLineLength = 4096;
const originLineColor = "rgba(255, 0, 0, 0.5)";
const Origin = memo(() => (
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
  </g>
));

const DefsAndGrid = memo(() => (
  <>
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
        <path d="M 50 0 L 0 0 0 50" fill="none" stroke="rgba(100, 116, 139, 0.5)" strokeWidth="1" />
      </pattern>
    </defs>
    <rect
      x="-10000"
      y="-10000"
      width="20000"
      height="20000"
      fill="url(#grid)"
      className="pointer-events-none"
    />
  </>
));
