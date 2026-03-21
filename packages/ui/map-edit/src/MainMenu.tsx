import { Menu } from "@base-ui/react/menu";
import { uiClassName } from "@npc-cli/ui-sdk";
import { cn, type UseStateRef } from "@npc-cli/util";
import {
  ArrowCounterClockwiseIcon,
  CaretRightIcon,
  CopyIcon,
  FloppyDiskIcon,
  ListIcon,
  RulerIcon,
  SelectionAllIcon,
  TrashIcon,
  WarningIcon,
} from "@phosphor-icons/react";
import { NodeIcon } from "./InspectorNode";
import type { State } from "./MapEdit";
import { clearLocalStorage, getRecursiveNodes, mapNodeTypes } from "./map-node-api";

export function MainMenu({ state }: { state: UseStateRef<State> }) {
  return (
    <Menu.Root>
      <Menu.Trigger className={cn(uiClassName, "cursor-pointer")}>
        <ListIcon className="size-5.5 bg-background text-on-background border border-on-background/50 p-0.5" />
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

            {state.isDirty && (
              <Menu.Item
                className="flex items-center gap-2 px-2 py-1 text-xs text-slate-300 hover:bg-slate-700 cursor-pointer"
                closeOnClick
                onClick={() => state.load()}
              >
                <ArrowCounterClockwiseIcon className="size-4" />
                Reset
              </Menu.Item>
            )}

            <Menu.SubmenuRoot>
              <Menu.SubmenuTrigger className="flex items-center justify-between gap-2 px-2 py-1 text-xs text-slate-300 hover:bg-slate-700 cursor-pointer w-full">
                <div className="flex items-center gap-2">
                  <RulerIcon className="size-4" />
                  Size
                </div>
                <CaretRightIcon className="size-4" />
              </Menu.SubmenuTrigger>
              <Menu.Portal>
                <Menu.Positioner className="z-50" sideOffset={4}>
                  <Menu.Popup className="bg-gray-900 border border-slate-700 rounded-md shadow-lg py-2 px-3 min-w-30">
                    <div className="flex flex-col gap-2">
                      <label className="flex items-center gap-2 text-xs text-slate-300">
                        <span className="w-12">Width:</span>
                        <input
                          type="text"
                          title="width"
                          value={state.svgWidth}
                          onChange={(e) => {
                            state.pushHistory();
                            state.set({ svgWidth: Number(e.currentTarget.value) || 0 });
                          }}
                          onClick={(e) => e.stopPropagation()}
                          onKeyDown={(e) => e.stopPropagation()}
                          className="w-12 text-center px-1 py-0.5 bg-slate-700 border border-slate-600 text-slate-200 text-xs rounded"
                        />
                      </label>
                      <label className="flex items-center gap-2 text-xs text-slate-300">
                        <span className="w-12">Height:</span>
                        <input
                          type="text"
                          title="height"
                          value={state.svgHeight}
                          onChange={(e) => {
                            state.pushHistory();
                            state.set({ svgHeight: Number(e.currentTarget.value) || 0 });
                          }}
                          onClick={(e) => e.stopPropagation()}
                          onKeyDown={(e) => e.stopPropagation()}
                          className="w-12 text-center px-1 py-0.5 bg-slate-700 border border-slate-600 text-slate-200 text-xs rounded"
                        />
                      </label>
                    </div>
                  </Menu.Popup>
                </Menu.Positioner>
              </Menu.Portal>
            </Menu.SubmenuRoot>

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
                {import.meta.env.DEV && (
                  <Menu.Item
                    className="flex items-center gap-2 px-2 py-1 text-xs text-red-400 hover:bg-slate-700 cursor-pointer"
                    closeOnClick
                    onClick={() => state.deleteSelectedNodes()}
                  >
                    <TrashIcon className="size-4" />
                    Delete
                  </Menu.Item>
                )}
                <div className="my-1 border-t border-slate-700" />
              </>
            )}

            {mapNodeTypes.map((type) => (
              <Menu.Item
                key={type}
                className="flex items-center gap-2 px-2 py-1 text-xs text-slate-300 hover:bg-slate-700 cursor-pointer"
                closeOnClick
                onClick={() => {
                  state.add(type, { selectionAsParent: true });
                }}
              >
                <NodeIcon type={type} />
                {type.charAt(0).toUpperCase() + type.slice(1)}
              </Menu.Item>
            ))}

            <div className="my-1 border-t border-slate-700" />

            <Menu.Item
              className="flex items-center gap-2 px-2 py-1 text-xs text-slate-300 hover:bg-slate-700 cursor-pointer"
              closeOnClick
              onClick={() => {
                state.set({ selectedIds: new Set([...getRecursiveNodes(state.nodes)].map((node) => node.id)) });
              }}
            >
              <SelectionAllIcon className="size-4" />
              Select All
            </Menu.Item>

            <div className="my-1 border-t border-slate-700" />

            <Menu.Item
              className="flex items-center gap-2 px-2 py-1 text-on-background text-xs hover:bg-slate-700 cursor-pointer"
              closeOnClick
              onClick={() => {
                if (
                  confirm(
                    "Clear all localStorage maps and symbols?\n\nThis will delete all saved files from localStorage (not from filesystem). This action cannot be undone.",
                  )
                ) {
                  clearLocalStorage();
                  state.updateSavedFileSpecifiers([]);
                }
              }}
            >
              <WarningIcon className="size-4 text-red-400" />
              Clear localStorage
            </Menu.Item>
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}
