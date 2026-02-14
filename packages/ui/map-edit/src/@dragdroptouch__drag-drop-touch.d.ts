declare module "@dragdroptouch/drag-drop-touch" {
  export interface DragDropTouchOptions {
    dragThresholdPixels?: number;
    allowDragScroll?: boolean;
    contextMenuDelayMS?: number;
    dragImageOpacity?: number;
    dragScrollPercentage?: number;
    dragScrollSpeed?: number;
    isPressHoldMode?: boolean;
    forceListen?: boolean;
    pressHoldDelayMS?: number;
    pressHoldMargin?: number;
    pressHoldThresholdPixels?: number;
  }

  export function enableDragDropTouch(
    dragRoot?: HTMLElement | null,
    dropRoot?: HTMLElement | null,
    options?: DragDropTouchOptions,
  ): void;
}
