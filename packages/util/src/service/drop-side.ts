import type { PaneEdge } from "./pane-tree";

/** The side of a rect a drag would drop onto */
export type DropSide = Exclude<PaneEdge, "center">;

/** The side whose edge's centre the point is near, if any */
export function dropSideAt(rect: DOMRect, x: number, y: number): null | DropSide {
  const fx = (x - rect.left) / rect.width;
  const fy = (y - rect.top) / rect.height;
  const alongX = Math.abs(fx - 0.5) < zoneAlong / 2;
  const alongY = Math.abs(fy - 0.5) < zoneAlong / 2;
  if (alongX && fy < zoneDepth) return "top";
  if (alongX && fy > 1 - zoneDepth) return "bottom";
  if (alongY && fx < zoneDepth) return "left";
  if (alongY && fx > 1 - zoneDepth) return "right";
  return null;
}

/** An edge's centre, as a share of the rect: how far in, and how far along */
const zoneDepth = 0.2;
const zoneAlong = 0.5;
