import { cn } from "@npc-cli/util";
import { CaretUpIcon, CheckIcon, DotsThreeIcon, XIcon } from "@phosphor-icons/react";
import { Fragment, useEffect, useRef, useState } from "react";

import "./talk-thread.css";

/**
 * A conversation as speech bubbles: only the latest exchange and the one before it, dimmed, the rest
 * folded into an ellipsis which shows them, and folds them again — then the replies, each waiting on
 * its pips
 */
export function TalkThread(props: {
  lines: TalkLine[];
  replies: TalkReply[];
  /** Changes with the line replied to, so its replies pop in afresh */
  repliesKey: string;
  /** The answer is on its way */
  typing?: boolean;
  /** Under the replies, or instead of them */
  footer?: React.ReactNode;
  /** Given, each topic's rule clears its run of lines: theirs by `id` */
  onClear?(ids: TalkLine["id"][]): void;
}) {
  const [spread, setSpread] = useState(false);
  useEffect(() => setSpread(false), [props.lines.length]);

  // what was just said, or is now to be answered, is brought into view — not so as it mounts
  const foot = useRef<HTMLDivElement>(null);
  const mounted = useRef(false);
  useEffect(() => {
    if (mounted.current) foot.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    mounted.current = true;
  }, [props.lines.length, props.repliesKey, props.typing]);

  const rows = toRows(props.lines);
  const last = rows.at(-1);
  if (props.typing === true && last !== undefined && last.left === undefined) {
    last.left = { id: "typing", side: "left", text: "" };
  }

  /** Enough rows that folding hides more than the pill it costs */
  const foldable = rows.length - 2 >= minFolded;
  const folded = foldable && spread === false;

  return (
    // room for the tails either side
    <div className="flex flex-col gap-3 px-2 py-1">
      {foldable && (
        <button
          type="button"
          title={spread ? "fold them away" : "show them"}
          className="self-center flex items-center gap-1 px-2 rounded-full border border-zinc-700 bg-zinc-900/70 text-[10px] text-zinc-400 cursor-pointer hover:bg-zinc-800 hover:text-zinc-100"
          onClick={() => setSpread(spread === false)}
        >
          {spread ? (
            <CaretUpIcon weight="bold" className="size-4" />
          ) : (
            <DotsThreeIcon weight="bold" className="size-4" />
          )}
          {rows.length - 2} earlier
        </button>
      )}
      {rows.map((row, i) => {
        const latest = i === rows.length - 1;
        /** The one before the latest: dimmed, whilst those before it are folded into the ellipsis */
        const piled = i === rows.length - 2 && folded;
        /** The latest, with the earlier ones spread above it: a click folds them again */
        const piles = latest && spread && foldable;
        if (folded && i < rows.length - 2) return null;
        const topic = row.left?.topic;
        /** Folded, the first row shown names its topic whether or not it turned to it there */
        const heads = folded && i === rows.length - 2;
        return (
          <Fragment key={row.left?.id ?? row.right?.id}>
            {topic !== undefined && (heads || topic !== rows[i - 1]?.left?.topic) && (
              <div className="talk-topic text-[10px] uppercase" style={{ color: `hsl(${topicHue(topic)} 60% 60%)` }}>
                {topic}
                {props.onClear !== undefined && (
                  <XIcon
                    className="size-3 cursor-pointer opacity-50 hover:opacity-100"
                    onClick={() => props.onClear?.(runIds(rows, i))}
                  >
                    <title>clear these lines</title>
                  </XIcon>
                )}
              </div>
            )}
            {/* said and answered on one row, the answer a little lower: on its own only when too long */}
            <div
              title={piled ? "show the earlier ones" : piles ? "fold the earlier ones away" : undefined}
              className={cn(
                "talk-row flex flex-row-reverse flex-wrap items-start gap-x-3",
                (piled || piles) && "cursor-pointer",
                piled && "talk-dim",
              )}
              onClick={piled ? () => setSpread(true) : piles ? () => setSpread(false) : undefined}
            >
              {row.right !== undefined && <Bubble line={row.right} faded={latest === false} />}
              {row.left !== undefined && (
                <Bubble
                  line={row.left}
                  faded={latest === false}
                  typing={row.left.id === "typing"}
                  // a piled one only spreads the rest
                  active={piled === false}
                />
              )}
            </div>
          </Fragment>
        );
      })}
      {props.typing !== true && props.replies.length > 0 && (
        <div key={props.repliesKey} className="flex flex-wrap justify-end gap-1.5">
          {props.replies.map((reply, i) => {
            const ready = reply.pips.every((pip) => pip.met !== false);
            return (
              <button
                key={i}
                type="button"
                disabled={ready === false}
                title={
                  ready ? undefined : reply.pips.map((pip) => `${pip.met === true ? "✓" : "·"} ${pip.label}`).join("\n")
                }
                className="talk-choice flex items-center gap-1.5 pl-1 pr-2.5 py-1 cursor-pointer"
                style={{ animationDelay: `${i * choiceStaggerMs}ms` }}
                onClick={reply.onChoose}
              >
                <span className="grid place-items-center size-4 rounded-full bg-zinc-800 text-[10px] text-zinc-400">
                  {i + 1}
                </span>
                <Glyphed text={reply.text} />
                <Pips pips={reply.pips} />
                {reply.seen === true && <CheckIcon className="size-3 shrink-0 text-zinc-500" />}
              </button>
            );
          })}
        </div>
      )}
      {props.footer}
      {/* no row of its own: the gap before it is taken back */}
      <div ref={foot} className="-mt-3" />
    </div>
  );
}

/** One segment per test a reply waits on: green once met, outlined when nothing is tested */
export function Pips({ pips }: { pips: TalkPip[] }) {
  return (
    pips.length > 0 && (
      <span className="flex gap-0.5" title={pips.map((pip) => pip.label).join(", ")}>
        {pips.map((pip, i) => (
          <span key={i} className="talk-pip" data-met={pip.met === undefined ? undefined : String(pip.met)} />
        ))}
      </span>
    )
  );
}

/** Text whose emoji are each an element, to grow under the pointer */
export function Glyphed({ text }: { text: string }) {
  const glyphs = text.match(emojiRe) ?? [];
  return (
    <span>
      {text.split(emojiRe).map((words, i) => (
        <Fragment key={i}>
          {words}
          {glyphs[i] !== undefined && <span className="talk-glyph">{glyphs[i]}</span>}
        </Fragment>
      ))}
    </span>
  );
}

/** A line said, in a bubble with a tail at its speaker's corner */
function Bubble(props: { line: TalkLine; faded: boolean; typing?: boolean; active?: boolean }) {
  const { line } = props;
  const hue = line.topic === undefined ? undefined : topicHue(line.topic);
  const tint = hue === undefined ? undefined : `hsl(${hue} 60% 55% / 0.22)`;
  const onClick = props.active === false ? undefined : line.onClick;
  return (
    <div
      title={props.active === false ? undefined : line.title}
      data-side={line.side}
      className={cn(
        "talk-bubble max-w-[85%] px-2.5 py-1 select-text",
        line.thought !== undefined && "talk-thought italic",
        line.side === "left" ? "mr-auto mt-3 bg-zinc-900" : "bg-zinc-300 text-zinc-950",
        props.faded ? "brightness-75 hover:brightness-100" : line.side === "left" && "text-zinc-100",
        onClick !== undefined && "cursor-pointer",
      )}
      style={
        line.thought !== undefined
          ? { borderColor: line.thought.color, color: line.thought.color }
          : tint === undefined
            ? undefined
            : { background: `linear-gradient(${tint}, ${tint}), var(--color-zinc-900)` }
      }
      onClick={onClick}
    >
      {line.who !== undefined && <div className="text-[10px] opacity-60">{line.who}</div>}
      {line.thought !== undefined && (
        <div className="text-[10px] uppercase not-italic opacity-70">{line.thought.khandha}</div>
      )}
      {props.typing === true ? (
        <span className="talk-dots">
          <span />
          <span />
          <span />
        </span>
      ) : (
        <Glyphed text={line.text} />
      )}
    </div>
  );
}

/** The lines of the run of rows about one topic which row `at` is in, a row with none going with those before */
function runIds(rows: ReturnType<typeof toRows>, at: number) {
  const topics: (string | undefined)[] = [];
  for (const row of rows) topics.push(row.left?.topic ?? topics.at(-1));
  let [from, to] = [at, at];
  while (from > 0 && topics[from - 1] === topics[at]) from--;
  while (to < rows.length - 1 && topics[to + 1] === topics[at]) to++;
  return rows
    .slice(from, to + 1)
    .flatMap((row) => [row.right, row.left])
    .flatMap((line) => (line === undefined || line.id === "typing" ? [] : [line.id]));
}

/** A reply and the answer to it share a row */
function toRows(lines: TalkLine[]) {
  const rows: { left?: TalkLine; right?: TalkLine }[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.side === "right" && lines[i + 1]?.side === "left") rows.push({ right: line, left: lines[++i] });
    else rows.push(line.side === "right" ? { right: line } : { left: line });
  }
  return rows;
}

/** A topic's own hue, the same wherever it turns up */
function topicHue(topic: string) {
  let hash = 0;
  for (const char of topic) hash = (hash * 31 + char.charCodeAt(0)) % 360;
  return hash;
}

export type TalkLine = {
  id: number | string;
  /** The player's on the right */
  side: "left" | "right";
  text: string;
  /** Tints it, and a rule names it where it changes */
  topic?: string;
  /** Thought, not said: outlined in its khandha's colour, which it names */
  thought?: { khandha: string; color: string };
  /** Who says it, where more than two talk */
  who?: string;
  title?: string;
  onClick?(): void;
};

export type TalkReply = { text: string; pips: TalkPip[]; seen?: boolean; onChoose(): void };

/** `met` unknown draws it neutral, as a hint */
export type TalkPip = { label: string; met?: boolean };

/** An emoji whole: its variation selector, and whatever a joiner ties on */
const emojiRe = /\p{Extended_Pictographic}️?(?:‍\p{Extended_Pictographic}️?)*/gu;
const choiceStaggerMs = 40;
/** The fewest earlier rows worth folding away */
const minFolded = 2;
