import { Menu } from "@base-ui/react/menu";
import { Select } from "@base-ui/react/select";
import { symbolByGroup } from "@npc-cli/media/starship-symbol";
import { uiClassName } from "@npc-cli/ui-sdk";
import { cn, type UseStateRef } from "@npc-cli/util";
import { keys } from "@npc-cli/util/legacy/generic";
import { CheckIcon, MapTrifoldIcon, PlusIcon, StampIcon } from "@phosphor-icons/react";
import { useMemo } from "react";
import type { State } from "./MapEdit";
import { ALLOWED_MAP_EDIT_FOLDERS, type MapEditSavableFileType } from "./map-node-api";

const allSymbolKeys = Object.values(symbolByGroup).flatMap((group) => keys(group));

const newMapValue = "__new_map__";

export function FileMenu({ state }: { state: UseStateRef<State> }) {
  const { type } = state.currentFile;

  return (
    <div className="flex items-center gap-0.5 py-1 border-b border-slate-800">
      <Menu.Root>
        <Menu.Trigger
          className={cn(
            uiClassName,
            "text-on-background px-1 py-0.5 text-xs rounded hover:bg-slate-600 cursor-pointer",
          )}
          title="Change folder"
        >
          {type === "map" ? <MapTrifoldIcon className="size-4" /> : <StampIcon className="size-4" />}
        </Menu.Trigger>

        <Menu.Portal>
          <Menu.Positioner className="z-50" align="start" sideOffset={4}>
            <Menu.Popup className="bg-slate-800 border border-slate-700 rounded-md shadow-lg py-1 min-w-20">
              {ALLOWED_MAP_EDIT_FOLDERS.map((folderType) => (
                <Menu.Item
                  key={folderType}
                  className={cn(
                    "px-2 py-1 text-xs cursor-pointer",
                    folderType === type ? "text-blue-400 bg-slate-700" : "text-slate-300 hover:bg-slate-700",
                  )}
                  closeOnClick
                  onClick={() => {
                    if (folderType !== type) {
                      const existing = state.savedFileSpecifiers.find((f) => f.type === folderType);
                      const file = existing ?? {
                        type: folderType,
                        filename: folderType === "map" ? "empty-map.json" : `${allSymbolKeys[0]}.json`,
                      };
                      state.load(file);
                    }
                  }}
                >
                  {folderType}
                </Menu.Item>
              ))}
            </Menu.Popup>
          </Menu.Positioner>
        </Menu.Portal>
      </Menu.Root>

      {type === "symbol" ? <SymbolFileSelect state={state} /> : <MapFileSelect state={state} />}
    </div>
  );
}

function SymbolFileSelect({ state }: { state: UseStateRef<State> }) {
  const savedFilenames = useMemo(
    () => new Set(state.savedFileSpecifiers.filter((f) => f.type === "symbol").map((f) => f.filename)),
    [state.savedFileSpecifiers],
  );

  return (
    <Select.Root
      value={state.currentFile.filename}
      onValueChange={(filename) => {
        if (filename && filename !== state.currentFile.filename) {
          const file = { type: "symbol" as const, filename };
          if (savedFilenames.has(filename)) {
            state.load(file);
          } else {
            state.set({
              nodes: [],
              selectedIds: new Set(),
              selectionBox: null,
              currentFile: file,
              undoStack: [],
              redoStack: [],
              isDirty: true,
            });
          }
        }
      }}
    >
      <Select.Trigger
        className={cn(
          uiClassName,
          "flex w-30 line-clamp-1 gap-1 items-center text-sm text-on-background/80 truncate cursor-pointer hover:text-on-background min-w-0",
          state.isDirty && "italic",
        )}
      >
        <Select.Value placeholder="Select symbol..." />
      </Select.Trigger>

      <Select.Portal>
        <Select.Positioner className="z-50" sideOffset={4}>
          <Select.Popup className="bg-slate-800 border border-slate-700 rounded-md shadow-lg py-1 max-h-60 overflow-auto">
            <Select.List>
              {allSymbolKeys.map((key) => {
                const filename = `${key}.json`;
                const isSaved = savedFilenames.has(filename);
                return (
                  <Select.Item
                    key={key}
                    value={filename}
                    className={cn(
                      "flex items-center gap-1.5 px-2 py-1 text-xs cursor-pointer text-slate-300",
                      "data-highlighted:bg-slate-700 data-selected:text-blue-400",
                    )}
                  >
                    <Select.ItemText>{key}</Select.ItemText>
                    {isSaved && <CheckIcon className="size-3 text-green-400 shrink-0" />}
                  </Select.Item>
                );
              })}
            </Select.List>
          </Select.Popup>
        </Select.Positioner>
      </Select.Portal>
    </Select.Root>
  );
}

function MapFileSelect({ state }: { state: UseStateRef<State> }) {
  const mapFiles = useMemo(
    () => state.savedFileSpecifiers.filter((f) => f.type === "map"),
    [state.savedFileSpecifiers],
  );

  return (
    <Select.Root
      value={state.currentFile.filename}
      onValueChange={(value) => {
        if (!value) return;
        if (value === newMapValue) {
          const name = prompt("New map name:")?.trim();
          if (name) {
            const filename = name.endsWith(".json") ? name : `${name}.json`;
            state.save({ type: "map", filename });
          }
        } else if (value !== state.currentFile.filename) {
          state.load({ type: "map", filename: value });
        }
      }}
    >
      <Select.Trigger
        className={cn(
          uiClassName,
          "flex flex-1 gap-1 items-center text-sm text-on-background/80 truncate cursor-pointer hover:text-on-background min-w-0",
          state.isDirty && "italic",
        )}
      >
        <Select.Value placeholder="Select map..." />
      </Select.Trigger>

      <Select.Portal>
        <Select.Positioner className="z-50" sideOffset={4}>
          <Select.Popup className="bg-slate-800 border border-slate-700 rounded-md shadow-lg py-1 max-h-60 overflow-auto">
            <Select.List>
              {mapFiles.map((file) => (
                <Select.Item
                  key={file.filename}
                  value={file.filename}
                  className={cn(
                    "flex items-center gap-1.5 px-2 py-1 text-xs cursor-pointer text-slate-300",
                    "data-highlighted:bg-slate-700 data-selected:text-blue-400",
                  )}
                >
                  <Select.ItemText>{file.filename}</Select.ItemText>
                </Select.Item>
              ))}
              <Select.Item
                value={newMapValue}
                className="flex items-center gap-1.5 px-2 py-1 text-xs cursor-pointer text-slate-400 border-t border-slate-700 data-highlighted:bg-slate-700"
              >
                <PlusIcon className="size-3" />
                <Select.ItemText>New map...</Select.ItemText>
              </Select.Item>
            </Select.List>
          </Select.Popup>
        </Select.Positioner>
      </Select.Portal>
    </Select.Root>
  );
}

export function parseFilePath(filePath: string): {
  folder: MapEditSavableFileType;
  filename: string;
} {
  const parts = filePath.split("/");
  if (parts.length !== 2 || !ALLOWED_MAP_EDIT_FOLDERS.find((f) => f === parts[0]) || !parts[1]) {
    throw new Error(`Invalid file path: ${filePath}`);
  }
  return { folder: parts[0] as MapEditSavableFileType, filename: parts[1] };
}
