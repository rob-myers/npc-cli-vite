import { Menu } from "@base-ui/react/menu";
import { Select } from "@base-ui/react/select";
import { UiContext } from "@npc-cli/ui-sdk/UiContext";
import { cn, Spinner, useStateRef } from "@npc-cli/util";
import { hashJson, tryLocalStorageGetParsed, tryLocalStorageSet } from "@npc-cli/util/legacy/generic";
import {
  ArrowsOutIcon,
  CaretDownIcon,
  CaretRightIcon,
  CircleDashedIcon,
  GlobeStandIcon,
  MagnifyingGlassIcon,
  PauseIcon,
  PlayIcon,
  SunIcon,
} from "@phosphor-icons/react";
import debounce from "debounce";
import { AnimatePresence, motion, useMotionValue } from "motion/react";
import { useContext, useEffect, useRef, useState } from "react";
import type * as THREE from "three/webgpu";
import { WorldThemeSchema } from "../assets.schema";
import {
  brightnessStorageKey,
  defaultFov,
  defaultXzCircleRadius,
  fovStorageKey,
  pickOpenDoorsKey,
  xzCircleRadiusStorageKey,
} from "../const";
import { GeomorphGraphsModal, RoomHitModal, SkinsModal } from "../service/debug";
import { queryClientApi } from "../service/query-client";
import { WorldContext } from "./world-context";

export function WorldMenu() {
  const { uiStoreApi } = useContext(UiContext);

  const w = useContext(WorldContext);
  const mapKeys = Object.keys(w.assets?.map ?? {});
  const themeKeys = Object.keys(w.assets?.theme ?? {});
  /** Bigger touch targets on mobile */
  const big = w.touchDevice;

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
        return w.view?.postProcessing ?? false;
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
      case "Focus Outline":
        return w.view?.lightPostprocess.showBorder.value === 1;
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
        state.set({ menuOpen: false, debugHitOpen: true });
        break;
      case "Graphs":
        state.set({ menuOpen: false, gmGraphsOpen: true });
        break;
      case "Skins":
        state.set({ menuOpen: false, skinDebugOpen: true });
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
      case "Focus Outline":
        w.view.lightPostprocess.setShowBorder(w.view.lightPostprocess.showBorder.value !== 1);
        w.r3f?.invalidate();
        state.update();
        break;
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
            <div className={cn("flex items-center gap-2 bg-gray-800 text-white p-2", big && "p-3")}>
              <GlobeStandIcon className={cn("size-5", big && "size-6")} weight="bold" />
              {pendingKeys.length > 0 && <Spinner className={cn("size-4", big && "size-5")} />}
            </div>
          </Menu.Trigger>

          {(extraZoomActive || readyForExtraZoom) && (
            <div
              className={cn(
                "pointer-events-none flex justify-center rounded p-1 select-none",
                big && "p-2",
                extraZoomActive ? "bg-gray-800/90 text-white" : "bg-gray-800/50 text-gray-400",
              )}
            >
              <MagnifyingGlassIcon size={big ? 26 : 22} weight="bold" />
            </div>
          )}

          <Menu.Portal>
            <Menu.Positioner className="z-50" sideOffset={4} align="start">
              <Menu.Popup
                className={cn("bg-slate-800 border border-slate-700 rounded-md shadow-lg py-1", big && "py-2")}
              >
                <div className={cn("flex flex-wrap", big ? "max-w-72" : "max-w-52")}>
                  <div
                    className={cn(
                      "flex items-center gap-2 px-2 py-1.5 text-xs text-slate-300",
                      big && "gap-3 px-3 py-2 text-sm",
                    )}
                  >
                    <BrightnessPie
                      big={big}
                      ratio={brightnessToRatio(w.brightness)}
                      onClick={() => {
                        const brightness = 2;
                        w.set({ brightness });
                        tryLocalStorageSet(brightnessStorageKey, `${brightness}`);
                      }}
                    />
                    <input
                      type="range"
                      min="1"
                      max="4"
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
                        big &&
                          "w-24 [&::-webkit-slider-thumb]:h-5 [&::-webkit-slider-thumb]:w-5 [&::-moz-range-thumb]:h-5 [&::-moz-range-thumb]:w-5",
                      )}
                    />
                  </div>

                  {w.view && (
                    <div
                      className={cn(
                        "flex items-center gap-2 px-2 py-1.5 text-xs text-slate-300",
                        big && "gap-3 px-3 py-2 text-sm",
                      )}
                    >
                      <ArrowsOutIcon
                        className={cn("size-4 text-white cursor-pointer shrink-0", big && "size-5")}
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
                          big &&
                            "w-24 [&::-webkit-slider-thumb]:h-5 [&::-webkit-slider-thumb]:w-5 [&::-moz-range-thumb]:h-5 [&::-moz-range-thumb]:w-5",
                        )}
                      />
                    </div>
                  )}

                  {w.view && (
                    <div
                      className={cn(
                        "flex items-center gap-2 px-2 py-1.5 text-xs text-slate-300",
                        big && "gap-3 px-3 py-2 text-sm",
                      )}
                    >
                      <CircleDashedIcon
                        className={cn("size-4 text-white cursor-pointer shrink-0", big && "size-5")}
                        onClick={() => {
                          w.view.defaultLightRadius = defaultXzCircleRadius;
                          tryLocalStorageSet(xzCircleRadiusStorageKey, String(defaultXzCircleRadius));
                          w.update();
                        }}
                      />
                      <input
                        type="range"
                        min="0.5"
                        max="8"
                        step="0.5"
                        value={w.view.defaultLightRadius}
                        onChange={(e) => {
                          const radius = Number(e.target.value);
                          w.view.defaultLightRadius = radius;
                          tryLocalStorageSet(xzCircleRadiusStorageKey, String(radius));
                          w.update();
                        }}
                        onClick={(e) => e.stopPropagation()}
                        className={cn(
                          "w-16 accent-white cursor-pointer",
                          "appearance-none bg-transparent [&::-webkit-slider-runnable-track]:rounded-full [&::-webkit-slider-runnable-track]:bg-white/50 [&::-moz-range-track]:bg-white/50 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:h-3.5 [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white",
                          big &&
                            "w-24 [&::-webkit-slider-thumb]:h-5 [&::-webkit-slider-thumb]:w-5 [&::-moz-range-thumb]:h-5 [&::-moz-range-thumb]:w-5",
                        )}
                      />
                    </div>
                  )}
                </div>
                {w.view && (
                  <Menu.Item
                    className={cn(
                      "flex justify-between items-center gap-2 px-2 py-1 text-xs text-slate-300 bg-slate-700 cursor-pointer",
                      big && "gap-3 px-3 py-2 text-sm",
                    )}
                    closeOnClick={false}
                    onClick={() => w.view.setCameraMode(nextCameraMode[w.view.cameraMode])}
                  >
                    <div>camera: {w.view.cameraMode}</div>
                    <div
                      onClick={(e) => e.stopPropagation()}
                      className={cn(w.view.cameraMode === "free" && "pointer-events-none opacity-40")}
                    >
                      <MenuSelect
                        big={big}
                        side="bottom"
                        value={String(w.view.numCardinalDirections)}
                        items={cardinalDirItems}
                        onValueChange={(v) => {
                          if (v) w.view.setNumCardinalDirections(Number(v));
                        }}
                      />
                    </div>
                  </Menu.Item>
                )}

                <div className="flex">
                  <div className="text-white text-xs flex items-center px-2">map:</div>
                  <MenuSelect
                    big={big}
                    label={w.mapKey}
                    value={w.mapKey}
                    items={mapKeys.map((key) => ({ key, value: key }))}
                    side="bottom"
                    onValueChange={(key) => {
                      if (!key || key === w.mapKey) return;
                      w.setCanvasFade(true);
                      uiStoreApi.setUiMeta(w.id, (draft) => (draft.mapKey = key));
                    }}
                  />
                </div>
                <Menu.Item
                  className={cn(
                    "flex items-center gap-2 px-2 py-1 text-xs text-slate-300 hover:bg-slate-700 cursor-pointer",
                    big && "gap-3 px-3 py-2 text-sm",
                  )}
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
                <div
                  className={cn(
                    "flex items-center gap-1 px-2 py-1 text-xs text-slate-400 cursor-pointer hover:text-slate-200",
                    big && "gap-2 px-3 py-2 text-sm",
                  )}
                  onClick={(e) => {
                    e.stopPropagation();
                    state.debugOpen = !state.debugOpen;
                    tryLocalStorageSet(debugStorageKey, String(state.debugOpen));
                    state.update();
                  }}
                >
                  {state.debugOpen ? (
                    <CaretDownIcon className={cn("size-3", big && "size-4")} />
                  ) : (
                    <CaretRightIcon className={cn("size-3", big && "size-4")} />
                  )}
                  debug
                </div>
                {state.debugOpen && (
                  <>
                    <div className={cn("px-2 pb-1 grid grid-cols-2 gap-0.5", big && "gap-1.5")}>
                      {debugItems.map((item) => (
                        <button
                          key={item}
                          type="button"
                          className={cn(
                            "text-xs px-1.5 py-0.5 rounded cursor-pointer text-left",
                            big && "text-sm px-2 py-1.5",
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

                    <button
                      type="button"
                      className={cn(
                        "w-full cursor-pointer text-xs bg-slate-700 hover:bg-slate-600 text-slate-200 rounded px-2 py-0.5",
                        big && "text-sm px-3 py-1.5",
                      )}
                      onClick={(e) => {
                        e.stopPropagation();
                        w.debug.logGPUInfo = true;
                        w.view.forceUpdate();
                      }}
                    >
                      log gpu info
                    </button>
                  </>
                )}
              </Menu.Popup>
            </Menu.Positioner>
          </Menu.Portal>
        </Menu.Root>

        <div
          className={cn(
            "flex w-9 items-center justify-center bg-gray-800 text-white p-2 cursor-pointer hover:bg-gray-700",
            big && "w-12 p-3",
          )}
          onClick={() => w.setDisabled()}
        >
          {w.disabled ? (
            <PlayIcon className={cn("size-5", big && "size-6")} weight="bold" />
          ) : (
            <PauseIcon className={cn("size-5", big && "size-6")} weight="bold" />
          )}
        </div>

        <AnimatePresence>
          {[...toastKeys, ...toggleToastKeys].map((key) => (
            <motion.div
              key={key}
              className={cn("bg-gray-800/90 text-slate-300 text-xs px-2 py-1", big && "text-sm px-3 py-1.5")}
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
        <SkinsModal
          open={state.skinDebugOpen}
          onOpenChange={(open) => state.set({ skinDebugOpen: open })}
          container={w.rootEl}
        />
      )}
    </>
  );
}

/** Sun icon wi\th a pie-chart fill showing brightness ratio (0–1) */
function BrightnessPie({ ratio, onClick, big }: { ratio: number; onClick?: () => void; big?: boolean }) {
  const a = Math.min(1, Math.max(0, ratio)) * Math.PI * 2;
  return (
    <div className={cn("relative size-4 cursor-pointer", big && "size-6")} onClick={onClick}>
      <SunIcon className={cn("size-4 text-white", big && "size-6")} />
      {ratio > 0 && (
        <svg className={cn("absolute inset-0 size-4", big && "size-6")} viewBox="0 0 16 16">
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
const cardinalDirItems = [1, 2, 4, 8].map((n) => ({ key: String(n), value: String(n) }));
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
  "Focus Outline",
] as const;

const getSelectItemClass = (big?: boolean) =>
  cn(
    "px-2 py-1 text-xs cursor-pointer text-slate-300",
    "data-highlighted:bg-slate-700 data-selected:text-green-400",
    big && "px-3 py-2 text-sm",
  );

function MenuSelect<T extends string>({
  big,
  className,
  items,
  label,
  side = "right",
  value,
  onValueChange,
}: {
  big?: boolean;
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
          big && "gap-2 px-3 py-2 text-sm",
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
          <Select.Popup
            className={cn(
              "bg-slate-800 border border-slate-700 rounded shadow-lg py-1 max-h-60 overflow-auto",
              big && "max-h-80",
            )}
          >
            <Select.List>
              {items.map(({ key, value }) => (
                <Select.Item key={key} value={value} className={getSelectItemClass(big)}>
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
