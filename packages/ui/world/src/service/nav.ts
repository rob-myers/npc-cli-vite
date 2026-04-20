import type { FindNearestPolyResult } from "navcat";

export const emptyFailedResult: FindNearestPolyResult = {
  success: false,
  nodeRef: -1,
  position: [0, 0, 0],
};
