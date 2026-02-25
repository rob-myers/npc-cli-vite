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
import { uiClassName } from "@npc-cli/ui-sdk";
import { cn, type UseStateRef, useDoubleTap, useStateRef } from "@npc-cli/util";
import { FolderIcon, type Icon, ImageIcon, PathIcon, RectangleIcon } from "@phosphor-icons/react";
import { AnimatePresence, motion } from "motion/react";
import React, { useEffect } from "react";
import type { State as MapEditState } from "./MapEdit";
import { type MapNode, type MapNodeType, toImageOffsetValue } from "./map-node-api";

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
  }, []);

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
          root.onSelect(element.id, { shiftKey: e.shiftKey, metaKey: e.metaKey });
          onDoubleTap.onClick(e.nativeEvent);
        }}
      >
        <div className="text-on-background pl-0.5">{React.createElement(toIcon[element.type])}</div>

        <input
          ref={state.ref("inputEl")}
          type="text"
          className={cn(
            "w-full my-1 px-0.5 text-xs border-0 border-gray-500/50 text-on-background/80 bg-transparent outline-none",
            isSelected && "brightness-125 font-medium text-blue-500/80",
            isEditing ? "italic" : "cursor-pointer",
          )}
          value={element.name}
          readOnly={!isEditing}
          onBlur={() => isEditing && root.set({ editingId: null })}
          onChange={(e) => {
            element.name = e.currentTarget.value;
            state.update();
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") root.onStartEdit(element.id);
            if (e.key === "Escape") root.set({ editingId: null });
          }}
        />
      </div>

      <AnimatePresence>
        {isSelected && root.selectedIds.size === 1 && element.type === "image" && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="overflow-hidden"
          >
            <div
              className={cn(
                uiClassName,
                "flex items-center justify-between gap-2 px-2 py-1 bg-background/50 border-b border-slate-700/50 text-xs",
              )}
            >
              <div className="flex-1 flex flex-wrap gap-2">
                <select
                  className="px-1 py-0.5 bg-slate-700 border border-slate-600 rounded text-slate-200 text-xs"
                  title="dx"
                  value={element.offset.x}
                  onChange={(e) => {
                    element.offset.x = Number(e.target.value) || 0;
                    root.update();
                  }}
                  onClick={(e) => e.stopPropagation()}
                >
                  {Object.values(toImageOffsetValue).map((value) => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ))}
                </select>
                <select
                  className="px-1 py-0.5 bg-slate-700 border border-slate-600 rounded text-slate-200 text-xs"
                  title="dy"
                  value={element.offset.y}
                  onChange={(e) => {
                    element.offset.y = Number(e.target.value) || 0;
                    root.update();
                  }}
                  onClick={(e) => e.stopPropagation()}
                >
                  {Object.values(toImageOffsetValue).map((value) => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {isGroup === true && state.isExpanded === true && (
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
  root: UseStateRef<MapEditState>;
}

const toIcon = {
  group: FolderIcon,
  rect: RectangleIcon,
  image: ImageIcon,
  path: PathIcon,
} as const satisfies Record<MapNodeType, Icon>;
