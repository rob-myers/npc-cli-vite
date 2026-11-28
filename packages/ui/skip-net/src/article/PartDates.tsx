import { tw } from "@npc-cli/util";
import { Fragment, useEffect, useRef } from "react";

/** Where an article comes from, as links in its window's title bar */
export function PartSource({ source }: { source: undefined | Record<string, string> }) {
  if (source === undefined) return null;
  return (
    <div className={sourceClass}>
      {Object.entries(source).map(([text, href], i) => (
        <Fragment key={href}>
          {i > 0 && ", "}
          <a href={href} target="_blank" rel="noopener noreferrer">
            {text}
          </a>
        </Fragment>
      ))}
    </div>
  );
}

/** When a part of an article was first committed and last changed, floated top-right beside its heading. Changed the same day, the one date */
export function PartDates({ dates }: { dates: undefined | { createdMs: number; modifiedMs: number } }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    const part = el?.parentElement;
    if (!el || !part) return;
    /** A heading's tape beside them never shrinks, so they truncate in the room it leaves */
    const fit = () => {
      const tape = el.nextElementSibling?.querySelector(':scope > div > [role="heading"]');
      el.style.maxWidth = tape
        ? `${Math.max(0, el.getBoundingClientRect().right - tape.getBoundingClientRect().right - tapeGapPx)}px`
        : "";
    };
    const observer = new ResizeObserver(fit);
    observer.observe(part);
    return () => observer.disconnect();
  }, []);

  if (dates === undefined) return null;
  const [created, modified] = [new Date(dates.createdMs), new Date(dates.modifiedMs)];
  const sameDay = created.toDateString() === modified.toDateString();
  return (
    <div ref={ref} data-part-dates className={datesClass}>
      <DateStamp label="created" date={created} />
      {!sameDay && <DateStamp label="updated" date={modified} />}
    </div>
  );
}

/** A labelled date, its full time on hover */
function DateStamp({ label, date }: { label: string; date: Date }) {
  return (
    <span className="max-w-full truncate">
      {label}{" "}
      <time dateTime={date.toISOString()} title={date.toLocaleString()} className="text-mac-text/80">
        {date.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}
      </time>
    </span>
  );
}

/** Small and muted, a line each, as tall as a heading. A float, so the heading's rule stops short of it */
const datesClass = tw(
  "float-right ml-3 min-w-0 flex flex-col items-end font-mono text-[10px] leading-[1.2] tracking-wide text-mac-muted",
);
/** As small as the title bar's pickers, on one line. Before the session picker, giving way first */
const sourceClass = tw(
  "skip-net-no-drag order-first min-w-0 shrink-[20] truncate text-[11px] text-mac-muted [&_a]:underline [&_a]:hover:text-mac-text",
);
/** Pixels kept between a heading's tape and the dates, its rule's least room */
const tapeGapPx = 24;
