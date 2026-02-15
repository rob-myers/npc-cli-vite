import { combine } from "@atlaskit/pragmatic-drag-and-drop/combine";
import {
  draggable,
  dropTargetForElements,
} from "@atlaskit/pragmatic-drag-and-drop/element/adapter";
import {
  attachClosestEdge,
  type Edge,
  extractClosestEdge,
} from "@atlaskit/pragmatic-drag-and-drop-hitbox/closest-edge";
import { ContextMenu } from "@base-ui/react/context-menu";
import { uiClassName } from "@npc-cli/ui-sdk";
import { cn, useDoubleTap, useStateRef } from "@npc-cli/util";
import { BoundingBoxIcon, FolderIcon } from "@phosphor-icons/react";
import type React from "react";
import { useEffect } from "react";
import type { State as MapEditState } from "./MapEdit";

/**
 * - Double tap to edit name
 * - Long press or right click icon for context menu
 * - Drag to reorder
 */
export const MapNodeUi: React.FC<TreeItemProps> = ({ element, level, root }) => {
  const state = useStateRef(() => ({
    isExpanded: true,
    editValue: element.name,
    inputEl: null as HTMLInputElement | null,
    longPressTimeout: null as ReturnType<typeof setTimeout> | null,
    rowEl: null as HTMLDivElement | null,
    closestEdge: null as Edge | null,
  }));

  const isSelected = root.selectedId === element.id;
  const isEditing = root.editingId === element.id;
  const isGroup = element.type === "group";

  useEffect(() => {
    if (isEditing) {
      state.editValue = element.name;
      state.inputEl?.focus();
      state.inputEl?.select();
    }
  }, [isEditing, element.name, state]);

  useEffect(() => {
    const el = state.rowEl;
    if (!el) return;
    const id = element.id;
    return combine(
      draggable({ element: el, getInitialData: () => ({ type: "map-node", id }) }),
      dropTargetForElements({
        element: el,
        canDrop: ({ source }) => source.data.type === "map-node" && source.data.id !== id,
        getData: ({ input }) =>
          attachClosestEdge({ id }, { element: el, input, allowedEdges: ["top", "bottom"] }),
        onDrag: ({ self }) => state.set({ closestEdge: extractClosestEdge(self.data) }),
        onDragLeave: () => state.set({ closestEdge: null }),
        onDrop: ({ source, self }) => {
          const edge = extractClosestEdge(self.data);
          state.set({ closestEdge: null });
          if (edge === "top" || edge === "bottom")
            root.moveNode(source.data.id as string, id, edge);
        },
      }),
    );
  }, [element.id, root, state]);

  const onDoubleTap = useDoubleTap(() => root.onStartEdit(element.id));

  return (
    <div>
      <div
        ref={state.ref("rowEl")}
        className={cn(
          uiClassName,
          "relative grid grid-cols-[minmax(auto,1.5rem)_auto] items-center cursor-pointer hover:brightness-125",
          "bg-background border-b border-b-on-background/10",
          isSelected && "brightness-125 border-blue-400/25",
          state.closestEdge === "top" && "border-t-2 border-t-blue-400",
          state.closestEdge === "bottom" && "border-b-2 border-b-blue-400",
        )}
        style={{ paddingLeft: 8 + level * 2 }}
        onClick={(e) => {
          root.onSelect(element.id);
          onDoubleTap.onClick(e.nativeEvent);
        }}
      >
        <ContextMenu.Root>
          <ContextMenu.Trigger className="text-on-background pl-0.5">
            {isGroup ? <FolderIcon /> : <BoundingBoxIcon />}
          </ContextMenu.Trigger>

          <ContextMenu.Portal>
            <ContextMenu.Positioner className="z-50" sideOffset={4}>
              <ContextMenu.Popup className="bg-slate-800 border border-slate-700 rounded-md shadow-lg py-1 min-w-[120px]">
                <ContextMenu.Item
                  className="flex items-center gap-2 px-2 py-1 text-xs text-slate-300 hover:bg-slate-700 cursor-pointer"
                  onClick={() => root.groupNode(element.id)}
                >
                  <FolderIcon className="size-4" />
                  Group node
                </ContextMenu.Item>
              </ContextMenu.Popup>
            </ContextMenu.Positioner>
          </ContextMenu.Portal>
        </ContextMenu.Root>

        <input
          ref={state.ref("inputEl")}
          type="text"
          className={cn(
            "text-xs px-0.5 border-0 border-gray-500/50 my-1 text-on-background/80 bg-transparent outline-none w-full",
            isSelected && "brightness-125 font-medium",
            isEditing ? "bg-slate-700 rounded" : "cursor-pointer",
          )}
          defaultValue={element.name || element.type}
          readOnly={!isEditing}
          onClick={(e) => isEditing && e.stopPropagation()}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              root.onRename(element.id, e.currentTarget.value);
            } else if (e.key === "Escape") {
              root.onCancelEdit();
            }
          }}
          onBlur={(e) => isEditing && root.onRename(element.id, e.currentTarget.value)}
        />
      </div>

      {isGroup && state.isExpanded && element.children && (
        <div className="border-l border-slate-700/50">
          {element.children.map((child) => (
            <MapNodeUi key={child.id} element={child} level={level + 1} root={root} />
          ))}
        </div>
      )}
    </div>
  );
};

export function mapElements(list: MapNode[], id: string, fn: (el: MapNode) => MapNode): MapNode[] {
  return list.map((item) => {
    if (item.id === id) return fn(item);
    if (item.type === "group") return { ...item, children: mapElements(item.children, id, fn) };
    return item;
  });
}

export function traverseElements(list: MapNode[], act: (el: MapNode) => void): void {
  list.forEach((item) => {
    act(item);
    if (item.type === "group") traverseElements(item.children, act);
  });
}

export function extractNode(
  nodes: MapNode[],
  id: string,
): { elements: MapNode[]; node: MapNode | null } {
  for (const child of nodes) {
    if (child.id === id) {
      return { elements: nodes.filter((n) => n.id !== id), node: child };
    }
    if (child.type === "group") {
      const r = extractNode(child.children, id);
      if (r.node) {
        const updated = nodes.map((n) => (n.id === child.id ? { ...n, children: r.elements } : n));
        return { elements: updated, node: r.node };
      }
    }
  }
  return { elements: nodes, node: null };
}

export function insertNode(
  nodes: MapNode[],
  node: MapNode,
  targetId: string,
  edge: "top" | "bottom",
): MapNode[] {
  for (const [i, child] of nodes.entries()) {
    if (child.id === targetId) {
      const idx = edge === "top" ? i : i + 1;
      return [...nodes.slice(0, idx), node, ...nodes.slice(idx)];
    }

    if (child.type === "group") {
      const result = insertNode(child.children, node, targetId, edge);
      if (result !== child.children) {
        return [...nodes.slice(0, i), { ...child, children: result }, ...nodes.slice(i + 1)];
      }
    }
  }
  return nodes;
}

export type ShapeType = "rect" | "circle" | "path" | "group" | "ellipse" | "polygon";

export type MapNode = {
  id: string;
  name: string;
  isVisible: boolean;
  isLocked: boolean;
} & ({ type: "group"; children: MapNode[] } | { type: Exclude<ShapeType, "group"> });

export type GroupMapNode = Pretty<Extract<MapNode, { type: "group" }>>;

interface TreeItemProps {
  element: MapNode;
  level: number;
  root: MapEditState;
}
