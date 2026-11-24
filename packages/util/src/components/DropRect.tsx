import type { CSSProperties } from "react";
import type { DropSide } from "../service/drop-side";

/** Where a drop would go: `size` is its share of its parent along `at`'s axis */
export function DropRect({ at, size }: { at: DropSide; size: number }) {
  const pct = `${size * 100}%`;
  const rectOf: Record<DropSide, CSSProperties> = {
    top: { inset: 0, bottom: "auto", height: pct },
    bottom: { inset: 0, top: "auto", height: pct },
    left: { inset: 0, right: "auto", width: pct },
    right: { inset: 0, left: "auto", width: pct },
  };
  return (
    <div
      className="pointer-events-none absolute z-20 outline-2 -outline-offset-4 outline-blue-400 bg-blue-400/20"
      style={rectOf[at]}
    />
  );
}
