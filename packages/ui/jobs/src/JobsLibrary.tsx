import { Select } from "@base-ui/react/select";
import { Tooltip } from "@base-ui/react/tooltip";
import { cn, type UseStateRef, useStateRef } from "@npc-cli/util";
import { isTouchDevice } from "@npc-cli/util/legacy/dom";
import { tryLocalStorageGetParsed, tryLocalStorageSet } from "@npc-cli/util/legacy/generic";
import { ArticleIcon, CaretRightIcon, CheckIcon, CopyIcon, ListBulletsIcon } from "@phosphor-icons/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type React from "react";
import { useEffect } from "react";
import { jobsExamplesChangedEvent } from "./const";
import {
  type Example,
  type ExampleCategory,
  getSharedArgs,
  jobsLibraryQueryKey,
  loadExamples,
  parseCategories,
  sharedArgKeys,
  toEditedSrc,
  toSegments,
} from "./library";
import type { TokenKind } from "./shell-highlight";

const touchDevice = isTouchDevice();

/**
 * A library of example commands, provided via `./examples/*.md`.
 * Browsable without a session; only running needs one.
 */
export default function JobsLibrary(props: Props) {
  const queryClient = useQueryClient();

  const categories =
    useQuery({
      queryKey: jobsLibraryQueryKey,
      queryFn: async () => parseCategories(await loadExamples()),
    }).data ?? noCategories;

  const state = useStateRef((): State => {
    const stored = tryLocalStorageGetParsed<Stored>(getStorageKey(props.uiId));
    return {
      articleEl: null,
      categoryKey: stored?.categoryKey ?? "",
      edits: {},
      props,
      ranId: null,
      sectionKeys: stored?.sectionKeys ?? {},
      view: stored?.view ?? "preview",

      onEditArg(e) {
        state.edits[e.currentTarget.dataset.editKey ?? ""] = e.currentTarget.value;
        state.update();
      },
      onExampleCopy(e) {
        e.stopPropagation(); // the preview's row runs it, and this button sits within
        state.props.onCopy(getExampleData(e).src);
      },
      onExampleRun(e) {
        const { exampleId, src } = getExampleData(e);
        state.props.onRun(src);
        // stays until the next run, so it reads as "this is the one you ran" rather than
        // as a flash of feedback — which a tap would miss anyway
        state.set({ ranId: exampleId });
      },
      persist() {
        const stored: Stored = {
          categoryKey: state.categoryKey,
          sectionKeys: state.sectionKeys,
          view: state.view,
        };
        tryLocalStorageSet(getStorageKey(props.uiId), JSON.stringify(stored));
      },
      setCategory(categoryKey) {
        // a tab also unfolds, else it'd seem inert
        state.set({ categoryKey });
        state.persist();
      },
      setSection(categoryKey, sectionKey) {
        state.sectionKeys[categoryKey] = sectionKey;
        state.persist();
        state.update();
        if (state.view === "preview") {
          // the preview shows every section, so the select navigates rather than filters.
          // Instant, else the observer would fire for each section swept past
          state.articleEl?.querySelector(`[data-section-key="${sectionKey}"]`)?.scrollIntoView({ block: "start" });
        }
      },
      toggleView() {
        state.set({ view: state.view === "preview" ? "compact" : "preview" });
        state.persist();
      },
    };
  });

  state.props = props; // its handlers run long after this render

  useEffect(() => {
    const hot = import.meta.hot;
    if (hot === undefined) {
      return;
    }
    const onExamplesChange = () => queryClient.invalidateQueries({ queryKey: jobsLibraryQueryKey });
    hot.on(jobsExamplesChangedEvent, onExamplesChange);
    return () => hot.off(jobsExamplesChangedEvent, onExamplesChange);
  }, []);

  useEffect(() => {
    // seed the header from the examples, so it agrees with them before any edit
    state.set({ edits: { ...getSharedArgs(categories), ...state.edits } });
  }, [categories]);

  const category = categories.find((x) => x.key === state.categoryKey) ?? categories[0] ?? null;
  const section =
    category === null
      ? null
      : (category.sections.find((x) => x.key === state.sectionKeys[category.key]) ?? category.sections[0] ?? null);

  useEffect(() => {
    // the preview shows every section, so the select tracks whichever one we've scrolled to
    const article = state.articleEl;
    if (article === null || category === null || state.view !== "preview") {
      return;
    }
    const sections = Array.from(article.querySelectorAll<HTMLElement>("[data-section-key]"));

    let frameId = 0;

    const syncSection = () => {
      frameId = 0;
      const top = article.getBoundingClientRect().top + sectionSpyOffset;
      // the last section to have started above the top of the view
      const active = sections.filter((el) => el.getBoundingClientRect().top <= top).at(-1) ?? sections[0];
      const sectionKey = active?.dataset.sectionKey;
      if (sectionKey !== undefined && state.sectionKeys[category.key] !== sectionKey) {
        state.sectionKeys[category.key] = sectionKey;
        state.persist();
        state.update();
      }
    };

    // a scroll listener rather than an `IntersectionObserver`: a section taller than the view
    // crosses no threshold whilst its heading passes the top, which is the moment we care about
    const onScroll = () => {
      frameId ||= requestAnimationFrame(syncSection);
    };

    syncSection(); // e.g. having just switched to this view
    article.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(frameId);
      article.removeEventListener("scroll", onScroll);
    };
  }, [category?.key, state.view, categories]);

  return (
    <div
      className={cn(
        "min-h-0 flex flex-col flex-1 font-sans bg-term-inset border border-term-border rounded shadow-md shadow-black/40",
        !touchDevice && "text-sm",
      )}
    >
      <div
        className={cn(
          "shrink-0 flex items-center gap-3 px-2 min-w-0 overflow-hidden",
          "border-b border-term-border-subtle",
        )}
      >
        <nav className="min-w-0 flex flex-1 items-end -mb-px py-1">
          {categories.map(({ key, label }) => (
            <button
              key={key}
              type="button"
              className={cn(
                "px-2 py-1 cursor-pointer border-b transition-colors",
                key === category?.key
                  ? "text-term-accent border-term-accent"
                  : "text-term-muted border-transparent hover:text-term-foreground",
              )}
              onClick={() => state.setCategory(key)}
            >
              {label}
            </button>
          ))}
        </nav>

        <button
          type="button"
          title={state.view === "preview" ? "compact view" : "preview view"}
          className={cn("ml-auto", headerButtonCss)}
          onClick={state.toggleView}
        >
          {state.view === "preview" ? (
            <ListBulletsIcon alt="compact view" className={touchDevice ? "size-5" : "size-4"} />
          ) : (
            <ArticleIcon alt="preview view" className={touchDevice ? "size-5" : "size-4"} />
          )}
        </button>
      </div>

      {category !== null && (
        <div className="shrink-0 flex items-center gap-3 px-2 py-1.5 min-w-0 border-b border-term-border-subtle">
          <Select.Root value={section?.key ?? ""} onValueChange={(key) => key && state.setSection(category.key, key)}>
            <Select.Trigger
              title="section"
              className={cn(
                "min-w-0 flex items-center gap-2 px-2 py-0.5 rounded-sm cursor-pointer",
                "border border-term-border-subtle bg-term-hover text-term-foreground",
                "transition-colors hover:bg-term-surface",
              )}
            >
              {/* the value is a `${categoryKey}/${index}` key, so show the section's title */}
              <Select.Value className="truncate">
                {(key: string) => category.sections.find((x) => x.key === key)?.title ?? ""}
              </Select.Value>
              <CaretRightIcon alt="open" className="size-3 shrink-0 rotate-90 text-term-muted" />
            </Select.Trigger>

            <Select.Portal>
              <Select.Positioner className="z-50" sideOffset={4} alignItemWithTrigger={false}>
                <Select.Popup className="py-1 rounded-sm border border-term-border shadow-lg shadow-black/50 bg-term-inset text-sm">
                  <Select.List>
                    {category.sections.map((x) => (
                      <Select.Item
                        key={x.key}
                        value={x.key}
                        className={cn(
                          "px-3 py-1 cursor-pointer text-term-muted",
                          "data-highlighted:bg-term-surface data-selected:text-term-accent",
                        )}
                      >
                        <Select.ItemText>{x.title}</Select.ItemText>
                      </Select.Item>
                    ))}
                  </Select.List>
                </Select.Popup>
              </Select.Positioner>
            </Select.Portal>
          </Select.Root>

          {/* shared by every example, so editing here rewrites them all */}
          {[...sharedArgKeys].map((key) => (
            // takes the space left beside the select, so it cannot overflow
            <label
              key={key}
              className="ml-auto min-w-0 flex-1 max-w-28 flex items-center gap-1 font-mono text-term-accent"
            >
              <span className="shrink-0">{`${key}:`}</span>
              <input
                data-edit-key={key}
                value={state.edits[key] ?? ""}
                spellCheck={false}
                autoComplete="off"
                className={cn(
                  "w-full min-w-0 px-1.5 py-0.5 rounded-sm bg-term-hover border border-term-border-subtle",
                  "text-sh-command outline-none focus:border-term-focus",
                )}
                onChange={state.onEditArg}
              />
            </label>
          ))}
        </div>
      )}

      {category !== null && (
        <article
          ref={state.ref("articleEl")}
          className={cn(
            "flex-1 min-h-0 overflow-auto [scrollbar-width:thin] flex flex-col px-3 py-3",
            state.view === "preview" ? "gap-4" : "gap-1",
          )}
        >
          {state.view === "preview"
            ? category.sections.map((section) => (
                // no heading: the select above already names whichever section we've reached
                <section key={section.key} data-section-key={section.key} className="flex flex-col gap-2">
                  {section.blocks.map((block) =>
                    block.type === "prose" ? (
                      <p key={block.key} className="whitespace-pre-line text-[13px]/relaxed text-term-muted">
                        {block.lines.join("\n")}
                      </p>
                    ) : (
                      // one bordered block per fence, its examples reading continuously
                      <div key={block.key} className="rounded border border-term-border-subtle bg-term-fence py-1">
                        {block.examples.map((example) => (
                          <PreviewExample key={example.id} example={example} state={state} />
                        ))}
                      </div>
                    ),
                  )}
                </section>
              ))
            : section !== null && (
                <>
                  {section.prose && <p className="text-[13px]/relaxed text-term-muted">{section.prose}</p>}
                  <Tooltip.Provider delay={300} closeDelay={100}>
                    {section.examples.map((example) => (
                      <LibraryExample key={example.id} example={example} state={state} />
                    ))}
                  </Tooltip.Provider>
                </>
              )}
        </article>
      )}
    </div>
  );
}

/**
 * One example as the markdown file reads it: its `#` comment lines verbatim above the command,
 * with play/copy on hover. Every handler comes from `state`, so none is created per example.
 */
function PreviewExample({ example, state }: { example: Example; state: UseStateRef<State> }) {
  const { copiedSrc } = state.props;
  const src = toEditedSrc(example, state.edits);

  return (
    // the handlers read these, rather than closing over the example
    <div
      className={cn(
        // `term-hover` is darker than the `term-fence` it sits on, so it vanishes in dark mode
        "group px-3 py-0.5 cursor-pointer hover:bg-term-hover-strong",
        // bordered throughout, so gaining the colour shifts nothing
        "border border-transparent",
        example.id === state.ranId && "border-term-ok",
      )}
      // the blank lines this example follows in the file, so the fence reads as it is written
      style={example.blankBefore > 0 ? { marginTop: `${example.blankBefore * exampleLineHeight}em` } : undefined}
      data-example-id={example.id}
      data-src={src}
      onClick={state.onExampleRun}
    >
      <code className={exampleCodeCss}>
        {example.commentLines.map((line, i) => (
          <span key={i} className={cn(tokenCss.comment, "block")}>
            {line}
          </span>
        ))}
        {srcSegments(example, state.edits)}

        {/* inline, so it sits where the command ends. It always takes its space,
            so fading it in shifts nothing */}
        <button
          type="button"
          title="copy"
          className={cn(
            previewIconCss,
            "align-middle ml-1.5 -my-1",
            // shown outright without hover to reveal it, i.e. on touch. `hover:` is itself
            // `@media (hover: hover)` in tailwind v4, so the fade only applies to pointers
            "transition-opacity [@media(hover:hover)]:opacity-0 group-hover:opacity-100 focus-visible:opacity-100",
          )}
          onClick={state.onExampleCopy}
        >
          {copiedSrc === src ? (
            <CheckIcon alt="copied" className="size-4 text-term-ok" />
          ) : (
            <CopyIcon alt="copy" className="size-4" />
          )}
        </button>
      </code>
    </div>
  );
}

/**
 * A single example: click to run, or read its comment via the info tooltip.
 * Every handler comes from `state`, so none is created per example.
 */
function LibraryExample({ example, state }: { example: Example; state: UseStateRef<State> }) {
  const { copiedSrc } = state.props;
  const src = toEditedSrc(example, state.edits);

  return (
    // the handlers read these, rather than closing over the example
    <div className="relative" data-example-id={example.id} data-src={src}>
      {/* the command itself explains what it does, on hover or focus */}
      <Tooltip.Root
        disabled={!example.comment}
        onOpenChange={(open, eventDetails) => {
          // running it would otherwise dismiss the description mid-read
          if (open === false && eventDetails.reason === "trigger-press") {
            eventDetails.cancel();
          }
        }}
      >
        <Tooltip.Trigger
          className={cn(
            "block w-full text-left cursor-pointer select-none transition-colors",
            // as the preview: the hover tints the background, and the last run keeps its border
            "px-3 py-2 rounded border bg-term-fence hover:bg-term-hover-strong",
            example.id === state.ranId ? "border-term-ok" : "border-term-border-subtle",
          )}
          onClick={state.onExampleRun}
        >
          <code className={exampleCodeCss}>
            {/* only the first line makes room for the overlaid toolbar */}
            <span aria-hidden className="float-right w-8 h-[1.45em]" />
            {srcSegments(example, state.edits)}
          </code>
        </Tooltip.Trigger>

        {/* portalled, else the scrolling article would clip it */}
        <Tooltip.Portal>
          <Tooltip.Positioner className="z-50 max-w-72" side="top" align="end" sideOffset={4}>
            <Tooltip.Popup
              className={cn(
                "px-3 py-2 rounded border border-term-focus shadow-lg shadow-black/50",
                "bg-term-inset font-sans text-xs/relaxed text-term-foreground",
              )}
            >
              {example.comment}
            </Tooltip.Popup>
          </Tooltip.Positioner>
        </Tooltip.Portal>
      </Tooltip.Root>

      <div className="absolute right-1.5 top-1.5 flex items-center rounded bg-term-fence/90 px-1 py-0.5">
        <button type="button" title="copy" className={iconCss} onClick={state.onExampleCopy}>
          {copiedSrc === src ? (
            <CheckIcon alt="copied" className="size-4 text-term-ok" />
          ) : (
            <CopyIcon alt="copy" className="size-4" />
          )}
        </button>
      </div>
    </div>
  );
}

/** The command itself, shell-highlighted, with editable arg keys picked out */
function srcSegments(example: Example, edits: Record<string, string>) {
  return toSegments(example, edits).map((segment, i) => (
    <span key={i} className={segment.arg === "key" ? "text-term-accent" : tokenCss[segment.kind]}>
      {segment.text}
    </span>
  ));
}

const exampleCodeCss = cn(
  "block font-mono text-[13px]/[1.45] whitespace-pre-wrap break-words",
  touchDevice && "text-[15px]/[1.45]",
);

const headerButtonCss = "flex items-center py-1 cursor-pointer text-term-muted hover:text-term-foreground";

/** Muted, so the block reads as grey with only a hint of hue */
const tokenCss: Record<TokenKind, string> = {
  command: "text-sh-command",
  comment: "text-sh-comment",
  flag: "text-sh-flag",
  keyword: "text-sh-keyword",
  number: "text-sh-number",
  operator: "text-sh-operator",
  string: "text-sh-string",
  text: "text-sh-text",
  variable: "text-sh-variable",
};

const iconCss = cn(
  "shrink-0 cursor-pointer text-term-faint transition-colors hover:text-term-foreground",
  "disabled:opacity-40 disabled:cursor-default disabled:hover:text-term-faint",
);

/** Padded, for a tap target rather than a bare icon */
const previewIconCss = cn(iconCss, "p-1");

/** The example an event occurred within, via the `data-*` on its wrapper */
function getExampleData(e: React.SyntheticEvent) {
  const el = (e.currentTarget as HTMLElement).closest<HTMLElement>("[data-example-id]");
  return { exampleId: el?.dataset.exampleId ?? "", src: el?.dataset.src ?? "" };
}

const noCategories: ExampleCategory[] = [];

/** How far below the top of the view a section must start before it counts as current */
const sectionSpyOffset = 8;
/** Matches the `text-[13px]/[1.45]` of an example's `code`, so a gap is a whole number of lines */
const exampleLineHeight = 1.45;

function getStorageKey(uiId: string) {
  return `jobs-library:${uiId}`;
}

type Props = {
  /** UI instance id, for localStorage */
  uiId: string;
  copiedSrc: null | string;
  onCopy: (src: string) => void;
  onRun: (src: string) => void;
};

/** Persisted per UI instance */
type Stored = Pick<State, "categoryKey" | "sectionKeys" | "view">;

type State = {
  /** The scroll container, whose sections the preview observes */
  articleEl: null | HTMLElement;
  /** Currently shown category i.e. tab */
  categoryKey: string;
  /** Shared arg key -> value, applied to every example; not persisted */
  edits: Record<string, string>;
  /** Synced each render, so the handlers below never read stale props */
  props: Props;
  /** The example most recently run, which stays bordered until another is */
  ranId: null | string;
  /** categoryKey -> currently shown sectionKey */
  sectionKeys: Record<string, string>;
  /** `preview` reads like the markdown file; `compact` lists one section tersely */
  view: "compact" | "preview";

  onEditArg: (e: React.ChangeEvent<HTMLInputElement>) => void;
  /** Each of these reads the example from `data-*` — see `getExampleData` */
  onExampleCopy: (e: React.MouseEvent<HTMLElement>) => void;
  onExampleRun: (e: React.MouseEvent<HTMLElement>) => void;
  persist: () => void;
  setCategory: (categoryKey: string) => void;
  setSection: (categoryKey: string, sectionKey: string) => void;
  toggleView: () => void;
};
