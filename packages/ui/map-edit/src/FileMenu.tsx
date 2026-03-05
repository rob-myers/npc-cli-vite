import { Menu } from "@base-ui/react/menu";
import { uiClassName } from "@npc-cli/ui-sdk";
import { cn, type UseStateRef } from "@npc-cli/util";
import { MapTrifoldIcon, StampIcon } from "@phosphor-icons/react";
import type { State } from "./MapEdit";
import { ALLOWED_MAP_EDIT_FOLDERS, type MapEditSavableFileType } from "./map-node-api";

export function FileMenu({ state }: { state: UseStateRef<State> }) {
  return (
    <div className="flex flex-wrap items-center gap-0.5 py-1 border-b border-slate-800">
      <Menu.Root>
        <Menu.Trigger
          className={cn(
            uiClassName,
            "text-on-background px-1 py-0.5 text-xs rounded hover:bg-slate-600 cursor-pointer",
          )}
          title="Change folder"
        >
          {state.currentFile.type === "map" ? <MapTrifoldIcon className="size-4" /> : <StampIcon className="size-4" />}
        </Menu.Trigger>

        <Menu.Portal>
          <Menu.Positioner className="z-50" align="start" sideOffset={4}>
            <Menu.Popup className="bg-slate-800 border border-slate-700 rounded-md shadow-lg py-1 min-w-20">
              {ALLOWED_MAP_EDIT_FOLDERS.map((type) => (
                <Menu.Item
                  key={type}
                  className={cn(
                    "px-2 py-1 text-xs cursor-pointer",
                    type === state.currentFile.type
                      ? "text-blue-400 bg-slate-700"
                      : "text-slate-300 hover:bg-slate-700",
                  )}
                  closeOnClick
                  onClick={() => {
                    if (type !== state.currentFile.type) {
                      // 🚧 weird preservation of filename while switching folders
                      state.set({
                        currentFile: { type: type, filename: state.currentFile.filename },
                        isDirty: true,
                      });
                    }
                  }}
                >
                  {type}
                </Menu.Item>
              ))}
            </Menu.Popup>
          </Menu.Positioner>
        </Menu.Portal>
      </Menu.Root>

      <div
        className={cn(
          uiClassName,
          "flex flex-1 gap-1 text-sm text-on-background/80 truncate cursor-pointer hover:text-on-background",
          state.isDirty && "italic",
        )}
        onClick={() => {
          const { type, filename } = state.currentFile;
          const name = prompt("Save as:", filename)?.trim();
          if (name) state.save({ type, filename: name });
        }}
        title="Click to save as..."
      >
        {state.currentFile.filename}
      </div>
    </div>
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
