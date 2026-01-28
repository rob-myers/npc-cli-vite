import { Popover } from "@base-ui/react/popover";
import { cn } from "../service/tailwind-cn";

export function PopoverArrow({
  className = "fill-on-background stroke-on-background",
  arrowBorderFill,
}: {
  className?: string;
  arrowBorderFill?: string;
}) {
  return (
    <Popover.Arrow
      className={cn(
        "flex",
        "data-[side=top]:-bottom-2 data-[side=top]:rotate-180",
        "data-[side=bottom]:-top-2 data-[side=bottom]:rotate-0",
        "data-[side=left]:right-[-13px] data-[side=left]:rotate-90",
        "data-[side=right]:left-[-13px] data-[side=right]:-rotate-90",
      )}
    >
      <ArrowSvg className={cn("stroke-[0.1]", className)} arrowBorderFill={arrowBorderFill} />
    </Popover.Arrow>
  );
}

/** https://base-ui.com/react/components/popover */
function ArrowSvg({
  arrowBorderFill,
  ...props
}: React.ComponentProps<"svg"> & { arrowBorderFill?: string }) {
  return (
    <svg width="20" height="10" viewBox="0 0 20 10" fill="none" {...props}>
      <title>Arrow for popover</title>
      <path d="M9.66437 2.60207L4.80758 6.97318C4.07308 7.63423 3.11989 8 2.13172 8H0V10H20V8H18.5349C17.5468 8 16.5936 7.63423 15.8591 6.97318L11.0023 2.60207C10.622 2.2598 10.0447 2.25979 9.66437 2.60207Z" />
      <path
        fill={arrowBorderFill}
        d="M10.3333 3.34539L5.47654 7.71648C4.55842 8.54279 3.36693 9 2.13172 9H0V8H2.13172C3.11989 8 4.07308 7.63423 4.80758 6.97318L9.66437 2.60207C10.0447 2.25979 10.622 2.2598 11.0023 2.60207L15.8591 6.97318C16.5936 7.63423 17.5468 8 18.5349 8H20V9H18.5349C17.2998 9 16.1083 8.54278 15.1901 7.71648L10.3333 3.34539Z"
      />
    </svg>
  );
}
