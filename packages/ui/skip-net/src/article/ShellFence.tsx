import { type Example, fenceIdOf, type SrcSegment, splitExamples, toSegments } from "@npc-cli/cli";
import { tokenCss } from "@npc-cli/cli/shell/sh-tokens";
import { worldTtyOf } from "@npc-cli/ui__jsh-prelude/run";
import { preludeApi, usePrelude } from "@npc-cli/ui__jsh-prelude/store";
import { UiContext } from "@npc-cli/ui-sdk/UiContext";
import { cn, Tip, tw } from "@npc-cli/util";
import { isTouchDevice } from "@npc-cli/util/legacy/dom";
import { CaretDownIcon, CaretUpIcon, CheckIcon, CopyIcon, LightningIcon, PlayIcon } from "@phosphor-icons/react";
import { type ComponentProps, isValidElement, useContext, useEffect, useMemo, useRef, useState } from "react";
import { SkipNetContext } from "../context";
import type { SkipNetUiMeta } from "../schema";
import { ArticleContext } from "./context";

/** An article's `pre`: a shell fence's commands run on a click, any other fence is shown as is */
export function ShellFence(props: ComponentProps<"pre">) {
  const code = props.children;
  if (
    isValidElement<{ className?: string; children?: unknown }>(code) &&
    typeof code.props.children === "string" &&
    (code.props.className === undefined || shellClasses.has(code.props.className))
  ) {
    return <ShellCommands src={code.props.children} />;
  }
  return <pre {...props} />;
}

/** Capped until its corner is dragged, which sets an inline height */
const fenceClass = tw(
  "group/fence not-prose my-3 py-1 min-h-10 [&:not([style*=height])]:max-h-40 resize-y overflow-y-auto scrollbar-thin rounded border border-term-border-subtle bg-term-fence",
);
/** A fade and caret at its foot whilst more is below, as a hidden scrollbar hides that it scrolls */
const moreClass = tw(
  "sticky bottom-0 h-6 -mt-6 flex items-end justify-center pointer-events-none bg-linear-to-t from-term-fence opacity-0 transition-opacity group-data-[more=true]/fence:opacity-100",
);

/** Its commands, in a box resized by its corner, its height saved */
function ShellCommands({ src }: { src: string }) {
  const { articleKey } = useContext(ArticleContext);
  const state = useContext(SkipNetContext);
  const { uiStoreApi } = useContext(UiContext);
  const boxRef = useRef<HTMLDivElement>(null);
  /** By its original, so an amendment can attach to it */
  const fenceId = fenceIdOf(articleKey, src);
  /** Highlighted once, rather than per render */
  const commands = useMemo(
    () => splitExamples(fenceId, src.split("\n")).map((example) => ({ example, segments: toSegments(example) })),
    [fenceId, src],
  );

  useEffect(() => {
    const el = boxRef.current;
    if (el === null) return;
    let timeoutId = 0;
    // only a drag of its corner sets its height inline
    const observer = new ResizeObserver(() => {
      const px = Math.round(Number.parseFloat(el.style.height));
      if (Number.isNaN(px) || px === state.meta.fenceHeights?.[fenceId]) return;
      window.clearTimeout(timeoutId);
      timeoutId = window.setTimeout(() => {
        uiStoreApi.setUiMeta(state.meta.id, (draft) => {
          const meta = draft as SkipNetUiMeta;
          meta.fenceHeights = { ...meta.fenceHeights, [fenceId]: px };
        });
      }, saveDelayMs);
    });
    observer.observe(el);
    return () => {
      observer.disconnect();
      window.clearTimeout(timeoutId);
    };
  }, [fenceId]);

  useEffect(() => {
    const el = boxRef.current;
    if (el === null) return;
    const sync = () => {
      el.dataset.more = String(el.scrollTop + el.clientHeight < el.scrollHeight - 1);
    };
    /** Its commands too, as one expanding changes what is below without resizing the box */
    const observer = new ResizeObserver(sync);
    observer.observe(el);
    for (const child of el.children) observer.observe(child);
    el.addEventListener("scroll", sync, { passive: true });
    return () => {
      observer.disconnect();
      el.removeEventListener("scroll", sync);
    };
  }, [commands]);

  const savedPx = state.meta.fenceHeights?.[fenceId];
  return (
    <div
      ref={boxRef}
      data-fence-id={fenceId}
      className={fenceClass}
      style={savedPx === undefined ? undefined : { height: savedPx }}
    >
      {commands.map(({ example, segments }) => (
        <ShellCommand key={example.id} example={example} segments={segments} />
      ))}
      <div className={moreClass}>
        <CaretDownIcon weight="bold" className="size-3.5 text-term-muted" />
      </div>
    </div>
  );
}

/** Its comment, a run button on its left, copy and expand on its right. Expanded, its command shows beneath */
function ShellCommand({ example, segments }: { example: Example; segments: SrcSegment[] }) {
  const { copiedSrc, copy, ranId, run, sessionKey } = useContext(ArticleContext);
  const [expanded, setExpanded] = useState(false);
  const toggle = () => setExpanded(!expanded);
  const { src } = example;
  /** Without a comment, its command is shown in its place */
  const commented = example.commentLines.length > 0;
  const command = (
    <code className={cn(codeCss, "min-w-0")}>
      {segments.map((segment, i) => (
        <span key={i} className={segment.arg === "key" ? "text-term-accent" : tokenCss[segment.kind]}>
          {segment.text}
        </span>
      ))}
    </code>
  );

  return (
    <div
      className={cn(
        "px-3 py-1 border border-transparent", // bordered throughout, so gaining the colour shifts nothing
        example.id === ranId && "border-term-ok/50 bg-term-ok/10",
        example.blankBefore > 0 && "mt-0.5",
        // run, comment, then copy and expand. Expanded, its command goes under the comment
        "grid grid-cols-[auto_1fr_auto] items-center gap-x-2",
      )}
    >
      <button
        type="button"
        title={sessionKey === null ? "no tty to run in" : "run"}
        disabled={sessionKey === null}
        className={runButtonCss}
        onClick={() => run(example.id, src)}
      >
        <PlayIcon weight="fill" className={runIconCss} />
      </button>
      {commented ? (
        <code
          className={cn(codeCss, tokenCss.comment, "min-w-0 cursor-pointer translate-y-px")} // its glyphs sit high
          onClick={toggle}
        >
          {example.commentLines.join("\n")}
        </code>
      ) : (
        command
      )}
      <span className="flex items-center gap-0.5">
        {example.bootable && <AutorunToggle example={example} />}
        <button type="button" title="copy" className={iconButtonCss} onClick={() => copy(src)}>
          {copiedSrc === src ? <CheckIcon className={cn(iconCss, "text-term-ok")} /> : <CopyIcon className={iconCss} />}
        </button>
        {commented && (
          <button
            type="button"
            title={expanded ? "hide command" : "show command"}
            className={iconButtonCss}
            onClick={toggle}
          >
            {expanded ? <CaretUpIcon className={iconCss} /> : <CaretDownIcon className={iconCss} />}
          </button>
        )}
      </span>
      {commented && expanded && <div className="col-start-2 col-span-2 mt-0.5">{command}</div>}
    </div>
  );
}

/** Whether the World's autorun runs it, in this article's tty */
function AutorunToggle({ example }: { example: Example }) {
  const { articleKey, sessionKey, worldKey } = useContext(ArticleContext);
  const entry = usePrelude(worldKey).entries.find((x) => x.id === example.id);
  const on = entry !== undefined;
  const toggle = () =>
    preludeApi.toggle(worldKey, {
      id: example.id,
      articleKey,
      sessionKey: sessionKey ?? undefined,
      src: example.src,
      comment: example.commentLines.join("\n"),
    });
  const tty = entry?.sessionKey ?? worldTtyOf(worldKey);
  const tip = on ? `autoruns in ${tty ?? "no tty yet"}` : "add to autorun";
  return (
    <Tip content={tip}>
      <button type="button" aria-pressed={on} className={cn(autorunButtonCss, on && autorunOnCss)} onClick={toggle}>
        {on && <LightningIcon weight="fill" className={cn(runIconCss, "col-start-1 row-start-1 text-yellow-300")} />}
        <LightningIcon className={cn(runIconCss, "col-start-1 row-start-1")} />
      </button>
    </Tip>
  );
}

const touchDevice = isTouchDevice();
/** How long after a resize its height is saved */
const saveDelayMs = 300;
/** MDX's class for a fence's language, `sh` or the like */
const shellClasses = new Set(["language-sh", "language-bash"]);

const codeCss = cn(
  "block font-mono text-[13px]/[1.45] whitespace-pre-wrap wrap-break-word",
  touchDevice && "text-[15px]/[1.45]",
);
/** A copy or expand button, right of an example's comment */
const iconButtonCss = cn(
  "grid place-items-center rounded cursor-pointer text-term-faint transition-colors hover:text-term-foreground hover:bg-term-hover-strong",
  touchDevice ? "size-8" : "size-5",
);
const iconCss = touchDevice ? "size-4.5" : "size-3.5";
/** A square button left of an example's comment, larger than the rest */
const sideButtonCss = cn(
  "shrink-0 grid place-items-center rounded border border-term-border-subtle cursor-pointer text-term-muted transition-colors",
  touchDevice ? "size-10" : "size-7",
);
/** The run button */
const runButtonCss = cn(
  sideButtonCss,
  "enabled:hover:text-term-ok enabled:hover:border-term-ok/50 enabled:hover:bg-term-ok/10 disabled:opacity-40 disabled:cursor-default",
);
const runIconCss = touchDevice ? "size-5" : "size-4";
/** The autorun toggle, right of the comment, as large as the run button */
const autorunButtonCss = cn(
  sideButtonCss,
  "mr-1.5 hover:text-term-accent hover:border-term-accent/50 hover:bg-term-accent/10",
);
/** Its bolt outlined in the foreground over a yellow fill */
const autorunOnCss = tw("text-term-foreground hover:text-term-foreground");
