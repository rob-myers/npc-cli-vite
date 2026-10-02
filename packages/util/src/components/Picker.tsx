import { Select } from "@base-ui/react/select";
import { CaretDownIcon } from "@phosphor-icons/react";
import { cn } from "../service/tailwind-cn";

/** One of `options`, chosen from a base-ui `Select` — as wide as what is chosen, and no wider */
export function Picker<T extends string>(props: {
  value: T;
  options: readonly (T | { value: T; label: string })[];
  onChange(value: T): void;
  disabled?: boolean;
  title?: string;
  className?: string;
  /** The popup is portalled out of its panel, whose theme it takes by this class */
  popupClassName: string;
}) {
  const options = props.options.map((o) => (typeof o === "string" ? { value: o, label: o } : o));
  const label = options.find((o) => o.value === props.value)?.label ?? props.value;
  return (
    <Select.Root value={props.value} disabled={props.disabled} onValueChange={(v) => props.onChange(v as T)}>
      <Select.Trigger
        title={props.title}
        className={cn(
          "flex items-center gap-1 w-fit max-w-full min-w-0 px-1 py-0.5 rounded border border-zinc-800 bg-zinc-900",
          "text-zinc-300 outline-none cursor-pointer hover:bg-zinc-800 focus-visible:border-zinc-600",
          "data-disabled:opacity-50 data-disabled:cursor-default",
          props.className,
        )}
      >
        <span className="truncate">{label}</span>
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
                className="px-3 py-1 cursor-pointer outline-none data-highlighted:bg-zinc-700 data-selected:text-zinc-100"
              >
                <Select.ItemText>{label}</Select.ItemText>
              </Select.Item>
            ))}
          </Select.Popup>
        </Select.Positioner>
      </Select.Portal>
    </Select.Root>
  );
}
