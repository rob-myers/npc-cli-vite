import { cn, type UseStateRef, useStateRef } from "@npc-cli/util";
import { tryLocalStorageGetParsed, tryLocalStorageSet } from "@npc-cli/util/legacy/generic";
import {
  ArrowCounterClockwiseIcon,
  CaretRightIcon,
  CheckIcon,
  ClipboardTextIcon,
  CopyIcon,
  PencilSimpleIcon,
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
      press: { timeoutId: 0, longPressed: false },
      props,
      sectionKeys: stored?.sectionKeys ?? {},
      height: stored?.height ?? defaultLibraryHeight,
      open: stored?.open ?? true,
      resizing: false,
      rootEl: null,
      startHeight: 0,
      startY: 0,

      focusExample(exampleId) {
        state.set({ focusedId: state.focusedId === exampleId ? null : exampleId });
      },
      getMaxHeight() {
        const root = state.rootEl?.closest<HTMLElement>("[data-jobs-root]");
        return Math.max(minLibraryHeight, (root?.clientHeight ?? 600) - reservedHeight);
      },
      onEditArg(e) {
        state.edits[e.currentTarget.dataset.editKey ?? ""] = e.currentTarget.value;
        state.update();
      },
      onExampleClick(e) {
        if (state.press.longPressed === true) {
          return; // the long press already opened the detail
        }
        const { exampleId, src } = getExampleData(e);
        e.shiftKey ? state.focusExample(exampleId) : state.props.onRun(src);
      },
      onExampleCopy(e) {
        state.props.onCopy(getExampleData(e).src);
      },
      onExampleDown(e) {
        const { exampleId } = getExampleData(e); // captured, the event won't outlive the timer
        state.press.longPressed = false;
        state.press.timeoutId = window.setTimeout(() => {
          state.press.longPressed = true;
          state.focusExample(exampleId);
        }, longPressMs);
      },
      onExampleEdit(e) {
        state.focusExample(getExampleData(e).exampleId);
      },
      onExamplePaste(e) {
        state.props.onPaste(getExampleData(e).src);
      },
      onExamplePressEnd() {
        window.clearTimeout(state.press.timeoutId);
      },
      onExampleReset(e) {
        const prefix = `${getExampleData(e).exampleId}#`; // see `getEditKey`
        for (const editKey of Object.keys(state.edits)) {
          if (editKey.startsWith(prefix)) {
            delete state.edits[editKey];
          }
        }
        state.update();
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

  state.props = props; // its handlers run long after this render

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

  useEffect(() => () => window.clearTimeout(state.press.timeoutId), []);

  const category = categories.find((x) => x.key === state.categoryKey) ?? categories[0] ?? null;
  const section =
    category === null
      ? null
      : (category.sections.find((x) => x.key === state.sectionKeys[category.key]) ?? category.sections[0] ?? null);

  return (
    <div
      ref={state.ref("rootEl")}
      className="shrink-0 flex flex-col font-sans bg-term-inset border border-term-border rounded shadow-md shadow-black/40"
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
          <div className="w-10 h-0.5 rounded bg-term-border group-hover:bg-term-focus" />
        </div>
      )}

      <div className={cn("shrink-0 flex items-end gap-3 px-2", state.open && "border-b border-term-border-subtle")}>
        <nav className="flex items-end -mb-px">
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
                "shrink-0 px-2 py-0.5 rounded-sm cursor-pointer text-xs transition-colors",
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
        <article
          className="flex-1 min-h-0 overflow-auto [scrollbar-width:thin] flex flex-col gap-1 px-3 py-3"
          onKeyDown={state.onKeyDown}
        >
          {section.prose && <p className="text-[13px]/relaxed text-term-muted">{section.prose}</p>}
          {section.examples.map((example) => (
            <LibraryExample key={example.id} example={example} state={state} />
          ))}
        </article>
      )}
    </div>
  );
}

/**
 * A single example, whose `key:value` args become inputs when focused.
 * Every handler comes from `state`, so none is created per example.
 */
function LibraryExample({ example, state }: { example: Example; state: UseStateRef<State> }) {
  const { canRun, copiedSrc } = state.props;
  const { edits } = state;
  const focused = state.focusedId === example.id;
  const src = toEditedSrc(example, edits);
  const edited = example.args.some((_, index) => edits[getEditKey(example, index)] !== undefined);

  return (
    // the handlers read these, rather than closing over the example
    <div className="relative" data-example-id={example.id} data-src={src}>
      <button
        type="button"
        title="run in background — shift+click or long press to edit"
        className={cn(
          "block w-full text-left cursor-pointer select-none transition-colors",
          "px-3 py-2 bg-term-fence border rounded",
          focused ? "border-term-focus" : "border-term-border-subtle hover:border-term-ok",
          // the args panel continues this fence
          focused && example.args.length > 0 && "rounded-b-none",
        )}
        onPointerDown={state.onExampleDown}
        onPointerUp={state.onExamplePressEnd}
        onPointerCancel={state.onExamplePressEnd}
        onPointerLeave={state.onExamplePressEnd}
        onClick={state.onExampleClick}
      >
        <code className="block font-mono text-[13px]/[1.45] whitespace-pre-wrap break-words">
          {/* only the first line makes room for the overlaid toolbar */}
          <span aria-hidden className="float-right w-22 h-[1.45em]" />
          {focused && example.comment && <span className={tokenCss.comment}>{`# ${example.comment}\n`}</span>}
          {toSegments(example, edits).map((segment, i) => (
            <span
              key={i}
              className={cn(
                segment.arg === "key" ? "text-term-accent" : tokenCss[segment.kind],
                // editable values are underlined
                // segment.arg === "value" && "decoration-dotted decoration-[#919ba6] underline underline-offset-4",
              )}
            >
              {segment.text}
            </span>
          ))}
        </code>
      </button>

      <div className="absolute right-1.5 top-1.5 flex items-center gap-1.5 rounded bg-term-fence/90 px-1 py-0.5">
        {edited && (
          <button type="button" title="reset args" className={iconCss} onClick={state.onExampleReset}>
            <ArrowCounterClockwiseIcon alt="reset args" className="size-3.5" />
          </button>
        )}
        <button type="button" title="copy" className={iconCss} onClick={state.onExampleCopy}>
          {copiedSrc === src ? (
            <CheckIcon alt="copied" className="size-3.5 text-term-ok" />
          ) : (
            <CopyIcon alt="copy" className="size-3.5" />
          )}
        </button>
        <button
          type="button"
          title="paste into prompt"
          disabled={!canRun}
          className={iconCss}
          onClick={state.onExamplePaste}
        >
          <ClipboardTextIcon alt="paste into prompt" className="size-3.5" />
        </button>
        {/* editing needs no session, unlike the two above */}
        <button
          type="button"
          title={focused ? "hide detail" : "edit args"}
          className={cn(iconCss, focused && "text-term-focus")}
          onClick={state.onExampleEdit}
        >
          <PencilSimpleIcon alt="edit args" className="size-3.5" />
        </button>
      </div>

      {focused && example.args.length > 0 && (
        <div
          className={cn(
            "grid grid-cols-[auto_1fr] items-center gap-x-2 gap-y-1",
            "px-3 py-2 bg-term-inset border border-t-0 border-term-focus rounded-b",
          )}
        >
          {example.args.map((token, index) => {
            const editKey = getEditKey(example, index);
            return (
              <Fragment key={editKey}>
                <label htmlFor={editKey} className="font-mono text-xs text-term-accent">
                  {`${token.key}:`}
                </label>
                <input
                  id={editKey}
                  data-edit-key={editKey}
                  value={edits[editKey] ?? token.value}
                  spellCheck={false}
                  autoComplete="off"
                  className={cn(
                    "min-w-0 px-1.5 py-0.5 rounded-sm bg-term-hover border border-term-border-subtle",
                    "font-mono text-xs text-sh-command outline-none focus:border-term-focus",
                  )}
                  onChange={state.onEditArg}
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

/** Long press an example to edit it, since there is no shift key on mobile */
const longPressMs = 400;

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
  /** Long press an example to edit it — see `onExampleDown` */
  press: { timeoutId: number; longPressed: boolean };
  /** Synced each render, so the handlers below never read stale props */
  props: Props;
  /** categoryKey -> currently shown sectionKey */
  sectionKeys: Record<string, string>;
  /** Height in pixels when `open` */
  height: number;
  open: boolean;
  resizing: boolean;
  rootEl: null | HTMLDivElement;
  startHeight: number;
  startY: number;

  focusExample: (exampleId: string) => void;
  getMaxHeight: () => number;
  /** Each of these reads the example from `data-*` — see `getExampleData` */
  onEditArg: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onExampleClick: (e: React.MouseEvent<HTMLButtonElement>) => void;
  onExampleCopy: (e: React.MouseEvent<HTMLButtonElement>) => void;
  onExampleDown: (e: React.PointerEvent<HTMLButtonElement>) => void;
  onExampleEdit: (e: React.MouseEvent<HTMLButtonElement>) => void;
  onExamplePaste: (e: React.MouseEvent<HTMLButtonElement>) => void;
  onExamplePressEnd: () => void;
  onExampleReset: (e: React.MouseEvent<HTMLButtonElement>) => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLDivElement>) => void;
  onResizeDown: (e: React.PointerEvent<HTMLDivElement>) => void;
  onResizeMove: (e: React.PointerEvent<HTMLDivElement>) => void;
  onResizeUp: (e: React.PointerEvent<HTMLDivElement>) => void;
  persist: () => void;
  setCategory: (categoryKey: string) => void;
  setSection: (categoryKey: string, sectionKey: string) => void;
  toggleOpen: () => void;
};
