import type { PaneEdge, UseStateRef } from "@npc-cli/util";
import type React from "react";
import { createContext } from "react";
import type { SkipNetLeaf, SkipNetPaneNode, SkipNetUiMeta } from "./schema";

export type State = {
  /** Clear was pressed once, so a second press clears */
  clearArmed: boolean;
  clearTimeoutId: number;
  /** The pane dragged by its grip, where it would land, and where the drag began */
  drag: null | {
    sourceId: number;
    targetId: null | number;
    /** `center` swaps, dropped on the other's grip */
    edge: null | PaneEdge;
    /** It has moved `dragStartPx` from `x`, `y` */
    moved: boolean;
    x: number;
    y: number;
  };
  /** Shows where a dragged pane would land */
  dropEl: null | HTMLDivElement;
  /** What jsh mounted on our World, read once for every pane */
  items: JshCli.SkipNetItem[];
  meta: SkipNetUiMeta;
  rootEl: null | HTMLDivElement;
  /** Ends a drag without a drop */
  cancelDrag(): void;
  /** Every pane gone but one empty, on a second press */
  clear(): void;
  close(paneId: number): void;
  endDrag(): void;
  /** Adds a jobs pane and a library pane, unless there are some */
  ensureJobs(): void;
  moveDrag(e: React.PointerEvent): void;
  /** Escape cancels a drag */
  onDragKey(e: KeyboardEvent): void;
  setLeaf(paneId: number, leaf: SkipNetLeaf): void;
  setPanes(panes: SkipNetPaneNode): void;
  setSizes(splitId: number, sizes: number[]): void;
  split(paneId: number, edge: "right" | "bottom"): void;
  startDrag(e: React.PointerEvent, paneId: number): void;
};

/** Where a pane is dropped beside another */
export type SplitEdge = Exclude<PaneEdge, "center">;

export const SkipNetContext = createContext<UseStateRef<State>>(null as never);
