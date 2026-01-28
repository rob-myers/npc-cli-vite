import { Popover } from "@base-ui/react/popover";
import { type PropsWithChildren, useState } from "react";
import { cn } from "../service/tailwind-cn";
import { PopoverArrow } from "./PopoverArrow";

/**
 * Typically:
 * - `trigger` is text
 * - `children` is text or a button
 */
export function BasicPopover(
  props: PropsWithChildren<{
    /** For trigger */
    className?: string;
    trigger?: React.ReactNode;
    side?: "top" | "right" | "bottom" | "left";
    sideOffset?: number;
  }>,
) {
  const [handleRef] = useState(() => Popover.createHandle());

  return (
    <Popover.Root handle={handleRef}>
      <Popover.Trigger
        className={cn("cursor-pointer p-1", props.className)}
        onTouchStart={(e) => handleRef.open(e.currentTarget.parentElement!.id)}
      >
        {props.trigger}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner side={props.side} sideOffset={props.sideOffset}>
          <Popover.Popup>
            <PopoverArrow iconClassName="fill-gray-700 stroke-gray-700" />
            <Popover.Description className="flex items-center px-2 py-1 bg-gray-700 text-white/80 text-sm">
              {props.children}
            </Popover.Description>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
