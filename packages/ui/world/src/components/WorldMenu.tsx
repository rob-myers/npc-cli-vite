import { Menu } from "@base-ui/react/menu";
import { Select } from "@base-ui/react/select";
import { Slider } from "@base-ui/react/slider";
import { UiContext } from "@npc-cli/ui-sdk/UiContext";
import { cn, Spinner, useStateRef } from "@npc-cli/util";
import { hashJson, tryLocalStorageGetParsed, tryLocalStorageSet } from "@npc-cli/util/legacy/generic";
import {
  ArrowsClockwiseIcon,
  ArrowsOutIcon,
  CaretDownIcon,
  CaretRightIcon,
  EyeIcon,
  EyeSlashIcon,
  GlobeStandIcon,
  GpsIcon,
  GpsSlashIcon,
  type Icon,
  MagnifyingGlassIcon,
  PauseIcon,
  PencilSimpleIcon,
  PlayIcon,
  SunIcon,
  TrashIcon,
} from "@phosphor-icons/react";
import debounce from "debounce";
import { AnimatePresence, motion, useDragControls, useMotionValue } from "motion/react";
import { useContext, useEffect, useRef, useState } from "react";
import type * as THREE from "three/webgpu";
import { WorldThemeSchema } from "../assets.schema";
import {
  brightnessStorageKey,
  defaultAmbientIntensity,
  defaultDesktopFov,
  defaultDynamicLightIntensity,
  defaultDynamicLightRadius,
  defaultRoomLightIntensity,
  fovStorageKey,
  maxDynamicLightRadius,
  pickOpenDoorsKey,
} from "../const";
import { GeomorphGraphsModal, LightMapModal, RoomHitModal, SkinsModal } from "../service/debug";
import { queryClientApi } from "../service/query-client";
import { WorldContext } from "./world-context";

export function WorldMenu() {
  const { uiStoreApi } = useContext(UiContext);

  const w = useContext(WorldContext);
  const mapKeys = Object.keys(w.assets?.map ?? {});
  const npcKeys = Object.keys(w.n ?? {});

  const state = useStateRef(
    (): State => ({
      debugHitOpen: false,
      debugOpen: tryLocalStorageGetParsed(debugStorageKey) === true,
      dragged: false,
      gmGraphsOpen: false,
      skinDebugOpen: false,
      lightMapOpen: false,
      menuOpen: false,
      playerOpen: tryLocalStorageGetParsed(playerOpenStorageKey) === true,
      minY: 40,
      themeEditorOpen: tryLocalStorageGetParsed(themeEditorStorageKey) === true,
      themeEditorRef: null as any,
      toastTs: {} as Record<string, number>,
      y: tryLocalStorageGetParsed<number>(storageKey(w.id)) ?? 40,
      menuWidth: tryLocalStorageGetParsed<number>(menuWidthStorageKey(w.id)) ?? 288,
      menuHeight: tryLocalStorageGetParsed<number>(menuHeightStorageKey(w.id)) ?? 288,
      resizing: false,

      getMaxY() {
        return Math.max(state.minY, (w.rootEl?.clientHeight ?? Infinity) - 120);
      },
      getClampedY(y: number) {
        return Math.min(state.getMaxY(), Math.max(state.minY, y));
      },
      getMaxMenuWidth() {
        return Math.max(minMenuWidth, (w.rootEl?.clientWidth ?? Infinity) - 32);
      },
      getClampedMenuWidth(width: number) {
        return Math.min(state.getMaxMenuWidth(), Math.max(minMenuWidth, width));
      },
      getMaxMenuHeight() {
        return Math.max(minMenuHeight, (w.rootEl?.clientHeight ?? Infinity) - 160);
      },
      getClampedMenuHeight(height: number) {
        return Math.min(state.getMaxMenuHeight(), Math.max(minMenuHeight, height));
      },
      onResize() {
        y.set(state.getClampedY(y.get()));
        state.menuWidth = state.getClampedMenuWidth(state.menuWidth);
        state.menuHeight = state.getClampedMenuHeight(state.menuHeight);
        state.update();
      },
      onResizeMouseDown(e) {
        e.stopPropagation();
        const startX = e.clientX;
        const startY = e.clientY;
        const startWidth = state.menuWidth;
        const startHeight = state.menuHeight;
        state.resizing = true;
        const onMove = (ev: MouseEvent) => {
          // popup opens rightward/downward from the trigger, so dragging the corner out grows it
          state.menuWidth = state.getClampedMenuWidth(startWidth + (ev.clientX - startX));
          state.menuHeight = state.getClampedMenuHeight(startHeight + (ev.clientY - startY));
          state.update();
        };
        const onUp = () => {
          state.resizing = false;
          state.persistMenuSize();
          window.removeEventListener("mousemove", onMove);
          window.removeEventListener("mouseup", onUp);
        };
        window.addEventListener("mousemove", onMove);
        window.addEventListener("mouseup", onUp);
      },
      onResizeTouchStart(e) {
        e.stopPropagation();
        const t = e.touches[0];
        if (!t) return;
        const startX = t.clientX;
        const startY = t.clientY;
        const startWidth = state.menuWidth;
        const startHeight = state.menuHeight;
        state.resizing = true;
        const onMove = (ev: TouchEvent) => {
          const t2 = ev.touches[0];
          if (t2) {
            state.menuWidth = state.getClampedMenuWidth(startWidth + (t2.clientX - startX));
            state.menuHeight = state.getClampedMenuHeight(startHeight + (t2.clientY - startY));
            state.update();
          }
        };
        const onEnd = () => {
          state.resizing = false;
          state.persistMenuSize();
          document.removeEventListener("touchmove", onMove, { capture: true });
          document.removeEventListener("touchend", onEnd, { capture: true });
        };
        document.addEventListener("touchmove", onMove, { capture: true });
        document.addEventListener("touchend", onEnd, { capture: true });
      },
      persistY() {
        tryLocalStorageSet(storageKey(w.id), `${state.getClampedY(y.get())}`);
      },
      persistMenuSize() {
        tryLocalStorageSet(menuWidthStorageKey(w.id), `${state.menuWidth}`);
        tryLocalStorageSet(menuHeightStorageKey(w.id), `${state.menuHeight}`);
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
  const dragControls = useDragControls();

  const isDebugActive = (item: string) => {
    switch (item) {
      case "View Pick":
        return w.view.objectPick?.value === 1;
      case "Post FX":
        return w.view.postProcessing ?? false;
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
        w.view.setPostProcessingEnabled();
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
      case "Light Map":
        state.set({ menuOpen: false, lightMapOpen: true });
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
  const zoomingByTouch = w.view.controls?.touchMode === "zoom";
  const introEnabled = w.player.introEnabled;
  // click replays the intro, whereas long press disables it
  const introPress = useRef<{ timeoutId?: ReturnType<typeof setTimeout>; longPressed: boolean }>({
    longPressed: false,
  });
  /** Buttons whose press should not dismiss the menu as an "outside press" */
  const keepMenuOpenEl = useRef<HTMLDivElement>(null);
  const onIntroPressStart = () => {
    introPress.current.longPressed = false;
    introPress.current.timeoutId = setTimeout(() => {
      introPress.current.longPressed = true;
      w.player.setIntroEnabled(false);
    }, introLongPressMs);
  };
  const onIntroPressEnd = (cancelled = false) => {
    clearTimeout(introPress.current.timeoutId);
    if (cancelled === false && introPress.current.longPressed === false) {
      w.player.setIntroEnabled(true);
    }
  };

  return (
    <>
      <motion.div
        className="outline-none absolute top-0 left-0.5 z-10 touch-none select-none flex flex-col gap-0.5 max-w-full overflow-x-hidden"
        style={{ y }}
        drag="y"
        dragListener={false}
        dragControls={dragControls}
        onPointerDown={(e) => dragControls.start(e)}
        dragConstraints={{ top: state.minY, bottom: state.getMaxY() }}
        dragMomentum={false}
        onDragStart={() => (state.dragged = true)}
        onDragEnd={() => {
          state.persistY();
          requestAnimationFrame(() => (state.dragged = false));
        }}
      >
        <div className="flex flex-col gap-0.5" style={{ zoom: w.touchDevice ? touchDeviceZoom : undefined }}>
          {/* main menu */}
          <Menu.Root
            open={state.menuOpen}
            onOpenChange={(open, { reason, event }) => {
              if (open) {
                state.set({ menuOpen: true });
              } else if (
                reason === "outside-press" &&
                keepMenuOpenEl.current?.contains(event.target as Node) === true
              ) {
                // panning to the player, or pausing, should not close the menu
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
              <div className="outline-width-1 w-fit grid grid-flow-col items-center bg-gray-800 text-white">
                <div className="grid place-items-center size-9">
                  <GlobeStandIcon className="size-5" weight="bold" />
                </div>
                {pendingKeys.length > 0 && <Spinner className="mr-2 size-4" />}
              </div>
            </Menu.Trigger>

            <Menu.Portal container={w.rootEl} className="w-full">
              <Menu.Positioner
                className="z-50 overflow-auto max-w-[calc(100%-40px)]"
                side="right"
                sideOffset={4}
                align="start"
              >
                <Menu.Popup
                  className="relative select-none bg-slate-800/70 border border-slate-700 rounded-md shadow-lg py-1"
                  style={{ width: state.menuWidth }}
                >
                  <div
                    className={cn(
                      "flex flex-col overflow-y-auto pb-6",
                      "[&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-track]:bg-transparent",
                      "[&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-slate-600",
                    )}
                    style={{ maxHeight: state.menuHeight, scrollbarWidth: "thin" }}
                  >
                    <div className="flex flex-wrap max-w-52">
                      <div className="flex items-center gap-2 px-2 py-1.5 text-xs text-slate-300">
                        <BrightnessPie
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
                          className="w-16 accent-white cursor-pointer appearance-none bg-transparent [&::-webkit-slider-runnable-track]:rounded-full [&::-webkit-slider-runnable-track]:bg-white/50 [&::-moz-range-track]:bg-white/50 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:h-3.5 [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white"
                        />
                      </div>

                      {w.view && (
                        <div className="flex items-center gap-2 px-2 py-1.5 text-xs text-slate-300">
                          <ArrowsOutIcon
                            className="size-4 text-white cursor-pointer shrink-0"
                            onClick={() => {
                              w.view.fov = defaultDesktopFov;
                              const cam = w.r3f?.camera as THREE.PerspectiveCamera | undefined;
                              if (cam?.isPerspectiveCamera) {
                                cam.fov = defaultDesktopFov;
                                cam.updateProjectionMatrix();
                              }
                              w.r3f?.invalidate();
                              tryLocalStorageSet(fovStorageKey, String(defaultDesktopFov));
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
                            className="w-16 accent-white cursor-pointer appearance-none bg-transparent [&::-webkit-slider-runnable-track]:rounded-full [&::-webkit-slider-runnable-track]:bg-white/50 [&::-moz-range-track]:bg-white/50 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:h-3.5 [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white"
                          />
                        </div>
                      )}
                    </div>
                    {w.view && (
                      <Menu.Item
                        className="flex justify-between items-center gap-2 px-2 py-1 text-xs text-slate-300 bg-slate-700 cursor-pointer"
                        closeOnClick={false}
                        onClick={() => w.view.setCameraMode(nextCameraMode[w.view.cameraMode])}
                      >
                        <div>camera: {w.view.cameraMode}</div>
                        <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                          <div className={cn(w.view.cameraMode === "free" && "pointer-events-none opacity-40")}>
                            <MenuSelect
                              side="bottom"
                              value={String(w.view.cameraDirections)}
                              items={cardinalDirItems}
                              onValueChange={(v) => {
                                if (v) w.view.setNumCardinalDirections(Number(v));
                              }}
                            />
                          </div>
                          <span title="reset camera" onClick={() => w.view.resetCamera()}>
                            <ArrowsClockwiseIcon className="size-3.5 cursor-pointer hover:text-white" />
                          </span>
                        </div>
                      </Menu.Item>
                    )}

                    <div className="flex">
                      <div className="text-white text-xs flex items-center px-2">map:</div>
                      <MenuSelect
                        label={w.mapKey}
                        value={w.mapKey}
                        items={mapKeys.map((key) => ({ key, value: key }))}
                        side="bottom"
                        onValueChange={async (key) => {
                          if (!key || key === w.mapKey) return;
                          await w.setCanvasOpacity(0);
                          w.e.onChangeMap(); // persist + remove whilst the old map still exists
                          uiStoreApi.setUiMeta(w.id, (draft) => (draft.mapKey = key));
                        }}
                      />
                    </div>
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
                          edit theme
                        </div>
                        {state.themeEditorOpen && (
                          <div className="p-2 pt-0 flex flex-col gap-1">
                            <textarea
                              key={w.themeKey}
                              ref={state.ref("themeEditorRef")}
                              className="w-44 h-32 select-text bg-slate-900 text-slate-200 text-[10px] font-mono p-1 rounded border border-slate-600 resize-y"
                              defaultValue={JSON.stringify(w.getTheme(), null, 2)}
                              onKeyDown={(e) => e.stopPropagation()}
                              onClick={(e) => e.stopPropagation()}
                              onChange={() => {
                                const parsed = WorldThemeSchema.safeParse(
                                  JSON.parse(state.themeEditorRef?.value ?? ""),
                                );
                                if (parsed.success && w.assets) {
                                  (w.assets.theme ??= {})[w.themeKey] = parsed.data;
                                  w.e.onChangeTheme();
                                  state.saveThemeDevDebounced();
                                }
                              }}
                              onBlur={() => {
                                state.saveThemeDev();
                              }}
                            />
                          </div>
                        )}
                      </>
                    )}

                    <div
                      className="max-w-80 flex flex-wrap items-end gap-1 px-2 py-1"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <div className="w-24">
                        <LightsMenuSlider
                          label="Room lights"
                          value={w.view.roomLightIntensity?.value ?? defaultRoomLightIntensity}
                          defaultValue={defaultRoomLightIntensity}
                          onChange={(next) => w.view.setRoomLightIntensity(next)}
                        />
                      </div>

                      <div className="flex gap-1">
                        <LightsIconButton
                          active={w.view.roomLightEditingEnabled}
                          icon={PencilSimpleIcon}
                          title="Edit (long press)"
                          onClick={() => w.view.toggleRoomLightEditing()}
                        />
                        <LightsIconButton
                          active={w.view.roomLight?.roomLightingEnabled.value === 1}
                          icon={w.view.roomLight?.roomLightingEnabled.value === 1 ? EyeIcon : EyeSlashIcon}
                          title="Lights shown"
                          onClick={() => {
                            w.view.setPostProcessingEnabled(true);
                            w.view.setRoomLightingEnabled();
                            state.update();
                          }}
                        />
                        <LightsIconButton
                          danger
                          icon={TrashIcon}
                          title="Clear lighting"
                          onClick={() => w.view.resetAllRooms()}
                        />
                      </div>
                    </div>

                    <div
                      className="flex items-center gap-1 px-2 py-1 text-xs text-slate-400 cursor-pointer hover:text-slate-200"
                      onClick={(e) => {
                        e.stopPropagation();
                        state.playerOpen = !state.playerOpen;
                        tryLocalStorageSet(playerOpenStorageKey, String(state.playerOpen));
                        state.update();
                      }}
                    >
                      {state.playerOpen ? <CaretDownIcon className="size-3" /> : <CaretRightIcon className="size-3" />}
                      player
                    </div>

                    {state.playerOpen && (
                      <div
                        className="max-w-80 flex flex-wrap items-end gap-1 px-2 py-1"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <div className="w-24 flex items-stretch">
                          <MenuSelect
                            side="bottom"
                            className="border rounded-l border-white/30 border-r-0"
                            label={truncateLabel(w.player?.key ?? "no npc", 10)}
                            value={w.player?.key ?? ""}
                            items={npcKeys.map((k) => ({ key: k, value: k }))}
                            onValueChange={(v) => v && w.player.setKey(v)}
                          />
                          <button
                            type="button"
                            title="Cycle player"
                            className="grid place-items-center border rounded-r border-l-0 border-white/30 px-1.5 text-slate-300 cursor-pointer hover:bg-slate-700"
                            onClick={(e) => {
                              e.stopPropagation();
                              if (npcKeys.length === 0) return;
                              const currentIdx = npcKeys.indexOf(w.player?.key ?? "");
                              w.player.setKey(npcKeys[(currentIdx + 1) % npcKeys.length]);
                            }}
                          >
                            <CaretRightIcon className="size-3" />
                          </button>
                        </div>

                        <div className="w-20">
                          <LightsMenuSlider
                            label="radius"
                            min={0.2}
                            max={maxDynamicLightRadius}
                            step={0.1}
                            value={w.view.dynamicLight?.radius ?? defaultDynamicLightRadius}
                            defaultValue={defaultDynamicLightRadius}
                            onChange={(next) => w.view.setDynamicLightRadius(next)}
                          />
                        </div>
                        <div className="w-20">
                          <LightsMenuSlider
                            label="lit"
                            value={w.view.dynamicLight?.intensity?.value ?? defaultDynamicLightIntensity}
                            defaultValue={defaultDynamicLightIntensity}
                            onChange={(next) => w.view.setDynamicLightIntensity(next)}
                          />
                        </div>
                      </div>
                    )}

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
                      <>
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
                      </>
                    )}

                    {import.meta.env.DEV && (
                      <div className="flex mt-2">
                        <button
                          type="button"
                          className="w-full flex items-center justify-center gap-1.5 cursor-pointer text-xs bg-slate-700/70 hover:bg-slate-600 text-slate-200 border border-slate-600 px-2 py-1"
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
                              w.setNextPending({ obstacles: false });
                            }
                          }}
                        >
                          obstacles
                          <ArrowsClockwiseIcon className="size-3.5" />
                        </button>

                        <button
                          type="button"
                          className="w-full flex items-center justify-center gap-1.5 cursor-pointer text-xs bg-slate-700/70 hover:bg-slate-600 text-slate-200 border border-slate-600 px-2 py-1"
                          onClick={async (e) => {
                            e.stopPropagation();
                            try {
                              const res = await fetch("/api/gen-assets-json", {
                                method: "POST",
                              });
                              if (!res.ok) throw new Error(`HTTP ${res.status}`);
                              await queryClientApi.queryClient.invalidateQueries({
                                exact: false,
                                queryKey: w.worldQueryPrefix,
                              });
                            } catch (err) {
                              console.error("Failed to update assets:", err);
                            }
                          }}
                        >
                          assets
                          <ArrowsClockwiseIcon className="size-3.5" />
                        </button>
                      </div>
                    )}
                  </div>

                  {/* drag to resize the popup — bottom-right corner, since it opens rightward/downward from the trigger */}
                  <div
                    className="absolute bottom-0 right-0 size-5 touch-none cursor-nwse-resize"
                    onMouseDown={state.onResizeMouseDown}
                    onTouchStart={state.onResizeTouchStart}
                  >
                    <div
                      className={cn(
                        "absolute bottom-1 right-1 size-2.5 border-b-2 border-r-2 border-slate-600 rounded-br",
                        state.resizing && "border-slate-400",
                      )}
                    />
                  </div>
                </Menu.Popup>
              </Menu.Positioner>
            </Menu.Portal>
          </Menu.Root>

          {w.view && (
            <div className="outline-width-1 flex flex-col items-center gap-1.5 bg-gray-800 text-white px-1.5 py-2 w-9">
              <button type="button" className="cursor-pointer" onClick={() => w.view.setAmbientIntensity(0.4)}>
                <SunIcon className="size-4 shrink-0" />
              </button>
              <Slider.Root
                orientation="vertical"
                min={0}
                max={1}
                step={0.01}
                value={ambientValueToSliderPos(w.view.ambientIntensity ?? defaultAmbientIntensity)}
                onValueChange={(v) => w.view.setAmbientIntensity(ambientSliderPosToValue(v))}
              >
                <Slider.Control
                  className="h-20 w-4 flex justify-center cursor-pointer touch-none"
                  onPointerDown={(e) => e.stopPropagation()}
                >
                  <Slider.Track className="relative w-1 h-full rounded-full bg-white/50">
                    <Slider.Indicator className="rounded-full bg-white" />
                    <Slider.Thumb className="size-3.5 rounded-full bg-white outline-none" />
                  </Slider.Track>
                </Slider.Control>
              </Slider.Root>
            </div>
          )}

          {/* `contents` so these still lay out as siblings, whilst sharing one ref */}
          <div ref={keepMenuOpenEl} className="contents">
            {/* pan to the player: long press disables it on load */}
            <div
              className="cursor-pointer outline-width-1 grid place-items-center bg-gray-800 text-white hover:bg-gray-700 size-9 touch-none select-none"
              onPointerDown={onIntroPressStart}
              onPointerUp={() => onIntroPressEnd()}
              onPointerLeave={() => onIntroPressEnd(true)}
              onContextMenu={(e) => e.preventDefault()}
            >
              {introEnabled ? (
                <GpsIcon className="size-5" alt="pan to the player (long press to disable on load)" weight="bold" />
              ) : (
                <GpsSlashIcon
                  className="size-5 text-red-400"
                  alt="pan to the player (disabled on load)"
                  weight="bold"
                />
              )}
            </div>

            {/* play/pause */}
            <button
              className="cursor-pointer outline-width-1 grid place-items-center bg-gray-800 text-white cursor-pointerhover:bg-gray-700 size-9"
              onClick={() => w.setDisabled()}
            >
              {w.disabled ? (
                <PlayIcon className="size-5" weight="bold" />
              ) : (
                <PauseIcon className="size-5" weight="bold" />
              )}
            </button>
          </div>

          {/* two fingers rotate by default, and zoom after a long press */}
          {zoomingByTouch === true && (
            <div className="outline-width-1 grid place-items-center bg-gray-800 text-white pointer-events-none select-none size-9">
              <MagnifyingGlassIcon className="size-5" alt="two fingers zoom" weight="bold" />
            </div>
          )}
        </div>

        <div>
          <AnimatePresence>
            {[...toastKeys, ...toggleToastKeys].map((key) => (
              <motion.div
                key={key}
                className="bg-zinc-800/90 text-slate-300 text-xs p-3 py-1.5 wrap-break-word"
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
      <LightMapModal
        open={state.lightMapOpen}
        onOpenChange={(open) => state.set({ lightMapOpen: open })}
        container={w.rootEl}
      />
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

// non-uniform ambient slider: the bottom 1/3 of the value range takes up 2/3 of the slider's
// travel, so low (dim) values are finer-grained to adjust than high ones
const ambientSliderBreak = 2 / 3;
const ambientValueBreak = 1 / 3;

/** Slider position (0..1, uniform) -> actual ambient value (0..1, non-uniform) */
function ambientSliderPosToValue(pos: number) {
  return pos <= ambientSliderBreak
    ? (pos / ambientSliderBreak) * ambientValueBreak
    : ambientValueBreak + ((pos - ambientSliderBreak) / (1 - ambientSliderBreak)) * (1 - ambientValueBreak);
}

/** Inverse of `ambientSliderPosToValue` — actual ambient value -> slider position */
function ambientValueToSliderPos(value: number) {
  return value <= ambientValueBreak
    ? (value / ambientValueBreak) * ambientSliderBreak
    : ambientSliderBreak + ((value - ambientValueBreak) / (1 - ambientValueBreak)) * (1 - ambientSliderBreak);
}

/** Small square icon button used to pack several toggles/actions into one row in the lights menu */
function LightsIconButton({
  active,
  danger,
  icon: IconCmp,
  title,
  onClick,
}: {
  active?: boolean;
  /** Styles as a destructive action (e.g. clear) instead of an on/off toggle */
  danger?: boolean;
  icon: Icon;
  title: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className={cn(
        "grid place-items-center rounded cursor-pointer size-6",
        danger
          ? "text-red-300 hover:bg-red-900/40"
          : active
            ? "bg-slate-700 text-white"
            : "text-slate-500 hover:bg-slate-700",
      )}
    >
      <IconCmp className={cn("size-3.5", danger && "scale-110")} weight={active ? "fill" : "regular"} />
    </button>
  );
}

/** One labelled slider row in the lights menu */
function LightsMenuSlider({
  label,
  min = 0,
  max = 1,
  step = 0.05,
  value,
  defaultValue,
  onChange,
}: {
  label: string;
  min?: number;
  max?: number;
  step?: number;
  value: number;
  defaultValue?: number;
  onChange: (next: number) => void;
}) {
  return (
    <div className="flex flex-col gap-0.5 px-2 py-0.5">
      <span
        className={cn("text-[10px] text-slate-400", defaultValue !== undefined && "cursor-pointer hover:underline")}
        onClick={(e) => {
          if (defaultValue === undefined) {
            return;
          }
          e.stopPropagation();
          onChange(defaultValue);
        }}
      >
        {label}
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        onClick={(e) => e.stopPropagation()}
        className="w-14 accent-white cursor-pointer appearance-none bg-transparent [&::-webkit-slider-runnable-track]:rounded-full [&::-webkit-slider-runnable-track]:bg-white/50 [&::-moz-range-track]:bg-white/50 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:h-3.5 [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white"
      />
    </div>
  );
}

export type State = {
  debugHitOpen: boolean;
  gmGraphsOpen: boolean;
  skinDebugOpen: boolean;
  lightMapOpen: boolean;
  dragged: boolean;
  menuOpen: boolean;
  /** Collapsible "player" section within the main menu */
  playerOpen: boolean;
  themeEditorRef: HTMLTextAreaElement;
  toastTs: Record<string, number>;
  y: number;
  themeEditorOpen: boolean;
  debugOpen: boolean;
  minY: number;
  /** Width (px) of the main menu popup — resizable, persisted */
  menuWidth: number;
  /** Height (px) of the main menu popup's scrollable body — resizable, persisted */
  menuHeight: number;
  resizing: boolean;
  getMaxY(): number;
  getClampedY(y: number): number;
  getMaxMenuWidth(): number;
  getClampedMenuWidth(width: number): number;
  getMaxMenuHeight(): number;
  getClampedMenuHeight(height: number): number;
  onResize(): void;
  onResizeMouseDown(e: React.MouseEvent): void;
  onResizeTouchStart(e: React.TouchEvent): void;
  persistY(): void;
  persistMenuSize(): void;
  saveThemeDev(): Promise<void>;
  saveThemeDevDebounced(): void;
};

/** Enlarges the menu controls on touch devices */
const touchDeviceZoom = 1.25;

const storageKey = (id: string) => `world-context-menu-y-${id}`;
const menuWidthStorageKey = (id: string) => `world-context-menu-width-${id}`;
const menuHeightStorageKey = (id: string) => `world-context-menu-height-${id}`;
const minMenuWidth = 200;
const minMenuHeight = 120;
const themeEditorStorageKey = "world-theme-editor-open";
const debugStorageKey = "world-debug-panel-open";
const playerOpenStorageKey = "world-player-section-open";
/** Long press the intro button to disable it, since a click always replays it */
const introLongPressMs = 500;
const nextCameraMode = { free: "cardinal", cardinal: "free" } as const;
const cardinalDirItems = [1, 2, 4, 8].map((n) => ({ key: String(n), value: String(n) }));
const debugItems = [
  "View Pick",
  "Post FX",
  "Room Hit",
  "Graphs",
  "Skins",
  "Light Map",
  "Colliders",
  "Grid",
  "Room Lights",
  "Toggle Doors",
  "Door Normals",
  "Decor Points",
  "NavMesh",
] as const;

/** Shorten a select trigger's displayed label (e.g. an npc/symbol key) to fit the compact lights grid */
const truncateLabel = (label: string, max = 5) => (label.length > max ? `${label.slice(0, max)}…` : label);

const selectItemClassName = cn(
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
  const w = useContext(WorldContext);

  return (
    <Select.Root value={value} onValueChange={onValueChange}>
      <Select.Trigger
        className={cn(
          "flex items-center gap-1 px-2 py-1 text-xs text-slate-300 cursor-pointer hover:bg-slate-700 w-full min-w-0",
          className,
        )}
      >
        <Select.Value placeholder={label} className="truncate">
          {label ?? items.find((item) => item.value === value)?.key ?? label}
        </Select.Value>
      </Select.Trigger>
      <Select.Portal container={w.rootEl}>
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
                <Select.Item key={key} value={value} className={selectItemClassName}>
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
