import { Menu } from "@base-ui/react/menu";
import { Select } from "@base-ui/react/select";
import { UiContext } from "@npc-cli/ui-sdk/UiContext";
import { cn, Spinner, useStateRef } from "@npc-cli/util";
import { hashJson, tryLocalStorageGetParsed, tryLocalStorageSet } from "@npc-cli/util/legacy/generic";
import {
  ArrowsOutIcon,
  CaretDownIcon,
  CaretRightIcon,
  CircleHalfIcon,
  GlobeStandIcon,
  MagnifyingGlassIcon,
  SunIcon,
} from "@phosphor-icons/react";
import debounce from "debounce";
import { AnimatePresence, motion, useMotionValue } from "motion/react";
import { useContext, useEffect, useRef, useState } from "react";
import type * as THREE from "three/webgpu";
import { WorldThemeSchema } from "../assets.schema";
import { brightnessStorageKey, contrastStorageKey, defaultFov, fovStorageKey, pickOpenDoorsKey } from "../const";
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
      debugOpen: tryLocalStorageGetParsed(debugStorageKey) === true,
      dragged: false,
      gmGraphsOpen: false,
      skinDebugOpen: false,
      menuOpen: false,
      minY: 40,
      themeEditorOpen: tryLocalStorageGetParsed(themeEditorStorageKey) === true,
      themeEditorRef: null as any,
      toastTs: {} as Record<string, number>,
      y: tryLocalStorageGetParsed<number>(storageKey(w.id)) ?? 40,

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
      persistY() {
        tryLocalStorageSet(storageKey(w.id), `${state.getClampedY(y.get())}`);
      },
      async saveThemeDev() {
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
      saveThemeDevDebounced: debounce(() => state.saveThemeDev(), 300),
    }),
  );

  w.menu = state;

  const y = useMotionValue(state.getClampedY(state.y));

  const isDebugActive = (item: string) => {
    switch (item) {
      case "View Pick":
        return w.view?.objectPick.value === 1;
      case "Post FX":
        return w.view?.postProcessing ?? true;
      case "Colliders":
        return w.debug?.physicsCollidersShown ?? false;
      case "Grid":
        return w.debug?.gridShown ?? false;
      case "Room Lights":
        return w.debug?.lightSpheresShown ?? true;
      case "NavMesh":
        return w.debug?.navMeshShown ?? false;
      case "Toggle Doors":
        return w.debug?.pickOpenDoors ?? true;
      case "Door Normals":
        return w.debug?.doorNormalsShown ?? true;
      case "Decor Points":
        return w.debug?.doPointsShown ?? false;
      default:
        return false;
    }
  };

  const onDebugToggle = (item: string) => {
    switch (item) {
      case "View Pick":
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
      case "Grid":
        w.debug?.set({ gridShown: !w.debug.gridShown });
        void w.floor?.draw().then(() => w.update());
        break;
      case "Room Lights":
        w.debug?.set({ lightSpheresShown: !w.debug.lightSpheresShown });
        w.update();
        break;
      case "NavMesh":
        w.debug?.set({ navMeshShown: !w.debug.navMeshShown });
        setTimeout(() => w.view.forceUpdate());
        break;
      case "Toggle Doors": {
        const next = !w.debug?.pickOpenDoors;
        w.debug?.set({ pickOpenDoors: next });
        tryLocalStorageSet(pickOpenDoorsKey, String(next));
        state.update();
        break;
      }
      case "Door Normals":
        w.debug?.set({ doorNormalsShown: !w.debug.doorNormalsShown });
        w.view.forceUpdate();
        break;
      case "Decor Points": {
        w.debug?.set({ doPointsShown: !w.debug.doPointsShown });
        w.view.forceUpdate();
        break;
      }
    }
  };

  const pendingKeys = Object.keys(w.pending);
  const toastKeys = useToastKeys(pendingKeys, 2000);
  const toggleToastKeys = useToastTs(state.toastTs);
  const { extraZoomActive, readyForExtraZoom } = w.view?.controls ?? {};

  return (
    <>
      <motion.div
        className="absolute top-0 left-px z-10 touch-none select-none"
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
                      "appearance-none bg-transparent [&::-webkit-slider-runnable-track]:rounded-full [&::-webkit-slider-runnable-track]:bg-white/50 [&::-moz-range-track]:bg-white/50 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:h-3.5 [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white",
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
                      "appearance-none bg-transparent [&::-webkit-slider-runnable-track]:rounded-full [&::-webkit-slider-runnable-track]:bg-white/50 [&::-moz-range-track]:bg-white/50 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:h-3.5 [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white",
                    )}
                  />
                </div>

                {w.view && (
                  <div className="flex items-center gap-2 px-2 py-1.5 text-xs text-slate-300">
                    <ArrowsOutIcon
                      className="size-4 text-white cursor-pointer shrink-0"
                      onClick={() => {
                        w.view.fov = defaultFov;
                        const cam = w.r3f?.camera as THREE.PerspectiveCamera | undefined;
                        if (cam?.isPerspectiveCamera) {
                          cam.fov = defaultFov;
                          cam.updateProjectionMatrix();
                        }
                        w.r3f?.invalidate();
                        tryLocalStorageSet(fovStorageKey, String(defaultFov));
                        w.update();
                      }}
                    />
                    <input
                      type="range"
                      min="20"
                      max="100"
                      step="5"
                      value={w.view.fov}
                      onChange={(e) => {
                        const fov = Number(e.target.value);
                        w.view.fov = fov;
                        const cam = w.r3f?.camera as THREE.PerspectiveCamera | undefined;
                        if (cam?.isPerspectiveCamera) {
                          cam.fov = fov;
                          cam.updateProjectionMatrix();
                        }
                        w.r3f?.invalidate();
                        tryLocalStorageSet(fovStorageKey, String(fov));
                        w.update();
                      }}
                      onClick={(e) => e.stopPropagation()}
                      className={cn(
                        "w-16 accent-white cursor-pointer",
                        "appearance-none bg-transparent [&::-webkit-slider-runnable-track]:rounded-full [&::-webkit-slider-runnable-track]:bg-white/50 [&::-moz-range-track]:bg-white/50 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:h-3.5 [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white",
                      )}
                    />
                  </div>
                )}

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
                  items={mapKeys.map((key) => ({ key, value: key }))}
                  onValueChange={(key) => {
                    if (!key) return;
                    w.setCanvasFade(true);
                    uiStoreApi.setUiMeta(w.id, (draft) => (draft.mapKey = key));
                  }}
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
                            state.saveThemeDevDebounced();
                          }}
                          onBlur={() => {
                            state.saveThemeDev();
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
                          delete w.pending.obstacles;
                          w.update();
                        }
                      }}
                    >
                      update obstacles
                    </button>
                  </>
                )}

                <button
                  type="button"
                  className="w-full cursor-pointer text-xs bg-slate-700 hover:bg-slate-600 text-slate-200 rounded px-2 py-0.5"
                  onClick={(e) => {
                    e.stopPropagation();
                    w.debug.logGPUInfo = true;
                    w.view.forceUpdate();
                  }}
                >
                  log gpu info
                </button>

                <div
                  className="flex items-center gap-1 px-2 py-1 text-xs text-slate-400 cursor-pointer hover:text-slate-200"
                  onClick={(e) => {
                    e.stopPropagation();
                    state.debugOpen = !state.debugOpen;
                    tryLocalStorageSet(debugStorageKey, String(state.debugOpen));
                    state.update();
                  }}
                >
                  {state.debugOpen ? <CaretDownIcon className="size-3" /> : <CaretRightIcon className="size-3" />}
                  debug
                </div>
                {state.debugOpen && (
                  <div className="px-2 pb-1 grid grid-cols-2 gap-0.5">
                    {debugItems.map((item) => (
                      <button
                        key={item}
                        type="button"
                        className={cn(
                          "text-xs px-1.5 py-0.5 rounded cursor-pointer text-left",
                          isDebugActive(item)
                            ? "text-green-400 bg-slate-700"
                            : "text-slate-400 hover:bg-slate-700 hover:text-slate-200",
                        )}
                        onClick={(e) => {
                          e.stopPropagation();
                          onDebugToggle(item);
                        }}
                      >
                        {item}
                      </button>
                    ))}
                  </div>
                )}
              </Menu.Popup>
            </Menu.Positioner>
          </Menu.Portal>
        </Menu.Root>

        <AnimatePresence>
          {[...toastKeys, ...toggleToastKeys].map((key) => (
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

      <RoomHitModal
        open={state.debugHitOpen}
        onOpenChange={(open) => state.set({ debugHitOpen: open })}
        container={w.rootEl}
      />
      <GeomorphGraphsModal
        open={state.gmGraphsOpen}
        onOpenChange={(open) => state.set({ gmGraphsOpen: open })}
        container={w.rootEl}
      />
      {w.npc && (
        <SkinDebugModal
          open={state.skinDebugOpen}
          onOpenChange={(open) => state.set({ skinDebugOpen: open })}
          container={w.rootEl}
        />
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
  dragged: boolean;
  menuOpen: boolean;
  themeEditorRef: HTMLTextAreaElement;
  toastTs: Record<string, number>;
  y: number;
  themeEditorOpen: boolean;
  debugOpen: boolean;
  minY: number;
  getMaxY(): number;
  getClampedY(y: number): number;
  onResize(): void;
  persistY(): void;
  saveThemeDev(): Promise<void>;
  saveThemeDevDebounced(): void;
};

const storageKey = (id: string) => `world-context-menu-y-${id}`;
const themeEditorStorageKey = "world-theme-editor-open";
const debugStorageKey = "world-debug-panel-open";
const nextCameraMode = { free: "cardinal", cardinal: "free" } as const;
const debugItems = [
  "View Pick",
  "Post FX",
  "Room Hit",
  "Graphs",
  "Skins",
  "Colliders",
  "Grid",
  "Room Lights",
  "Toggle Doors",
  "Door Normals",
  "Decor Points",
  "NavMesh",
] as const;

const selectItemClass = cn(
  "px-2 py-1 text-xs cursor-pointer text-slate-300",
  "data-highlighted:bg-slate-700 data-selected:text-green-400",
);

function MenuSelect<T extends string>({
  className,
  items,
  label,
  side = "right",
  value,
  onValueChange,
}: {
  className?: string;
  items: { key: string; value: T }[];
  /** Defaults to value */
  label?: string;
  side?: "left" | "right" | "bottom" | "top";
  value: T | null;
  onValueChange: (value: T | null) => void;
}) {
  return (
    <Select.Root value={value} onValueChange={onValueChange}>
      <Select.Trigger
        className={cn(
          "flex items-center gap-1 px-2 py-1 text-xs text-slate-300 cursor-pointer hover:bg-slate-700 w-full",
          className,
        )}
      >
        <Select.Value placeholder={label}>
          {label ?? items.find((item) => item.value === value)?.key ?? label}
        </Select.Value>
      </Select.Trigger>
      <Select.Portal>
        <Select.Positioner
          className="z-50"
          sideOffset={4}
          side={side}
          align="start"
          collisionPadding={0}
          alignItemWithTrigger={false}
        >
          <Select.Popup className="bg-slate-800 border border-slate-700 rounded shadow-lg py-1 max-h-60 overflow-auto">
            <Select.List>
              {items.map(({ key, value }) => (
                <Select.Item key={key} value={value} className={selectItemClass}>
                  <Select.ItemText>{key}</Select.ItemText>
                </Select.Item>
              ))}
            </Select.List>
          </Select.Popup>
        </Select.Positioner>
      </Select.Portal>
    </Select.Root>
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
