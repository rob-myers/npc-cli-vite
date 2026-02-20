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
import type { MapNode } from "./map-node-api";

/**
 * - Double tap to edit name
 * - Long press or right click icon for context menu
 * - Drag outside icon to reorder
 */
export const InspectorNode: React.FC<TreeItemProps> = ({ element, level, root }) => {
  const state = useStateRef(() => ({
    isExpanded: true,
    editValue: element.name,
    inputEl: null as HTMLInputElement | null,
    longPressTimeout: null as ReturnType<typeof setTimeout> | null,
    rowEl: null as HTMLDivElement | null,
    closestEdge: null as Edge | null,
    dropInside: false,
  }));

  const isSelected = root.selectedIds.has(element.id);
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
        getData: ({ input }) =>
          attachClosestEdge({ id }, { element: el, input, allowedEdges: ["top", "bottom"] }),
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
  }, [element.id, isGroup, root, state]);

  const onDoubleTap = useDoubleTap(() => root.onStartEdit(element.id));

  return (
    <div>
      <div
        ref={state.ref("rowEl")}
        className={cn(
          uiClassName,
          "relative grid grid-cols-[minmax(auto,1.5rem)_auto] items-center cursor-pointer hover:brightness-125",
          "pr-3 bg-background border-b border-b-on-background/10",
          isSelected && "brightness-125 border-blue-400/25",
          state.closestEdge === "top" && "border-t-2 border-t-blue-400",
          state.closestEdge === "bottom" && "border-b-2 border-b-blue-400",
          state.dropInside && "bg-blue-400/20 ring-1 ring-inset ring-blue-400",
        )}
        style={{ paddingLeft: 8 + level * 2 }}
        onClick={(e) => {
          root.onSelect(element.id, { add: e.shiftKey });
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
            "w-full my-1 px-0.5 text-xs border-0 border-gray-500/50 text-on-background/80 bg-transparent outline-none",
            "selection:bg-blue-400/50",
            isSelected && "brightness-125 font-medium",
            isEditing ? "rounded" : "cursor-pointer",
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
            <InspectorNode key={child.id} element={child} level={level + 1} root={root} />
          ))}
        </div>
      )}
    </div>
  );
};

interface TreeItemProps {
  element: MapNode;
  level: number;
  root: MapEditState;
}
