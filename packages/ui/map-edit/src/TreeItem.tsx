// import { SVGElement } from '../types';
import {
  ArrowDownIcon,
  ArrowRightIcon,
  BoundingBoxIcon,
  EyeClosedIcon,
  EyeIcon,
  FolderIcon,
} from "@phosphor-icons/react";
import type React from "react";
import { useState } from "react";

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
  selectedId: string | null;
  onSelect: (id: string) => void;
  onToggleVisibility: (id: string) => void;
}

export const TreeItem: React.FC<TreeItemProps> = ({
  element,
  level,
  selectedId,
  onSelect,
  onToggleVisibility,
}) => {
  const [isExpanded, setIsExpanded] = useState(true);
  const isSelected = selectedId === element.id;
  const isGroup = element.type === "group";

  return (
    <div>
      <div
        className={`flex items-center px-2 cursor-pointer hover:bg-slate-700/50 transition-colors group ${isSelected ? "bg-blue-600/40 border-l-2 border-blue-400" : "border-l-2 border-transparent"}`}
        onClick={() => onSelect(element.id)}
      >
        <span
          className="mr-2"
          onClick={(e) => {
            e.stopPropagation();
            setIsExpanded(!isExpanded);
          }}
        >
          {isGroup && element.children && element.children.length > 0 ? (
            isExpanded ? (
              <ArrowDownIcon className="w-3.5 h-3.5" />
            ) : (
              <ArrowRightIcon className="w-3.5 h-3.5" />
            )
          ) : (
            <div className="w-3.5 h-3.5" />
          )}
        </span>

        <span className="mr-2 text-slate-400">
          {isGroup ? <FolderIcon className="w-4 h-4" /> : <BoundingBoxIcon className="w-4 h-4" />}
        </span>

        <span
          className={`text-sm truncate flex-grow ${isSelected ? "text-blue-100 font-medium" : "text-slate-300"}`}
        >
          {element.name || element.type}
        </span>

        <button
          className={`ml-2 p-1 rounded hover:bg-slate-600/50 transition-colors ${!element.isVisible ? "text-slate-500" : "text-slate-400 opacity-0 group-hover:opacity-100"}`}
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
        </button>
      </div>

      {isGroup && isExpanded && element.children && (
        <div className="border-l border-slate-700/50 ml-2">
          {element.children.map((child) => (
            <TreeItem
              key={child.id}
              element={child}
              level={level + 1}
              selectedId={selectedId}
              onSelect={onSelect}
              onToggleVisibility={onToggleVisibility}
            />
          ))}
        </div>
      )}
    </div>
  );
};
