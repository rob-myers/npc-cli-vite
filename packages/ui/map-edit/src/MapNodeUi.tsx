import { ContextMenu } from "@base-ui/react/context-menu";
import { uiClassName } from "@npc-cli/ui-sdk";
import { cn, useStateRef } from "@npc-cli/util";
import { BoundingBoxIcon, FolderIcon } from "@phosphor-icons/react";
import type React from "react";
import { useEffect } from "react";
import type { State as MapEditState } from "./MapEdit";

export const MapNodeUi: React.FC<TreeItemProps> = ({ element, level, root }) => {
  const state = useStateRef(() => ({
    isExpanded: true,
    editValue: element.name,
    inputEl: null as HTMLInputElement | null,
    longPressTimeout: null as ReturnType<typeof setTimeout> | null,
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

  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger
        className={cn(
          uiClassName,
          "grid grid-cols-[minmax(auto,1.5rem)_auto] items-center px-2 cursor-pointer hover:brightness-125 group",
          "bg-background border-b border-b-on-background/10",
          isSelected && "brightness-125 border-blue-400/25",
        )}
        onClick={() => root.onSelect(element.id)}
        onDoubleClick={() => root.onStartEdit(element.id)}
        onPointerDown={() => {
          state.longPressTimeout = setTimeout(() => root.onStartEdit(element.id), 500);
        }}
        onPointerUp={() => {
          if (state.longPressTimeout) clearTimeout(state.longPressTimeout);
        }}
        onPointerLeave={() => {
          if (state.longPressTimeout) clearTimeout(state.longPressTimeout);
        }}
      >
        {/* <span
          className="mr-2"
          onClick={(e) => {
            e.stopPropagation();
            setIsExpanded(!isExpanded);
          }}
        >
          {isGroup && element.children && element.children.length > 0 ? (
            isExpanded ? (
              <ArrowDownIcon className="size-3.5" />
            ) : (
              <ArrowRightIcon className="w-3.5 h-3.5" />
            )
          ) : (
            <div className="w-2" />
          )}
        </span> */}

        <div className="text-on-background pl-0.5">
          {isGroup ? <FolderIcon /> : <BoundingBoxIcon />}
        </div>

        <input
          ref={state.ref("inputEl")}
          type="text"
          className={cn(
            "text-xs px-0.5 border-0 border-gray-500/50 my-1 text-on-background/80 bg-transparent outline-none w-full",
            isSelected && "brightness-125 font-medium",
            isEditing && "bg-slate-700 rounded",
          )}
          style={{ borderLeftWidth: level * 2 }}
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

      {isGroup && state.isExpanded && element.children && (
        <div className="border-l border-slate-700/50">
          {element.children.map((child) => (
            <MapNodeUi key={child.id} element={child} level={level + 1} root={root} />
          ))}
        </div>
      )}
    </ContextMenu.Root>
  );
};

export function mapElements(list: MapNode[], id: string, fn: (el: MapNode) => MapNode): MapNode[] {
  return list.map((item) => {
    if (item.id === id) return fn(item);
    if (item.children) return { ...item, children: mapElements(item.children, id, fn) };
    return item;
  });
}

export function traverseElements(list: MapNode[], act: (el: MapNode) => void): void {
  list.forEach((item) => {
    act(item);
    if (item.children) traverseElements(item.children, act);
  });
}

export function extractNode(
  nodes: MapNode[],
  id: string,
): { elements: MapNode[]; node: MapNode | null } {
  for (let i = 0; i < nodes.length; i++) {
    if (nodes[i].id === id) {
      return { elements: [...nodes.slice(0, i), ...nodes.slice(i + 1)], node: nodes[i] };
    }
    const children = nodes[i].children;
    if (children) {
      const r = extractNode(children, id);
      if (r.node) {
        const updated = [
          ...nodes.slice(0, i),
          { ...nodes[i], children: r.elements },
          ...nodes.slice(i + 1),
        ];
        return { elements: updated, node: r.node };
      }
    }
  }
  return { elements: nodes, node: null };
}

export type ShapeType = "rect" | "circle" | "path" | "group" | "ellipse" | "polygon";

export interface MapNode {
  id: string;
  name: string;
  type: ShapeType;
  children?: MapNode[];
  isVisible: boolean;
  isLocked: boolean;
}

interface TreeItemProps {
  element: MapNode;
  level: number;
  root: MapEditState;
}
