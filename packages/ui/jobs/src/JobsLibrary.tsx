import { Tooltip } from "@base-ui/react/tooltip";
import { cn, type UseStateRef, useStateRef } from "@npc-cli/util";
import { tryLocalStorageGetParsed, tryLocalStorageSet } from "@npc-cli/util/legacy/generic";
import { CaretRightIcon, CheckIcon, CopyIcon } from "@phosphor-icons/react";
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
      categoryKey: stored?.categoryKey ?? "",
      edits: {},
      props,
      sectionKeys: stored?.sectionKeys ?? {},
      open: stored?.open ?? true,

      onEditArg(e) {
        state.edits[e.currentTarget.dataset.editKey ?? ""] = e.currentTarget.value;
        state.update();
      },
      onExampleCopy(e) {
        state.props.onCopy(getExampleData(e).src);
      },
      onExampleRun(e) {
        state.props.onRun(getExampleData(e).src);
      },
      persist() {
        const stored: Stored = {
          categoryKey: state.categoryKey,
          sectionKeys: state.sectionKeys,
          open: state.open,
        };
        tryLocalStorageSet(getStorageKey(props.uiId), JSON.stringify(stored));
      },
      setCategory(categoryKey) {
        // a tab also unfolds, else it'd seem inert
        state.set({ categoryKey, open: true });
        state.persist();
      },
      setSection(categoryKey, sectionKey) {
        state.sectionKeys[categoryKey] = sectionKey;
        state.persist();
        state.update();
      },
      toggleOpen() {
        state.set({ open: !state.open });
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

  return (
    <div
      className={cn(
        "min-h-0 flex flex-col font-sans bg-term-inset border border-term-border rounded shadow-md shadow-black/40",
        // fills whatever the header and processes leave, unless folded away
        state.open ? "flex-1" : "shrink-0",
      )}
    >
      <div
        className={cn(
          "shrink-0 flex items-end gap-3 px-2 min-w-0 overflow-hidden",
          state.open && "border-b border-term-border-subtle",
        )}
      >
        <nav className="min-w-0 flex flex-1 items-end -mb-px">
          {categories.map(({ key, label }) => (
            <button
              key={key}
              type="button"
              className={cn(
                "px-2 py-1 cursor-pointer text-sm border-b transition-colors",
                state.open && key === category?.key
                  ? "text-term-accent border-term-accent"
                  : "text-term-muted border-transparent hover:text-term-foreground",
              )}
              onClick={() => state.setCategory(key)}
            >
              {label}
            </button>
          ))}
        </nav>

        {/* shared by every example, so editing here rewrites them all */}
        {state.open &&
          [...sharedArgKeys].map((key) => (
            // takes the space left between the tabs and the caret, so it cannot overflow
            <label
              key={key}
              className="min-w-0 flex-1 max-w-22 flex items-center gap-1 py-1 font-mono text-xs text-term-accent"
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

        <button
          type="button"
          title={state.open ? "fold library" : "unfold library"}
          className="ml-auto flex items-center py-1 cursor-pointer text-term-muted hover:text-term-foreground"
          onClick={state.toggleOpen}
        >
          <CaretRightIcon alt={state.open ? "fold" : "unfold"} className={cn("size-3", state.open && "rotate-90")} />
        </button>
      </div>

      {state.open && category !== null && (
        // wraps rather than scrolls, else tabs could hide
        <nav className="shrink-0 flex flex-wrap items-center gap-1 px-2 py-1.5 border-b border-term-border-subtle">
          {category.sections.map((x) => (
            <button
              key={x.key}
              type="button"
              className={cn(
                "shrink-0 px-2.5 py-1 rounded-sm cursor-pointer text-sm transition-colors",
                x.key === section?.key
                  ? "bg-term-surface text-term-foreground"
                  : "text-term-muted hover:text-term-foreground",
              )}
              onClick={() => state.setSection(category.key, x.key)}
            >
              {x.title}
            </button>
          ))}
        </nav>
      )}

      {state.open && section !== null && (
        <article className="flex-1 min-h-0 overflow-auto [scrollbar-width:thin] flex flex-col gap-1 px-3 py-3">
          {section.prose && <p className="text-[13px]/relaxed text-term-muted">{section.prose}</p>}
          <Tooltip.Provider delay={300} closeDelay={100}>
            {section.examples.map((example) => (
              <LibraryExample key={example.id} example={example} state={state} />
            ))}
          </Tooltip.Provider>
        </article>
      )}
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
            "px-3 py-2 bg-term-fence border border-term-border-subtle rounded hover:border-term-ok",
          )}
          onClick={state.onExampleRun}
        >
          <code className="block font-mono text-[13px]/[1.45] whitespace-pre-wrap break-words">
            {/* only the first line makes room for the overlaid toolbar */}
            <span aria-hidden className="float-right w-8 h-[1.45em]" />
            {toSegments(example, state.edits).map((segment, i) => (
              <span key={i} className={segment.arg === "key" ? "text-term-accent" : tokenCss[segment.kind]}>
                {segment.text}
              </span>
            ))}
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

/** The example an event occurred within, via the `data-*` on its wrapper */
function getExampleData(e: React.SyntheticEvent) {
  const el = (e.currentTarget as HTMLElement).closest<HTMLElement>("[data-example-id]");
  return { exampleId: el?.dataset.exampleId ?? "", src: el?.dataset.src ?? "" };
}

const noCategories: ExampleCategory[] = [];

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
type Stored = Pick<State, "categoryKey" | "open" | "sectionKeys">;

type State = {
  /** Currently shown category i.e. tab */
  categoryKey: string;
  /** Shared arg key -> value, applied to every example; not persisted */
  edits: Record<string, string>;
  /** Synced each render, so the handlers below never read stale props */
  props: Props;
  /** categoryKey -> currently shown sectionKey */
  sectionKeys: Record<string, string>;
  open: boolean;

  onEditArg: (e: React.ChangeEvent<HTMLInputElement>) => void;
  /** Each of these reads the example from `data-*` — see `getExampleData` */
  onExampleCopy: (e: React.MouseEvent<HTMLButtonElement>) => void;
  onExampleRun: (e: React.MouseEvent<HTMLButtonElement>) => void;
  persist: () => void;
  setCategory: (categoryKey: string) => void;
  setSection: (categoryKey: string, sectionKey: string) => void;
  toggleOpen: () => void;
};
