import { Tooltip } from "@base-ui/react/tooltip";
import type { ReactElement, ReactNode } from "react";

/**
 * A base-ui tooltip over `children`, which must take a ref and props, e.g. a `button`. No `content`, it is off.
 * A disabled child gets no hover, so a span round it takes the pointer.
 */
export function Tip({ content, children, side = "top" }: { content: ReactNode; children: ReactElement; side?: Side }) {
  /** Off rather than absent, so the child never remounts as its content comes and goes */
  const off = content == null || content === "";
  const disabled = !off && (children.props as { disabled?: unknown }).disabled === true;
  return (
    <Tooltip.Root disabled={off}>
      <Tooltip.Trigger
        // base-ui binds hover to the first element, so a swap to or from the span remounts it
        key={disabled ? "wrapped" : "bare"}
        delay={tipDelayMs}
        render={disabled ? <span className="inline-flex">{children}</span> : children}
      />
      {!off && (
        <Tooltip.Portal>
          <Tooltip.Positioner side={side} sideOffset={6} className="z-10001">
            <Tooltip.Popup className="px-2 py-1 rounded border border-neutral-700 bg-neutral-800 font-sans text-xs text-neutral-200 shadow-lg shadow-black/50 transition-opacity duration-150 data-starting-style:opacity-0 data-ending-style:opacity-0">
              {content}
            </Tooltip.Popup>
          </Tooltip.Positioner>
        </Tooltip.Portal>
      )}
    </Tooltip.Root>
  );
}

type Side = "top" | "bottom" | "left" | "right";
/** How long a pointer rests on it before it shows */
const tipDelayMs = 300;
