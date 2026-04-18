import { Menu } from "@base-ui/react/menu";
import { uiClassName } from "@npc-cli/ui-sdk/const";
import { UiContext } from "@npc-cli/ui-sdk/UiContext";
import { cn, Spinner, useStateRef } from "@npc-cli/util";
import { hashJson, tryLocalStorageGetParsed, tryLocalStorageSet } from "@npc-cli/util/legacy/generic";
import { CaretDownIcon, CaretRightIcon, GlobeStandIcon, SunIcon } from "@phosphor-icons/react";
import { motion, useMotionValue } from "motion/react";
import { ANY_QUERY_FILTER, findRandomPoint } from "navcat";
import { useContext } from "react";
import { WorldThemeSchema } from "../assets.schema";
import { brightnessStorageKey } from "../const";
import { objectPick } from "../service/pick";
import { WorldContext } from "./world-context";

export function WorldMenu() {
  const { uiStoreApi } = useContext(UiContext);

  const w = useContext(WorldContext);
  const mapKeys = Object.keys(w.assets?.map ?? {});
  const themeKeys = Object.keys(w.assets?.theme ?? {});

  const state = useStateRef(
    (): State => ({
      dragged: false,
      menuOpen: false,
      minY: 40,
      themeEditorRef: null as any,
      y: tryLocalStorageGetParsed<number>(storageKey(w.id)) ?? 40,
      persistY() {
        tryLocalStorageSet(storageKey(w.id), `${state.getClampedY(y.get())}`);
      },
      themeEditorOpen: tryLocalStorageGetParsed(themeEditorStorageKey) === true,
      saveTimer: 0 as ReturnType<typeof setTimeout> | 0,

      getMaxY() {
        return Math.max(state.minY, (w.view.rootEl?.clientHeight ?? Infinity) - 120);
      },
      getClampedY(y: number) {
        return Math.min(state.getMaxY(), Math.max(state.minY, y));
      },
      onResize() {
        y.set(state.getClampedY(y.get()));
        state.update();
      },
      async saveTheme() {
        const theme = w.assets?.theme?.[w.themeKey];
        if (!theme) return;
        const res = await fetch(`/api/assets/theme/${encodeURIComponent(w.themeKey)}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(theme),
        });
        if (res.ok) {
          w.hash = hashJson(w.assets);
          w.update();
        }
      },
      saveThemeDebounced() {
        clearTimeout(state.saveTimer);
        state.saveTimer = setTimeout(() => state.saveTheme(), 300);
      },
    }),
  );

  w.menu = state;

  const y = useMotionValue(state.getClampedY(state.y));

  return (
    <motion.div
      className={cn(uiClassName, "absolute top-0 left-0.25 z-9999 touch-none select-none")}
      style={{ y }}
      drag="y"
      dragConstraints={{ top: state.minY, bottom: state.getMaxY() }}
      dragMomentum={false}
      onDragStart={() => (state.dragged = true)}
      onDragEnd={() => {
        state.persistY();
        requestAnimationFrame(() => (state.dragged = false));
      }}
    >
      <Menu.Root
        open={state.menuOpen}
        onOpenChange={(open) => {
          state.set({ menuOpen: open });
        }}
      >
        <Menu.Trigger
          className="cursor-pointer"
          onPointerDown={(e) => e.preventDefault()}
          onClick={() => {
            if (state.dragged) return;
            state.set({ menuOpen: !state.menuOpen });
          }}
        >
          <div className="flex items-center gap-2 bg-gray-800 text-white p-2">
            <GlobeStandIcon className="size-5" weight="bold" />
            {w.navPending && <Spinner className="size-4" />}
          </div>
        </Menu.Trigger>

        <Menu.Portal>
          <Menu.Positioner className="z-50" sideOffset={4} align="start">
            <Menu.Popup className="bg-slate-800 border border-slate-700 rounded-md shadow-lg py-1 min-w-[120px]">
              <div className="flex items-center gap-2 px-2 py-1.5 text-xs text-slate-300">
                <BrightnessPie
                  ratio={brightnessToRatio(w.brightness)}
                  onClick={() => {
                    w.brightness = 1;
                    w.update();
                    tryLocalStorageSet(brightnessStorageKey, "1");
                  }}
                />
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
                  className="w-20 accent-white"
                />
              </div>

              <div className="my-1 border-t border-slate-700" />

              {mapKeys.map((key) => (
                <Menu.Item
                  key={key}
                  className={cn(
                    "flex items-center gap-2 px-2 py-1 text-left text-xs text-slate-300 cursor-pointer",
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

              <div className="my-1 border-t border-slate-700" />

              {themeKeys.map((key) => (
                <Menu.Item
                  key={key}
                  className={cn(
                    "flex items-center gap-2 px-2 py-1 text-left text-xs text-slate-300 cursor-pointer",
                    "hover:bg-slate-700",
                    key === w.themeKey && "text-green-400",
                  )}
                  closeOnClick={false}
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
                        key={w.themeKey}
                        ref={state.ref("themeEditorRef")}
                        className="w-48 h-32 bg-slate-900 text-slate-200 text-[10px] font-mono p-1 rounded border border-slate-600 resize-y"
                        defaultValue={JSON.stringify(w.getTheme(), null, 2)}
                        onKeyDown={(e) => e.stopPropagation()}
                        onClick={(e) => e.stopPropagation()}
                        onChange={() => {
                          const parsed = WorldThemeSchema.safeParse(JSON.parse(state.themeEditorRef?.value ?? ""));
                          if (!parsed.success || !w.assets) return;
                          w.assets.theme ??= {};
                          w.assets.theme[w.themeKey] = parsed.data;
                          state.saveThemeDebounced();
                        }}
                        onBlur={() => {
                          clearTimeout(state.saveTimer);
                          state.saveTheme();
                        }}
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

              <div className="my-1 border-t border-slate-700" />

              <Menu.Item
                className="flex items-center gap-2 px-2 py-1 text-xs text-slate-300 hover:bg-slate-700 cursor-pointer"
                closeOnClick={false}
                onClick={() => {
                  if (!w.nav || !w.npc) return;
                  const result = findRandomPoint(w.nav.navMesh, ANY_QUERY_FILTER, Math.random);
                  if (!result.success) return;
                  const [x, y, z] = result.position;
                  const key = `npc-${Date.now().toString(36)}`;
                  w.npc.spawn({ npcKey: key, position: [x, y, z] });
                  w.update();
                }}
              >
                Spawn NPC
              </Menu.Item>

              <Menu.Item
                className="flex items-center gap-2 px-2 py-1 text-xs text-slate-300 hover:bg-slate-700 cursor-pointer"
                closeOnClick={false}
                onClick={() => {
                  if (!w.npc) return;
                  for (const key of Object.keys(w.npc.npc)) {
                    w.npc.remove(key);
                  }
                  w.update();
                }}
              >
                Clear NPCs
              </Menu.Item>

              <Menu.Item
                className="flex items-center gap-2 px-2 py-1 text-xs text-slate-300 hover:bg-slate-700 cursor-pointer"
                closeOnClick={false}
                onClick={() => {
                  objectPick.value = objectPick.value === 1 ? 0 : 1;
                  w.r3f?.invalidate();
                }}
              >
                Debug Pick
              </Menu.Item>
            </Menu.Popup>
          </Menu.Positioner>
        </Menu.Portal>
      </Menu.Root>
    </motion.div>
  );
}

/** Sun icon with a pie-chart fill showing brightness ratio (0–1) */
function BrightnessPie({ ratio, onClick }: { ratio: number; onClick?: () => void }) {
  const a = Math.min(1, Math.max(0, ratio)) * Math.PI * 2;
  return (
    <div className="relative size-4 cursor-pointer" onClick={onClick}>
      <SunIcon className="size-4 text-white" />
      {ratio > 0 && (
        <svg className="absolute inset-0 size-4" viewBox="0 0 16 16">
          <path
            d={
              ratio >= 1
                ? "M8,8 m-8,0 a8,8 0 1,1 16,0 a8,8 0 1,1 -16,0"
                : `M8,8 L8,0 A8,8 0 ${a > Math.PI ? 1 : 0},1 ${8 + 8 * Math.sin(a)},${8 - 8 * Math.cos(a)} Z`
            }
            fill="rgba(250,220,100,0.45)"
          />
        </svg>
      )}
    </div>
  );
}

/** Map brightness (0.5–2.0) so that 1.0 = 50% pie fill */
function brightnessToRatio(b: number) {
  return b <= 1 ? b - 0.5 : 0.5 + (b - 1) * 0.5;
}

export type State = {
  dragged: boolean;
  menuOpen: boolean;
  themeEditorRef: HTMLTextAreaElement;
  y: number;
  themeEditorOpen: boolean;
  saveTimer: ReturnType<typeof setTimeout> | 0;
  minY: number;
  getMaxY(): number;
  getClampedY(y: number): number;
  onResize(): void;
  persistY(): void;
  saveTheme(): Promise<void>;
  saveThemeDebounced(): void;
};

const storageKey = (id: string) => `world-context-menu-y-${id}`;
const themeEditorStorageKey = "world-theme-editor-open";
