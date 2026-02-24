import { Menu } from "@base-ui/react/menu";
import { uiClassName } from "@npc-cli/ui-sdk";
import { cn, type UseStateRef } from "@npc-cli/util";
import { FloppyDiskIcon, FolderOpenIcon, TrashIcon } from "@phosphor-icons/react";
import type { State } from "./MapEdit";

export function FileMenu({ state }: { state: UseStateRef<State> }) {
  const { folder, filename } = parseFilePath(state.currentFilename);

  return (
    <div className="flex flex-wrap items-center gap-1 py-1.5 border-b border-slate-800">
      <Menu.Root>
        <Menu.Trigger
          className={cn(
            uiClassName,
            "px-1 py-0.5 text-xs rounded bg-slate-700 hover:bg-slate-600 text-slate-300 cursor-pointer",
          )}
          title="Change folder"
        >
          {folder.slice(0, 3)}
        </Menu.Trigger>
        <Menu.Portal>
          <Menu.Positioner className="z-50" align="start" sideOffset={4}>
            <Menu.Popup className="bg-slate-800 border border-slate-700 rounded-md shadow-lg py-1 min-w-20">
              {ALLOWED_FOLDERS.map((f) => (
                <Menu.Item
                  key={f}
                  className={cn(
                    "px-2 py-1 text-xs cursor-pointer",
                    f === folder
                      ? "text-blue-400 bg-slate-700"
                      : "text-slate-300 hover:bg-slate-700",
                  )}
                  closeOnClick
                  onClick={() => {
                    if (f !== folder) {
                      state.set({ currentFilename: `${f}/${filename}`, isDirty: true });
                    }
                  }}
                >
                  {f}
                </Menu.Item>
              ))}
            </Menu.Popup>
          </Menu.Positioner>
        </Menu.Portal>
      </Menu.Root>

      <span className="text-slate-500">/</span>

      <div
        className={cn(
          uiClassName,
          "flex flex-1 gap-1 text-sm text-on-background/80 truncate cursor-pointer hover:text-on-background",
          state.isDirty && "italic",
        )}
        onClick={() => {
          const name = prompt("Save as:", filename);
          if (name?.trim()) state.save(`${folder}/${name.trim()}`);
        }}
        title="Click to save as..."
      >
        {filename}
      </div>

      <div>
        <button
          className={cn(
            uiClassName,
            "rounded hover:bg-background/20 text-on-background/50 hover:text-on-background",
          )}
          onClick={() => state.save()}
          title="Save"
        >
          <FloppyDiskIcon className="size-4" />
        </button>

        <Menu.Root>
          <Menu.Trigger
            className={cn(
              uiClassName,
              "p-1 rounded hover:bg-background/20 text-on-background/50 hover:text-on-background",
            )}
            title="Open file..."
          >
            <FolderOpenIcon className="size-4" />
          </Menu.Trigger>

          <Menu.Portal>
            <Menu.Positioner className="z-50" sideOffset={4} align="start">
              <Menu.Popup className="bg-slate-800 border border-slate-700 rounded-md shadow-lg py-1 min-w-[140px] max-h-[300px] overflow-y-auto">
                {state.savedFiles.length === 0 ? (
                  <div className="px-3 py-2 text-xs text-slate-500 italic">No saved files</div>
                ) : (
                  state.savedFiles.map((filename) => (
                    <Menu.Item
                      key={filename}
                      className="flex items-center justify-between gap-2 px-2 py-1 text-xs text-slate-300 hover:bg-slate-700 cursor-pointer group"
                      closeOnClick
                      onClick={() => state.load(filename)}
                    >
                      <span className="truncate">{filename}</span>
                      <button
                        className="opacity-0 group-hover:opacity-100 p-0.5 hover:text-red-400"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (confirm(`Delete "${filename}"?`)) {
                            state.deleteFile(filename);
                          }
                        }}
                      >
                        <TrashIcon className="size-3" />
                      </button>
                    </Menu.Item>
                  ))
                )}
              </Menu.Popup>
            </Menu.Positioner>
          </Menu.Portal>
        </Menu.Root>
      </div>
    </div>
  );
}

const ALLOWED_FOLDERS = ["symbol", "map"] as const;

function parseFilePath(filePath: string): { folder: string; filename: string } {
  const parts = filePath.split("/");
  if (parts.length === 2) {
    return { folder: parts[0], filename: parts[1] };
  }
  return { folder: "symbol", filename: filePath };
}
