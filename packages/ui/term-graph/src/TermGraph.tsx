import { type PrologNode, prolog, type Term } from "@npc-cli/prolog";
import { UiContext } from "@npc-cli/ui-sdk/UiContext";
import { cn, type UseStateRef, useStateRef } from "@npc-cli/util";
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  CaretRightIcon,
  PlusIcon,
  SelectionSlashIcon,
  TrashIcon,
  XIcon,
} from "@phosphor-icons/react";
import { Fragment, useContext, useEffect } from "react";
import type { TermGraphUiMeta } from "./schema";
import {
  type CombinatorKey,
  combinatorKeys,
  getAt,
  insertAfter,
  isCombinator,
  isCompound,
  isVar,
  moveAt,
  type Path,
  removeAt,
  samePath,
  setAt,
  termText,
  unwrapAt,
  wrapAt,
} from "./term-edit";

export default function TermGraph({ meta }: { meta: TermGraphUiMeta }) {
  const { uiStoreApi } = useContext(UiContext);

  const state = useStateRef(
    (): State => ({
      nodes: [],
      error: null,
      selected: null,
      editing: null,
      text: "",
      textFocused: false,
      newName: "",

      current() {
        return state.nodes.find((n) => n.name === meta.nodeKey) ?? state.nodes[0];
      },
      async load() {
        try {
          state.set({ nodes: await prolog.nodes() });
        } catch (e) {
          state.set({ error: String(e) });
        }
      },
      async save(body, selected = state.selected, editing = false) {
        const node = state.current();
        if (node === undefined) return;
        try {
          await prolog.setNode(node.name, body);
          state.set({ selected, editing: editing ? selected : null, error: null });
        } catch (e) {
          state.set({ error: String(e) });
        }
      },
      async commitLeaf(path, text) {
        const node = state.current();
        if (node === undefined) return;
        try {
          await state.save(setAt(node.body, path, await prolog.parse(text)));
        } catch (e) {
          state.set({ error: String(e) });
        }
      },
      async commitText() {
        state.textFocused = false;
        const node = state.current();
        if (node === undefined) return;
        try {
          await state.save(await prolog.parse(state.text), null);
        } catch (e) {
          state.set({ error: String(e) });
        }
      },
      edit(op, editing = false) {
        const node = state.current();
        const path = state.selected;
        if (node === undefined || path === null) return;
        const next = op(node.body, path);
        if (next !== null) state.save(next.term, next.path, editing);
      },
      async addNode() {
        const name = state.newName.trim();
        if (name === "") return;
        await prolog.setNode(name, { f: "seq", args: ["todo"] });
        state.set({ newName: "" });
        state.select(name);
      },
      async removeNode() {
        const node = state.current();
        if (node !== undefined) await prolog.removeNode(node.name);
      },
      select(nodeKey) {
        uiStoreApi.setUiMeta(meta.id, (draft) => void ((draft as TermGraphUiMeta).nodeKey = nodeKey));
        state.set({ selected: null, editing: null });
      },
    }),
    { deps: [meta.nodeKey] },
  );

  useEffect(() => {
    state.load();
    return prolog.subscribeKeyed(`term-graph:${meta.id}`, (e) => e.key === "changed" && state.load());
  }, [meta.id]);

  const node = state.current();
  const bodyJson = JSON.stringify(node?.body);
  useEffect(() => {
    if (node === undefined || state.textFocused) return;
    prolog.write(node.body).then((text) => state.set({ text }));
  }, [bodyJson]);

  const selectedTerm = node && state.selected ? getAt(node.body, state.selected) : null;

  return (
    <div className="size-full flex flex-col bg-zinc-950 text-zinc-300 text-xs">
      <div className="flex flex-wrap items-center gap-1 p-1 border-b border-zinc-800">
        {state.nodes.map((n) => (
          <button
            key={n.name}
            type="button"
            className={cn(
              "px-2 py-0.5 rounded border border-zinc-800 cursor-pointer",
              n === node ? "bg-zinc-800 text-zinc-100" : "hover:bg-zinc-900",
            )}
            onClick={() => state.select(n.name)}
          >
            {n.name}
          </button>
        ))}
        <input
          className="w-24 px-1 py-0.5 bg-zinc-900 border border-zinc-800 rounded"
          placeholder="new node"
          value={state.newName}
          onChange={(e) => state.set({ newName: e.target.value })}
          onKeyDown={(e) => e.key === "Enter" && state.addNode()}
        />
        <ToolButton title="add node" onClick={state.addNode} disabled={state.newName.trim() === ""}>
          <PlusIcon />
        </ToolButton>
        <ToolButton title="remove node" onClick={state.removeNode} disabled={node === undefined}>
          <TrashIcon />
        </ToolButton>
      </div>

      <div className="flex flex-wrap items-center gap-1 p-1 border-b border-zinc-800">
        {combinatorKeys.map((f) => (
          <ToolButton
            key={f}
            title={`wrap in ${f}`}
            disabled={selectedTerm === null}
            onClick={() => state.edit((t, p) => ({ term: wrapAt(t, p, f), path: [...p, 0] }))}
          >
            <span className={combinatorColor[f]}>{f}</span>
          </ToolButton>
        ))}
        <ToolButton
          title="unwrap"
          disabled={selectedTerm === null || !isCombinator(selectedTerm)}
          onClick={() => state.edit((t, p) => withPath(unwrapAt(t, p), null))}
        >
          <SelectionSlashIcon />
        </ToolButton>
        <ToolButton
          title="add after"
          disabled={selectedTerm === null}
          onClick={() => state.edit((t, p) => insertAfter(t, p, "todo"), true)}
        >
          <PlusIcon />
        </ToolButton>
        <ToolButton
          title="remove"
          disabled={selectedTerm === null}
          onClick={() => state.edit((t, p) => withPath(removeAt(t, p), null))}
        >
          <XIcon />
        </ToolButton>
        <ToolButton
          title="move back"
          disabled={selectedTerm === null}
          onClick={() => state.edit((t, p) => moveAt(t, p, -1))}
        >
          <ArrowLeftIcon />
        </ToolButton>
        <ToolButton
          title="move forward"
          disabled={selectedTerm === null}
          onClick={() => state.edit((t, p) => moveAt(t, p, 1))}
        >
          <ArrowRightIcon />
        </ToolButton>
      </div>

      <div
        className="flex-1 overflow-auto p-3 scrollbar-thin"
        onClick={() => state.set({ selected: null, editing: null })}
      >
        {node === undefined ? (
          <div className="text-zinc-500">No nodes: add one above, or run `demo_prolog_seed` in a tty</div>
        ) : (
          <TermBox term={node.body} path={[]} state={state} />
        )}
      </div>

      <textarea
        className="h-20 p-2 font-mono bg-zinc-900 border-t border-zinc-800 resize-y outline-none"
        spellCheck={false}
        value={state.text}
        onFocus={() => (state.textFocused = true)}
        onChange={(e) => state.set({ text: e.target.value })}
        onBlur={state.commitText}
      />
      {state.error !== null && <div className="p-1 text-red-400 border-t border-zinc-800 break-all">{state.error}</div>}
    </div>
  );
}

/** A combinator lays its parts out as the series-parallel graph they are; anything else is a leaf */
function TermBox({ term, path, state }: { term: Term; path: Path; state: UseStateRef<State> }) {
  const selected = samePath(state.selected, path);
  const onClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    state.set({ selected: path });
  };

  if (isCombinator(term)) {
    const children = term.args.map((arg, i) => (
      <TermBox key={`${i}:${termText(arg)}`} term={arg} path={[...path, i]} state={state} />
    ));
    return (
      <div
        className={cn(
          "relative inline-flex rounded border border-zinc-800 p-2 pt-4 gap-2",
          term.f === "seq" ? "flex-row items-center" : "flex-col items-start",
          term.f === "par" && "border-l-2 border-l-sky-700",
          selected && "ring-2 ring-blue-400",
        )}
        onClick={onClick}
      >
        <span className={cn("absolute top-0.5 left-1 text-[10px] leading-none", combinatorColor[term.f])}>
          {term.f}
        </span>
        {term.args.map((_, i) => (
          <Fragment key={`${i}:${termText(term.args[i])}`}>
            {i > 0 && term.f === "seq" && <CaretRightIcon className="text-zinc-600 shrink-0" />}
            {i > 0 && term.f === "alt" && <div className="w-full border-t border-dashed border-zinc-700" />}
            {children[i]}
          </Fragment>
        ))}
      </div>
    );
  }

  if (samePath(state.editing, path)) {
    return (
      <input
        autoFocus
        className="px-1 py-0.5 font-mono bg-zinc-900 border border-blue-400 rounded outline-none"
        defaultValue={termText(term)}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === "Enter") state.commitLeaf(path, e.currentTarget.value);
          if (e.key === "Escape") state.set({ editing: null });
        }}
        onBlur={() => state.set({ editing: null })}
      />
    );
  }

  return (
    <div
      className={cn(
        "px-1.5 py-0.5 font-mono whitespace-nowrap rounded bg-zinc-900 border border-zinc-800 cursor-pointer",
        selected && "ring-2 ring-blue-400",
      )}
      onClick={onClick}
      onDoubleClick={(e) => {
        e.stopPropagation();
        state.set({ selected: path, editing: path });
      }}
    >
      <Leaf term={term} />
    </div>
  );
}

/** Variables stand out by colour, so a role shared across steps is plain to see */
function Leaf({ term }: { term: Term }) {
  if (isVar(term)) return <span style={{ color: varColor(term.v) }}>{term.v}</span>;
  if (Array.isArray(term)) return <Args open="[" close="]" args={term} />;
  if (!isCompound(term)) return <span>{termText(term)}</span>;
  return (
    <span>
      <span className="text-zinc-100">{termText(term.f)}</span>
      <Args open="(" close=")" args={term.args} />
    </span>
  );
}

function Args({ open, close, args }: { open: string; close: string; args: Term[] }) {
  return (
    <span className="text-zinc-500">
      {open}
      {args.map((arg, i) => (
        <Fragment key={i}>
          {i > 0 && ", "}
          <span className="text-zinc-300">
            <Leaf term={arg} />
          </span>
        </Fragment>
      ))}
      {close}
    </span>
  );
}

function ToolButton(props: { title: string; disabled?: boolean; onClick(): void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      title={props.title}
      disabled={props.disabled}
      className="px-1.5 py-0.5 rounded border border-zinc-800 cursor-pointer hover:bg-zinc-800 disabled:opacity-40 disabled:cursor-default"
      onClick={props.onClick}
    >
      {props.children}
    </button>
  );
}

function varColor(name: string) {
  let hash = 0;
  for (const c of name) hash = (hash * 31 + c.charCodeAt(0)) | 0;
  return `hsl(${Math.abs(hash) % 360} 70% 70%)`;
}

function withPath(term: null | Term, path: null | Path) {
  return term === null ? null : { term, path };
}

const combinatorColor: Record<CombinatorKey, string> = {
  seq: "text-emerald-400",
  par: "text-sky-400",
  alt: "text-amber-400",
};

type State = {
  nodes: PrologNode[];
  error: null | string;
  selected: null | Path;
  /** The leaf whose text is being edited */
  editing: null | Path;
  /** The textarea's draft of the whole body */
  text: string;
  textFocused: boolean;
  newName: string;

  current(): PrologNode | undefined;
  load(): Promise<void>;
  save(body: Term, selected?: null | Path, editing?: boolean): Promise<void>;
  commitLeaf(path: Path, text: string): Promise<void>;
  commitText(): Promise<void>;
  /** With `editing`, the leaf it selects is then edited */
  edit(op: (body: Term, path: Path) => null | { term: Term; path: null | Path }, editing?: boolean): void;
  addNode(): Promise<void>;
  removeNode(): Promise<void>;
  select(nodeKey: string): void;
};
