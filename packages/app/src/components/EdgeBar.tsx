import { cn, useStateRef } from "@npc-cli/util";
import { BookOpenTextIcon } from "@phosphor-icons/react";
import { motion } from "motion/react";
import { type PaneNode, showPane } from "./pane-service";

/**
 * The indicators for a split's hidden panes: click one to show that pane again,
 * or drag the group along the edge it sits on.
 */
export default function EdgeBar({
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
  const state = useStateRef(() => ({
    dragged: false,
    nodeId,

    onDragStart() {
      state.dragged = true;
    },
    onDragEnd() {
      // cleared a frame late, else the click ending the drag would still show the pane
      requestAnimationFrame(() => (state.dragged = false));
    },
    onPaneClick(e: React.MouseEvent<HTMLButtonElement>) {
      if (state.dragged === false) {
        showPane(state.nodeId, Number(e.currentTarget.dataset.childId));
      }
    },
  }));

  state.nodeId = nodeId; // its handlers run long after this render

  return (
    <motion.div
      className="touch-none select-none"
      drag={axis}
      dragConstraints={constraintsRef}
      dragElastic={0.05}
      dragMomentum={false}
      onDragStart={state.onDragStart}
      onDragEnd={state.onDragEnd}
    >
      {panes.map((child) => (
        <button
          key={child.id}
          type="button"
          data-child-id={child.id}
          className={cn(
            "px-4 py-2 mb-2 text-xs rounded cursor-pointer",
            "text-on-background/50 bg-background hover:border hover:border-on-background/25 hover:text-on-background",
          )}
          onClick={state.onPaneClick}
        >
          <BookOpenTextIcon className="size-6" />
        </button>
      ))}
    </motion.div>
  );
}
