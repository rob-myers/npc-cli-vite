import { Menu } from "@base-ui/react/menu";
import { Select } from "@base-ui/react/select";
import { UiContext } from "@npc-cli/ui-sdk/UiContext";
import { cn, Spinner, useStateRef } from "@npc-cli/util";
import { hashJson, tryLocalStorageGetParsed, tryLocalStorageSet } from "@npc-cli/util/legacy/generic";
import {
  CaretDownIcon,
  CaretRightIcon,
  CircleHalfIcon,
  GlobeStandIcon,
  MagnifyingGlassIcon,
  SunIcon,
} from "@phosphor-icons/react";
import { AnimatePresence, motion, useMotionValue } from "motion/react";
import { ANY_QUERY_FILTER, findRandomPoint } from "navcat";
import { useContext, useEffect, useRef, useState } from "react";
import { WorldThemeSchema } from "../assets.schema";
import { brightnessStorageKey, contrastStorageKey } from "../const";
import { GeomorphGraphsModal, RoomHitModal, SkinDebugModal } from "../service/debug";
import { queryClientApi } from "../service/query-client";
import { WorldContext } from "./world-context";

export function WorldMenu() {
  const { uiStoreApi } = useContext(UiContext);

  const w = useContext(WorldContext);
  const mapKeys = Object.keys(w.assets?.map ?? {});
  const themeKeys = Object.keys(w.assets?.theme ?? {});

  const state = useStateRef(
    (): State => ({
      debugHitOpen: false,
      gmGraphsOpen: false,
      skinDebugOpen: false,
      suppressGrayscale: true,
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
        return Math.max(state.minY, (w.rootEl?.clientHeight ?? Infinity) - 120);
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
          w.set({ hash: hashJson(w.assets) });
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

  const pendingKeys = Object.keys(w.pending);
  const toastKeys = useToastKeys(pendingKeys, 2000);
  const { extraZoomActive, readyForExtraZoom } = w.view?.controls ?? {};

  return (
    <>
      <motion.div
        className="absolute top-0 left-0.25 z-10 touch-none select-none"
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
          onOpenChange={(open, { reason }) => {
            if (open) {
              state.set({ menuOpen: true });
            } else if (reason === "outside-press" || reason === "escape-key" || reason === "item-press") {
              state.set({ menuOpen: false });
            }
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
              {pendingKeys.length > 0 && <Spinner className="size-4" />}
            </div>
          </Menu.Trigger>

          {(extraZoomActive || readyForExtraZoom) && (
            <div
              className={cn(
                "pointer-events-none flex justify-center rounded p-1 select-none",
                extraZoomActive ? "bg-gray-800/90 text-white" : "bg-gray-800/50 text-gray-400",
              )}
            >
              <MagnifyingGlassIcon size={22} weight="bold" />
            </div>
          )}

          <Menu.Portal>
            <Menu.Positioner className="z-50" sideOffset={4} align="start">
              <Menu.Popup className="bg-slate-800 border border-slate-700 rounded-md shadow-lg py-1">
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
                    className={cn(
                      "w-16 accent-white cursor-pointer",
                      "appearance-none bg-transparent [&::-webkit-slider-runnable-track]:rounded-full [&::-webkit-slider-runnable-track]:bg-white/50 [&::-moz-range-track]:bg-white/50 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:h-[14px] [&::-webkit-slider-thumb]:w-[14px] [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white",
                    )}
                  />
                </div>
                <div className="flex items-center gap-2 px-2 py-1.5 text-xs text-slate-300">
                  <CircleHalfIcon
                    className="size-4 text-white cursor-pointer shrink-0"
                    onClick={() => {
                      w.contrast = 1;
                      w.update();
                      tryLocalStorageSet(contrastStorageKey, "1");
                    }}
                  />
                  <input
                    type="range"
                    min="0.75"
                    max="1.75"
                    step="0.05"
                    value={w.contrast}
                    onChange={(e) => {
                      w.contrast = Number(e.target.value);
                      w.update();
                      tryLocalStorageSet(contrastStorageKey, String(w.contrast));
                    }}
                    onClick={(e) => e.stopPropagation()}
                    className={cn(
                      "w-16 accent-white cursor-pointer",
                      "appearance-none bg-transparent [&::-webkit-slider-runnable-track]:rounded-full [&::-webkit-slider-runnable-track]:bg-white/50 [&::-moz-range-track]:bg-white/50 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:h-[14px] [&::-webkit-slider-thumb]:w-[14px] [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white",
                    )}
                  />
                </div>

                {w.view && (
                  <Menu.Item
                    className="flex items-center gap-2 px-2 py-1 text-xs text-slate-300 hover:bg-slate-700 cursor-pointer"
                    closeOnClick={false}
                    onClick={() => w.view.setCameraMode(nextCameraMode[w.view.cameraMode])}
                  >
                    camera: {w.view.cameraMode}
                  </Menu.Item>
                )}

                <MenuSelect
                  label={w.mapKey}
                  value={w.mapKey}
                  items={mapKeys}
                  onValueChange={(key) => key && uiStoreApi.setUiMeta(w.id, (draft) => (draft.mapKey = key))}
                />

                <Menu.Item
                  className="flex items-center gap-2 px-2 py-1 text-xs text-slate-300 hover:bg-slate-700 cursor-pointer"
                  closeOnClick={false}
                  onClick={() => {
                    const currentIdx = themeKeys.indexOf(w.themeKey);
                    const nextIdx = (currentIdx + 1) % themeKeys.length;
                    uiStoreApi.setUiMeta(w.id, (draft) => (draft.themeKey = themeKeys[nextIdx]));
                  }}
                >
                  {w.themeKey}
                </Menu.Item>

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
                          className="w-44 h-32 bg-slate-900 text-slate-200 text-[10px] font-mono p-1 rounded border border-slate-600 resize-y"
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

                    <button
                      type="button"
                      className="w-full cursor-pointer text-xs bg-slate-700 hover:bg-slate-600 text-slate-200 rounded px-2 py-0.5"
                      onClick={async (e) => {
                        e.stopPropagation();
                        w.setNextPending({ obstacles: true });
                        try {
                          const res = await fetch("/api/gen-starship-sheets", {
                            method: "POST",
                          });
                          if (!res.ok) throw new Error(`HTTP ${res.status}`);
                          await queryClientApi.queryClient.invalidateQueries({
                            queryKey: [...w.worldQueryPrefix, "sheets"],
                          });
                          await queryClientApi.queryClient.invalidateQueries({
                            queryKey: [...w.worldQueryPrefix, "obstacle-images"],
                          });
                        } catch (err) {
                          console.error("Failed to update obstacles:", err);
                        } finally {
                          delete w.pending["obstacles"];
                          w.update();
                        }
                      }}
                    >
                      update obstacles
                    </button>
                  </>
                )}

                <div className="flex">
                  <MenuMultiSelect
                    label="actions"
                    items={actionItems}
                    className="justify-center"
                    isActive={(action) => {
                      if (action === "Wall Lights") return w.wall?.lightsShown ?? true;
                      return false;
                    }}
                    onToggle={(action) => {
                      if (action === "Spawn NPC") {
                        const result = findRandomPoint(w.nav.navMesh, ANY_QUERY_FILTER, Math.random);
                        if (!result.success) return;
                        const [x, y, z] = result.position;
                        const key = `npc-${Date.now().toString(36)}`;
                        w.npc.spawn({ npcKey: key, at: [x, y, z] });
                        w.update();
                      } else if (action === "Clear NPCs") {
                        w.npc.remove(...Object.keys(w.npc.npc));
                        w.view.forceUpdate();
                      } else if (action === "Wall Lights") {
                        w.wall?.toggleLights();
                      }
                    }}
                  />

                  <MenuMultiSelect
                    label="debug"
                    items={debugItems}
                    className="justify-center"
                    isActive={(item) => {
                      switch (item) {
                        case "Pick":
                          return w.view?.objectPick.value === 1;
                        case "Post FX":
                          return w.view?.postProcessing ?? true;
                        case "Colliders":
                          return w.debug?.physicsCollidersShown ?? false;
                        case "Lights":
                          return w.debug?.lightSpheresShown ?? true;
                        case "NavMesh":
                          return w.debug?.navMeshShown ?? false;
                        case "Points":
                          return w.debug?.onPointsShown ?? false;
                        default:
                          return false;
                      }
                    }}
                    onToggle={(item) => {
                      switch (item) {
                        case "Pick":
                          w.view.objectPick.value = w.view.objectPick.value === 1 ? 0 : 1;
                          w.view.forceUpdate();
                          break;
                        case "Post FX":
                          w.view.set({ postProcessing: !w.view.postProcessing });
                          state.update();
                          break;
                        case "Room Hit":
                          state.set({ debugHitOpen: true });
                          break;
                        case "Graphs":
                          state.set({ gmGraphsOpen: true });
                          break;
                        case "Skins":
                          state.set({ skinDebugOpen: true });
                          break;
                        case "Colliders":
                          w.debug?.showPhysicsColliders();
                          w.update();
                          break;
                        case "Lights":
                          w.debug?.set({ lightSpheresShown: !w.debug.lightSpheresShown });
                          w.update();
                          break;
                        case "NavMesh":
                          w.debug?.set({ navMeshShown: !w.debug.navMeshShown });
                          setTimeout(() => w.view.forceUpdate());
                          break;
                        case "Points": {
                          const next = !w.debug.onPointsShown;
                          w.debug?.set({ onPointsShown: next });
                          if (next) w.debug?.updateOnPoints();
                          w.view.forceUpdate();
                          break;
                        }
                      }
                    }}
                  />
                </div>
              </Menu.Popup>
            </Menu.Positioner>
          </Menu.Portal>
        </Menu.Root>

        <AnimatePresence>
          {toastKeys.map((key) => (
            <motion.div
              key={key}
              className="bg-gray-800/90 text-slate-300 text-xs px-2 py-1"
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
            >
              {key}
            </motion.div>
          ))}
        </AnimatePresence>
      </motion.div>

      <RoomHitModal open={state.debugHitOpen} onOpenChange={(open) => state.set({ debugHitOpen: open })} />
      <GeomorphGraphsModal
        open={state.gmGraphsOpen}
        onOpenChange={(open) => state.set({ gmGraphsOpen: open })}
        container={w.rootEl}
      />
      {w.npc && (
        <SkinDebugModal open={state.skinDebugOpen} onOpenChange={(open) => state.set({ skinDebugOpen: open })} />
      )}
    </>
  );
}

/** Sun icon wi\th a pie-chart fill showing brightness ratio (0–1) */
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
  debugHitOpen: boolean;
  gmGraphsOpen: boolean;
  skinDebugOpen: boolean;
  suppressGrayscale: boolean;
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
const nextCameraMode = { free: "azimuthal", azimuthal: "cardinal", cardinal: "free" } as const;
const actionItems = ["Spawn NPC", "Clear NPCs", "Wall Lights"] as const;
const debugItems = [
  "Pick",
  "Post FX",
  "Room Hit",
  "Graphs",
  "Skins",
  "Colliders",
  "Lights",
  "NavMesh",
  "Points",
] as const;

const selectItemClass = cn(
  "px-2 py-1 text-xs cursor-pointer text-slate-300",
  "data-highlighted:bg-slate-700 data-selected:text-green-400",
);

function MenuSelect({
  className,
  label,
  value,
  items,
  onValueChange,
}: {
  className?: string;
  label: string;
  value: string | null;
  items: string[];
  onValueChange: (value: string | null) => void;
}) {
  return (
    <Select.Root value={value} onValueChange={onValueChange}>
      <Select.Trigger
        className={cn(
          "flex items-center gap-1 px-2 py-1 text-xs text-slate-300 cursor-pointer hover:bg-slate-700 w-full",
          className,
        )}
      >
        <Select.Value placeholder={label} />
      </Select.Trigger>
      <Select.Portal>
        <Select.Positioner
          className="z-50"
          sideOffset={4}
          side="right"
          align="start"
          collisionPadding={0}
          alignItemWithTrigger={false}
        >
          <Select.Popup className="bg-slate-800 border border-slate-700 rounded shadow-lg py-1 max-h-60 overflow-auto">
            <Select.List>
              {items.map((item) => (
                <Select.Item key={item} value={item} className={selectItemClass}>
                  <Select.ItemText>{item}</Select.ItemText>
                </Select.Item>
              ))}
            </Select.List>
          </Select.Popup>
        </Select.Positioner>
      </Select.Portal>
    </Select.Root>
  );
}

function MenuMultiSelect({
  label,
  items,
  className,
  isActive,
  onToggle,
}: {
  label: string;
  className?: string;
  items: readonly string[];
  isActive: (item: string) => boolean;
  onToggle: (item: string) => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Select.Root
      open={open}
      onOpenChange={(nextOpen, { reason }) => {
        if (!nextOpen && reason === "item-press") return;
        setOpen(nextOpen);
      }}
      value={null}
    >
      <Select.Trigger
        className={cn(
          "flex items-center gap-1 px-2 py-1 text-xs text-slate-300 cursor-pointer hover:bg-slate-700 w-full",
          className,
        )}
      >
        {label}
      </Select.Trigger>
      <Select.Portal>
        <Select.Positioner
          className="z-50"
          sideOffset={4}
          side="right"
          align="start"
          collisionPadding={0}
          alignItemWithTrigger={false}
        >
          <Select.Popup className="bg-slate-800 border border-slate-700 rounded shadow-lg py-1">
            <Select.List>
              {items.map((item) => (
                <Select.Item
                  key={item}
                  value={item}
                  className={cn(selectItemClass, isActive(item) && "text-green-400!")}
                  onClick={(e) => {
                    e.preventDefault();
                    onToggle(item);
                  }}
                >
                  <Select.ItemText>{item}</Select.ItemText>
                </Select.Item>
              ))}
            </Select.List>
          </Select.Popup>
        </Select.Positioner>
      </Select.Portal>
    </Select.Root>
  );
}

function useToastKeys(keys: string[], delayMs: number): string[] {
  const [visible, setVisible] = useState<string[]>([]);
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  useEffect(() => {
    for (const key of keys) {
      if (!visible.includes(key)) {
        setVisible((prev) => (prev.includes(key) ? prev : [...prev, key]));
      }
      clearTimeout(timers.current[key]);
      delete timers.current[key];
    }
    for (const key of visible) {
      if (!keys.includes(key) && !timers.current[key]) {
        timers.current[key] = setTimeout(() => {
          setVisible((prev) => prev.filter((k) => k !== key));
          delete timers.current[key];
        }, delayMs);
      }
    }
  }, [keys.join(",")]);

  useEffect(() => {
    return () => Object.values(timers.current).forEach(clearTimeout);
  }, []);

  return visible;
}
