import { uiStore } from "@npc-cli/ui-sdk/ui.store";
import { cn } from "@npc-cli/util";
import { BookOpenTextIcon } from "@phosphor-icons/react";
import { Allotment } from "allotment";
import { motion } from "motion/react";
import { useRef } from "react";
import * as portals from "react-reverse-portal";
import { useStore } from "zustand";
import type { PaneNode } from "./pane-service";
import { setPaneHidden, setSizes, showPane } from "./pane-service";

export function PaneTree({ node }: { node: PaneNode }) {
  /** Bounds the hidden-pane indicators' drag — see `EdgeBar` */
  const containerRef = useRef<HTMLDivElement>(null);

  if (node.type === "leaf") {
    return <PaneLeaf node={node} />;
  }

  const hiddenSet = new Set(node.hiddenIds);
  const lastIndex = node.children.length - 1;
  const startHidden = node.children.filter((c, i) => hiddenSet.has(c.id) && i <= lastIndex / 2);
  const endHidden = node.children.filter((c, i) => hiddenSet.has(c.id) && i > lastIndex / 2);

  const isVertical = node.vertical;

  const posClass = {
    start: isVertical ? "top-0 left-1/2 -translate-x-1/2" : "left-0 top-1/2 -translate-y-1/2",
    end: isVertical ? "bottom-0 left-1/2 -translate-x-1/2" : "right-0 top-1/2 -translate-y-1/2",
  };

  const edgeBar = (children: PaneNode[], edge: "start" | "end") => {
    if (children.length === 0) return null;
    return (
      // the centring transform stays out here, so the drag transform has this element to itself
      <div className={`absolute z-10 ${posClass[edge]}`}>
        <EdgeBar
          nodeId={node.id}
          panes={children}
          // slides along the edge it sits on, not away from it
          axis={isVertical ? "x" : "y"}
          constraintsRef={containerRef}
        />
      </div>
    );
  };

  return (
    <div ref={containerRef} className="size-full relative">
      {edgeBar(startHidden, "start")}
      {edgeBar(endHidden, "end")}
      <Allotment
        key={`${node.id}-${isVertical}`}
        vertical={isVertical}
        defaultSizes={node.sizes}
        snap
        onDragEnd={(sizes) => setSizes(node.id, sizes)}
        onVisibleChange={(index, visible) => setPaneHidden(node.id, index, visible)}
      >
        {node.children.map((child) => (
          <Allotment.Pane key={child.id} visible={!hiddenSet.has(child.id)} snap minSize={90}>
            <PaneTree node={child} />
          </Allotment.Pane>
        ))}
      </Allotment>
    </div>
  );
}

/**
 * The indicators for a split's hidden panes: click one to show that pane again,
 * or drag the group along the edge it sits on.
 */
function EdgeBar({
  axis,
  constraintsRef,
  nodeId,
  panes,
}: {
  axis: "x" | "y";
  constraintsRef: React.RefObject<HTMLDivElement | null>;
  nodeId: number;
  panes: PaneNode[];
}) {
  const dragged = useRef(false);

  return (
    <motion.div
      className="touch-none select-none"
      drag={axis}
      dragConstraints={constraintsRef}
      dragElastic={0.05}
      dragMomentum={false}
      onDragStart={() => (dragged.current = true)}
      // cleared a frame late, else the click ending the drag would still show the pane
      onDragEnd={() => requestAnimationFrame(() => (dragged.current = false))}
    >
      {panes.map((child) => (
        <button
          key={child.id}
          type="button"
          className={cn(
            "px-4 py-2 mb-2 text-xs rounded cursor-pointer",
            "text-on-background/50 bg-background hover:border hover:border-on-background/25 hover:text-on-background",
          )}
          onClick={() => {
            if (dragged.current === false) {
              showPane(nodeId, child.id);
            }
          }}
        >
          <BookOpenTextIcon className="size-6" />
        </button>
      ))}
    </motion.div>
  );
}

function PaneLeaf({ node }: { node: Extract<PaneNode, { type: "leaf" }> }) {
  const portal = useStore(uiStore, (s) => (node.uiId ? s.byId[node.uiId]?.portal : undefined));

  return (
    <div className="size-full min-w-0 min-h-0 relative overflow-hidden bg-background text-on-background">
      {portal && <portals.OutPortal node={portal.portalNode} />}
    </div>
  );
}
