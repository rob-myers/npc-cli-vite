import { Popover } from "@base-ui/react/popover";
import { cn, tw } from "@npc-cli/util";
import { useContext, useLayoutEffect, useRef, useState } from "react";
import { SkipNetContext } from "../context";

/** Where an article comes from: "source" in its window's title bar, a press showing its links */
export function PartSource({ source }: { source: undefined | Record<string, string> }) {
  const state = useContext(SkipNetContext);
  if (source === undefined) return null;
  return (
    <Popover.Root>
      <Popover.Trigger className={sourceClass}>source</Popover.Trigger>
      <Popover.Portal container={state.rootEl}>
        <Popover.Positioner
          className="z-3000"
          positionMethod="absolute"
          side="bottom"
          sideOffset={4}
          collisionPadding={8}
        >
          <Popover.Popup className={sourcePopupClass}>
            {Object.entries(source).map(([text, href]) => (
              <a key={href} href={href} target="_blank" rel="noopener noreferrer">
                {text}
              </a>
            ))}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

/**
 * When a part of an article was first committed and last changed, floated top-right beside its heading.
 * Before anything else, e.g. a video, they have a line of their own. Changed the same day, the one date
 */
export function PartDates({ dates }: { dates: undefined | { createdMs: number; modifiedMs: number } }) {
  const ref = useRef<HTMLDivElement>(null);
  /** Index of `dateForms`: the longest which fits beside a heading */
  const [form, setForm] = useState(0);
  /** A heading follows them, so they float beside it */
  const [beside, setBeside] = useState(true);
  const stamps = stampsOf(dates);

  // before the first paint, so a video never shows squeezed beside them
  useLayoutEffect(() => {
    const el = ref.current;
    const part = el?.parentElement;
    if (!el || !part || stamps.length === 0) return;
    const ctx = document.createElement("canvas").getContext("2d");
    const style = getComputedStyle(el);
    if (ctx) ctx.font = style.font;
    const spacing = Number.parseFloat(style.letterSpacing) || 0;
    const widthOf = (text: string) => (ctx?.measureText(text).width ?? text.length * 6) + text.length * spacing;
    /** By form, its widest line, measured once */
    const widths = dateForms.map((form) => Math.max(...stamps.map(([label, date]) => widthOf(form(label, date)))));
    /** A heading's tape beside them never shrinks, so they shorten in the room it leaves, and only then truncate */
    const fit = () => {
      const next = el.nextElementSibling;
      const tape = next?.querySelector(':scope > div > [role="heading"]');
      setBeside(tape != null || next?.matches(headingSelector) === true);
      const room = tape ? el.getBoundingClientRect().right - tape.getBoundingClientRect().right - tapeGapPx : Infinity;
      el.style.maxWidth = Number.isFinite(room) ? `${Math.max(0, room)}px` : "";
      const i = widths.findIndex((width) => width <= room);
      setForm(i === -1 ? widths.length - 1 : i);
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(part);
    return () => observer.disconnect();
  }, [dates?.createdMs, dates?.modifiedMs]);

  if (stamps.length === 0) return null;
  return (
    <div ref={ref} data-part-dates className={cn(datesClass, beside ? "float-right ml-3" : "mb-2")}>
      {stamps.map(([label, date]) => (
        <time
          key={label}
          dateTime={date.toISOString()}
          title={`${label} ${date.toLocaleString()}`}
          className="max-w-full truncate"
        >
          {dateForms[form](label, date)}
        </time>
      ))}
    </div>
  );
}

/** Its created date, then its updated one unless the same day */
function stampsOf(dates: undefined | { createdMs: number; modifiedMs: number }): [string, Date][] {
  if (dates === undefined) return [];
  const [created, modified] = [new Date(dates.createdMs), new Date(dates.modifiedMs)];
  return created.toDateString() === modified.toDateString()
    ? [["created", created]]
    : [
        ["created", created],
        ["updated", modified],
      ];
}

const longDate = (date: Date) =>
  date.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });

/** A date, labelled, then ever shorter: without its label, its year, then in figures */
const dateForms: ((label: string, date: Date) => string)[] = [
  (label, date) => `${label} ${longDate(date)}`,
  (_, date) => longDate(date),
  (_, date) => date.toLocaleDateString(undefined, { day: "numeric", month: "short" }),
  (_, date) => date.toLocaleDateString(undefined, { day: "numeric", month: "numeric", year: "2-digit" }),
];

/** Small and muted, a line each, as tall as a heading. A float, so the heading's rule stops short of it */
const datesClass = tw(
  "min-w-0 flex flex-col items-end font-mono text-[10px] leading-[1.2] tracking-wide text-mac-muted",
);
/** As small as the title bar's pickers, before the session picker */
const sourceClass = tw(
  "skip-net-no-drag order-first shrink-0 h-3.5 px-1 text-[11px] leading-none cursor-pointer text-mac-muted underline decoration-dotted hover:text-mac-text data-popup-open:text-mac-text",
);
/** As a side note's: the title bar's shade, a link a line */
const sourcePopupClass = tw(
  "flex flex-col gap-1 px-3 py-2 bg-mac-title text-mac-text rounded-md border border-mac-edge shadow-[1px_1px_0_var(--color-mac-shadow)] font-mono text-xs outline-none [&_a]:underline [&_a]:hover:text-mac-muted",
);
/** What the dates float beside: a markdown heading or a tape title */
const headingSelector = "h1, h2, h3, h4, [role='heading']";
/** Pixels kept between a heading's tape and the dates, its rule's least room */
const tapeGapPx = 24;
