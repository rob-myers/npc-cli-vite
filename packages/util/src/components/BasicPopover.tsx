import { Popover } from "@base-ui/react/popover";
import { type PropsWithChildren, useState } from "react";
import { cn } from "../service/tailwind-cn";
import { PopoverArrow } from "./PopoverArrow";

/**
 * Typically:
 * - `trigger` is text
 * - `children` is text or a button
 */
export function BasicPopover(props: BasicPopoverProps) {
  return (
    <Popover.Root handle={props.handle} open={props.open} onOpenChange={props.onOpenChange}>
      <Popover.Trigger className={cn("cursor-pointer", props.triggerClassName)}>{props.trigger}</Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner
          className={props.positionerClassName}
          align={props.align}
          side={props.side}
          sideOffset={props.sideOffset}
          collisionPadding={props.collisionPadding}
        >
          <Popover.Popup className="outline-0" onPointerDown={props.onClick}>
            <PopoverArrow className={props.arrowClassName ?? "fill-gray-200"} arrowBorderFill="#00000033" />
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

type BasicPopoverProps = Pick<
  React.ComponentProps<typeof Popover.Positioner>,
  "align" | "collisionPadding" | "side" | "sideOffset"
> &
  PropsWithChildren<{
    arrowClassName?: string;
    positionerClassName?: string;
    triggerClassName?: string;
    className?: string;

    handle?: Popover.Handle<unknown>;
    open?: React.ComponentProps<typeof Popover.Root>["open"];
    trigger?: React.ReactNode;

    onOpenChange?: React.ComponentProps<typeof Popover.Root>["onOpenChange"];
    onClick?: React.ComponentProps<typeof Popover.Popup>["onClick"];
  }>;

export function CloseOnClickPopover(props: BasicPopoverProps) {
  const [open, setOpen] = useState(false);

  return <BasicPopover {...props} open={open} onOpenChange={setOpen} onClick={() => setOpen(false)} />;
}
