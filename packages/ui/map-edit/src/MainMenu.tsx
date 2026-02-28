import { Menu } from "@base-ui/react/menu";
import { uiClassName } from "@npc-cli/ui-sdk";
import { cn, type UseStateRef } from "@npc-cli/util";
import {
  CaretRightIcon,
  CopyIcon,
  FloppyDiskIcon,
  FolderIcon,
  FolderOpenIcon,
  ImageIcon,
  ListIcon,
  SelectionAllIcon,
  SquareIcon,
  TrashIcon,
} from "@phosphor-icons/react";
import type { State } from "./MapEdit";
import { getAllNodeIds } from "./map-node-api";

export function MainMenu({ state }: { state: UseStateRef<State> }) {
  return (
    <Menu.Root>
      <Menu.Trigger
        className={cn(
          uiClassName,
          "cursor-pointer text-slate-300",
          "hover:text-slate-300 transition-colors",
        )}
      >
        <ListIcon className="size-5.5 p-0.5 bg-slate-700 border border-white/10" />
      </Menu.Trigger>

      <Menu.Portal>
        <Menu.Positioner className="z-50" sideOffset={4} align="start">
          <Menu.Popup className="bg-slate-800 border border-slate-700 rounded-md shadow-lg py-1 min-w-[120px]">
            <Menu.Item
              className="flex items-center gap-2 px-2 py-1 text-xs text-slate-300 hover:bg-slate-700 cursor-pointer"
              closeOnClick
              onClick={() => state.save()}
            >
              <FloppyDiskIcon className="size-4" />
              Save
            </Menu.Item>

            <Menu.SubmenuRoot>
              <Menu.SubmenuTrigger className="flex items-center justify-between gap-2 px-2 py-1 text-xs text-slate-300 hover:bg-slate-700 cursor-pointer w-full">
                <div className="flex items-center gap-2">
                  <FolderOpenIcon className="size-4" />
                  Open
                </div>
                <CaretRightIcon className="size-4" />
              </Menu.SubmenuTrigger>
              <Menu.Portal>
                <Menu.Positioner className="z-50" sideOffset={4}>
                  <Menu.Popup className="bg-slate-800 border border-slate-700 rounded-md shadow-lg py-1 min-w-40 max-h-[300px] overflow-y-auto">
                    {state.savedFiles.length === 0 ? (
                      <div className="px-3 py-2 text-xs text-slate-500 italic">No saved files</div>
                    ) : (
                      state.savedFiles.map((file) => (
                        <Menu.Item
                          key={file}
                          className="flex items-center justify-between gap-2 px-2 py-1 text-xs text-slate-300 hover:bg-slate-700 cursor-pointer group"
                          closeOnClick
                          onClick={() => state.load(file)}
                        >
                          <span className="truncate">{file}</span>
                          <button
                            className="group-hover:opacity-100 p-0.5 hover:text-red-400"
                            onClick={(e) => {
                              e.stopPropagation();
                              if (confirm(`Delete "${file}"?`)) {
                                state.deleteFile(file);
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
            </Menu.SubmenuRoot>

            <Menu.Item
              className="flex items-center gap-2 px-2 py-1 text-xs text-slate-300 hover:bg-slate-700 cursor-pointer"
              closeOnClick={false}
            >
              <div className="flex flex-col gap-2 py-1">
                <label className="flex items-center gap-2 text-xs text-slate-300">
                  w
                  <input
                    type="text"
                    value={state.svgWidth}
                    onChange={(e) => {
                      state.set({ svgWidth: Number(e.currentTarget.value) || 0 });
                    }}
                    onClick={(e) => e.stopPropagation()}
                    onKeyDown={(e) => e.stopPropagation()}
                    className="px-1 py-0.5 bg-slate-700 border border-slate-600 text-slate-200 text-xs rounded w-20"
                  />
                </label>
                <label className="flex items-center gap-2 text-xs text-slate-300">
                  h
                  <input
                    type="text"
                    value={state.svgHeight}
                    onChange={(e) => {
                      state.set({ svgHeight: Number(e.currentTarget.value) || 0 });
                    }}
                    onClick={(e) => e.stopPropagation()}
                    onKeyDown={(e) => e.stopPropagation()}
                    className="px-1 py-0.5 bg-slate-700 border border-slate-600 text-slate-200 text-xs rounded w-20"
                  />
                </label>
              </div>
            </Menu.Item>

            <div className="my-1 border-t border-slate-700" />

            {state.selectedIds.size > 0 && (
              <>
                <Menu.Item
                  className="flex items-center gap-2 px-2 py-1 text-xs text-slate-300 hover:bg-slate-700 cursor-pointer"
                  closeOnClick
                  onClick={() => state.duplicateSelected()}
                >
                  <CopyIcon className="size-4" />
                  Duplicate
                </Menu.Item>
                <Menu.Item
                  className="flex items-center gap-2 px-2 py-1 text-xs text-red-400 hover:bg-slate-700 cursor-pointer"
                  closeOnClick
                  onClick={() => state.deleteSelected()}
                >
                  <TrashIcon className="size-4" />
                  Delete
                </Menu.Item>
                <div className="my-1 border-t border-slate-700" />
              </>
            )}

            <Menu.Item
              className="flex items-center gap-2 px-2 py-1 text-xs text-slate-300 hover:bg-slate-700 cursor-pointer"
              closeOnClick
              onClick={() => {
                state.add("group", { selectionAsParent: true });
              }}
            >
              <FolderIcon className="size-4" />
              Group
            </Menu.Item>
            <Menu.Item
              className="flex items-center gap-2 px-2 py-1 text-xs text-slate-300 hover:bg-slate-700 cursor-pointer"
              closeOnClick
              onClick={() => {
                state.add("rect", { selectionAsParent: true });
              }}
            >
              <SquareIcon className="size-4" />
              Rect
            </Menu.Item>

            <Menu.Item
              className="flex items-center gap-2 px-2 py-1 text-xs text-slate-300 hover:bg-slate-700 cursor-pointer"
              closeOnClick
              onClick={() => {
                state.add("image", { selectionAsParent: true });
              }}
            >
              <ImageIcon className="size-4" />
              Image
            </Menu.Item>
            <div className="my-1 border-t border-slate-700" />

            <Menu.Item
              className="flex items-center gap-2 px-2 py-1 text-xs text-slate-300 hover:bg-slate-700 cursor-pointer"
              closeOnClick
              onClick={() => {
                state.set({ selectedIds: getAllNodeIds(state.elements) });
              }}
            >
              <SelectionAllIcon className="size-4" />
              Select All
            </Menu.Item>
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}
