import { ContextMenu } from "@base-ui/react/context-menu";
import type { WorldState } from "@npc-cli/ui__world";
import type { GraphEntry, GraphNode } from "@npc-cli/ui__world/scenario.schema";
import { cn } from "@npc-cli/util";
import { isTouchDevice } from "@npc-cli/util/legacy/dom";
import { CaretRightIcon, CheckIcon, TrashIcon } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import {
  angleOf,
  type DecorType,
  hasHeight,
  type NewDefOpts,
  quadScale,
  quadScaled,
  toMap,
  turned,
  typeIcon,
  withHeight,
  withTilt,
} from "./decor-edit";
import {
  addedNode,
  minNodes,
  movedNodes,
  onSpot,
  type Pt,
  removedEdge,
  removedNode,
  reversedEdge,
  snapped,
  splitEdge,
  withDirected,
} from "./graph-edit";
import { mergeKey } from "./history";

/**
 * The map's context menu: on empty map it adds decor where it was opened, on a decor it edits it.
 * With a graph chosen, empty map adds a node, and its nodes and edges have their own items.
 * A ctrl-click is a fine-step drag, not a menu, as is any press a drag is blocking. None on touch, for now
 */
export function DecorMenu({
  w,
  children,
  newDefOpts,
  isBlocked,
  onOpenChange,
  onAdd,
  onTarget,
  onCommit,
  onRemove,
  graph,
  onGraphCommit,
  onGraphConnect,
  spotNear,
}: Props) {
  const [target, setTarget] = useState<Target | null>(null);

  function onContextMenuCapture(e: React.MouseEvent<HTMLDivElement>) {
    if (e.ctrlKey || isBlocked()) {
      e.preventDefault();
      e.stopPropagation(); // else the Trigger below opens anyway
      return;
    }
    locate(e);
  }

  /** What was pressed: with a graph chosen, also where a node would go, and the spot near a node */
  function locate(e: React.MouseEvent<HTMLDivElement>) {
    const svg = e.currentTarget.querySelector("svg");
    if (svg === null) return;
    const at = toMap(svg, e.clientX, e.clientY);
    const graphEl = (e.target as Element).closest?.("[data-graph-node], [data-graph-edge]");
    const nodeAt = graph === null ? null : snapped(w, at);
    if (graphEl != null && graph !== null) {
      const id = graphEl.getAttribute("data-graph-node");
      const node = graph.nodes.find((n) => n.id === id);
      const near = node === undefined || node.spot !== undefined ? null : spotNear({ x: node.at[0], y: node.at[1] });
      const edgeAttr = graphEl.getAttribute("data-graph-edge");
      const edge = edgeAttr === null ? undefined : Number(edgeAttr);
      return setTarget({ key: null, at, nodeAt, graph: { node, edge, near } });
    }
    const el = (e.target as Element).closest?.("[data-decor], [data-handle]");
    const key = el?.getAttribute("data-decor") ?? el?.getAttribute("data-handle") ?? null;
    setTarget({ key, at, nodeAt });
    if (key !== null) onTarget(key);
  }

  const def = target?.key == null ? undefined : w.decor.runtime.defByKey[target.key];
  const onGraph = graph === null ? undefined : target?.graph;
  const { node, edge, near } = onGraph ?? {};
  /** Where a node would go: on the navmesh where the menu was opened */
  const nodeAt = target?.nodeAt ?? null;
  const imgs = Object.keys(w.sheets?.decor ?? {});

  if (touchDevice) return <div className="flex-1 min-w-0">{children}</div>;

  return (
    <ContextMenu.Root onOpenChange={(open) => onOpenChange(open)}>
      <ContextMenu.Trigger className="flex-1 min-w-0" onContextMenuCapture={onContextMenuCapture}>
        {children}
      </ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Positioner className="z-50" sideOffset={2}>
          <ContextMenu.Popup className={popupCls}>
            {graph !== null && onGraph !== undefined && (
              <ContextMenu.Group>
                <ContextMenu.GroupLabel className={labelCls}>
                  {graph.key} · {node?.id ?? "edge"}
                </ContextMenu.GroupLabel>
                {edge !== undefined && (
                  <>
                    <ContextMenu.Item
                      className={itemCls}
                      disabled={nodeAt === null}
                      onClick={() => nodeAt !== null && onGraphCommit(splitEdge(graph, edge, nodeAt))}
                    >
                      insert node here
                    </ContextMenu.Item>
                    {graph.directed && (
                      <ContextMenu.Item className={itemCls} onClick={() => onGraphCommit(reversedEdge(graph, edge))}>
                        reverse
                      </ContextMenu.Item>
                    )}
                  </>
                )}
                {node !== undefined && (
                  <>
                    <ContextMenu.Item className={itemCls} onClick={() => onGraphConnect(node.id)}>
                      connect to…
                    </ContextMenu.Item>
                    {node.spot !== undefined ? (
                      <ContextMenu.Item
                        className={itemCls}
                        onClick={() => onGraphCommit(movedNodes(graph, { [node.id]: node.at }))}
                      >
                        detach from {node.spot}
                      </ContextMenu.Item>
                    ) : (
                      <ContextMenu.Item
                        className={itemCls}
                        disabled={near == null}
                        onClick={() =>
                          near != null && onGraphCommit(onSpot(graph, node.id, near.spot, [near.at.x, near.at.y]))
                        }
                      >
                        {near == null ? "no spot near" : `attach to ${near.spot}`}
                      </ContextMenu.Item>
                    )}
                  </>
                )}
                <ContextMenu.CheckboxItem
                  className={itemCls}
                  checked={graph.directed}
                  onCheckedChange={(directed) => onGraphCommit(withDirected(graph, directed))}
                >
                  <span className="w-3">
                    <ContextMenu.CheckboxItemIndicator>
                      <CheckIcon className="size-3" />
                    </ContextMenu.CheckboxItemIndicator>
                  </span>
                  directed
                </ContextMenu.CheckboxItem>
                <ContextMenu.Separator className="my-1 border-t border-zinc-700" />
                {node !== undefined && (
                  <ContextMenu.Item
                    className={cn(itemCls, "text-red-300 data-disabled:opacity-50")}
                    disabled={graph.nodes.length <= minNodes}
                    onClick={() => onGraphCommit(removedNode(graph, node.id))}
                  >
                    <TrashIcon className="size-3.5" />
                    delete node {node.id}
                  </ContextMenu.Item>
                )}
                {edge !== undefined && (
                  <ContextMenu.Item
                    className={cn(itemCls, "text-red-300")}
                    onClick={() => onGraphCommit(removedEdge(graph, edge))}
                  >
                    <TrashIcon className="size-3.5" />
                    delete edge
                  </ContextMenu.Item>
                )}
              </ContextMenu.Group>
            )}

            {target !== null && onGraph === undefined && def === undefined && graph !== null && (
              <ContextMenu.Group>
                <ContextMenu.GroupLabel className={labelCls}>{graph.key}</ContextMenu.GroupLabel>
                <ContextMenu.Item
                  className={itemCls}
                  disabled={nodeAt === null}
                  onClick={() => nodeAt !== null && onGraphCommit(addedNode(graph, nodeAt))}
                >
                  add node here
                </ContextMenu.Item>
                <ContextMenu.Separator className="my-1 border-t border-zinc-700" />
              </ContextMenu.Group>
            )}

            {target !== null && onGraph === undefined && def === undefined && (
              <ContextMenu.Group>
                <ContextMenu.GroupLabel className={labelCls}>add here</ContextMenu.GroupLabel>
                {addTypes.map((type) => {
                  const TypeIcon = typeIcon[type];
                  return (
                    <ContextMenu.Item key={type} className={itemCls} onClick={() => onAdd(type, target.at)}>
                      <TypeIcon className="size-3.5" />
                      {type}
                      {(type === "point" || type === "quad") && newDefOpts.img !== undefined && (
                        <span className="ml-auto pl-3 text-zinc-500">{newDefOpts.img}</span>
                      )}
                    </ContextMenu.Item>
                  );
                })}
              </ContextMenu.Group>
            )}

            {def !== undefined && (
              <ContextMenu.Group>
                <ContextMenu.GroupLabel className={labelCls}>
                  {def.key} · {def.type}
                </ContextMenu.GroupLabel>

                {(def.type === "point" || def.type === "quad") && (
                  <ContextMenu.SubmenuRoot>
                    <ContextMenu.SubmenuTrigger className={itemCls}>
                      image
                      <span className="ml-auto pl-3 text-zinc-500">{def.img ?? "none"}</span>
                      <CaretRightIcon className="size-3" />
                    </ContextMenu.SubmenuTrigger>
                    <ContextMenu.Portal>
                      <ContextMenu.Positioner className="z-50" sideOffset={2}>
                        <ContextMenu.Popup className={cn(popupCls, "max-h-72 overflow-auto")}>
                          <ContextMenu.RadioGroup
                            value={def.img ?? ""}
                            onValueChange={(img: string) =>
                              def.type === "point"
                                ? onCommit({ ...def, img: img === "" ? undefined : img })
                                : img !== "" && onCommit({ ...def, img })
                            }
                          >
                            {(def.type === "point" ? ["", ...imgs] : imgs).map((img) => (
                              <ContextMenu.RadioItem key={img} value={img} className={itemCls}>
                                <span className="w-3">
                                  <ContextMenu.RadioItemIndicator>
                                    <CheckIcon className="size-3" />
                                  </ContextMenu.RadioItemIndicator>
                                </span>
                                {img === "" ? "none" : img}
                              </ContextMenu.RadioItem>
                            ))}
                          </ContextMenu.RadioGroup>
                        </ContextMenu.Popup>
                      </ContextMenu.Positioner>
                    </ContextMenu.Portal>
                  </ContextMenu.SubmenuRoot>
                )}

                {def.type === "quad" && (
                  <ContextMenu.CheckboxItem
                    className={itemCls}
                    checked={def.meta?.tilt === true}
                    onCheckedChange={(tilt) => onCommit(withTilt(def, tilt))}
                    closeOnClick={false}
                  >
                    <span className="w-3">{def.meta?.tilt === true && <CheckIcon className="size-3" />}</span>
                    tilt
                  </ContextMenu.CheckboxItem>
                )}

                {(def.type === "rect" || def.type === "quad") && (
                  <NumberRow
                    label="angle°"
                    title="angle (degrees)"
                    step={5}
                    value={toDegrees(angleOf(w, def))}
                    onCommit={(degrees, stepped) =>
                      onCommit(turned(w, def, ((degrees ?? 0) * Math.PI) / 180), mergeKey(stepped, [def.key], "angle"))
                    }
                  />
                )}
                {def.type === "quad" && (
                  <NumberRow
                    label="scale"
                    title="scale on its image's own size"
                    step={0.1}
                    value={Math.round(quadScale(def) * 1000) / 1000}
                    placeholder="1"
                    onCommit={(scale, stepped) =>
                      onCommit(quadScaled(w, def, scale ?? 1), mergeKey(stepped, [def.key], "scale"))
                    }
                  />
                )}
                {hasHeight(def) && (
                  <NumberRow
                    label="height"
                    value={def.y3d}
                    onCommit={(y3d, stepped) => onCommit(withHeight(def, y3d), mergeKey(stepped, [def.key], "y3d"))}
                  />
                )}

                <ContextMenu.Separator className="my-1 border-t border-zinc-700" />
                <ContextMenu.Item className={cn(itemCls, "text-red-300")} onClick={() => onRemove(def.key)}>
                  <TrashIcon className="size-3.5" />
                  delete
                </ContextMenu.Item>
              </ContextMenu.Group>
            )}
          </ContextMenu.Popup>
        </ContextMenu.Positioner>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
}

/** Typed, committed on Enter or blur; stepped (spinner, arrow keys) at once. Emptied, it is the default */
export function NumberInput({
  value,
  placeholder,
  title = "height (m)",
  step = 0.05,
  className,
  onCommit,
}: {
  value: number | undefined;
  placeholder?: string;
  title?: string;
  step?: number;
  className?: string;
  onCommit(value: number | undefined, stepped: boolean): void;
}) {
  const [text, setText] = useState(value === undefined ? "" : String(value));
  useEffect(() => setText(value === undefined ? "" : String(value)), [value]);

  function commit() {
    const next = text.trim() === "" ? undefined : Number(text);
    if (next !== undefined && !Number.isFinite(next)) return setText(value === undefined ? "" : String(value));
    if (next !== value) onCommit(next, false);
  }

  function onChange(e: React.ChangeEvent<HTMLInputElement>) {
    const next = e.currentTarget.value;
    setText(next);
    // typing has an `inputType`, a step has none
    const stepped = !(e.nativeEvent as InputEvent).inputType;
    if (stepped && next !== "" && Number.isFinite(Number(next)) && Number(next) !== value) onCommit(Number(next), true);
  }

  return (
    <input
      type="number"
      step={step}
      title={title}
      value={text}
      placeholder={placeholder}
      className={cn(
        "w-14 px-1 py-0.5 rounded border border-zinc-700 bg-zinc-950 text-zinc-200 outline-none",
        className,
      )}
      onChange={onChange}
      onBlur={commit}
      // the menu's own keys, and the panel's e.g. Backspace deletes, are not for a field
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter") commit();
      }}
      onClick={(e) => e.stopPropagation()}
    />
  );
}

/** A menu row: a label, and its field to the right */
function NumberRow({
  label,
  placeholder = "0",
  ...props
}: { label: string } & React.ComponentProps<typeof NumberInput>) {
  return (
    <div className={cn(itemCls, "cursor-default")}>
      {label}
      <NumberInput className="ml-auto" placeholder={placeholder} {...props} />
    </div>
  );
}

/** To a tenth of a degree in (-180, 180], so a field shows what was typed */
function toDegrees(radians: number) {
  return Math.round((Math.atan2(Math.sin(radians), Math.cos(radians)) * 1800) / Math.PI) / 10;
}

type Props = {
  w: WorldState;
  children: React.ReactNode;
  /** What an added point or quad takes, as the toolbar has it */
  newDefOpts: NewDefOpts;
  /** Whilst a press on the map is under way, and just after */
  isBlocked(): boolean;
  onOpenChange(open: boolean): void;
  onAdd(type: DecorType, at: Geom.VectJson): void;
  /** A decor the menu was opened on */
  onTarget(key: string): void;
  /** `merge` names an edit that repeats, e.g. a spinner's steps: one undo takes back the run */
  onCommit(def: Geomorph.DecorDef, merge?: string): void;
  onRemove(key: string): void;
  /** The chosen graph, if it may be edited */
  graph: null | GraphEntry;
  onGraphCommit(next: GraphEntry): void;
  /** Begins an edge from node `from`, ended by a click on another */
  onGraphConnect(from: string): void;
  /** The spot nearest `at`, if one is near: its alias and point */
  spotNear(at: Geom.VectJson): null | { spot: string; at: Geom.VectJson };
};

/** Where the menu was opened, and on which decor, or which of the graph's nodes or edges, if any */
type Target = {
  key: string | null;
  at: Geom.VectJson;
  /** On the navmesh, where a node would go, if a graph is chosen */
  nodeAt: null | Pt;
  graph?: { node?: GraphNode; edge?: number; near: null | { spot: string; at: Geom.VectJson } };
};

const touchDevice = isTouchDevice();
const addTypes: DecorType[] = ["point", "rect", "circle", "quad"];
const popupCls =
  "decorator min-w-36 py-1 rounded border border-zinc-700 bg-zinc-900 text-xs text-zinc-300 shadow-lg outline-none";
const itemCls =
  "flex items-center gap-2 px-3 py-1 cursor-pointer select-none outline-none data-highlighted:bg-zinc-700";
const labelCls = "px-3 py-1 text-zinc-500";
