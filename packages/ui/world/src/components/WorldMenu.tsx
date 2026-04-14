import { Menu } from "@base-ui/react/menu";
import { uiClassName } from "@npc-cli/ui-sdk/const";
import { UiContext } from "@npc-cli/ui-sdk/UiContext";
import { cn, Spinner, useStateRef } from "@npc-cli/util";
import { tryLocalStorageGetParsed, tryLocalStorageSet } from "@npc-cli/util/legacy/generic";
import { CaretDownIcon, CaretRightIcon, ListIcon, SunIcon } from "@phosphor-icons/react";
import { motion, useMotionValue } from "motion/react";
import { useContext, useRef } from "react";
import { WorldThemeSchema } from "../assets.schema";
import { brightnessStorageKey } from "../const";
import { objectPick } from "../service/pick";
import { WorldContext } from "./world-context";

export function WorldMenu() {
  const { uiStoreApi } = useContext(UiContext);

  const w = useContext(WorldContext);
  const mapKeys = Object.keys(w.assets?.map ?? {});
  const themeKeys = Object.keys(w.assets?.theme ?? {});
  const themeEditorRef = useRef<HTMLTextAreaElement>(null);

  const state = useStateRef(() => ({
    y: tryLocalStorageGetParsed(storageKey(w.id)) ?? 40,
    onDragEnd() {
      tryLocalStorageSet(storageKey(w.id), String(y.get()));
    },
    themeEditorOpen: tryLocalStorageGetParsed(themeEditorStorageKey) === true,
    themeDirty: false,
    saveTheme() {
      if (!state.themeDirty) return;
      state.themeDirty = false;
      const theme = w.assets?.theme?.[w.themeKey];
      if (!theme) return;
      fetch(`/api/assets/theme/${encodeURIComponent(w.themeKey)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(theme),
      });
    },
  }));

  const minY = 40;
  const maxY = (w.view.rootEl?.clientHeight ?? Infinity) - 120;
  const y = useMotionValue(Math.min(maxY, Math.max(minY, state.y)));

  return (
    <motion.div
      className={cn(uiClassName, "absolute top-0 left-0 z-9999 touch-none select-none")}
      style={{ y }}
      drag="y"
      dragConstraints={{ top: minY, bottom: maxY }}
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

              <Menu.Item
                className="flex items-center gap-2 px-2 py-1 text-xs text-slate-300 hover:bg-slate-700 cursor-pointer"
                closeOnClick={false}
                onClick={() => {
                  objectPick.value = objectPick.value === 1 ? 0 : 1;
                  w.r3f?.invalidate();
                }}
              >
                Toggle pick colors
              </Menu.Item>

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

              <div className="my-1 border-t border-slate-700" />

              {themeKeys.map((key) => (
                <Menu.Item
                  key={key}
                  closeOnClick={false}
                  className={cn(
                    "flex items-center gap-2 px-2 py-1 text-left text-xs text-slate-300 cursor-pointer",
                    "hover:bg-slate-700",
                    key === w.themeKey && "text-green-400",
                  )}
                  onClick={() => {
                    uiStoreApi.setUiMeta(w.id, (draft) => {
                      draft.themeKey = key;
                    });
                  }}
                >
                  {key}
                </Menu.Item>
              ))}

              {import.meta.env.DEV && (
                <>
                  <div
                    className="flex items-center gap-1 px-2 py-1 text-xs text-slate-400 cursor-pointer hover:text-slate-200"
                    onClick={(e) => {
                      e.stopPropagation();
                      state.themeEditorOpen = !state.themeEditorOpen;
                      tryLocalStorageSet(themeEditorStorageKey, String(state.themeEditorOpen));
                      w.update();
                    }}
                  >
                    {state.themeEditorOpen ? (
                      <CaretDownIcon className="size-3" />
                    ) : (
                      <CaretRightIcon className="size-3" />
                    )}
                    edit
                  </div>
                  {state.themeEditorOpen && (
                    <div className="p-2 pt-0 flex flex-col gap-1">
                      <textarea
                        ref={themeEditorRef}
                        className="w-48 h-32 bg-slate-900 text-slate-200 text-[10px] font-mono p-1 rounded border border-slate-600 resize-y"
                        defaultValue={JSON.stringify(w.getTheme(), null, 2)}
                        onKeyDown={(e) => e.stopPropagation()}
                        onClick={(e) => e.stopPropagation()}
                        onChange={() => {
                          try {
                            const parsed = WorldThemeSchema.safeParse(JSON.parse(themeEditorRef.current?.value ?? ""));
                            if (!parsed.success || !w.assets) return;
                            w.assets.theme ??= {};
                            w.assets.theme[w.themeKey] = parsed.data;
                            state.themeDirty = true;
                            w.ceil.draw().then(() => w.update());
                          } catch {
                            // invalid JSON, ignore
                          }
                        }}
                        onBlur={() => state.saveTheme()}
                      />
                      <button
                        type="button"
                        className="cursor-pointer text-xs bg-slate-700 hover:bg-slate-600 text-slate-200 rounded px-2 py-0.5"
                        onClick={async (e) => {
                          e.stopPropagation();
                          const name = prompt("Theme name:");
                          if (!name || !w.assets) return;
                          const theme = structuredClone(w.getTheme());
                          const res = await fetch(`/api/assets/theme/${encodeURIComponent(name)}`, {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify(theme),
                          });
                          if (!res.ok) return console.warn("Failed to save theme:", await res.text());
                          w.assets.theme ??= {};
                          w.assets.theme[name] = theme;
                          w.update();
                        }}
                      >
                        add theme
                      </button>
                    </div>
                  )}
                </>
              )}
            </Menu.Popup>
          </Menu.Positioner>
        </Menu.Portal>
      </Menu.Root>
    </motion.div>
  );
}

const storageKey = (id: string) => `world-context-menu-y-${id}`;
const themeEditorStorageKey = "world-theme-editor-open";
