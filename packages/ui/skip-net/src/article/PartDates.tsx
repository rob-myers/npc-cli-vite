import { tw } from "@npc-cli/util";

/** When a part of an article was first committed and last changed, floated top-right beside its heading. Changed the same day, the one date */
export function PartDates({ dates }: { dates: undefined | { createdMs: number; modifiedMs: number } }) {
  if (dates === undefined) return null;
  const [created, modified] = [new Date(dates.createdMs), new Date(dates.modifiedMs)];
  const sameDay = created.toDateString() === modified.toDateString();
  return (
    <div data-part-dates className={datesClass}>
      <DateStamp label="created" date={created} />
      {!sameDay && <DateStamp label="updated" date={modified} />}
    </div>
  );
}

/** A labelled date, its full time on hover */
function DateStamp({ label, date }: { label: string; date: Date }) {
  return (
    <span>
      {label}{" "}
      <time dateTime={date.toISOString()} title={date.toLocaleString()} className="text-mac-text/80">
        {date.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}
      </time>
    </span>
  );
}

/** Small and muted, a line each, as tall as a heading. A float, so the heading's rule stops short of it */
const datesClass = tw(
  "float-right ml-3 flex flex-col items-end font-mono text-[10px] leading-[1.2] tracking-wide text-mac-muted",
);
