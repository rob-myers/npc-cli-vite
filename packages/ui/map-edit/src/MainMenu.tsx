import { Menu } from "@base-ui/react/menu";
import { Select } from "@base-ui/react/select";
import type { UseStateRef } from "@npc-cli/util";
import {
  ArrowCounterClockwiseIcon,
  CaretRightIcon,
  CopyIcon,
  FloppyDiskIcon,
  ListIcon,
  RulerIcon,
  SelectionAllIcon,
  TrashIcon,
} from "@phosphor-icons/react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { NodeIcon } from "./InspectorNode";
import type { State } from "./MapEdit";
import { clearLocalStorage, getRecursiveNodes, mapNodeTypes } from "./map-node-api";

export function MainMenu({ state }: { state: UseStateRef<State> }) {
  const toastKeys = useToastTs(state.toastTs);

  return (
    <div className="flex items-start gap-2">
      <Menu.Root>
        <Menu.Trigger className="cursor-pointer">
          <ListIcon className="size-5.5 bg-background text-on-background border border-on-background/50 p-0.5" />
        </Menu.Trigger>

        <Menu.Portal>
          <Menu.Positioner className="z-50" sideOffset={4} align="start">
            <Menu.Popup className="bg-slate-800 border border-slate-700 rounded-md shadow-lg py-1 min-w-[120px]">
              {!state.isReadOnly() && (
                <>
                  <Menu.Item
                    className="flex items-center gap-2 px-2 py-1 text-xs text-slate-300 hover:bg-slate-700 cursor-pointer"
                    closeOnClick
                    onClick={() => state.save()}
                  >
                    <FloppyDiskIcon className="size-4" />
                    Save
                  </Menu.Item>

                  <Menu.Item
                    className="flex items-center gap-2 px-2 py-1 text-xs text-slate-300 hover:bg-slate-700 cursor-pointer"
                    closeOnClick
                    onClick={() => state.load(undefined, { ignoreDraft: true, preserveHistory: true })}
                  >
                    <ArrowCounterClockwiseIcon className="size-4" />
                    Reset
                  </Menu.Item>

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
                </>
              )}

              {!state.isReadOnly() && (
                <>
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
                </>
              )}

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

              <div className="px-1 border-2 border-l-8 border-slate-700 text-[0.7rem]">
                {!state.isReadOnly() && (
                  <>
                    <Select.Root
                      value={state.loadDrafts}
                      onValueChange={(v) => {
                        if (v) void state.switchLoadDrafts(v as "use-originals" | "use-drafts");
                      }}
                    >
                      <Select.Trigger className="flex items-center gap-1 px-2 py-1 text-slate-300 cursor-pointer hover:bg-slate-700 w-full ">
                        <Select.Value />
                      </Select.Trigger>
                      <Select.Portal>
                        <Select.Positioner
                          className="z-50"
                          sideOffset={4}
                          side="right"
                          align="start"
                          alignItemWithTrigger={false}
                        >
                          <Select.Popup className="bg-slate-800 border border-slate-700 rounded shadow-lg py-1">
                            <Select.List>
                              {(["use-originals", "use-drafts"] as const).map((v) => (
                                <Select.Item
                                  key={v}
                                  value={v}
                                  className="px-2 py-1 text-slate-300 cursor-pointer data-highlighted:bg-slate-700 data-selected:text-green-400"
                                >
                                  <Select.ItemText>{v}</Select.ItemText>
                                </Select.Item>
                              ))}
                            </Select.List>
                          </Select.Popup>
                        </Select.Positioner>
                      </Select.Portal>
                    </Select.Root>

                    <Menu.Item
                      className="flex items-center gap-2 px-2 text-on-background text-slate-300 hover:bg-slate-700 cursor-pointer"
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
                      clear drafts
                    </Menu.Item>
                  </>
                )}

                {import.meta.env.DEV && (
                  <Menu.Item
                    className="flex items-center gap-2 px-2 py-1 text-slate-300 hover:bg-slate-700 cursor-pointer"
                    closeOnClick
                    onClick={() => {
                      state.set({ devForceReadOnly: !state.devForceReadOnly });
                    }}
                  >
                    {state.devForceReadOnly ? "disable read only" : "set read only"}
                  </Menu.Item>
                )}
              </div>
            </Menu.Popup>
          </Menu.Positioner>
        </Menu.Portal>
      </Menu.Root>

      <AnimatePresence>
        {toastKeys.map((key) => (
          <motion.div
            key={key}
            className="bg-gray-800/90 text-slate-300 text-xs px-2 py-1 pointer-events-none"
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
          >
            {key}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

function useToastTs(tsRecord: Record<string, number>, delayMs = 2000): string[] {
  const [visible, setVisible] = useState<string[]>([]);
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  useEffect(() => {
    for (const [key, ts] of Object.entries(tsRecord)) {
      if (!ts) continue;
      setVisible((prev) => (prev.includes(key) ? prev : [...prev, key]));
      clearTimeout(timers.current[key]);
      timers.current[key] = setTimeout(() => {
        setVisible((prev) => prev.filter((k) => k !== key));
        delete timers.current[key];
      }, delayMs);
    }
  }, [Object.values(tsRecord).join(",")]);

  useEffect(() => () => Object.values(timers.current).forEach(clearTimeout), []);

  return visible;
}
