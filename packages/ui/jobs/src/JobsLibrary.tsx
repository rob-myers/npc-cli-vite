import { cn, useStateRef } from "@npc-cli/util";
import { tryLocalStorageGetParsed, tryLocalStorageSet } from "@npc-cli/util/legacy/generic";
import {
  ArrowCounterClockwiseIcon,
  CaretRightIcon,
  CheckIcon,
  ClipboardTextIcon,
  CopyIcon,
  PlayIcon,
} from "@phosphor-icons/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type React from "react";
import { Fragment, useEffect } from "react";
import { jobsExamplesChangedEvent } from "./const";
import {
  type Example,
  type ExampleCategory,
  getEditKey,
  jobsLibraryQueryKey,
  loadExamples,
  parseCategories,
  toEditedSrc,
  toSegments,
} from "./library";
import type { TokenKind } from "./shell-highlight";

/**
 * A resizable library of example commands, provided via `./examples/*.md`.
 * Browsable without a session; only run/paste need one.
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
      focusedId: null,
      sectionKeys: stored?.sectionKeys ?? {},
      height: stored?.height ?? defaultLibraryHeight,
      open: stored?.open ?? false,
      resizing: false,
      rootEl: null,
      startHeight: 0,
      startY: 0,

      editArg(editKey, value) {
        state.edits[editKey] = value;
        state.update();
      },
      focusExample(exampleId) {
        state.set({ focusedId: state.focusedId === exampleId ? null : exampleId });
      },
      getMaxHeight() {
        const root = state.rootEl?.closest<HTMLElement>("[data-jobs-root]");
        return Math.max(minLibraryHeight, (root?.clientHeight ?? 600) - reservedHeight);
      },
      onKeyDown(e) {
        if (e.key === "Escape" && state.focusedId !== null) {
          state.set({ focusedId: null });
        }
      },
      onResizeDown(e) {
        e.currentTarget.setPointerCapture(e.pointerId);
        state.set({ resizing: true, startY: e.clientY, startHeight: state.height });
      },
      onResizeMove(e) {
        if (state.resizing === false) {
          return;
        }
        const next = state.startHeight - (e.clientY - state.startY); // drag up to grow
        state.set({ height: Math.min(state.getMaxHeight(), Math.max(minLibraryHeight, next)) });
      },
      onResizeUp(e) {
        if (state.resizing === false) {
          return;
        }
        e.currentTarget.releasePointerCapture?.(e.pointerId);
        state.resizing = false;
        state.persist();
      },
      persist() {
        const stored: Stored = {
          categoryKey: state.categoryKey,
          sectionKeys: state.sectionKeys,
          height: state.height,
          open: state.open,
        };
        tryLocalStorageSet(getStorageKey(props.uiId), JSON.stringify(stored));
      },
      resetExample(example) {
        example.args.forEach((_, index) => delete state.edits[getEditKey(example, index)]);
        state.update();
      },
      setCategory(categoryKey) {
        // a tab also unfolds, else it'd seem inert
        state.set({ categoryKey, focusedId: null, open: true });
        state.persist();
      },
      setSection(categoryKey, sectionKey) {
        state.sectionKeys[categoryKey] = sectionKey;
        state.set({ focusedId: null });
        state.persist();
      },
      toggleOpen() {
        state.set({ open: !state.open, height: Math.min(state.getMaxHeight(), state.height) });
        state.persist();
      },
    };
  });

  useEffect(() => {
    // the window may have shrunk since `height` was persisted
    state.set({ height: Math.min(state.getMaxHeight(), Math.max(minLibraryHeight, state.height)) });

    const hot = import.meta.hot;
    if (hot === undefined) {
      return;
    }
    const onExamplesChange = () => queryClient.invalidateQueries({ queryKey: jobsLibraryQueryKey });
    hot.on(jobsExamplesChangedEvent, onExamplesChange);
    return () => hot.off(jobsExamplesChangedEvent, onExamplesChange);
  }, []);

  const category = categories.find((x) => x.key === state.categoryKey) ?? categories[0] ?? null;
  const section =
    category === null
      ? null
      : (category.sections.find((x) => x.key === state.sectionKeys[category.key]) ?? category.sections[0] ?? null);

  return (
    <div
      ref={state.ref("rootEl")}
      className="shrink-0 flex flex-col font-sans bg-black border border-[#505050] rounded shadow-md shadow-black/40"
      style={state.open ? { height: state.height } : undefined}
    >
      {state.open && (
        <div
          title="resize"
          className="group shrink-0 h-2 -mt-1 flex items-center justify-center cursor-ns-resize touch-none"
          onPointerDown={state.onResizeDown}
          onPointerMove={state.onResizeMove}
          onPointerUp={state.onResizeUp}
          onLostPointerCapture={state.onResizeUp}
        >
          <div className="w-10 h-0.5 rounded bg-[#505050] group-hover:bg-[#aaca]" />
        </div>
      )}

      <div className={cn("shrink-0 flex items-end gap-3 px-2", state.open && "border-b border-[#2a2a2a]")}>
        <nav className="flex items-end -mb-px">
          {categories.map(({ key, label }) => (
            <button
              key={key}
              type="button"
              className={cn(
                "px-2 py-1 cursor-pointer text-sm border-b transition-colors",
                state.open && key === category?.key
                  ? "text-[#ff9] border-[#ff9]"
                  : "text-[#999] border-transparent hover:text-white",
              )}
              onClick={() => state.setCategory(key)}
            >
              {label}
            </button>
          ))}
        </nav>

        <button
          type="button"
          title={state.open ? "fold library" : "unfold library"}
          className="ml-auto flex items-center py-1 cursor-pointer text-[#999] hover:text-white"
          onClick={state.toggleOpen}
        >
          <CaretRightIcon alt={state.open ? "fold" : "unfold"} className={cn("size-3", state.open && "rotate-90")} />
        </button>
      </div>

      {state.open && category !== null && (
        // wraps rather than scrolls, else tabs could hide
        <nav className="shrink-0 flex flex-wrap items-center gap-1 px-2 py-1.5 border-b border-[#2a2a2a]">
          {category.sections.map((x) => (
            <button
              key={x.key}
              type="button"
              className={cn(
                "shrink-0 px-2 py-0.5 rounded-sm cursor-pointer text-xs transition-colors",
                x.key === section?.key ? "bg-[#2a2a2a] text-[#eee]" : "text-[#999] hover:text-white",
              )}
              onClick={() => state.setSection(category.key, x.key)}
            >
              {x.title}
            </button>
          ))}
        </nav>
      )}

      {state.open && section !== null && (
        <article
          className="flex-1 min-h-0 overflow-auto [scrollbar-width:thin] flex flex-col gap-2 px-3 py-3"
          onKeyDown={state.onKeyDown}
        >
          {section.prose && <p className="text-[13px]/relaxed text-[#aaa]">{section.prose}</p>}
          {section.examples.map((example) => (
            <LibraryExample
              key={example.id}
              example={example}
              focused={state.focusedId === example.id}
              edits={state.edits}
              canRun={props.canRun}
              copiedSrc={props.copiedSrc}
              onCopy={props.onCopy}
              onEdit={state.editArg}
              onFocus={state.focusExample}
              onPaste={props.onPaste}
              onReset={state.resetExample}
              onRun={props.onRun}
            />
          ))}
        </article>
      )}
    </div>
  );
}

/** A single example, whose `key:value` args become inputs when focused */
function LibraryExample({
  example,
  focused,
  edits,
  canRun,
  copiedSrc,
  onCopy,
  onEdit,
  onFocus,
  onPaste,
  onReset,
  onRun,
}: {
  example: Example;
  focused: boolean;
  edits: Record<string, string>;
  canRun: boolean;
  copiedSrc: null | string;
  onCopy: (src: string) => void;
  onEdit: (editKey: string, value: string) => void;
  onFocus: (exampleId: string) => void;
  onPaste: (src: string) => void;
  onReset: (example: Example) => void;
  onRun: (src: string) => void;
}) {
  const src = toEditedSrc(example, edits);
  const edited = example.args.some((_, index) => edits[getEditKey(example, index)] !== undefined);

  return (
    <div className="relative">
      {/* a code fence, clickable to reveal its comment and args */}
      <button
        type="button"
        title={focused ? "hide detail" : "show detail"}
        className={cn(
          "block w-full text-left cursor-pointer transition-colors",
          "px-3 py-2 bg-[#131313] border rounded",
          focused ? "border-[#aaca]" : "border-[#2a2a2a] hover:border-[#444]",
          // the args panel continues this fence
          focused && example.args.length > 0 && "rounded-b-none",
        )}
        onClick={() => onFocus(example.id)}
      >
        <code className="block font-mono text-[13px]/[1.45] whitespace-pre-wrap break-words">
          {/* only the first line makes room for the overlaid toolbar */}
          <span aria-hidden className="float-right w-22 h-[1.45em]" />
          {focused && example.comment && <span className={tokenCss.comment}>{`# ${example.comment}\n`}</span>}
          {toSegments(example, edits).map((segment, i) => (
            <span
              key={i}
              className={cn(
                segment.arg === "key" ? "text-[#eaeaae]" : tokenCss[segment.kind],
                // editable values are underlined
                segment.arg === "value" && "decoration-dotted decoration-[#919ba6] underline underline-offset-4",
              )}
            >
              {segment.text}
            </span>
          ))}
        </code>
      </button>

      <div className="absolute right-1.5 top-1.5 flex items-center gap-1.5 rounded bg-[#131313]/90 px-1 py-0.5">
        {edited && (
          <button type="button" title="reset args" className={iconCss} onClick={() => onReset(example)}>
            <ArrowCounterClockwiseIcon alt="reset args" className="size-3.5" />
          </button>
        )}
        <button type="button" title="copy" className={iconCss} onClick={() => onCopy(src)}>
          {copiedSrc === src ? (
            <CheckIcon alt="copied" className="size-3.5 text-[#a6c6a6]" />
          ) : (
            <CopyIcon alt="copy" className="size-3.5" />
          )}
        </button>
        <button
          type="button"
          title="paste into prompt"
          disabled={!canRun}
          className={iconCss}
          onClick={() => onPaste(src)}
        >
          <ClipboardTextIcon alt="paste into prompt" className="size-3.5" />
        </button>
        <button
          type="button"
          title="run in background"
          disabled={!canRun}
          className={cn(iconCss, "text-[#a6c6a6] hover:text-[#cae6ca] disabled:hover:text-[#a6c6a6]")}
          onClick={() => onRun(src)}
        >
          <PlayIcon alt="run in background" className="size-3.5" />
        </button>
      </div>

      {focused && example.args.length > 0 && (
        <div
          className={cn(
            "grid grid-cols-[auto_1fr] items-center gap-x-2 gap-y-1",
            "px-3 py-2 bg-[#0e0e0e] border border-t-0 border-[#aaca] rounded-b",
          )}
        >
          {example.args.map((token, index) => {
            const editKey = getEditKey(example, index);
            return (
              <Fragment key={editKey}>
                <label htmlFor={editKey} className="font-mono text-xs text-[#eaeaae]">
                  {`${token.key}:`}
                </label>
                <input
                  id={editKey}
                  value={edits[editKey] ?? token.value}
                  spellCheck={false}
                  autoComplete="off"
                  className={cn(
                    "min-w-0 px-1.5 py-0.5 rounded-sm bg-[#1a1a1a] border border-[#3a3a3a]",
                    "font-mono text-xs text-[#e2e7ed] outline-none focus:border-[#aaca]",
                  )}
                  onChange={(e) => onEdit(editKey, e.currentTarget.value)}
                />
              </Fragment>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** Muted, so the block reads as grey with only a hint of hue */
const tokenCss: Record<TokenKind, string> = {
  command: "text-[#e2e7ed]",
  comment: "text-[#829282]",
  flag: "text-[#c2b49e]",
  keyword: "text-[#c6b4d1]",
  number: "text-[#c2b49e]",
  operator: "text-[#98a8b1]",
  string: "text-[#aec09a]",
  text: "text-[#c2c2c2]",
  variable: "text-[#cebf92]",
};

const iconCss = cn(
  "shrink-0 cursor-pointer text-[#777] transition-colors hover:text-white",
  "disabled:opacity-40 disabled:cursor-default disabled:hover:text-[#777]",
);

/** Height of the panel when first opened */
const defaultLibraryHeight = 220;
const minLibraryHeight = 120;
/** Vertical space kept for the session header and process cards */
const reservedHeight = 140;

const noCategories: ExampleCategory[] = [];

function getStorageKey(uiId: string) {
  return `jobs-library:${uiId}`;
}

type Props = {
  /** UI instance id, for localStorage */
  uiId: string;
  /** Does a session exist i.e. can we run/paste? */
  canRun: boolean;
  copiedSrc: null | string;
  onCopy: (src: string) => void;
  onPaste: (src: string) => void;
  onRun: (src: string) => void;
};

/** Persisted per UI instance */
type Stored = Pick<State, "categoryKey" | "height" | "open" | "sectionKeys">;

type State = {
  /** Currently shown category i.e. tab */
  categoryKey: string;
  /** `${exampleId}#${argIndex}` -> value; not persisted */
  edits: Record<string, string>;
  /** Example whose comment and args are shown */
  focusedId: null | string;
  /** categoryKey -> currently shown sectionKey */
  sectionKeys: Record<string, string>;
  /** Height in pixels when `open` */
  height: number;
  open: boolean;
  resizing: boolean;
  rootEl: null | HTMLDivElement;
  startHeight: number;
  startY: number;

  editArg: (editKey: string, value: string) => void;
  focusExample: (exampleId: string) => void;
  getMaxHeight: () => number;
  onKeyDown: (e: React.KeyboardEvent<HTMLDivElement>) => void;
  onResizeDown: (e: React.PointerEvent<HTMLDivElement>) => void;
  onResizeMove: (e: React.PointerEvent<HTMLDivElement>) => void;
  onResizeUp: (e: React.PointerEvent<HTMLDivElement>) => void;
  persist: () => void;
  resetExample: (example: Example) => void;
  setCategory: (categoryKey: string) => void;
  setSection: (categoryKey: string, sectionKey: string) => void;
  toggleOpen: () => void;
};
