import { Menu } from "@base-ui/react/menu";
import { uiClassName } from "@npc-cli/ui-sdk";
import { cn, type UseStateRef } from "@npc-cli/util";
import { FloppyDiskIcon, FolderOpenIcon, TrashIcon } from "@phosphor-icons/react";
import type { State } from "./MapEdit";

export function FileMenu({ state }: { state: UseStateRef<State> }) {
  return (
    <div className="flex items-center gap-1 px-2 py-1.5 border-b border-slate-800">
      <div
        className={cn(
          uiClassName,
          "flex flex-1 gap-1 text-xs text-slate-300 truncate cursor-pointer hover:text-slate-100",
          state.isDirty && "italic text-amber-300 hover:text-amber-200",
        )}
        onClick={() => {
          const name = prompt("Save as:", state.currentFilename);
          if (name?.trim()) state.save(name.trim());
        }}
        title="Click to save as..."
      >
        {state.currentFilename}
      </div>
      <button
        className={cn(
          uiClassName,
          "p-1 rounded hover:bg-slate-700 text-slate-400 hover:text-slate-200",
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
            "p-1 rounded hover:bg-slate-700 text-slate-400 hover:text-slate-200",
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
  );
}
