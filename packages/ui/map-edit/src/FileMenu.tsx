import { Select } from "@base-ui/react/select";
import { symbolByGroup } from "@npc-cli/media/starship-symbol";
import { defaultMapKey } from "@npc-cli/ui__world/const";
import { cn, type UseStateRef } from "@npc-cli/util";
import { keys } from "@npc-cli/util/legacy/generic";
import { FloppyDiskIcon, LockKeyIcon, PlusIcon, TrashIcon } from "@phosphor-icons/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { SymbolKeySchema } from "./editor.schema";
import type { State } from "./MapEdit";
import { ALLOWED_MAP_EDIT_FOLDERS, defaultSymbolKey } from "./map-node-api";

const allSymbolKeys = Object.values(symbolByGroup).flatMap((group) => keys(group));

const newMapKey = "__new_map__";

export function FileMenu({ state }: { state: UseStateRef<State> }) {
  return (
    <div className="flex items-center gap-1 min-w-0">
      {state.isReadOnly() && (
        <LockKeyIcon className="size-3.5 text-red-500 shrink-0 bg-red-500/20 rounded p-1.5 box-content" />
      )}
      <FileSelect state={state} />
    </div>
  );
}

function FolderSwitcher({
  type,
  onChange,
}: {
  type: "symbol" | "map";
  onChange: (type: "symbol" | "map") => void;
}) {
  return (
    <div className="flex gap-1 px-2 py-1 border-b border-slate-700">
      {ALLOWED_MAP_EDIT_FOLDERS.map((folderType) => (
        <button
          key={folderType}
          type="button"
          className={cn(
            "px-2 py-0.5 text-xs rounded cursor-pointer",
            folderType === type ? "bg-slate-600 text-blue-400" : "text-slate-400 hover:bg-slate-700",
          )}
          onPointerDown={(e) => {
            if (folderType === type) return;
            e.preventDefault();
            onChange(folderType);
          }}
        >
          {folderType}
        </button>
      ))}
    </div>
  );
}

function FileSelect({ state }: { state: UseStateRef<State> }) {
  const [folderType, setFolderType] = useState<"symbol" | "map">(state.currentFile.type);
  const popupRef = useRef<HTMLDivElement>(null);

  // Sync when current file type changes externally (e.g. Reset loading a different type)
  useEffect(() => {
    setFolderType(state.currentFile.type);
  }, [state.currentFile.type]);

  const savedSymbolKeys = useMemo(
    () => new Set(state.savedFileSpecifiers.flatMap((f) => (f.type === "symbol" ? f.key : []))),
    [state.savedFileSpecifiers],
  );
  const mapFiles = useMemo(
    () => state.savedFileSpecifiers.filter((f) => f.type === "map"),
    [state.savedFileSpecifiers],
  );

  const onOpenChangeComplete = useCallback((open: boolean) => {
    if (open) popupRef.current?.querySelector<HTMLElement>("[data-selected]")?.scrollIntoView({ block: "nearest" });
  }, []);

  return (
    <Select.Root
      value={state.currentFile.key}
      onOpenChangeComplete={onOpenChangeComplete}
      onValueChange={(key) => {
        if (!key || key === state.currentFile.key) return;
        if (folderType === "symbol") {
          const parsedKey = SymbolKeySchema.parse(key);
          const fileSpecifier = { type: "symbol", filename: `${parsedKey}.json`, key: parsedKey } as const;
          const existsOnDisk = savedSymbolKeys.has(parsedKey) || !!state.symbolsManifest?.byKey[parsedKey];
          if (existsOnDisk) state.load(fileSpecifier);
          else state.openFresh(fileSpecifier);
        } else {
          if (key !== newMapKey) {
            state.load({ type: "map", filename: `${key}.json`, key });
          } else {
            const name = prompt("New map name:")?.trim();
            if (name) {
              const mapKey = name.endsWith(".json") ? name.slice(0, -".json".length) : name;
              if (state.isDirty && !confirm("Discard unsaved changes?")) return;
              state.set({ nodes: [] });
              state.save({ type: "map", filename: `${mapKey}.json`, key: mapKey });
            }
          }
        }
      }}
    >
      <Select.Trigger
        className={cn(
          "flex flex-1 gap-1 items-center text-sm cursor-pointer hover:text-on-background min-w-0",
          "text-on-background/80 rounded-xs px-2 py-0.5 bg-on-background/10",
          state.isDirty && "italic",
        )}
      >
        <Select.Value className="truncate" title={state.currentFile.key} placeholder="Select file..." />
      </Select.Trigger>

      <Select.Portal>
        <Select.Positioner className="z-50" sideOffset={4} alignItemWithTrigger={false}>
          <Select.Popup
            ref={popupRef}
            className="bg-slate-800 border border-slate-700 rounded-md shadow-lg py-1 max-h-60 overflow-auto"
          >
            <FolderSwitcher
              type={folderType}
              onChange={(newType) => {
                setFolderType(newType);
                const existing = state.savedFileSpecifiers.find((f) => f.type === newType);
                if (existing) void state.load(existing);
                else
                  state.openFresh(
                    newType === "map"
                      ? { type: "map", filename: `${defaultMapKey}.json`, key: defaultMapKey }
                      : { type: "symbol", filename: `${defaultSymbolKey}.json`, key: defaultSymbolKey },
                  );
              }}
            />
            <Select.List>
              {folderType === "symbol"
                ? allSymbolKeys.map((key) => (
                    <Select.Item
                      key={key}
                      value={key}
                      className={cn(
                        "flex items-center gap-1.5 px-2 py-1 text-xs cursor-pointer text-slate-300",
                        "data-highlighted:bg-slate-700 data-selected:text-blue-400",
                      )}
                    >
                      <Select.ItemText>{key}</Select.ItemText>
                      {savedSymbolKeys.has(key) && <FloppyDiskIcon className="size-3 text-green-400 shrink-0" />}
                    </Select.Item>
                  ))
                : mapFiles.map((file) => (
                    <Select.Item
                      key={file.key}
                      value={file.key}
                      className={cn(
                        "flex items-center gap-1.5 px-2 py-1 text-xs cursor-pointer text-slate-300",
                        "data-highlighted:bg-slate-700 data-selected:text-blue-400",
                      )}
                    >
                      <Select.ItemText className="flex-1">{file.key}</Select.ItemText>
                      {!state.isReadOnly() && (
                        <button
                          className="ml-auto opacity-40 hover:opacity-100 hover:text-red-400 p-0.5 rounded"
                          onPointerDown={(e) => e.stopPropagation()}
                          onClick={(e) => {
                            e.stopPropagation();
                            if (confirm(`Delete map "${file.key}"?`)) state.deleteFile(file);
                          }}
                        >
                          <TrashIcon className="size-3" />
                        </button>
                      )}
                    </Select.Item>
                  ))}
              {folderType === "map" && !state.isReadOnly() && (
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
