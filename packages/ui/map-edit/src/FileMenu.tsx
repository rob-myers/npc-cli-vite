import { Menu } from "@base-ui/react/menu";
import { Select } from "@base-ui/react/select";
import { symbolByGroup } from "@npc-cli/media/starship-symbol";
import { defaultMapKey } from "@npc-cli/ui__world/const";
import { cn, type UseStateRef } from "@npc-cli/util";
import { keys } from "@npc-cli/util/legacy/generic";
import { FloppyDiskIcon, MapTrifoldIcon, PlusIcon, StampIcon } from "@phosphor-icons/react";
import { useMemo } from "react";
import { SymbolKeySchema } from "./editor.schema";
import type { State } from "./MapEdit";
import { ALLOWED_MAP_EDIT_FOLDERS, defaultSymbolKey } from "./map-node-api";

const allSymbolKeys = Object.values(symbolByGroup).flatMap((group) => keys(group));

const newMapKey = "__new_map__";

export function FileMenu({ state }: { state: UseStateRef<State> }) {
  const { type } = state.currentFile;

  return (
    <div className="flex items-center gap-0.5 min-w-0">
      <Menu.Root>
        <Menu.Trigger
          className="text-on-background px-1 py-0.5 text-xs rounded hover:bg-slate-600 cursor-pointer"
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
                    if (folderType === type) return;

                    const existing = state.savedFileSpecifiers.find((f) => f.type === folderType);

                    if (existing) {
                      state.load(existing);
                    } else {
                      state.openFresh(
                        folderType === "map"
                          ? { type: "map", filename: `${defaultMapKey}.json`, key: defaultMapKey }
                          : { type: "symbol", filename: `${defaultSymbolKey}.json`, key: defaultSymbolKey },
                      );
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
  const savedKeys = useMemo(
    () => new Set(state.savedFileSpecifiers.flatMap((f) => (f.type === "symbol" ? f.key : []))),
    [state.savedFileSpecifiers],
  );

  return (
    <Select.Root
      value={state.currentFile.key}
      onValueChange={(key) => {
        if (!key || key === state.currentFile.key) return;
        const parsedKey = SymbolKeySchema.parse(key);
        const fileSpecifier = {
          type: "symbol",
          filename: `${parsedKey}.json`,
          key: parsedKey,
        } as const;

        if (savedKeys.has(parsedKey)) {
          state.load(fileSpecifier);
        } else {
          state.openFresh(fileSpecifier);
        }
      }}
    >
      <Select.Trigger
        className={cn(
          "flex flex-1 gap-1 items-center text-sm truncate cursor-pointer hover:text-on-background min-w-0",
          "text-on-background/80 rounded-xs",
          state.isDirty && "italic",
        )}
      >
        <Select.Value className="truncate" placeholder="Select symbol..." />
      </Select.Trigger>

      <Select.Portal>
        <Select.Positioner className="z-50" sideOffset={4} alignItemWithTrigger={false}>
          <Select.Popup className="bg-slate-800 border border-slate-700 rounded-md shadow-lg py-1 max-h-60 overflow-auto">
            <Select.List>
              {allSymbolKeys.map((key) => {
                return (
                  <Select.Item
                    key={key}
                    value={key}
                    className={cn(
                      "flex items-center gap-1.5 px-2 py-1 text-xs cursor-pointer text-slate-300",
                      "data-highlighted:bg-slate-700 data-selected:text-blue-400",
                    )}
                  >
                    <Select.ItemText>{key}</Select.ItemText>
                    {savedKeys.has(key) && <FloppyDiskIcon className="size-3 text-green-400 shrink-0" />}
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
      value={state.currentFile.key}
      onValueChange={(mapKey) => {
        if (!mapKey || mapKey === state.currentFile.key) return;

        if (mapKey !== newMapKey) {
          state.load({ type: "map", filename: `${mapKey}.json`, key: mapKey });
        } else {
          const name = prompt("New map name:")?.trim();
          if (name) {
            const mapKey = name.endsWith(".json") ? name.slice(0, -".json".length) : name;
            state.save({ type: "map", filename: `${mapKey}.json`, key: mapKey });
          }
        }
      }}
    >
      <Select.Trigger
        className={cn(
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
                  key={file.key}
                  value={file.key}
                  className={cn(
                    "flex items-center gap-1.5 px-2 py-1 text-xs cursor-pointer text-slate-300",
                    "data-highlighted:bg-slate-700 data-selected:text-blue-400",
                  )}
                >
                  <Select.ItemText>{file.key}</Select.ItemText>
                </Select.Item>
              ))}
              {!state.isReadOnly() && (
                <Select.Item
                  value={newMapKey}
                  className="flex items-center gap-1.5 px-2 py-1 text-xs cursor-pointer text-slate-400 border-t border-slate-700 data-highlighted:bg-slate-700"
                >
                  <PlusIcon className="size-3" />
                  <Select.ItemText>New map...</Select.ItemText>
                </Select.Item>
              )}
            </Select.List>
          </Select.Popup>
        </Select.Positioner>
      </Select.Portal>
    </Select.Root>
  );
}
