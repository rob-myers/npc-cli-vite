import { combine } from "@atlaskit/pragmatic-drag-and-drop/combine";
import { draggable, dropTargetForElements } from "@atlaskit/pragmatic-drag-and-drop/element/adapter";
import {
  attachClosestEdge,
  type Edge,
  extractClosestEdge,
} from "@atlaskit/pragmatic-drag-and-drop-hitbox/closest-edge";
import { cn, type UseStateRef, useDoubleTap, useStateRef } from "@npc-cli/util";
import {
  FolderIcon,
  FolderOpenIcon,
  ImageIcon,
  LockIcon,
  LockOpenIcon,
  PathIcon,
  QuestionIcon,
  RectangleIcon,
  StampIcon,
} from "@phosphor-icons/react";
import type React from "react";
import { useEffect } from "react";
import type { MapNode, MapNodeType } from "./editor.schema";
import type { State as MapEditState } from "./MapEdit";
import { traverseNodesSync } from "./map-node-api";

/**
 * - Double tap to edit name
 * - Drag to reorder
 */
export const InspectorNode: React.FC<TreeItemProps> = ({ node, level, root }) => {
  const state = useStateRef(() => ({
    editValue: node.name,
    inputEl: null as HTMLInputElement | null,
    rowEl: null as HTMLDivElement | null,
    closestEdge: null as Edge | null,
    dropInside: false,
    /** The prop as of the latest render — a reload or undo hands the same id a fresh object */
    node,
  }));
  state.node = node;

  const isSelected = root.selectedIds.has(node.id);
  const isEditing = root.editingId === node.id;
  const isGroup = node.type === "group";

  useEffect(() => {
    const el = state.rowEl;
    if (!el) return;
    const id = node.id;
    return combine(
      draggable({
        element: el,
        getInitialData: () => ({
          type: "map-node",
          id,
          ids: root.selectedIds.has(id) ? [...root.selectedIds] : [id],
        }),
      }),
      dropTargetForElements({
        element: el,
        canDrop: ({ source }) => !root.isReadOnly() && source.data.type === "map-node" && source.data.id !== id,
        getData: ({ input }) => attachClosestEdge({ id }, { element: el, input, allowedEdges: ["top", "bottom"] }),
        onDrag: ({ self, location }) => {
          if (isGroup) {
            // a folder row mostly means "into the folder": a thin band at the top reorders before
            // it, and the band at the bottom reorders after it — or, once its children show, puts
            // the drop FIRST among them, so the line under the folder means the same as the line
            // over its first child, rather than an append sitting a few pixels above a prepend
            const rect = el.getBoundingClientRect();
            const y = location.current.input.clientY;
            const bottomBand = isOpenGroup(state.node) ? rect.height * groupFirstFrac : groupEdgePx;
            const edge = y - rect.top <= groupEdgePx ? "top" : rect.bottom - y <= bottomBand ? "bottom" : null;
            state.set({ closestEdge: edge, dropInside: edge === null });
            if (edge === null) {
              if (!root.expandTimer) {
                root.expandTimer = setTimeout(() => {
                  const group = state.node;
                  if (group.type === "group" && !group.expanded) {
                    group.expanded = true;
                    root.update();
                  }
                  root.expandTimer = null;
                }, 600);
              }
            } else {
              clearTimeout(root.expandTimer ?? undefined);
              root.expandTimer = null;
            }
          } else {
            state.set({ closestEdge: extractClosestEdge(self.data), dropInside: false });
          }
        },
        onDragLeave: () => {
          clearTimeout(root.expandTimer ?? undefined);
          root.expandTimer = null;
          state.set({ closestEdge: null, dropInside: false });
        },
        onDrop: ({ source }) => {
          const edge = state.closestEdge;
          const dropInside = state.dropInside;
          state.set({ closestEdge: null, dropInside: false });
          const ids = source.data.ids as string[];
          if (dropInside && isGroup) {
            root.moveNodes(ids, id, "inside");
          } else if (edge === "bottom" && isOpenGroup(state.node)) {
            root.moveNodes(ids, id, "inside-first");
          } else if (edge === "top" || edge === "bottom") {
            root.moveNodes(ids, id, edge);
          }
        },
      }),
    );
  }, []);

  const onDoubleTap = useDoubleTap(() => !root.isReadOnly() && root.onStartEdit(node.id));

  return (
    <div>
      <div
        ref={state.ref("rowEl")}
        data-node-id={node.id}
        className={cn(
          "relative grid grid-cols-[minmax(auto,1.5rem)_auto_1.5em] items-center cursor-pointer hover:brightness-125",
          "bg-background border-b border-b-on-background/10",
          isSelected && "brightness-125 border-blue-400/25",
          state.closestEdge === "top" && "border-t-2 border-t-blue-400",
          state.closestEdge === "bottom" && "border-b-2 border-b-blue-400",
          state.dropInside && "bg-blue-400/20 ring-1 ring-inset ring-blue-400",
        )}
        style={{ paddingLeft: 8 + level * 2 }}
        onClick={(e) => {
          root.onSelect(node.id, { shiftKey: e.shiftKey, metaKey: e.metaKey });
          onDoubleTap.onClick(e.nativeEvent);
        }}
      >
        <span
          className="text-on-background pl-0.5 py-0.5"
          onClick={(e) => {
            e.stopPropagation();
            if (node.type === "group") {
              node.expanded = !node.expanded;
              root.update();
            } else {
              // centring on a node selects it too, cmd/shift extending as they do on the row
              root.onSelect(node.id, { shiftKey: e.shiftKey, metaKey: e.metaKey });
              root.zoomToNode(node.id);
            }
          }}
        >
          <NodeIcon type={node.type} isExpanded={isGroup && node.type === "group" ? node.expanded : undefined} />
        </span>

        <input
          ref={state.ref("inputEl")}
          type="text"
          className={cn(
            "w-full my-1 px-0.5 text-xs border-0 border-gray-500/50 text-on-background/80 bg-transparent outline-none",
            "selection:text-white selection:bg-black",
            isEditing ? "italic" : "cursor-pointer",
            isSelected && (root.theme === "dark" ? "text-blue-400/80" : "text-blue-900/80"),
          )}
          value={node.name}
          readOnly={!isEditing || root.isReadOnly()}
          onBlur={() => isEditing && root.set({ editingId: null })}
          onChange={(e) => {
            node.name = e.currentTarget.value;
            state.update();
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") root.editingId === null ? root.onStartEdit(node.id) : root.onCancelEdit();
            if (e.key === "Escape") root.onCancelEdit();
          }}
        />

        <button
          className={cn(
            "flex items-center justify-center text-on-background/50 hover:text-on-background",
            node.locked && "text-on-background/80",
          )}
          title={node.locked ? "Unlock" : "Lock"}
          onClick={(e) => {
            e.stopPropagation();
            if (root.isReadOnly()) return;
            const locked = !node.locked;
            traverseNodesSync([node], (n) => (n.locked = locked));
            root.update();
          }}
        >
          {node.locked ? <LockIcon className="size-3 text-red-400" /> : <LockOpenIcon className="size-3" />}
        </button>
      </div>

      {isGroup === true && node.type === "group" && node.expanded === true && (
        <div className="border-l border-slate-700/50">
          {node.children.map((child) => (
            <InspectorNode key={child.id} node={child} level={level + 1} root={root} />
          ))}
        </div>
      )}
    </div>
  );
};

/** How far from a folder row's top or bottom a drop reorders around it rather than into it */
const groupEdgePx = 5;
/** The share of an OPEN folder row, from its bottom, where a drop goes first among its children */
const groupFirstFrac = 0.4;

/** Whether the folder's children are on show beneath it */
function isOpenGroup(node: MapNode): boolean {
  return node.type === "group" && node.expanded === true && node.children.length > 0;
}

interface TreeItemProps {
  node: MapNode;
  level: number;
  root: UseStateRef<MapEditState>;
}

export function NodeIcon(props: { type: MapNodeType; isExpanded?: boolean }) {
  switch (props.type) {
    case "group":
      return props.isExpanded ? <FolderOpenIcon className="size-4" /> : <FolderIcon className="size-4" />;
    case "rect":
      return <RectangleIcon className="size-4" />;
    case "image":
      return <ImageIcon className="size-4" />;
    case "symbol":
      return <StampIcon className="size-4" />;
    case "path":
      return <PathIcon className="size-4" />;
    default:
      return <QuestionIcon className="size-4" />;
  }
}
