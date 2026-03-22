import { combine } from "@atlaskit/pragmatic-drag-and-drop/combine";
import { draggable, dropTargetForElements } from "@atlaskit/pragmatic-drag-and-drop/element/adapter";
import {
  attachClosestEdge,
  type Edge,
  extractClosestEdge,
} from "@atlaskit/pragmatic-drag-and-drop-hitbox/closest-edge";
import { uiClassName } from "@npc-cli/ui-sdk";
import { cn, type UseStateRef, useDoubleTap, useStateRef } from "@npc-cli/util";
import {
  FolderIcon,
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
import type { State as MapEditState } from "./MapEdit";
import { type MapNode, type MapNodeType, traverseNodesSync } from "./map-node-api";

/**
 * - Double tap to edit name
 * - Drag to reorder
 */
export const InspectorNode: React.FC<TreeItemProps> = ({ node, level, root }) => {
  const state = useStateRef(() => ({
    isExpanded: true,
    editValue: node.name,
    inputEl: null as HTMLInputElement | null,
    rowEl: null as HTMLDivElement | null,
    closestEdge: null as Edge | null,
    dropInside: false,
  }));

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
        canDrop: ({ source }) => source.data.type === "map-node" && source.data.id !== id,
        getData: ({ input }) => attachClosestEdge({ id }, { element: el, input, allowedEdges: ["top", "bottom"] }),
        onDrag: ({ self, location }) => {
          const edge = extractClosestEdge(self.data);
          if (isGroup) {
            const rect = el.getBoundingClientRect();
            const y = location.current.input.clientY;
            const relY = (y - rect.top) / rect.height;
            const inCenter = relY > 0.25 && relY < 0.75;
            state.set({ closestEdge: inCenter ? null : edge, dropInside: inCenter });
          } else {
            state.set({ closestEdge: edge, dropInside: false });
          }
        },
        onDragLeave: () => state.set({ closestEdge: null, dropInside: false }),
        onDrop: ({ source }) => {
          const edge = state.closestEdge;
          const dropInside = state.dropInside;
          state.set({ closestEdge: null, dropInside: false });
          const ids = source.data.ids as string[];
          const targetEdge = dropInside && isGroup ? "inside" : edge;
          if (targetEdge === "top" || targetEdge === "bottom" || targetEdge === "inside") {
            ids.forEach((srcId) => root.moveNode(srcId, id, targetEdge));
          }
        },
      }),
    );
  }, []);

  const onDoubleTap = useDoubleTap(() => root.onStartEdit(node.id));

  return (
    <div>
      <div
        ref={state.ref("rowEl")}
        className={cn(
          uiClassName,
          "relative grid grid-cols-[minmax(auto,1.5rem)_auto_auto] items-center cursor-pointer hover:brightness-125",
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
        <span className="text-on-background pl-0.5 py-0.5">
          <NodeIcon type={node.type} />
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
          readOnly={!isEditing}
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
            "flex items-center justify-end px-1 pr-2 text-on-background/50 hover:text-on-background",
            node.locked && "text-on-background/80",
          )}
          title={node.locked ? "Unlock" : "Lock"}
          onClick={(e) => {
            e.stopPropagation();
            const locked = !node.locked;
            traverseNodesSync([node], (n) => (n.locked = locked));
            root.update();
          }}
        >
          {node.locked ? <LockIcon className="size-3 text-red-400" /> : <LockOpenIcon className="size-3" />}
        </button>
      </div>

      {isGroup === true && state.isExpanded === true && (
        <div className="border-l border-slate-700/50">
          {node.children.map((child) => (
            <InspectorNode key={child.id} node={child} level={level + 1} root={root} />
          ))}
        </div>
      )}
    </div>
  );
};

interface TreeItemProps {
  node: MapNode;
  level: number;
  root: UseStateRef<MapEditState>;
}

export function NodeIcon(props: { type: MapNodeType }) {
  switch (props.type) {
    case "group":
      return <FolderIcon className="size-4" />;
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
