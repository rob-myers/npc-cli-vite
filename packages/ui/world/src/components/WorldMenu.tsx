import { Menu } from "@base-ui/react/menu";
import { Select } from "@base-ui/react/select";
import { UiContext } from "@npc-cli/ui-sdk/UiContext";
import { cn, Spinner, type UseStateRef, useStateRef } from "@npc-cli/util";
import { hashJson } from "@npc-cli/util/legacy/generic";
import {
  ArrowsClockwiseIcon,
  ArrowsOutCardinalIcon,
  BugIcon,
  CaretDownIcon,
  CaretRightIcon,
  CrosshairSimpleIcon,
  FlashlightIcon,
  GlobeStandIcon,
  type Icon,
  MapTrifoldIcon,
  PauseIcon,
  PersonSimpleCircleIcon,
  PlayIcon,
  SunIcon,
  XIcon,
} from "@phosphor-icons/react";
import debounce from "debounce";
import { AnimatePresence, motion, useDragControls, useMotionValue } from "motion/react";
import type React from "react";
import { useContext, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { WorldThemeSchema } from "../assets.schema";
import { defaultBrightness } from "../const";
import { GeomorphGraphsModal, RoomHitModal, SkinsModal } from "../service/debug";
import { queryClientApi } from "../service/query-client";
import { getWorldStore, listWorldKeysWithMap } from "../service/storage";
import { WorldContext } from "./world-context";

export function WorldMenu() {
  const { uiStoreApi } = useContext(UiContext);

  const w = useContext(WorldContext);
  const mapKeys = Object.keys(w.assets?.map ?? {});
  const npcKeys = Object.keys(w.n ?? {});
  /** Touch gets a full-height panel with larger targets, instead of the resizable popup */
  const touch = w.touchDevice;

  const store = getWorldStore(w.key);
  const saved = store.read();
  /** Worlds we could restore this map's npcs, lit rooms and locked doors from */
  const otherWorldKeys = listWorldKeysWithMap(w.mapKey, w.key);

  const state = useStateRef(
    (): State => ({
      debugHitOpen: false,
      dragged: false,
      gmGraphsOpen: false,
      skinDebugOpen: false,
      menuOpen: false,
      minY: 40,
      openSection: saved.menuSection,
      themeEditorRef: null as any,
      toastTs: {} as Record<string, number>,
      y: saved.menuY,
      menuWidth: saved.menuWidth,
      menuHeight: saved.menuHeight,
      armedState: null,
      armedTimeoutId: 0,
      lookLongPressed: false,
      lookTimeoutId: 0,
      resizing: false,
      stateSelectOpen: false,

      onSelectState(value) {
        if (value === null) {
          return;
        }
        if (state.armedState !== value) {
          // the popup stays open with this option now reading "confirm", so it can be clicked
          // straight away. It forgets itself, lest a much later click take effect by surprise
          window.clearTimeout(state.armedTimeoutId);
          state.armedTimeoutId = window.setTimeout(state.disarmState, stateArmedMs);
          state.set({ armedState: value });
          return;
        }

        state.disarmState();
        state.set({ stateSelectOpen: false });
        if (value === resetStateValue) {
          void w.e.resetWorldState();
        } else {
          void w.e.restoreFromWorld(value);
        }
      },
      onStateSelectOpenChange(open, reason) {
        if (open === false && reason === "item-press") {
          return; // `onSelectState` decides, since arming "confirm" must not close the popup
        }
        if (open === false) {
          state.disarmState(); // dismissed rather than confirmed
        }
        state.set({ stateSelectOpen: open });
      },
      disarmState() {
        window.clearTimeout(state.armedTimeoutId);
        if (state.armedState !== null) {
          state.set({ armedState: null });
        }
      },

      onLookPressStart() {
        state.lookLongPressed = false;
        state.lookTimeoutId = window.setTimeout(() => {
          state.lookLongPressed = true;
          w.view.setCameraMode(nextCameraMode[w.view.cameraMode]);
          state.update();
        }, lookLongPressMs);
      },
      onLookPressEnd(cancelled = false) {
        window.clearTimeout(state.lookTimeoutId);
        if (cancelled === false && state.lookLongPressed === false) {
          void w.player.panTo();
        }
      },

      isOpen(section) {
        return state.openSection === section;
      },
      toggleSection(section) {
        // a concertina: opening one folds whichever was open
        const openSection = state.isOpen(section) === true ? null : section;
        store.patch({ menuSection: openSection });
        state.set({ openSection });
      },

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
        store.patch({ menuY: state.getClampedY(y.get()) });
      },
      persistMenuSize() {
        store.patch({ menuWidth: state.menuWidth, menuHeight: state.menuHeight });
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
      case "Room Outlines":
        return w.debug?.fadeRoomOutlines ?? false;
      case "Light npcs":
        return w.view.lightNpcs?.value === 1;
      case "Colliders":
        return w.debug?.physicsCollidersShown ?? false;
      case "Grid":
        return w.debug?.gridShown ?? false;
      case "Light Tints":
        return w.debug?.lightSpheresShown ?? true;
      case "NavMesh":
        return w.debug?.navMeshShown ?? false;
      case "Toggle Doors":
        return w.debug?.pickOpenDoors ?? true;
      case "Pick Doors":
        return w.debug?.pickDoors ?? true;
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
      case "Room Outlines":
        w.debug?.set({ fadeRoomOutlines: !w.debug.fadeRoomOutlines });
        store.patch({ fadeRoomOutlines: w.debug?.fadeRoomOutlines === true });
        w.floor?.drawAll();
        state.update();
        break;
      case "Light npcs":
        w.view.setLightNpcsEnabled();
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
      case "Light Tints":
        w.debug?.set({ lightSpheresShown: !w.debug.lightSpheresShown });
        w.update();
        break;
      case "NavMesh":
        w.debug?.set({ navMeshShown: !w.debug.navMeshShown });
        setTimeout(() => w.view.forceUpdate());
        break;
      case "Toggle Doors": {
        // independent of "Pick Doors": a door's switches carry its `gdKey` too, so picking one of
        // those opens it whilst the door itself stays out of the pick pass
        const next = !w.debug?.pickOpenDoors;
        w.debug?.set({ pickOpenDoors: next });
        store.patch({ pickOpenDoors: next });
        state.update();
        break;
      }
      case "Pick Doors": {
        const next = !w.debug?.pickDoors;
        w.debug?.set({ pickDoors: next });
        store.patch({ pickDoors: next });
        w.view.pickDoors.value = next ? 1 : 0; // the doors' own shader reads this
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
  const toastKeys = useToastKeys(pendingKeys, toastLingerMs);
  // held briefly, else a fast load just flickers the trigger
  const spinnerKeys = useToastKeys(pendingKeys, spinnerMinMs);
  const toggleToastKeys = useToastTs(state.toastTs);

  const menuTrigger = (
    <div className="outline-width-1 grid place-items-center size-9 bg-gray-800 text-white">
      {spinnerKeys.length > 0 ? <Spinner className="size-4" /> : <GlobeStandIcon className="size-5" weight="bold" />}
    </div>
  );

  return (
    <>
      <motion.div
        // - `items-start` so no child can stretch the trigger, which would
        //   carry the popup rightwards with it
        // - above the popup's `z-50`, so the toasts below it are not covered. The drag
        //   transform makes this a stacking context, so a child cannot escape on its own
        className="outline-none absolute top-0 left-1 z-60 touch-none select-none flex flex-col items-start gap-0.5"
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
          <MenuShell state={state} touch={touch} trigger={menuTrigger}>
            <div className={cn("flex flex-wrap max-w-52", touch && "max-w-none items-stretch")}>
              <div
                className={cn(
                  "flex items-center gap-2 px-2 py-1.5 text-xs text-slate-300",
                  touch && "flex-1 min-w-0 gap-2 px-3 py-2 text-sm",
                )}
              >
                <BrightnessPie
                  ratio={brightnessToRatio(w.brightness)}
                  onClick={() => {
                    const brightness = defaultBrightness;
                    w.set({ brightness });
                    store.patch({ brightness });
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
                    store.patch({ brightness: w.brightness });
                  }}
                  onClick={(e) => e.stopPropagation()}
                  className={rangeInputClass(touch, touch ? "flex-1" : "w-16")}
                />
              </div>
            </div>
            <MenuRow
              menu={!touch}
              className={cn(
                "flex justify-between items-center gap-2 px-2 py-1 text-xs text-slate-300 bg-slate-700 cursor-pointer",
                touch && "px-3 py-2 text-sm",
              )}
              onClick={() => w.view.setCameraMode(nextCameraMode[w.view.cameraMode])}
            >
              <div>camera: {w.view.cameraMode}</div>
              <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                <span title="reset camera" onClick={() => w.view.resetCamera()}>
                  <ArrowsClockwiseIcon className="size-3.5 cursor-pointer hover:text-white" />
                </span>
              </div>
            </MenuRow>

            <div className={cn("flex", touch && "items-center border-t border-slate-800")}>
              <div className={cn("text-white text-xs flex items-center px-2", touch && "text-sm px-3 py-1")}>map:</div>
              <MenuSelect
                label={w.mapKey}
                value={w.mapKey}
                items={mapKeys.map((key) => ({ key, value: key }))}
                side="bottom"
                onValueChange={async (key) => {
                  if (!key || key === w.mapKey) return;
                  state.set({ menuOpen: false }); // nothing over the transition
                  await w.floor?.fadeOut(key);
                  w.e.onChangeMap(); // persist + remove whilst the old map still exists
                  uiStoreApi.setUiMeta(w.id, (draft) => (draft.mapKey = key));
                }}
              />
              {/* reset this map's npcs, lit rooms and locked doors, or take another world's */}
              <div
                className={cn("flex", touch && "items-center border-t border-slate-800")}
                title="reset, or use another world's npcs, lit rooms, locked doors"
              >
                <MenuSelect
                  label="state"
                  value={null}
                  items={[resetStateValue, ...otherWorldKeys].map((value) => ({
                    key: value === resetStateValue ? "reset" : value,
                    el: state.armedState === value ? <span className="text-red-300">confirm</span> : undefined,
                    value,
                  }))}
                  side="bottom"
                  onValueChange={state.onSelectState}
                  open={state.stateSelectOpen}
                  onOpenChange={state.onStateSelectOpenChange}
                />
              </div>
            </div>

            <div
              className={sectionHeaderClass(touch)}
              onClick={(e) => {
                e.stopPropagation();
                state.toggleSection("debug");
              }}
            >
              {state.isOpen("debug") ? <CaretDownIcon className="size-3" /> : <CaretRightIcon className="size-3" />}
              debug
            </div>

            {state.isOpen("debug") && (
              <>
                <div className={cn("px-2 pb-1 grid grid-cols-2 gap-0.5", touch && "px-3 pb-2 gap-1.5")}>
                  {debugItems.map((item) => (
                    <button
                      key={item}
                      type="button"
                      className={cn(
                        "text-xs px-1.5 py-0.5 rounded cursor-pointer text-left",
                        touch && "text-sm px-2 py-2 bg-slate-800",
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

                <div className={cn("px-2 pb-1", touch && "px-3 pb-2")}>
                  <button
                    type="button"
                    className={cn(
                      "w-full cursor-pointer text-xs bg-slate-700 hover:bg-slate-600 text-slate-200 rounded px-2 py-0.5",
                      touch && "text-sm py-2 mt-1",
                    )}
                    onClick={(e) => {
                      e.stopPropagation();
                      w.debug.logGPUInfo = true;
                      w.view.forceUpdate();
                    }}
                  >
                    log gpu info
                  </button>
                </div>
              </>
            )}

            <div
              className={sectionHeaderClass(touch)}
              onClick={(e) => {
                e.stopPropagation();
                state.toggleSection("player");
              }}
            >
              {state.isOpen("player") ? <CaretDownIcon className="size-3" /> : <CaretRightIcon className="size-3" />}
              player
            </div>

            {state.isOpen("player") && (
              <div
                className={cn(
                  "max-w-80 flex flex-wrap items-end gap-1 px-2 py-1",
                  touch && "max-w-none flex-col items-stretch gap-2 px-1 py-2",
                )}
                onClick={(e) => e.stopPropagation()}
              >
                <div className={cn("w-24 flex items-stretch", touch && "w-full mx-2")}>
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
                    className={cn(
                      "grid place-items-center border rounded-r border-l-0 border-white/30 px-1.5 text-slate-300 cursor-pointer hover:bg-slate-700",
                      touch && "px-3",
                    )}
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
              </div>
            )}

            {import.meta.env.DEV && (
              <>
                <div
                  className={sectionHeaderClass(touch)}
                  onClick={(e) => {
                    e.stopPropagation();
                    state.toggleSection("edit theme");
                  }}
                >
                  {state.isOpen("edit theme") ? (
                    <CaretDownIcon className="size-3" />
                  ) : (
                    <CaretRightIcon className="size-3" />
                  )}
                  edit theme
                </div>
                {state.isOpen("edit theme") && (
                  <div className="p-2 pt-0 flex flex-col gap-1">
                    <textarea
                      key={w.themeKey}
                      ref={state.ref("themeEditorRef")}
                      className="w-44 h-32 select-text bg-slate-900 text-slate-200 text-[10px] font-mono p-1 rounded border border-slate-600 resize-y"
                      defaultValue={JSON.stringify(w.getTheme(), null, 2)}
                      onKeyDown={(e) => e.stopPropagation()}
                      onClick={(e) => e.stopPropagation()}
                      onChange={() => {
                        const parsed = WorldThemeSchema.safeParse(JSON.parse(state.themeEditorRef?.value ?? ""));
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

            {import.meta.env.DEV && (
              <div
                className={sectionHeaderClass(touch)}
                onClick={(e) => {
                  e.stopPropagation();
                  state.toggleSection("dev scripts");
                }}
              >
                {state.isOpen("dev scripts") ? (
                  <CaretDownIcon className="size-3" />
                ) : (
                  <CaretRightIcon className="size-3" />
                )}
                dev scripts
              </div>
            )}

            {import.meta.env.DEV && state.isOpen("dev scripts") && (
              <div className="flex">
                <button
                  type="button"
                  className={cn(
                    "w-full flex items-center justify-center gap-1.5 cursor-pointer text-xs bg-slate-700/70 hover:bg-slate-600 text-slate-200 border border-slate-600 px-2 py-1",
                    touch && "text-sm py-2.5",
                  )}
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
                  className={cn(
                    "w-full flex items-center justify-center gap-1.5 cursor-pointer text-xs bg-slate-700/70 hover:bg-slate-600 text-slate-200 border border-slate-600 px-2 py-1",
                    touch && "text-sm py-2.5",
                  )}
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
          </MenuShell>

          <button
            type="button"
            data-keep-menu-open
            title={w.disabled ? "resume" : "pause"}
            className="cursor-pointer outline-width-1 grid place-items-center bg-gray-800 text-white hover:bg-gray-700 size-9"
            onClick={() => w.setDisabled()}
          >
            {w.disabled ? (
              <PlayIcon alt="resume" className="size-5" weight="bold" />
            ) : (
              <PauseIcon alt="pause" className="size-5" weight="bold" />
            )}
          </button>

          {/* look at the player, or long press to switch camera mode — which its own corner wears,
              and which `f` also toggles. See `WorldView`'s `onKeyDown` */}
          <div
            data-keep-menu-open
            className="relative cursor-pointer outline-width-1 grid place-items-center bg-gray-800 text-white hover:bg-gray-700 size-9 touch-none select-none"
            onPointerDown={() => state.onLookPressStart()}
            onPointerUp={() => state.onLookPressEnd()}
            onPointerLeave={() => state.onLookPressEnd(true)}
            onContextMenu={(e) => e.preventDefault()}
          >
            <PersonSimpleCircleIcon className="size-5" alt="look at the player (long press for camera mode)" />
            <div
              className="absolute bottom-0.5 right-0.5 leading-none pointer-events-none"
              title={`camera: ${w.view.cameraMode} (press f, or long press)`}
            >
              {w.view.cameraMode === "follow" ? (
                <CrosshairSimpleIcon className="size-2.5 text-emerald-400" weight="bold" />
              ) : (
                <ArrowsOutCardinalIcon className="size-2.5 text-slate-400" weight="bold" />
              )}
            </div>
          </div>

          {/* the world shown by room, everything the player cannot see into faded away — see
              `service/fade-rooms`. Cycles `focus` to `map` to `gm`, the same three the keys `1`,
              `2` and `3` select. The rooms fade INTO the post pass's backdrop, so asking for
              either fading mode switches that on too */}
          <button
            type="button"
            data-keep-menu-open
            title={`fade: ${w.view.fadeRoomsMode}`}
            className="cursor-pointer outline-width-1 grid place-items-center bg-gray-800 text-white hover:bg-gray-700 size-9"
            onClick={() => {
              w.view.setFadeRoomsMode();
              state.update();
            }}
          >
            {w.view.fadeRoomsMode === "focus" ? (
              <FlashlightIcon className="size-5 text-slate-200" alt="focus: only what the player sees" weight="bold" />
            ) : w.view.fadeRoomsMode === "map" ? (
              <MapTrifoldIcon className="size-5 text-slate-200" alt="map: the rest black" weight="bold" />
            ) : (
              <BugIcon className="size-5 text-slate-400" alt="gm: all of it" weight="bold" />
            )}
          </button>
        </div>

        <div className="absolute top-full left-0 mt-1 w-max max-w-64 flex flex-col gap-0.5">
          <AnimatePresence>
            {[...toastKeys, ...toggleToastKeys].map((key) => (
              <motion.div
                key={key}
                className="rounded shadow-lg shadow-black/40 bg-zinc-900/95 text-slate-100 text-xs px-3 py-1.5 wrap-break-word"
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
    </>
  );
}

/**
 * The shell around the menu's contents.
 *
 * Desktop keeps the anchored popup, resizable via its bottom-right corner.
 *
 * Touch instead gets a panel pinned to the full height of the world, because the popup's height
 * could not be grown past what the anchored positioner allowed beside the button column. It is
 * portalled into the world root so the column's drag transform cannot carry it around, and it
 * swallows `pointerdown` because a React portal still propagates events to that draggable column.
 */
function MenuShell({
  children,
  state,
  touch,
  trigger,
}: {
  children: React.ReactNode;
  state: UseStateRef<State>;
  touch: boolean;
  trigger: React.ReactNode;
}) {
  const w = useContext(WorldContext);

  if (touch === true) {
    return (
      <>
        <button
          type="button"
          className="cursor-pointer"
          onClick={() => {
            if (state.dragged) return;
            state.set({ menuOpen: !state.menuOpen });
          }}
        >
          {trigger}
        </button>
        {w.rootEl &&
          createPortal(
            <AnimatePresence>
              {state.menuOpen && (
                <motion.div
                  key="backdrop"
                  // below the panel but above the world, so a tap outside dismisses rather than
                  // picking. The icon column is `z-[60]`, so its buttons stay reachable
                  className="absolute inset-0 z-40"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    state.set({ menuOpen: false });
                  }}
                />
              )}
              {state.menuOpen && (
                <motion.div
                  key="panel"
                  className={cn(
                    "absolute inset-y-2 left-14 z-50 flex flex-col select-none",
                    "w-[min(22rem,calc(100%-4.5rem))] rounded-lg overflow-hidden",
                    "bg-slate-900/70 border border-slate-700 shadow-2xl shadow-black/50",
                  )}
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -8 }}
                  transition={{ duration: 0.15 }}
                  onPointerDown={(e) => e.stopPropagation()}
                >
                  <div className="flex items-center justify-between pl-3 pr-1.5 py-1.5 bg-slate-800 border-b border-slate-700">
                    <span className="text-sm text-slate-300">world</span>
                    <button
                      type="button"
                      className="grid place-items-center size-9 rounded text-slate-300 cursor-pointer hover:bg-slate-700"
                      onClick={() => state.set({ menuOpen: false })}
                    >
                      <XIcon className="size-4" weight="bold" />
                    </button>
                  </div>
                  <div className="flex-1 overflow-y-auto overscroll-contain pb-6">{children}</div>
                </motion.div>
              )}
            </AnimatePresence>,
            w.rootEl,
          )}
      </>
    );
  }

  return (
    <Menu.Root
      open={state.menuOpen}
      onOpenChange={(open, { reason, event }) => {
        if (open) {
          state.set({ menuOpen: true });
        } else if (
          reason === "outside-press" &&
          (event.target as HTMLElement).closest?.("[data-keep-menu-open]") != null
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
        {trigger}
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
            // the portal still propagates React events to the draggable column, so a press
            // anywhere in the popup would otherwise start dragging it up and down
            onPointerDown={(e) => e.stopPropagation()}
          >
            <div
              className={cn(
                "flex flex-col overflow-y-auto pb-6",
                "[&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-track]:bg-transparent",
                "[&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-slate-600",
              )}
              style={{ maxHeight: state.menuHeight, scrollbarWidth: "thin" }}
            >
              {children}
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
  );
}

/** A menu row: a real `Menu.Item` in the desktop popup, a plain row in the touch panel */
function MenuRow({
  children,
  className,
  menu,
  onClick,
}: {
  children: React.ReactNode;
  className?: string;
  menu: boolean;
  onClick: () => void;
}) {
  return menu === true ? (
    <Menu.Item className={className} closeOnClick={false} onClick={onClick}>
      {children}
    </Menu.Item>
  ) : (
    <div className={className} onClick={onClick}>
      {children}
    </div>
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

/** Small square icon button used to pack several toggles/actions into one row in the lights menu */
/** Map brightness (0.5–2.0) so that 1.0 = 50% pie fill */
function brightnessToRatio(b: number) {
  return b <= 1 ? b - 0.5 : 0.5 + (b - 1) * 0.5;
}

function _LightsIconButton({
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
  const { touchDevice: touch } = useContext(WorldContext);
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
        touch && "size-10 bg-slate-800",
        danger
          ? "text-red-300 hover:bg-red-900/40"
          : active
            ? "bg-slate-700 text-white"
            : "text-slate-500 hover:bg-slate-700",
      )}
    >
      <IconCmp
        className={cn("size-3.5", touch && "size-5", danger && "scale-110")}
        weight={active ? "fill" : "regular"}
      />
    </button>
  );
}

/** One labelled slider row in the lights menu */
function _LightsMenuSlider({
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
  const { touchDevice: touch } = useContext(WorldContext);
  return (
    <div className="flex flex-col gap-0.5 px-2 py-0.5">
      <span
        className={cn(
          "text-[10px] text-slate-400",
          touch && "text-xs",
          defaultValue !== undefined && "cursor-pointer hover:underline",
        )}
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
        className={rangeInputClass(touch, touch ? "w-full" : "w-14")}
      />
    </div>
  );
}

export type State = {
  debugHitOpen: boolean;
  gmGraphsOpen: boolean;
  skinDebugOpen: boolean;
  dragged: boolean;
  menuOpen: boolean;
  /** The one unfolded section, e.g. `debug`. Persisted */
  openSection: null | string;
  isOpen(section: string): boolean;
  toggleSection(section: string): void;
  themeEditorRef: HTMLTextAreaElement;
  toastTs: Record<string, number>;
  y: number;
  minY: number;
  /** Width (px) of the main menu popup — resizable, persisted */
  menuWidth: number;
  /** Height (px) of the main menu popup's scrollable body — resizable, persisted */
  menuHeight: number;
  resizing: boolean;
  /** The `state` option clicked once, whose next click takes effect. `null` when none is armed */
  armedState: null | string;
  armedTimeoutId: number;
  /** Whether the look button has been held long enough to have switched camera mode */
  lookLongPressed: boolean;
  lookTimeoutId: number;
  /** A click looks at the player; a long press switches camera mode — the badge it wears */
  onLookPressStart(): void;
  onLookPressEnd(cancelled?: boolean): void;
  /** Controlled, so arming "confirm" can keep the popup open — see `onStateSelectOpenChange` */
  stateSelectOpen: boolean;
  /** Either restore this map's state from another world, or reset it — each after confirming */
  onSelectState(value: null | string): void;
  onStateSelectOpenChange(open: boolean, reason: Select.Root.ChangeEventReason): void;
  disarmState(): void;
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

/** A collapsible section's header row, e.g. "player" or "debug" */
const sectionHeaderClass = (touch: boolean) =>
  cn(
    "flex items-center gap-1 px-2 py-1 text-xs text-slate-400 cursor-pointer hover:text-slate-200",
    touch && "gap-2 px-3 py-2.5 text-sm border-t border-slate-800",
  );

/** Every `<input type="range">` in the menu — touch gets a fatter thumb and more room to drag */
const rangeInputClass = (touch: boolean, width: string) =>
  cn(
    "accent-white cursor-pointer appearance-none bg-transparent",
    "[&::-webkit-slider-runnable-track]:rounded-full [&::-webkit-slider-runnable-track]:bg-white/50",
    "[&::-moz-range-track]:bg-white/50",
    "[&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white",
    touch
      ? "py-1.5 [&::-webkit-slider-thumb]:h-5 [&::-webkit-slider-thumb]:w-5"
      : "[&::-webkit-slider-thumb]:h-3.5 [&::-webkit-slider-thumb]:w-3.5",
    width,
  );

/** `MenuSelect` value of the "reset" option, which no `worldKey` can collide with */
const resetStateValue = "reset-world-state";
/** How long a `state` option stays armed as "confirm" */
const stateArmedMs = 5000;

const minMenuWidth = 200;
const minMenuHeight = 120;
/** How long a toast lingers after its pending key clears */
const toastLingerMs = 2000;
/** Minimum time the trigger's spinner stays up */
const spinnerMinMs = 300;
/** How long the look button must be held before it switches camera mode rather than looking */
const lookLongPressMs = 500;

const nextCameraMode = { free: "follow", follow: "free" } as const;
const debugItems = [
  "View Pick",
  "Post FX",
  "Room Outlines",
  "Light npcs",
  "Room Hit",
  "Graphs",
  "Skins",
  "Colliders",
  "Grid",
  "Light Tints",
  "Toggle Doors",
  "Pick Doors",
  "Door Normals",
  "Decor Points",
  "NavMesh",
] as const;

/** Shorten a select trigger's displayed label (e.g. an npc/symbol key) to fit the compact lights grid */
const truncateLabel = (label: string, max = 5) => (label.length > max ? `${label.slice(0, max)}…` : label);

const selectItemClassName = (touch: boolean) =>
  cn(
    "px-2 py-1 text-xs cursor-pointer text-slate-300",
    "data-highlighted:bg-slate-700 data-selected:text-green-400",
    touch && "px-3 py-2.5 text-sm",
  );

function MenuSelect<T extends string>({
  className,
  items,
  label,
  side = "right",
  value,
  onValueChange,
  open,
  onOpenChange,
}: {
  className?: string;
  items: { key: string; el?: React.JSX.Element; value: T }[];
  /** Defaults to value */
  label?: string;
  side?: "left" | "right" | "bottom" | "top";
  value: T | null;
  onValueChange: (value: T | null) => void;
  /** Optionally control the popup, e.g. to hold it open whilst confirming something */
  open?: boolean;
  onOpenChange?: (open: boolean, reason: Select.Root.ChangeEventReason) => void;
}) {
  const w = useContext(WorldContext);
  const touch = w.touchDevice;

  return (
    <Select.Root
      value={value}
      onValueChange={onValueChange}
      open={open}
      onOpenChange={(next, eventDetails) => onOpenChange?.(next, eventDetails.reason)}
    >
      <Select.Trigger
        className={cn(
          "flex items-center gap-1 px-2 py-1 text-xs text-slate-300 cursor-pointer hover:bg-slate-700 w-full min-w-0",
          touch && "px-3 py-2 text-sm",
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
              {items.map(({ key, el, value }) => (
                <Select.Item key={key} value={value} className={selectItemClassName(touch)}>
                  <Select.ItemText>{el ?? key}</Select.ItemText>
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
