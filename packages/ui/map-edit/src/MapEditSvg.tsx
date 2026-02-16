import { uiClassName } from "@npc-cli/ui-sdk";
import { cn, type UseStateRef } from "@npc-cli/util";
import { memo } from "react";
import type { State } from "./MapEdit";
import type { MapNode } from "./map-node-api";

export function MapEditSvg({ state }: { state: UseStateRef<State> }) {
  const baseSize = 500;
  const vbW = baseSize / state.zoom;
  const vbH = baseSize / state.zoom;
  const vbX = (baseSize - vbW) / 2 - state.pan.x / state.zoom;
  const vbY = (baseSize - vbH) / 2 - state.pan.y / state.zoom;

  return (
    <svg
      viewBox={`${vbX} ${vbY} ${vbW} ${vbH}`}
      className={cn(
        uiClassName,
        "size-full drop-shadow-2xl border border-white/20 overflow-visible",
      )}
      preserveAspectRatio="xMidYMid meet"
    >
      <RenderMapNodes state={state} elements={state.elements} />
      <DefsAndGrid />
    </svg>
  );
}

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
          <g key={el.id}>
            <RenderMapNodes state={state} elements={el.children} />
          </g>
        );
      default:
        return null;
    }
  });
};
