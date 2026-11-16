import { cn, type PaneLeaf, tw } from "@npc-cli/util";
import { Picker } from "@npc-cli/util/picker";
import { DotsSixVerticalIcon, SquareSplitHorizontalIcon, SquareSplitVerticalIcon, XIcon } from "@phosphor-icons/react";
import { Allotment } from "allotment";
import { useContext } from "react";
import { ArticlePane } from "./article/ArticlePane";
import { SkipNetContext } from "./context";
import { ItemPane } from "./ItemPane";
import { JobsPane } from "./JobsPane";
import { LibraryPane } from "./library/LibraryPane";
import type { SkipNetLeaf, SkipNetPaneNode } from "./schema";

/** A split as an allotment of its children, else a pane */
export function SkipNetPanes({ node }: { node: SkipNetPaneNode }) {
  const state = useContext(SkipNetContext);
  if (node.type === "leaf") {
    return <SkipNetPane leaf={node} />;
  }
  return (
    <Allotment
      key={`${node.id}-${node.vertical}`}
      vertical={node.vertical}
      defaultSizes={node.sizes}
      onDragEnd={(sizes) => state.setSizes(node.id, sizes)}
    >
      {node.children.map((child) => (
        <Allotment.Pane key={child.id} minSize={minPanePx}>
          <SkipNetPanes node={child} />
        </Allotment.Pane>
      ))}
    </Allotment>
  );
}

function SkipNetPane({ leaf }: { leaf: SkipNetPaneLeaf }) {
  const state = useContext(SkipNetContext);
  const choose = (value: string) => state.setLeaf(leaf.id, toLeaf(value));
  const value = toValue(leaf);
  const { items } = state;
  const options = [
    ...kindOptions,
    ...items.map((x) => ({ value: `${itemPrefix}${x.key}`, label: x.title })),
    // an item not mounted yet keeps its place
    ...(leaf.kind === "item" && !items.some((x) => x.key === leaf.itemKey)
      ? [{ value, label: `${leaf.itemKey}` }]
      : []),
  ];

  return (
    <div data-pane-id={leaf.id} className="size-full flex flex-col border border-zinc-800">
      <header className="shrink-0 flex items-center gap-1 px-1 py-0.5 bg-zinc-900 border-b border-zinc-800">
        <button
          type="button"
          title="drag onto another pane, or its grip to swap"
          data-pane-grip
          className={cn(iconButtonClass, "cursor-grab active:cursor-grabbing touch-none")}
          onPointerDown={(e) => state.startDrag(e, leaf.id)}
          onPointerMove={state.moveDrag}
          onPointerUp={state.endDrag}
          onLostPointerCapture={state.endDrag}
        >
          <DotsSixVerticalIcon className="size-3.5" />
        </button>
        <Picker
          value={value}
          options={options}
          onChange={choose}
          title="what this pane shows"
          popupClassName="skip-net"
        />
        <span className="flex-1" />
        <button
          type="button"
          title="split right"
          className={iconButtonClass}
          onClick={() => state.split(leaf.id, "right")}
        >
          <SquareSplitHorizontalIcon className="size-3.5" />
        </button>
        <button
          type="button"
          title="split down"
          className={iconButtonClass}
          onClick={() => state.split(leaf.id, "bottom")}
        >
          <SquareSplitVerticalIcon className="size-3.5" />
        </button>
        <button type="button" title="close pane" className={iconButtonClass} onClick={() => state.close(leaf.id)}>
          <XIcon className="size-3.5" />
        </button>
      </header>
      <div className="flex-1 min-h-0 overflow-hidden">
        <PaneBody leaf={leaf} options={options} choose={choose} />
      </div>
    </div>
  );
}

function PaneBody(props: { leaf: SkipNetPaneLeaf; options: PaneOption[]; choose(value: string): void }) {
  const { leaf, options, choose } = props;
  const state = useContext(SkipNetContext);
  switch (leaf.kind) {
    case "library":
      return <LibraryPane leaf={leaf} paneId={leaf.id} />;
    case "jobs":
      return <JobsPane leaf={leaf} paneId={leaf.id} />;
    case "article":
      return <ArticlePane leaf={leaf} paneId={leaf.id} />;
    case "item":
      return (
        <ItemPane
          item={state.items.find((x) => x.key === leaf.itemKey)}
          itemKey={leaf.itemKey}
          worldKey={state.meta.worldKey}
        />
      );
    case null:
      return (
        <div className="size-full grid place-content-center gap-1">
          {options.flatMap(({ value, label }) =>
            value === emptyValue ? (
              []
            ) : (
              <button key={value} type="button" className={kindButtonClass} onClick={() => choose(value)}>
                {label}
              </button>
            ),
          )}
        </div>
      );
  }
}

/** A Picker's value for a leaf: its kind, an item's key prefixed */
function toValue(leaf: SkipNetLeaf): string {
  return leaf.kind === "item" ? `${itemPrefix}${leaf.itemKey}` : (leaf.kind ?? emptyValue);
}

function toLeaf(value: string): SkipNetLeaf {
  if (value.startsWith(itemPrefix)) return { kind: "item", itemKey: value.slice(itemPrefix.length) };
  return { kind: paneKinds.find((x) => x === value) ?? null };
}

type SkipNetPaneLeaf = PaneLeaf<SkipNetLeaf>;

const emptyValue = "";
const itemPrefix = "item:";
type PaneOption = { value: string; label: string };

const paneKinds = ["library", "jobs", "article"] as const;
const kindOptions: PaneOption[] = [
  { value: emptyValue, label: "empty" },
  ...paneKinds.map((kind) => ({ value: kind, label: kind })),
];
/** Allotment snaps no pane narrower than this */
const minPanePx = 60;

const iconButtonClass = tw(
  "grid place-items-center p-0.5 rounded text-zinc-500 cursor-pointer hover:bg-zinc-800 hover:text-zinc-200",
);
const kindButtonClass = tw("px-3 py-1 rounded border border-zinc-800 cursor-pointer hover:bg-zinc-800");
