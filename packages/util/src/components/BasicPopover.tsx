import { Popover } from "@base-ui/react/popover";
import type { PropsWithChildren } from "react";
import { preventReactGridDragClassName } from "../const";
import { cn } from "../service/tailwind-cn";
import { PopoverArrow } from "./PopoverArrow";

/**
 * Typically:
 * - `trigger` is text
 * - `children` is text or a button
 */
export function BasicPopover(
  props: PropsWithChildren<{
    className?: string;
    arrowClassName?: string;
    triggerClassName?: string;
    trigger?: React.ReactNode;
    side?: "top" | "right" | "bottom" | "left";
    sideOffset?: number;
  }>,
) {
  return (
    <Popover.Root>
      <Popover.Trigger
        className={cn(preventReactGridDragClassName, "cursor-pointer", props.triggerClassName)}
      >
        {props.trigger}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner side={props.side} sideOffset={props.sideOffset}>
          <Popover.Popup className="outline-0">
            <PopoverArrow
              className={props.arrowClassName ?? "fill-gray-200"}
              arrowBorderFill="#00000033"
            />
            <Popover.Description
              render={(descriptionProps) => (
                <div
                  {...descriptionProps}
                  className={cn(
                    "border border-black/20 flex items-center px-2 py-1 bg-gray-200 text-black text-sm",
                    props.className,
                  )}
                />
              )}
            >
              {props.children}
            </Popover.Description>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
