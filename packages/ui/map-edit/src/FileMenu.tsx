import { Menu } from "@base-ui/react/menu";
import { uiClassName } from "@npc-cli/ui-sdk";
import { cn, type UseStateRef } from "@npc-cli/util";
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
