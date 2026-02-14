import { uiClassName } from "@npc-cli/ui-sdk";
import { cn, useStateRef } from "@npc-cli/util";
import { BoundingBoxIcon, FolderIcon } from "@phosphor-icons/react";
import type React from "react";
import { useEffect } from "react";
import type { State as MapEditState } from "./MapEdit";

export type ShapeType = "rect" | "circle" | "path" | "group" | "ellipse" | "polygon";

export interface SVGElementWrapper {
  id: string;
  name: string;
  type: ShapeType;
  props: Record<string, any>;
  children?: SVGElementWrapper[];
  isVisible: boolean;
  isLocked: boolean;
}

interface TreeItemProps {
  element: SVGElementWrapper;
  level: number;
  root: MapEditState;
}

export const TreeItem: React.FC<TreeItemProps> = ({ element, level, root }) => {
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
    <div>
      <div
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
            "text-xs pl-1 py-2 text-on-background/80 bg-transparent outline-none w-full",
            isSelected && "brightness-125 font-medium",
            isEditing && "bg-slate-700 rounded",
          )}
          style={{ paddingLeft: (1 + level) * 4 }}
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

        {/* <button
          className={cn(
            "cursor-pointer rounded hover:bg-slate-600/50 transition-colors",
            !element.isVisible
              ? "text-slate-500"
              : "text-slate-400 opacity-0 group-hover:opacity-100",
          )}
          onClick={(e) => {
            e.stopPropagation();
            onToggleVisibility(element.id);
          }}
        >
          {element.isVisible ? (
            <EyeIcon className="w-4 h-4" />
          ) : (
            <EyeClosedIcon className="w-4 h-4" />
          )}
        </button> */}
      </div>

      {isGroup && state.isExpanded && element.children && (
        // ml-2
        <div className="border-l border-slate-700/50">
          {element.children.map((child) => (
            <TreeItem key={child.id} element={child} level={level + 1} root={root} />
          ))}
        </div>
      )}
    </div>
  );
};

export function mapElements(
  list: SVGElementWrapper[],
  id: string,
  fn: (el: SVGElementWrapper) => SVGElementWrapper,
): SVGElementWrapper[] {
  return list.map((item) => {
    if (item.id === id) return fn(item);
    if (item.children) return { ...item, children: mapElements(item.children, id, fn) };
    return item;
  });
}
