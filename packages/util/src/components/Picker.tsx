import { Select } from "@base-ui/react/select";
import { CaretDownIcon } from "@phosphor-icons/react";
import { type ReactNode, type SyntheticEvent, useRef, useState } from "react";
import { isTouchDevice } from "../legacy/dom";
import { cn } from "../service/tailwind-cn";
import { Tip } from "./Tip";

/** One of `options`, chosen from a base-ui `Select` — as wide as what is chosen, and no wider */
export function Picker<T extends string>(props: {
  value: T;
  options: readonly (T | { value: T; label: string })[];
  onChange(value: T): void;
  disabled?: boolean;
  /** Only its chevron opens it, so what is chosen is shown elsewhere */
  chevronOnly?: boolean;
  /** Something to do with an option besides choosing it, closing the popup: a button after it, on touch a long press */
  optionAction?: { title: string; icon(value: T): ReactNode; onAction(value: T): void };
  /** An icon before an option, not a button */
  optionIcon?(value: T): ReactNode;
  title?: string;
  className?: string;
  /** The popup is portalled out of its panel, whose theme it takes by this class */
  popupClassName: string;
}) {
  const options = props.options.map((o) => (typeof o === "string" ? { value: o, label: o } : o));
  const label = options.find((o) => o.value === props.value)?.label ?? props.value;
  const [open, setOpen] = useState(false);
  const action = props.optionAction;
  /** On touch, a long press does `optionAction`: its timer, else "fired", so the lift ending it chooses nothing */
  const press = useRef<number | "fired">(0);
  const endPress = () => press.current !== "fired" && window.clearTimeout(press.current);
  const pressProps = (value: T) =>
    touchDevice && action
      ? {
          onPointerDown: () => {
            press.current = window.setTimeout(() => {
              press.current = "fired";
              navigator.vibrate?.(10);
              setOpen(false);
              action.onAction(value);
            }, longPressMs);
          },
          onPointerUp: endPress,
          onPointerCancel: endPress, // e.g. the list scrolled
          onPointerLeave: endPress,
          onClick: (e: { preventBaseUIHandler(): void }) => {
            if (press.current === "fired") (press.current = 0), e.preventBaseUIHandler();
          },
        }
      : {};
  return (
    <Select.Root
      open={open}
      onOpenChange={setOpen}
      value={props.value}
      disabled={props.disabled}
      onValueChange={(v) => props.onChange(v as T)}
    >
      <Tip content={props.title}>
        <Select.Trigger
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
      </Tip>
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
                className="flex items-center gap-1.5 px-3 py-1 cursor-pointer outline-none select-none [-webkit-touch-callout:none] data-highlighted:bg-zinc-700 data-selected:text-zinc-100"
                {...pressProps(value)}
              >
                {props.optionIcon?.(value)}
                <Select.ItemText className={cn(action && !touchDevice && "mr-3")}>{label}</Select.ItemText>
                {action && !touchDevice && (
                  // its own presses never reach the option, so it is not chosen
                  <Tip content={action.title}>
                    <button
                      type="button"
                      className="-my-0.5 -mr-1.5 ml-auto p-0.5 rounded cursor-pointer opacity-60 hover:opacity-100 hover:bg-black/20"
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
                  </Tip>
                )}
              </Select.Item>
            ))}
          </Select.Popup>
        </Select.Positioner>
      </Select.Portal>
    </Select.Root>
  );
}

const stopPropagation = (e: SyntheticEvent) => e.stopPropagation();

const touchDevice = isTouchDevice();
/** How long an option is pressed, on touch, to do its `optionAction` */
const longPressMs = 500;
