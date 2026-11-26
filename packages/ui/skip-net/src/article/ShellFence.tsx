import { type Example, fenceIdOf, type SrcSegment, splitExamples, toSegments } from "@npc-cli/cli";
import { tokenCss } from "@npc-cli/cli/shell/sh-tokens";
import { worldTtyOf } from "@npc-cli/ui__jsh-prelude/run";
import { preludeApi, substitute, usePrelude } from "@npc-cli/ui__jsh-prelude/store";
import { UiContext } from "@npc-cli/ui-sdk/UiContext";
import { cn, Tip, tw } from "@npc-cli/util";
import { isTouchDevice } from "@npc-cli/util/legacy/dom";
import {
  CaretDownIcon,
  CaretRightIcon,
  CaretUpIcon,
  CheckIcon,
  CopyIcon,
  LightningIcon,
  PlayIcon,
} from "@phosphor-icons/react";
import {
  type ComponentProps,
  isValidElement,
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { SkipNetContext } from "../context";
import type { SkipNetUiMeta } from "../schema";
import { ArticleContext } from "./context";
import { Subbed, SubsEditor, SubsPopover } from "./FenceSubs";
import { type FenceRule, rulesOf } from "./fence-rules";

/** An article's `pre`: a shell fence's commands run on a click, any other fence is shown as is */
export function ShellFence(props: ComponentProps<"pre">) {
  const code = props.children;
  if (
    isValidElement<{ className?: string; children?: unknown; metastring?: string }>(code) &&
    typeof code.props.children === "string" &&
    (code.props.className === undefined || shellClasses.has(code.props.className))
  ) {
    const meta = code.props.metastring ?? "";
    return (
      <ShellCommands
        src={code.props.children}
        title={titleRe.exec(meta)?.[1]}
        collapsedByDefault={!expandedRe.test(meta)}
        flat={flatRe.test(meta)}
        rules={rulesOf(meta)}
      />
    );
  }
  return <pre {...props} />;
}

/** Its title bar over its commands */
const frameClass = tw("relative not-prose my-3 rounded border border-term-border-subtle bg-term-fence overflow-hidden");
/** Its foot, which a drag resizes it by, as a desktop window's edge */
const edgeClass = tw("absolute inset-x-0 bottom-0 z-1 h-1.5 cursor-ns-resize");
/** Its title bar: its collapse, then any replacements */
const titleRowClass = tw("flex items-center gap-2 pr-2");
/** A bolt whilst collapsed with a command which autoruns, opening it there */
const boltButtonClass = tw(
  "grid size-5 shrink-0 place-items-center rounded-sm cursor-pointer hover:bg-term-hover-strong",
);
/** Its title, which collapses it */
const titleBarClass = tw(
  "flex min-w-0 flex-1 items-center gap-1.5 px-2 py-1 text-left font-mono text-xs text-term-muted cursor-pointer transition-colors hover:text-term-foreground hover:bg-term-hover-strong",
);
/** Capped until its corner is dragged, which sets an inline height */
const fenceClass = tw(
  "group/fence py-1 min-h-10 [&:not([style*=height])]:max-h-40 resize-y overflow-y-auto scrollbar-thin border-t border-term-border-subtle",
);
/** The caret at its foot whilst more is below, on a chip of its own so it shows over text. A drag of it resizes too */
const caretClass = tw(
  "box-content size-3 px-1.5 mb-0.5 rounded-full border border-term-border-subtle bg-term-fence text-term-muted hover:text-term-foreground group-data-[more=true]/fence:pointer-events-auto group-data-[more=true]/fence:cursor-ns-resize",
);
/** A fade and caret at its foot whilst more is below, as a hidden scrollbar hides that it scrolls */
const moreClass = tw(
  "sticky bottom-0 h-4 -mt-4 flex items-end justify-center pointer-events-none bg-linear-to-t from-term-fence/60 opacity-0 transition-opacity group-data-[more=true]/fence:opacity-100",
);

/**
 * Its commands, in a box resized by its corner, under a title bar collapsing it. Its height and collapse are saved.
 * A `flat` fence, or one of a single command, has no title bar.
 */
function ShellCommands({
  src,
  title,
  collapsedByDefault,
  flat: flatMeta,
  rules,
}: {
  src: string;
  title?: string;
  collapsedByDefault: boolean;
  flat: boolean;
  /** Literals in it which may be replaced, e.g. from ```` ```sh rob=npc ```` */
  rules: FenceRule[];
}) {
  const { articleKey } = useContext(ArticleContext);
  const state = useContext(SkipNetContext);
  const { uiStoreApi } = useContext(UiContext);
  const boxRef = useRef<HTMLDivElement>(null);
  /** By its original, so an amendment can attach to it */
  const fenceId = fenceIdOf(articleKey, src);
  /** Its replacements, e.g. `{ rob: "sue" }`, which its comments, commands, runs and copies use */
  const [subs, setSubs] = useState(() => state.meta.fenceSubs?.[fenceId] ?? {});
  /** Highlighted once per replacement, rather than per render. Autorun keeps the `original` */
  const commands = useMemo(() => {
    const originals = splitExamples(fenceId, src.split("\n"));
    return splitExamples(fenceId, substitute(src, subs).split("\n")).map((example, i) => ({
      example,
      original: originals[i],
      segments: toSegments(example),
    }));
  }, [fenceId, src, subs]);
  const saveSubsId = useRef(0);
  /** Shown at once, saved once typing pauses: for its commands which autorun too */
  const changeSub = (literal: string, value: string) => {
    const { [literal]: _, ...rest } = subs;
    const next = value === literal ? rest : { ...rest, [literal]: value };
    setSubs(next);
    window.clearTimeout(saveSubsId.current);
    saveSubsId.current = window.setTimeout(() => {
      uiStoreApi.setUiMeta(state.meta.id, (draft) => {
        const meta = draft as SkipNetUiMeta;
        const { [fenceId]: _, ...rest } = meta.fenceSubs ?? {};
        meta.fenceSubs = Object.keys(next).length === 0 ? rest : { ...rest, [fenceId]: next }; // none, forgotten
      });
      const { worldKey } = state.meta;
      const autoruns = new Set(preludeApi.entries(worldKey).map((x) => x.id));
      for (const { original } of commands) {
        autoruns.has(original.id) && preludeApi.setSubs(worldKey, original.id, next);
      }
    }, saveDelayMs);
  };

  useEffect(() => {
    const el = boxRef.current;
    if (el === null) return;
    let timeoutId = 0;
    /** Whether more is below, shown by a fade at its foot */
    const syncMore = () => {
      el.dataset.more = String(el.scrollTop + el.clientHeight < el.scrollHeight - 1);
    };
    /** Saves its height, set inline by a drag of its corner, foot or caret */
    const onResize = () => {
      syncMore();
      if (clampHeight(el)) return; // its clamped height resizes it again
      const px = Math.round(Number.parseFloat(el.style.height));
      if (Number.isNaN(px) || px === state.meta.fenceHeights?.[fenceId]) return;
      window.clearTimeout(timeoutId);
      timeoutId = window.setTimeout(() => {
        uiStoreApi.setUiMeta(state.meta.id, (draft) => {
          const meta = draft as SkipNetUiMeta;
          meta.fenceHeights = { ...meta.fenceHeights, [fenceId]: px };
        });
      }, saveDelayMs);
    };
    /** Its commands too, as one expanding changes what is below without resizing the box */
    const observer = new ResizeObserver(onResize);
    observer.observe(el);
    for (const child of el.children) observer.observe(child);
    el.addEventListener("scroll", syncMore, { passive: true });
    return () => {
      observer.disconnect();
      el.removeEventListener("scroll", syncMore);
      window.clearTimeout(timeoutId);
    };
  }, [commands]);

  const flat = flatMeta || commands.length === 1;
  /** Flat, its substitutions are edited from its one command's buttons, else its top-right */
  const editInline = flat && rules.length > 0 && commands.length === 1;
  const editAtCorner = flat && rules.length > 0 && commands.length > 1;
  const [shut, setShut] = useState(() => state.meta.fenceCollapsed?.[fenceId] ?? collapsedByDefault);
  const collapsed = !flat && shut;
  const { entries } = usePrelude(state.meta.worldKey);
  /** One of its commands autoruns, shown by a bolt whilst collapsed, which opens it */
  const autoruns = commands.some(({ original }) => entries.some((x) => x.id === original.id));
  const toggleCollapsed = () => {
    setShut(!collapsed);
    uiStoreApi.setUiMeta(state.meta.id, (draft) => {
      const meta = draft as SkipNetUiMeta;
      meta.fenceCollapsed = { ...meta.fenceCollapsed, [fenceId]: !collapsed };
    });
  };

  const savedPx = state.meta.fenceHeights?.[fenceId];
  return (
    <div
      // flat with substitutions and many commands, its edit button pokes over its top edge
      className={cn(frameClass, editAtCorner && "mt-5 overflow-visible")}
      onPointerDown={(e) => boxRef.current && resizeFrom(e, boxRef.current)}
    >
      {!collapsed && <span data-resize className={edgeClass} />}
      {editAtCorner && <SubsPopover rules={rules} values={subs} onChange={changeSub} />}
      {!flat && (
        <div className={titleRowClass}>
          <button type="button" aria-expanded={!collapsed} className={titleBarClass} onClick={toggleCollapsed}>
            {collapsed ? (
              <CaretRightIcon weight="bold" className="size-3" />
            ) : (
              <CaretDownIcon weight="bold" className="size-3" />
            )}
            <span className="min-w-0 truncate">
              {title === undefined ? `${commands.length} commands` : <Subbed text={title} subs={subs} />}
            </span>
          </button>
          {collapsed && autoruns && (
            <Tip content="something autoruns">
              <button type="button" aria-label="autoruns" className={boltButtonClass} onClick={toggleCollapsed}>
                <LightningIcon weight="fill" className="size-3 text-yellow-400" />
              </button>
            </Tip>
          )}
          {rules.length > 0 && <SubsEditor rules={rules} values={subs} onChange={changeSub} />}
        </div>
      )}
      <div
        ref={boxRef}
        data-fence-id={fenceId}
        className={cn(fenceClass, flat ? "border-t-0 resize-none" : collapsed && "hidden")}
        style={savedPx === undefined ? undefined : { height: savedPx }}
      >
        {commands.map(({ example, original, segments }) => (
          <ShellCommand
            key={example.id}
            example={example}
            original={original}
            segments={segments}
            subs={subs}
            edit={editInline && <SubsPopover inline rules={rules} values={subs} onChange={changeSub} />}
          />
        ))}
        <div className={moreClass}>
          <CaretDownIcon data-resize weight="bold" className={caretClass} />
        </div>
      </div>
    </div>
  );
}

/**
 * Its comment, a run button on its left, copy and expand on its right. Expanded, its command shows beneath.
 * `example` has its fence's replacements, its `original` none.
 */
function ShellCommand({
  example,
  original,
  segments,
  subs,
  edit,
}: {
  example: Example;
  original: Example;
  segments: SrcSegment[];
  /** Its fence's replacements, coloured in its comment */
  subs: Record<string, string>;
  /** An edit button after copy, if its fence's only command */
  edit?: ReactNode;
}) {
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
        example.id === ranId && "border-term-ok/30 bg-term-ok/5",
        example.blankBefore > 0 && "mt-0.5",
        // run, comment, then copy and expand. Expanded, its command goes under the comment
        "grid grid-cols-[auto_1fr_auto] items-center gap-x-2",
      )}
    >
      <Tip content={sessionKey === null ? "no tty to run in" : "run"}>
        <button
          type="button"
          disabled={sessionKey === null}
          className={runButtonCss}
          onClick={() => run(example.id, src)}
        >
          <PlayIcon weight="fill" className={runIconCss} />
        </button>
      </Tip>
      {commented ? (
        <code
          // one line, truncated, until expanded. Its glyphs sit high
          className={cn(
            codeCss,
            tokenCss.comment,
            "min-w-0 cursor-pointer translate-y-px",
            !expanded && "truncate whitespace-nowrap",
          )}
          title={expanded ? undefined : example.commentLines.join("\n")}
          onClick={toggle}
        >
          <Subbed text={original.commentLines.join("\n")} subs={subs} />
        </code>
      ) : (
        <div className="min-w-0">{command}</div>
      )}
      <span className="flex items-center gap-0.5">
        {example.bootable && <AutorunToggle original={original} subs={subs} />}
        <Tip content="copy">
          <button type="button" className={iconButtonCss} onClick={() => copy(src)}>
            {copiedSrc === src ? (
              <CheckIcon className={cn(iconCss, "text-term-ok")} />
            ) : (
              <CopyIcon className={iconCss} />
            )}
          </button>
        </Tip>
        {edit}
        {commented && (
          <Tip content={expanded ? "hide command" : "show command"}>
            <button type="button" className={iconButtonCss} onClick={toggle}>
              {expanded ? <CaretUpIcon className={iconCss} /> : <CaretDownIcon className={iconCss} />}
            </button>
          </Tip>
        )}
      </span>
      {commented && expanded && <div className="col-start-2 col-span-2 mt-0.5">{command}</div>}
    </div>
  );
}

/** Whether the World's autorun runs it, in this article's tty */
function AutorunToggle({ original: example, subs }: { original: Example; subs: Record<string, string> }) {
  const { articleKey, sessionKey, worldKey } = useContext(ArticleContext);
  const entry = usePrelude(worldKey).entries.find((x) => x.id === example.id);
  const on = entry !== undefined;
  const toggle = () =>
    preludeApi.toggle(
      worldKey,
      {
        id: example.id,
        articleKey,
        sessionKey: sessionKey ?? undefined,
        src: example.src,
        comment: example.commentLines.join("\n"),
      },
      subs,
    );
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
/** Resizes `box` by a drag from an element marked `data-resize`. Its height is set inline, as its corner sets it, so it saves the same way */
function resizeFrom(e: ReactPointerEvent, box: HTMLElement) {
  if ((e.target as Element).closest("[data-resize]") === null) return;
  e.preventDefault(); // else it selects text
  const [y0, h0, max] = [e.clientY, box.offsetHeight, contentHeightOf(box)];
  const onMove = (e: PointerEvent) =>
    void (box.style.height = `${Math.max(minFencePx, Math.min(max, h0 + e.clientY - y0))}px`);
  const onUp = () => {
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
  };
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
}

/** How tall `box` is with all its commands in view, and no taller, its padding and border included */
function contentHeightOf(box: HTMLElement) {
  const rows = [...box.children].filter((el) => !el.classList.contains("sticky"));
  const last = rows.at(-1);
  if (last === undefined) return minFencePx;
  const { paddingBottom, borderBottomWidth } = getComputedStyle(box);
  const bottom = last.getBoundingClientRect().bottom - box.getBoundingClientRect().top + box.scrollTop;
  return Math.ceil(bottom + Number.parseFloat(paddingBottom) + Number.parseFloat(borderBottomWidth));
}

/** Shrinks a height set inline, by its corner or a drag, to its content's. Did it? Not whilst hidden */
function clampHeight(box: HTMLElement) {
  if (box.style.height === "" || box.offsetParent === null) return false;
  const max = Math.max(minFencePx, contentHeightOf(box));
  if (box.offsetHeight <= max + 1) return false;
  box.style.height = `${max}px`;
  return true;
}

/** The least a drag resizes it to, as its `min-h-10` */
const minFencePx = 40;
/** How long after a resize its height is saved */
const saveDelayMs = 300;
/** A fence's title in its meta, e.g. ```` ```sh title="Move rob" ```` */
const titleRe = /\btitle="([^"]*)"/;
/** A fence starting expanded, e.g. ```` ```sh expanded ````. Others start collapsed */
const expandedRe = /(^|\s)expanded(\s|$)/;
/** A fence with no title bar, e.g. ```` ```sh flat ```` */
const flatRe = /(^|\s)flat(\s|$)/;
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
