import { Menu } from "@base-ui/react/menu";
import { uiClassName } from "@npc-cli/ui-sdk/const";
import { UiContext } from "@npc-cli/ui-sdk/UiContext";
import { cn, Spinner, useStateRef } from "@npc-cli/util";
import { tryLocalStorageGetParsed, tryLocalStorageSet } from "@npc-cli/util/legacy/generic";
import { CaretRightIcon, ListIcon, SunIcon } from "@phosphor-icons/react";
import { motion, useMotionValue } from "motion/react";
import { useContext } from "react";
import { brightnessStorageKey } from "../const";
import { WorldContext } from "./world-context";

export function WorldContextMenu() {
  const { uiStoreApi } = useContext(UiContext);

  const w = useContext(WorldContext);
  const mapKeys = Object.keys(w.assets?.map ?? {});

  const state = useStateRef(() => ({
    y: tryLocalStorageGetParsed(storageKey(w.id)) ?? 40,
    onDragEnd() {
      tryLocalStorageSet(storageKey(w.id), String(y.get()));
    },
  }));

  const y = useMotionValue(state.y);

  return (
    <motion.div
      className={cn(uiClassName, "absolute top-0 left-0 z-9999 touch-none select-none")}
      style={{ y }}
      drag="y"
      dragMomentum={false}
      onDragEnd={state.onDragEnd}
    >
      <Menu.Root>
        <Menu.Trigger className="cursor-pointer">
          <div className="flex items-center gap-2 bg-gray-800 text-white p-2">
            <ListIcon className="size-5" weight="bold" />
            {w.navPending && <Spinner className="size-4" />}
          </div>
        </Menu.Trigger>

        <Menu.Portal>
          <Menu.Positioner className="z-50" sideOffset={4} align="start">
            <Menu.Popup className="bg-slate-800 border border-slate-700 rounded-md shadow-lg py-1 min-w-[120px]">
              <div className="flex items-center gap-2 px-2 py-1.5 text-xs text-slate-300">
                <SunIcon className="size-4" />
                <input
                  type="range"
                  min="0.5"
                  max="2"
                  step="0.1"
                  value={w.brightness}
                  onChange={(e) => {
                    w.brightness = Number(e.target.value);
                    w.update();
                    tryLocalStorageSet(brightnessStorageKey, String(w.brightness));
                  }}
                  onClick={(e) => e.stopPropagation()}
                  className="w-20 accent-slate-400"
                />
                <span className="w-6 text-right">{w.brightness.toFixed(1)}</span>
              </div>

              <div className="my-1 border-t border-slate-700" />

              <Menu.SubmenuRoot>
                <Menu.SubmenuTrigger className="flex items-center justify-between gap-2 px-2 py-1 text-xs text-slate-300 hover:bg-slate-700 cursor-pointer w-full">
                  <span>Maps</span>
                  <CaretRightIcon className="size-4" />
                </Menu.SubmenuTrigger>
                <Menu.Portal>
                  <Menu.Positioner className="z-50" sideOffset={4}>
                    <Menu.Popup className="bg-slate-800 border border-slate-700 rounded-md shadow-lg py-1 min-w-[120px]">
                      {mapKeys.map((key) => (
                        <Menu.Item
                          key={key}
                          className={cn(
                            "flex items-center gap-2 px-3 py-1.5 text-left text-xs text-slate-300 cursor-pointer",
                            "hover:bg-slate-700",
                            key === w.mapKey && "text-green-400",
                          )}
                          closeOnClick
                          onClick={() => {
                            uiStoreApi.setUiMeta(w.id, (draft) => {
                              draft.mapKey = key;
                            });
                          }}
                        >
                          {key}
                        </Menu.Item>
                      ))}
                    </Menu.Popup>
                  </Menu.Positioner>
                </Menu.Portal>
              </Menu.SubmenuRoot>
            </Menu.Popup>
          </Menu.Positioner>
        </Menu.Portal>
      </Menu.Root>
    </motion.div>
  );
}

const storageKey = (id: string) => `world-context-menu-y-${id}`;
