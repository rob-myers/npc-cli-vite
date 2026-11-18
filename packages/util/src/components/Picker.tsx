import { Select } from "@base-ui/react/select";
import { CaretDownIcon } from "@phosphor-icons/react";
import { type ReactNode, type SyntheticEvent, useState } from "react";
import { cn } from "../service/tailwind-cn";

/** One of `options`, chosen from a base-ui `Select` — as wide as what is chosen, and no wider */
export function Picker<T extends string>(props: {
  value: T;
  options: readonly (T | { value: T; label: string })[];
  onChange(value: T): void;
  disabled?: boolean;
  /** Only its chevron opens it, so what is chosen is shown elsewhere */
  chevronOnly?: boolean;
  /** A button before each option, doing something with it besides choosing it. It closes the popup */
  optionAction?: { title: string; icon(value: T): ReactNode; onAction(value: T): void };
  title?: string;
  className?: string;
  /** The popup is portalled out of its panel, whose theme it takes by this class */
  popupClassName: string;
}) {
  const options = props.options.map((o) => (typeof o === "string" ? { value: o, label: o } : o));
  const label = options.find((o) => o.value === props.value)?.label ?? props.value;
  const [open, setOpen] = useState(false);
  const action = props.optionAction;
  return (
    <Select.Root
      open={open}
      onOpenChange={setOpen}
      value={props.value}
      disabled={props.disabled}
      onValueChange={(v) => props.onChange(v as T)}
    >
      <Select.Trigger
        title={props.title}
        className={cn(
          "flex items-center gap-1 w-fit max-w-full min-w-0 px-1 py-0.5 rounded border border-zinc-800 bg-zinc-900",
          "text-zinc-300 outline-none cursor-pointer hover:bg-zinc-800 focus-visible:border-zinc-600",
          "data-disabled:opacity-50 data-disabled:cursor-default",
          props.className,
        )}
      >
        {!props.chevronOnly && <span className="truncate">{label}</span>}
        <CaretDownIcon className="size-3 shrink-0 text-zinc-500" />
      </Select.Trigger>
      <Select.Portal>
        <Select.Positioner className="z-50" sideOffset={4} align="start" alignItemWithTrigger={false}>
          <Select.Popup
            className={cn(
              props.popupClassName,
              "bg-zinc-800 border border-zinc-700 rounded shadow-lg py-1 max-h-60 overflow-auto text-xs text-zinc-300",
            )}
          >
            {options.map(({ value, label }) => (
              <Select.Item
                key={value}
                value={value}
                className="flex items-center gap-1 px-3 py-1 cursor-pointer outline-none data-highlighted:bg-zinc-700 data-selected:text-zinc-100"
              >
                {action && (
                  // its own presses never reach the option, so it is not chosen
                  <button
                    type="button"
                    title={action.title}
                    className="-my-0.5 -ml-1.5 p-0.5 rounded cursor-pointer opacity-60 hover:opacity-100 hover:bg-black/20"
                    onPointerDown={stopPropagation}
                    onPointerUp={stopPropagation}
                    onMouseUp={stopPropagation}
                    onClick={(e) => {
                      e.stopPropagation();
                      setOpen(false);
                      action.onAction(value);
                    }}
                  >
                    {action.icon(value)}
                  </button>
                )}
                <Select.ItemText>{label}</Select.ItemText>
              </Select.Item>
            ))}
          </Select.Popup>
        </Select.Positioner>
      </Select.Portal>
    </Select.Root>
  );
}

const stopPropagation = (e: SyntheticEvent) => e.stopPropagation();
