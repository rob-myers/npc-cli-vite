import { uiStore } from "@npc-cli/ui-sdk/ui.store";
import { useStateRef } from "@npc-cli/util";
import { Allotment, type AllotmentHandle } from "allotment";
import { lazy, Suspense, useEffect } from "react";
import * as portals from "react-reverse-portal";
import { useStore } from "zustand";
import type { PaneNode } from "./pane-service";
import { setPaneHidden, setSizes } from "./pane-service";

/** Shown only once a pane is hidden, so its drag needn't load with the page */
const EdgeBar = lazy(() => import("./EdgeBar"));

export function PaneTree({ node }: { node: PaneNode }) {
  const state = useStateRef(() => ({
    allotment: null as null | AllotmentHandle,
    /** Bounds the hidden-pane indicators' drag — see `EdgeBar` */
    containerRef: { current: null as null | HTMLDivElement },
    /** Ids collapsed as of the previous sync, so we can spot one being expanded */
    hidden: new Set<number>(),
    /** Live pane sizes, unlike `node.sizes` which only updates on drag end */
    sizes: [] as number[],

    /**
     * Allotment restores a re-shown pane to whatever size it had before collapsing, often a
     * sliver, so grow anything just revealed to at least its `1/n` share.
     */
    syncHidden(children: PaneNode[], hiddenIds: number[]) {
      const wasHidden = state.hidden;
      state.hidden = new Set(hiddenIds);

      const revealed = children.flatMap((child, i) =>
        wasHidden.has(child.id) && state.hidden.has(child.id) === false ? i : [],
      );
      if (revealed.length > 0) {
        state.allotment?.resize(withFairShare(state.sizes, revealed, children.length));
      }
    },
  }));

  const hiddenIds = node.type === "split" ? (node.hiddenIds ?? []) : [];

  // allotment's own effects run first, so by now the pane is visible and `sizes` is current
  useEffect(() => {
    if (node.type === "split") {
      state.syncHidden(node.children, hiddenIds);
    }
  }, [hiddenIds.join(",")]);

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
        <Suspense fallback={null}>
          <EdgeBar
            nodeId={node.id}
            panes={children}
            // slides along the edge it sits on, not away from it
            axis={isVertical ? "x" : "y"}
            constraintsRef={state.containerRef}
          />
        </Suspense>
      </div>
    );
  };

  return (
    <div ref={state.containerRef} className="size-full relative">
      {edgeBar(startHidden, "start")}
      {edgeBar(endHidden, "end")}
      <Allotment
        key={`${node.id}-${isVertical}`}
        ref={state.ref("allotment")}
        vertical={isVertical}
        // without sizes, allotment places its panes only after the first paint, overlapping till then
        defaultSizes={node.sizes ?? node.children.map(() => 100)}
        snap
        onChange={(sizes) => (state.sizes = sizes)}
        onDragEnd={(sizes) => setSizes(node.id, sizes)}
        onVisibleChange={(index, visible) => setPaneHidden(node.id, index, visible)}
      >
        {node.children.map((child) => (
          <Allotment.Pane key={child.id} visible={!hiddenSet.has(child.id)} snap minSize={180} preferredSize={"50%"}>
            <PaneTree node={child} />
          </Allotment.Pane>
        ))}
      </Allotment>
    </div>
  );
}

/**
 * Grows each pane in `revealed` to at least `1/paneCount` of the split, taking what it needs
 * from the others in proportion to their current size. Hidden panes are `0`, so they stay shut.
 */
function withFairShare(sizes: number[], revealed: number[], paneCount: number): number[] {
  const total = sizes.reduce((sum, size) => sum + size, 0);
  const share = total / paneCount;

  const next = [...sizes];
  let deficit = 0;
  for (const i of revealed) {
    if (next[i] < share) {
      deficit += share - next[i];
      next[i] = share;
    }
  }

  const otherTotal = sizes.reduce((sum, size, i) => (revealed.includes(i) ? sum : sum + size), 0);
  if (deficit === 0 || otherTotal <= deficit) {
    return next; // already fair, or nowhere to take it from
  }

  const scale = (otherTotal - deficit) / otherTotal;
  return next.map((size, i) => (revealed.includes(i) ? size : sizes[i] * scale));
}

function PaneLeaf({ node }: { node: Extract<PaneNode, { type: "leaf" }> }) {
  const portal = useStore(uiStore, (s) => (node.uiId ? s.byId[node.uiId]?.portal : undefined));

  return (
    <div className="size-full min-w-0 min-h-0 relative overflow-hidden bg-background text-on-background">
      {portal && <portals.OutPortal node={portal.portalNode} />}
    </div>
  );
}
