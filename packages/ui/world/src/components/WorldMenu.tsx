import { Menu } from "@base-ui/react/menu";
import { Popover } from "@base-ui/react/popover";
import { Select } from "@base-ui/react/select";
import { Slider } from "@base-ui/react/slider";
import { UiContext } from "@npc-cli/ui-sdk/UiContext";
import { cn, Spinner, type UseStateRef, useStateRef } from "@npc-cli/util";
import { hashJson } from "@npc-cli/util/legacy/generic";
import {
  ArrowCounterClockwiseIcon,
  ArrowsClockwiseIcon,
  BrainIcon,
  CaretDownIcon,
  CaretLeftIcon,
  CaretRightIcon,
  CrosshairSimpleIcon,
  EyeIcon,
  GlobeSimpleIcon,
  GlobeStandIcon,
  HourglassMediumIcon,
  type Icon,
  PauseIcon,
  PersonSimpleIcon,
  PlayIcon,
  PowerIcon,
  RobotIcon,
  SlidersHorizontalIcon,
  XIcon,
} from "@phosphor-icons/react";
import debounce from "debounce";
import { AnimatePresence, motion, useDragControls, useMotionValue } from "motion/react";
import type React from "react";
import { useContext, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { WorldThemeSchema } from "../assets.schema";
import { compilingShadersText, defaultBrightness } from "../const.env";
import { GeomorphGraphsModal, RoomHitModal, SkinsModal } from "../service/debug";
import { extraFxKeys } from "../service/extra-fx";
import { queryClientApi } from "../service/query-client";
import {
  cameraPresets,
  distanceOfView,
  getDefaultCameraView,
  getPresetCameraView,
  minNearView,
} from "../service/camera-view";
import { type CameraView, getSiteStore, getWorldStore, listWorldKeysWithMap } from "../service/storage";
import { clearWorldFlags } from "../service/world-flags";
import type { CameraModeType } from "./CameraControls";
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
  /** The camera's outer zoom stop, held here whilst its slider is dragged — see the debug section */

  const state = useStateRef(
    (): State => ({
      unconfirmed: null,
      unconfirmedTimeoutId: 0,
      debugHitOpen: false,
      dragged: false,
      gmGraphsOpen: false,
      extraFxSelectOpen: false,
      menuWidth: saved.menuWidth,
      minY: 40,
      menuOpen: false,
      menuHeight: saved.menuHeight,
      resizing: false,
      skinDebugOpen: false,
      stateSelectOpen: false,
      themeEditorOpen: false,
      themeEditorRef: null as any,
      timeSliderOpen: saved.timeSliderOpen !== false,
      toastTs: {} as Record<string, number>,
      y: saved.menuY,

      confirm(value) {
        window.clearTimeout(state.unconfirmedTimeoutId);
        if (state.unconfirmed === value) {
          state.set({ unconfirmed: null });
          return true;
        }
        // it forgets itself, lest a much later click take effect by surprise
        state.unconfirmedTimeoutId = window.setTimeout(state.clearUnconfirmed, confirmMs);
        state.set({ unconfirmed: value });
        return false;
      },
      clearUnconfirmed() {
        window.clearTimeout(state.unconfirmedTimeoutId);
        if (state.unconfirmed !== null) {
          state.set({ unconfirmed: null });
        }
      },
      onExtraFxSelectOpenChange(open, reason) {
        if (open === false && reason === "item-press") return;
        state.set({ extraFxSelectOpen: open });
      },
      onSelectState(value) {
        if (value === null || state.confirm(value) === false) {
          return; // the popup stays open with this option now reading "confirm"
        }
        state.set({ stateSelectOpen: false });
        if (value === "reset-world-state") {
          void w.e.resetWorldState();
        } else {
          void w.e.restoreFromWorld(value);
        }
      },
      onStateSelectOpenChange(open, reason) {
        if (open === false && reason === "item-press") {
          return; // `onSelectState` decides, since "confirm" must not close the popup
        }
        if (open === false) {
          state.clearUnconfirmed(); // dismissed rather than confirmed
        }
        state.set({ stateSelectOpen: open });
      },
      onResetCamera() {
        if (state.confirm("reset-camera") === true) {
          w.view.resetCamera();
        }
      },
      onRemountWorld() {
        if (state.confirm("remount-world") === true) {
          clearWorldFlags(w.key); // else it arrives unveiled, with no bootstrap to see
          uiStoreApi.setUiMeta(w.id, (draft) => void (draft.mountKey = Date.now()));
        }
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
      setMenuHeight(startHeight, dy, startMenuY) {
        // from the top the column moves, and the height takes up what it moved
        if (startMenuY !== undefined) dy = startMenuY - state.getClampedY(startMenuY + dy);
        state.menuHeight = state.getClampedMenuHeight(startHeight + dy);
        if (startMenuY !== undefined) y.set(startMenuY + startHeight - state.menuHeight);
      },
      onResizeMouseDown(e, top) {
        e.stopPropagation();
        const startMenuY = top === true ? y.get() : undefined;
        const startX = e.clientX;
        const startY = e.clientY;
        const startWidth = state.menuWidth;
        const startHeight = state.menuHeight;
        state.resizing = true;
        const onMove = (ev: MouseEvent) => {
          // popup opens rightward/downward from the trigger, so dragging the corner out grows it
          state.menuWidth = state.getClampedMenuWidth(startWidth + (ev.clientX - startX));
          state.setMenuHeight(startHeight, ev.clientY - startY, startMenuY);
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
      onResizeTouchStart(e, top) {
        e.stopPropagation();
        const startMenuY = top === true ? y.get() : undefined;
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
            state.setMenuHeight(startHeight, t2.clientY - startY, startMenuY);
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
      toggleTimeSlider() {
        state.set({ timeSliderOpen: !state.timeSliderOpen });
        store.patch({ timeSliderOpen: state.timeSliderOpen });
      },
      persistMenuSize() {
        store.patch({ menuWidth: state.menuWidth, menuHeight: state.menuHeight, menuY: state.getClampedY(y.get()) });
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

  /** Spots greyed out until jsh `spots --show`, run by a terminal's profile, fills them */
  const withSpotsGreyed = <T extends { value: string }>(item: T) =>
    item.value === "spots" && (w.debug?.spots.length ?? 0) === 0 ? { ...item, disabled: true } : item;

  const isDebugActive = (item: string) => {
    switch (item) {
      case "view pick":
        return w.view.objectPick?.value === 1;
      case "post fx":
        return w.view.postProcessing ?? false;
      case "npc outline":
        return w.view.npcOutline ?? false;
      case "rgb shift":
        return w.view.rgbShift ?? false;
      case "extra fx":
        return w.view.extraFxEnabled ?? false;
      case "room outlines":
        return w.view.roomOutline ?? false;
      case "lit npcs":
        return w.view.litNpcsEnabled?.value === 1;
      case "colliders":
        return w.debug?.physicsCollidersShown ?? false;
      case "grid":
        return w.debug?.gridShown ?? false;
      case "navmesh":
        return w.debug?.navMeshShown ?? false;
      case "toggle doors":
        return w.debug?.pickGdkeyOpensDoors ?? true;
      case "pick doors":
        return w.debug?.pickDoors ?? true;
      case "door normals":
        return w.debug?.doorNormalsShown ?? true;
      case "decor points":
        return w.debug?.doPointsShown ?? false;
      case "decorations":
        return w.debug?.decorShown ?? false;
      case "spots":
        return w.debug?.spotsShown ?? false;
      case "npc contextmenu":
        return w.debug?.npcContextMenu ?? false;
      case "hud debug":
        return w.debug?.hudDebug ?? false;
      default:
        return false;
    }
  };

  const onDebugToggle = (item: string) => {
    switch (item) {
      case "view pick":
        w.view.toggleViewPick();
        break;
      case "post fx":
        // both rebuild the post pass, whose shader compile can stall a phone for a moment — and
        // change the pick pass's attachments, so that is warmed again rather than on the next tap
        void w.view.runBusy(compilingShadersText, () => {
          w.view.setPostProcessingEnabled();
          state.update();
          return w.view.warmPick();
        });
        break;
      case "npc outline":
        void w.view.runBusy(compilingShadersText, () => {
          w.view.setNpcOutlineEnabled();
          state.update();
          return w.view.warmPick();
        });
        break;
      case "rgb shift":
        // hung off the post pass, so it needs "post fx" on to show
        void w.view.runBusy(compilingShadersText, () => {
          w.view.setRgbShiftEnabled();
          state.update();
        });
        break;
      case "extra fx":
        void w.view.runBusy(compilingShadersText, () => w.view.setExtraFx());
        break;
      case "room outlines":
        // drawn by the post pass, so it rebuilds that too
        void w.view.runBusy(compilingShadersText, () => {
          w.view.setRoomOutlineEnabled();
          state.update();
        });
        break;
      case "lit npcs":
        w.view.setLitNpcsEnabled();
        state.update();
        break;
      case "room hit":
        state.set({ debugHitOpen: true });
        break;
      case "graphs":
        state.set({ gmGraphsOpen: true });
        break;
      case "skins":
        state.set({ skinDebugOpen: true });
        break;
      case "colliders":
        w.debug?.showPhysicsColliders();
        w.update();
        break;
      case "grid":
        w.debug?.set({ gridShown: !w.debug.gridShown });
        w.r3f?.invalidate();
        break;
      case "navmesh":
        w.debug?.set({ navMeshShown: !w.debug.navMeshShown });
        setTimeout(() => w.view.forceUpdate());
        break;
      case "toggle doors": {
        // independent of "pick doors": a door's switches carry its `gdKey` too, so picking one of
        // those opens it whilst the door itself stays out of the pick pass
        const next = !w.debug?.pickGdkeyOpensDoors;
        w.debug?.set({ pickGdkeyOpensDoors: next });
        store.patch({ pickOpenDoors: next });
        state.update();
        break;
      }
      case "pick doors": {
        const next = !w.debug?.pickDoors;
        w.debug?.set({ pickDoors: next });
        store.patch({ pickDoors: next });
        w.view.pickDoors.value = next ? 1 : 0; // the doors' own shader reads this
        state.update();
        break;
      }
      case "door normals":
        w.debug?.set({ doorNormalsShown: !w.debug.doorNormalsShown });
        w.view.forceUpdate();
        break;
      case "decor points": {
        w.debug?.set({ doPointsShown: !w.debug.doPointsShown });
        w.view.forceUpdate();
        break;
      }
      case "hud debug": {
        const next = !w.debug?.hudDebug;
        w.debug?.set({ hudDebug: next, forceShot: null }); // hidden, nothing stays forced
        store.patch({ hudDebug: next });
        w.hud?.update();
        state.update();
        break;
      }
      case "npc contextmenu": {
        const next = !w.debug?.npcContextMenu;
        w.debug?.set({ npcContextMenu: next });
        store.patch({ npcContextMenu: next });
        state.update();
        break;
      }
      case "decorations": {
        const next = !w.debug?.decorShown;
        w.debug?.set({ decorShown: next });
        store.patch({ decorShown: next });
        w.decor.setupRuntimeInstances(); // decor not meant to show is drawn whilst decorating
        w.view.forceUpdate();
        break;
      }
      case "spots":
        w.debug?.toggleSpots();
        break;
    }
  };

  const pendingKeys = Object.keys(w.pending);
  const toastKeys = useToastKeys(pendingKeys, toastLingerMs);
  // held briefly, else a fast load just flickers the trigger
  const spinnerKeys = useToastKeys(pendingKeys, spinnerMinMs);
  const toggleToastKeys = useToastTs(state.toastTs);

  const menuTrigger = (
    <div className="outline-width-1 grid place-items-center size-9 bg-neutral-800 text-white">
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
            <div className={cn("flex justify-between items-center", touch && "max-w-none")}>
              <span
                title="remount world"
                onClick={(e) => {
                  e.stopPropagation();
                  state.onRemountWorld();
                }}
                className={cn(
                  "flex items-center gap-1 pl-2 text-xs text-neutral-300 cursor-pointer",
                  touch && "pl-3 text-sm",
                  state.unconfirmed === "remount-world" ? "text-red-300" : "hover:text-white",
                )}
              >
                <PowerIcon className="size-3.5" />
                {state.unconfirmed === "remount-world" && "remount"}
              </span>
              <LightSlider touch={touch} />
            </div>
            <div
              className={cn(
                "flex justify-between items-center gap-2 text-xs text-neutral-300 bg-neutral-700",
                touch && "text-sm",
              )}
            >
              <div className={cn("flex items-center pl-2", touch && "pl-3")}>
                <div>camera:</div>
                <MenuSelect
                  label={w.view.cameraMode}
                  value={w.view.cameraMode}
                  items={cameraModes.map((value) => ({ key: value, value }))}
                  side="bottom"
                  onValueChange={(mode) => mode !== null && w.view.setCameraMode(mode)}
                />
              </div>
              <div
                className={cn("flex items-center gap-1.5 pr-2 py-1", touch && "pr-3 py-2")}
                onClick={(e) => e.stopPropagation()}
              >
                <span
                  title={`follow the player: ${w.view.follow ? "on" : "off"}`}
                  onClick={() => w.view.setFollow(!w.view.follow)}
                >
                  <CrosshairSimpleIcon
                    className={cn(
                      "size-3.5 cursor-pointer",
                      w.view.follow === true ? "text-amber-300" : "hover:text-white",
                    )}
                  />
                </span>
                <span
                  title="reset camera"
                  onClick={state.onResetCamera}
                  className={cn(
                    "flex items-center gap-1 cursor-pointer",
                    state.unconfirmed === "reset-camera" ? "text-red-300" : "hover:text-white",
                  )}
                >
                  {/* the word too: a title says nothing on touch */}
                  {state.unconfirmed === "reset-camera" && "reset"}
                  <ArrowsClockwiseIcon className="size-3.5" />
                </span>
              </div>
            </div>
            <CameraSliders touch={touch} />

            <div className={cn("flex", touch && "items-center border-t border-neutral-800")}>
              <div className={cn("text-white text-xs flex items-center px-2", touch && "text-sm px-3 py-1")}>map:</div>
              <MenuSelect
                label={w.mapKey}
                value={w.mapKey}
                items={mapKeys.map((key) => ({ key, value: key }))}
                side="bottom"
                onValueChange={async (key) => {
                  if (!key || key === w.mapKey) return;
                  state.set({ menuOpen: false }); // nothing over the transition
                  await w.net?.leave(); // a manual map switch ends any mirror session first
                  await w.floor?.fadeOut(key);
                  w.e.onChangeMap(); // persist + remove whilst the old map still exists
                  uiStoreApi.setUiMeta(w.id, (draft) => (draft.mapKey = key));
                }}
              />
              {/* reset this map's npcs, lit rooms and locked doors, or take another world's */}
              <div
                className={cn("flex", touch && "items-center border-t border-neutral-800")}
                title="reset, or use another world's npcs, lit rooms, locked doors"
              >
                <MenuSelect
                  label="state"
                  value={null}
                  items={["reset-world-state", ...otherWorldKeys].map((value) => ({
                    key: value === "reset-world-state" ? "reset" : value,
                    el: state.unconfirmed === value ? <span className="text-red-300">confirm</span> : undefined,
                    value,
                  }))}
                  side="bottom"
                  onValueChange={state.onSelectState}
                  open={state.stateSelectOpen}
                  onOpenChange={state.onStateSelectOpenChange}
                />
              </div>
            </div>

            <div className={cn("flex", touch && "items-center border-t border-neutral-800")}>
              <div className={cn("text-white text-xs flex items-center px-2", touch && "text-sm px-3 py-1")}>
                player:
              </div>
              <button
                type="button"
                title="previous player"
                className={cn(
                  "grid place-items-center px-1.5 text-neutral-300 cursor-pointer hover:text-white",
                  touch && "px-3",
                )}
                onClick={(e) => {
                  e.stopPropagation();
                  if (npcKeys.length === 0) return;
                  const currentIdx = npcKeys.indexOf(w.player?.key ?? "");
                  w.player.setKey(npcKeys[(currentIdx - 1 + npcKeys.length) % npcKeys.length]);
                }}
              >
                <CaretLeftIcon className="size-3" />
              </button>
              <MenuSelect
                label={truncateLabel(w.player?.key ?? "no npc", 10)}
                value={w.player?.key ?? ""}
                items={npcKeys.map((k) => ({ key: k, value: k }))}
                side="bottom"
                onValueChange={(v) => v && w.player.setKey(v)}
              />
              <button
                type="button"
                title="next player"
                className={cn(
                  "grid place-items-center px-1.5 text-neutral-300 cursor-pointer hover:text-white",
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

            <div className={sectionHeaderClass(touch)}>debug</div>

            <div
              className={cn("px-2 pb-1 flex items-center", touch && "px-3 pb-2")}
              onClick={(e) => e.stopPropagation()}
            >
              <button
                type="button"
                className={cn(debugButtonClassName(touch, w.view.extraFxEnabled), "shrink-0 whitespace-nowrap")}
                onClick={() => onDebugToggle("extra fx")}
              >
                extra fx
              </button>
              <MenuSelect
                side="bottom"
                className={cn("py-0.5", touch && "py-2")}
                value={w.view.extraFxKey}
                items={extraFxKeys.map((key) => ({ key, value: key }))}
                onValueChange={(next) => {
                  if (next === null || (next === w.view.extraFxKey && w.view.extraFxEnabled)) return;
                  void w.view.runBusy(compilingShadersText, () => w.view.setExtraFx(true, next));
                }}
                open={state.extraFxSelectOpen}
                onOpenChange={state.onExtraFxSelectOpenChange}
              />
            </div>

            <div className={cn("px-2 pb-1 grid grid-cols-2 gap-0.5", touch && "px-3 pb-2 gap-1.5")}>
              {debugItems.map((item) => {
                if (item === "modals") {
                  return (
                    <MenuSelect
                      key={item}
                      caret
                      side="bottom"
                      label={item}
                      className={debugButtonClassName(touch, false)}
                      value={null}
                      items={modalItems}
                      onValueChange={(next) => next !== null && onDebugToggle(next)}
                    />
                  );
                }
                const group = item in debugGroups ? debugGroups[item as DebugGroup].map(withSpotsGreyed) : null;
                const active = group?.map(({ value }) => value).filter(isDebugActive);
                return group !== null && active !== undefined ? (
                  <MenuMultiSelect
                    key={item}
                    label={item}
                    className={debugButtonClassName(touch, active.length > 0)}
                    items={group}
                    value={active}
                    onValueChange={(next) =>
                      group.forEach(
                        ({ value }) => next.includes(value) !== active.includes(value) && onDebugToggle(value),
                      )
                    }
                  />
                ) : (
                  <button
                    key={item}
                    type="button"
                    className={debugButtonClassName(touch, isDebugActive(item))}
                    onClick={(e) => {
                      e.stopPropagation();
                      onDebugToggle(item);
                    }}
                  >
                    {item}
                  </button>
                );
              })}
            </div>

            <div className={cn("px-2 pb-1", touch && "px-3 pb-2")}>
              <button
                type="button"
                className={cn(
                  "w-full cursor-pointer text-xs bg-neutral-700 hover:bg-neutral-600 text-neutral-200 rounded px-2 py-0.5",
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

            {import.meta.env.DEV && (
              <>
                <button
                  type="button"
                  className={cn(sectionHeaderClass(touch), "flex w-full cursor-pointer items-center gap-1 text-left")}
                  onClick={(e) => {
                    e.stopPropagation();
                    state.set({ themeEditorOpen: !state.themeEditorOpen });
                  }}
                >
                  <CaretRightIcon className={cn("size-3", state.themeEditorOpen && "rotate-90")} />
                  edit theme
                </button>
                {state.themeEditorOpen && (
                  <div className="p-2 pt-0 flex flex-col gap-1">
                    <textarea
                      key={w.themeKey}
                      ref={state.ref("themeEditorRef")}
                      className="w-full h-32 select-text bg-neutral-900 text-neutral-200 text-[10px] font-mono p-1 rounded border border-neutral-600 resize-y"
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

                <div className={sectionHeaderClass(touch)}>dev scripts</div>
                <div className="grid grid-cols-[repeat(auto-fit,minmax(6rem,1fr))] px-2">
                  <button
                    type="button"
                    className={cn(
                      "w-full flex items-center justify-center gap-2 cursor-pointer text-xs bg-neutral-700/70 hover:bg-neutral-600 text-neutral-200 border border-neutral-600 px-2 py-1",
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
                          queryKey: ["sheets"],
                        });
                        await queryClientApi.queryClient.invalidateQueries({
                          queryKey: ["obstacle-images"],
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
                      "w-full flex items-center justify-center gap-2 cursor-pointer text-xs bg-neutral-700/70 hover:bg-neutral-600 text-neutral-200 border border-neutral-600 px-2 py-1",
                      touch && "text-sm py-2.5",
                    )}
                    onClick={async (e) => {
                      e.stopPropagation();
                      w.setNextPending({ skins: true });
                      try {
                        const res = await fetch("/api/gen-skin-sheets", { method: "POST" });
                        if (!res.ok) throw new Error(`HTTP ${res.status}`);
                        await queryClientApi.queryClient.invalidateQueries({ queryKey: ["sheets"] });
                        await queryClientApi.queryClient.invalidateQueries({ queryKey: ["skins-and-gltf"] });
                      } catch (err) {
                        console.error("Failed to update skins:", err);
                        w.setNextPending({ skins: false });
                      }
                    }}
                  >
                    skins
                    <ArrowsClockwiseIcon className="size-3.5" />
                  </button>

                  <button
                    type="button"
                    className={cn(
                      "w-full flex items-center justify-center gap-2 cursor-pointer text-xs bg-neutral-700/70 hover:bg-neutral-600 text-neutral-200 border border-neutral-600 px-2 py-1",
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
              </>
            )}
          </MenuShell>

          <button
            type="button"
            data-keep-menu-open
            title={w.disabled ? "resume" : "pause"}
            className="cursor-pointer outline-width-1 grid place-items-center bg-neutral-800 text-white hover:bg-neutral-700 size-9"
            onClick={() => {
              if (state.dragged) return;
              w.setDisabled();
            }}
          >
            {w.disabled ? (
              <PlayIcon alt="resume" className="size-5" weight="bold" />
            ) : (
              <PauseIcon alt="pause" className="size-5" weight="bold" />
            )}
          </button>

          {/* the world shown by room, everything the player cannot see into faded away — see
              `service/fade-rooms`. Cycles `sight` to `sense` to `ship`, the same three the keys `1`,
              `2` and `3` select. The rooms fade INTO the post pass's backdrop, so asking for
              either fading mode switches that on too */}
          <div
            data-keep-menu-open
            title={w.view.fadeRoomsMode}
            className="cursor-pointer outline-width-1 grid place-items-center bg-neutral-800 text-white hover:bg-neutral-700 size-9 touch-none select-none"
            onClick={() => {
              if (state.dragged) return;
              w.view.setFadeRoomsMode();
              state.update();
            }}
          >
            {w.view.fadeRoomsMode === "sight" ? (
              <EyeIcon className="size-5 text-neutral-200" alt="sight" weight="bold" />
            ) : w.view.fadeRoomsMode === "sense" ? (
              <BrainIcon className="size-5 text-neutral-200" alt="sense" weight="fill" />
            ) : (
              <RobotIcon className="size-5 text-neutral-200" alt="ship" weight="bold" />
            )}
          </div>

          {/* game time per real second — see `GameTime.setScale` */}
          <div
            data-keep-menu-open
            title="time scale"
            className="flex flex-col items-center gap-1 bg-neutral-800 py-1.5 w-9"
            onPointerDown={(e) => e.stopPropagation()}
            onDoubleClick={() => w.gameTime.setScale(1)}
          >
            {state.timeSliderOpen && (
              <Slider.Root
                orientation="vertical"
                min={0}
                max={timeScaleStops}
                value={timeScaleToStop(w.gameTime.scale)}
                disabled={w.client}
                onValueChange={(stop) => w.gameTime.setScale(stopToTimeScale(stop))}
                className="h-25"
              >
                {/* padded by half the thumb, which is centred on its value, so it stays clear of the label */}
                <Slider.Control className="flex h-full w-5 cursor-pointer justify-center py-2.5">
                  <Slider.Track className="relative h-full w-1 rounded-full bg-white/50">
                    <Slider.Thumb className="grid size-6 place-items-center rounded-full bg-white text-neutral-800 outline-none">
                      <HourglassMediumIcon className="size-4.5" weight="bold" />
                    </Slider.Thumb>
                  </Slider.Track>
                </Slider.Control>
              </Slider.Root>
            )}
            <button
              type="button"
              title={state.timeSliderOpen ? "hide time scale" : "show time scale"}
              className="cursor-pointer text-[10px] tabular-nums text-neutral-300 hover:text-white"
              onClick={state.toggleTimeSlider}
            >
              {w.gameTime.scale.toFixed(2)}
            </button>
          </div>
        </div>

        <div className="absolute top-full left-0 mt-1 w-max max-w-64 flex flex-col gap-0.5">
          <AnimatePresence>
            {[...toastKeys, ...toggleToastKeys].map((key) => (
              <motion.div
                key={key}
                className="rounded shadow-lg shadow-black/40 bg-neutral-900/95 text-neutral-100 text-xs px-3 py-1.5 wrap-break-word"
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
                    "bg-neutral-900/70 border border-neutral-700 shadow-2xl shadow-black/50",
                  )}
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -8 }}
                  transition={{ duration: 0.15 }}
                  onPointerDown={(e) => e.stopPropagation()}
                >
                  <div className="flex items-center justify-between pl-3 pr-1.5 py-1.5 bg-neutral-800 border-b border-neutral-700">
                    <span className="text-sm text-neutral-300">world</span>
                    <button
                      type="button"
                      className="grid place-items-center size-9 rounded text-neutral-300 cursor-pointer hover:bg-neutral-700"
                      onClick={() => state.set({ menuOpen: false })}
                    >
                      <XIcon className="size-4" weight="bold" />
                    </button>
                  </div>
                  <div className="flex-1 overflow-y-auto overscroll-contain scrollbar-thin pb-6">{children}</div>
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
      // not modal: a click on the world whilst the menu is up both closes it and lands, as a pick
      modal={false}
      onOpenChange={(open, { reason, event }) => {
        if (open) {
          state.set({ menuOpen: true });
        } else if (state.debugHitOpen || state.gmGraphsOpen || state.skinDebugOpen) {
          // a press or escape in a debug modal is for the modal
        } else if (
          reason === "outside-press" &&
          (event.target as HTMLElement).closest?.("[data-keep-menu-open]") != null
        ) {
          // panning to the player, or pausing, should not close the menu
        } else if (reason === "outside-press" && w.rootEl?.contains(event.target as Node) === false) {
          // nor should a press outside the World e.g. typing in a tty beside it
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
          className="z-50 overflow-auto scrollbar-thin max-w-[calc(100%-40px)]"
          side="right"
          sideOffset={4}
          align="start"
        >
          <Menu.Popup
            className="relative select-none bg-neutral-800/70 border border-neutral-700 rounded-md shadow-lg py-1"
            style={{ width: state.menuWidth }}
            // the portal still propagates React events to the draggable column, so a press
            // anywhere in the popup would otherwise start dragging it up and down
            onPointerDown={(e) => e.stopPropagation()}
          >
            <div
              className="flex flex-col overflow-y-auto scrollbar-thin pb-6"
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
                  "absolute bottom-1 right-1 size-2.5 border-b-2 border-r-2 border-neutral-600 rounded-br",
                  state.resizing && "border-neutral-400",
                )}
              />
            </div>
            {/* and from the top-right, which moves the column with it */}
            <div
              className="absolute top-0 right-0 size-5 touch-none cursor-nesw-resize"
              onMouseDown={(e) => state.onResizeMouseDown(e, true)}
              onTouchStart={(e) => state.onResizeTouchStart(e, true)}
            >
              <div
                className={cn(
                  "absolute top-1 right-1 size-2.5 border-t-2 border-r-2 border-neutral-600 rounded-tr",
                  state.resizing && "border-neutral-400",
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
/** The two lights the slider below switches between: the environment's, and the npcs' own */
const lights = {
  // biome-ignore format: succinct
  world: { icon: GlobeSimpleIcon, label: "environment", min: 0.5, max: 2, step: 0.1, fallback: defaultBrightness, color: "text-orange-400" },
  // biome-ignore format: succinct
  npc: { icon: PersonSimpleIcon, label: "npc", min: 0.1, max: 1.5, step: 0.05, fallback: null, color: "text-yellow-300" },
} as const;

/** How long the button must be held to restore its light's default */
const lightResetHoldMs = 500;

/** ONE slider for both: the button says which and a click swaps them, a hold resets the one shown. Site-wide */
function LightSlider({ touch }: { touch: boolean }) {
  const w = useContext(WorldContext);
  const store = getSiteStore();
  const [key, setKey] = useState(() => store.read().lightKey);
  const { icon: WhichIcon, label, min, max, step, fallback, color } = lights[key];
  const other = key === "npc" ? "world" : "npc";
  const value = key === "npc" ? w.npcBrightness : w.brightness;
  const timeoutId = useRef(0);
  /** Whether the hold already fired, so the click ending it does not also swap */
  const held = useRef(false);
  const endPress = () => window.clearTimeout(timeoutId.current);

  /** `null` is the default: the npcs' is their theme's, so the override of it is dropped */
  function apply(next: null | number) {
    if (key === "npc") {
      const { [w.themeKey]: _, ...rest } = store.read().npcBrightnessByTheme;
      store.patch({ npcBrightnessByTheme: next === null ? rest : { ...rest, [w.themeKey]: next } });
      w.npcBrightness = next ?? w.getTheme().npcs.brightness;
      w.npc?.setBrightness(w.npcBrightness); // a uniform, unlike the world's css filter; absent until they are
    } else if (next !== null) {
      w.brightness = next;
      store.patch({ brightness: next });
    }
    w.update();
  }

  return (
    <div
      className={cn(
        "flex items-center gap-2 px-2 py-1.5 text-xs text-neutral-300",
        touch && "flex-1 min-w-0 gap-2 px-3 py-2 text-sm",
      )}
    >
      <button
        type="button"
        className={cn("cursor-pointer select-none hover:brightness-125", color)}
        title={`${label} brightness — click for ${lights[other].label}, hold to reset`}
        // the panel drags off a pointerdown anywhere in it, which a press being held is not
        onPointerDown={(e) => {
          e.stopPropagation();
          held.current = false;
          timeoutId.current = window.setTimeout(() => {
            held.current = true;
            apply(fallback);
          }, lightResetHoldMs);
        }}
        onPointerUp={endPress}
        onPointerLeave={endPress}
        onPointerCancel={endPress}
        onContextMenu={(e) => e.preventDefault()} // touch's own long press
        onClick={(e) => {
          e.stopPropagation();
          if (held.current === true) return;
          setKey(other);
          store.patch({ lightKey: other });
        }}
      >
        <WhichIcon className="size-4" weight="bold" />
      </button>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => apply(Number(e.target.value))}
        onClick={(e) => e.stopPropagation()}
        className={rangeInputClass(touch, touch ? "flex-1" : "w-24")}
      />
      <span className="w-9 text-right tabular-nums text-neutral-400">{value.toFixed(step < 0.1 ? 2 : 1)}×</span>
    </div>
  );
}

/** The camera's framing: presets in its row, the fov and each stop's view in a pop-up. Site-wide */
function CameraSliders({ touch }: { touch: boolean }) {
  const w = useContext(WorldContext);
  const view = w.view?.cameraView ?? getDefaultCameraView();
  /** Toggled by its button alone: it stays open beside the menu, and goes with it */
  const [slidersOpen, setSlidersOpen] = useState(false);

  /** The far view never below the near, so the stops never cross */
  function set(next: null | CameraView) {
    if (next !== null) next.farView = Math.max(next.farView, next.nearView);
    w.view.setCameraView(next);
    w.menu?.update();
  }

  const rows = [
    { key: "fov", label: "fov", min: 15, max: 60, step: 1, unit: "°" },
    { key: "nearView", label: "near", min: minNearView, max: 20, step: 0.1, unit: "m" },
    { key: "farView", label: "far", min: 3, max: 40, step: 0.1, unit: "m" },
  ] as const;
  const chip = "cursor-pointer rounded px-1 hover:bg-white/10";

  return (
    // under `camera:`, on its background and indented, as a part of it
    <div
      className={cn(
        "flex items-center gap-1 bg-neutral-700 pr-2 pb-1 pl-5 text-xs text-neutral-300",
        touch && "pr-3 pl-6 text-sm",
      )}
    >
      <span className="text-neutral-400">framing</span>
      {(Object.keys(cameraPresets) as (keyof typeof cameraPresets)[]).map((name) => {
        const preset = getPresetCameraView(name);
        const active = preset.fov === view.fov && Math.abs(preset.nearView - view.nearView) < 0.05;
        return (
          <button
            key={name}
            type="button"
            title={`${preset.fov}°, near ${preset.nearView.toFixed(1)} m: - and + step through them`}
            className={cn(chip, active && "bg-white/15 text-white", name === "low" && "ml-auto")}
            onClick={(e) => {
              e.stopPropagation();
              set(preset);
            }}
          >
            {name}
          </button>
        );
      })}
      <button
        type="button"
        title="the device's defaults"
        className={chip}
        onClick={(e) => {
          e.stopPropagation();
          set(null);
        }}
      >
        <ArrowCounterClockwiseIcon className="size-3.5" />
      </button>
      <Popover.Root
        open={slidersOpen}
        onOpenChange={(next, details) => details.reason === "trigger-press" && setSlidersOpen(next)}
      >
        <Popover.Trigger
          title="fov, and the floor seen at each zoom stop"
          className={cn(chip, slidersOpen && "bg-white/15 text-white")}
          onClick={(e) => e.stopPropagation()}
        >
          <SlidersHorizontalIcon className="size-3.5" />
        </Popover.Trigger>
        <Popover.Portal container={w.rootEl}>
          <Popover.Positioner className="z-50" side="right" align="start" sideOffset={6}>
            <Popover.Popup
              className="flex gap-3 rounded-md border border-neutral-500/40 bg-neutral-900/95 px-3 py-2 text-xs text-neutral-300"
              // portalled, its presses still bubble to the menu through React, which would drag it
              onPointerDown={(e) => e.stopPropagation()}
            >
              {rows.map(({ key, label, min, max, step, unit }) => (
                <div
                  key={key}
                  className="flex flex-col items-center gap-1"
                  // the floor seen is the slider; the stop it implies, at this fov, is its tooltip
                  title={
                    key === "fov"
                      ? "vertical field of view"
                      : `${distanceOfView(view[key], view.fov).toFixed(1)} m away`
                  }
                >
                  <span>{label}</span>
                  <Slider.Root
                    orientation="vertical"
                    min={key === "farView" ? view.nearView : min}
                    max={max}
                    step={step}
                    value={view[key]}
                    onValueChange={(value) => set({ ...view, [key]: value as number })}
                    className={touch ? "h-32" : "h-24"}
                  >
                    <Slider.Control className="flex h-full w-5 cursor-pointer justify-center py-1.5">
                      <Slider.Track className="relative h-full w-1 rounded-full bg-white/40">
                        <Slider.Thumb
                          className={cn("rounded-full bg-white outline-none", touch ? "size-5" : "size-3")}
                        />
                      </Slider.Track>
                    </Slider.Control>
                  </Slider.Root>
                  <span className="tabular-nums text-neutral-400">
                    {view[key].toFixed(step < 1 ? 1 : 0)}
                    {unit}
                  </span>
                </div>
              ))}
            </Popover.Popup>
          </Popover.Positioner>
        </Popover.Portal>
      </Popover.Root>
    </div>
  );
}

/** Small square icon button used to pack several toggles/actions into one row in the lights menu */
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
        touch && "size-10 bg-neutral-800",
        danger
          ? "text-red-300 hover:bg-red-900/40"
          : active
            ? "bg-neutral-700 text-white"
            : "text-neutral-500 hover:bg-neutral-700",
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
          "text-[10px] text-neutral-400",
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

/**
 * Something whose click must be confirmed by a second one — extend as more controls need it.
 * A plain `string` is a `worldKey`, whose map state the `state` select restores from
 */
export type Unconfirmed = "reset-camera" | "remount-world" | "reset-world-state" | (string & {});

export type State = {
  debugHitOpen: boolean;
  gmGraphsOpen: boolean;
  skinDebugOpen: boolean;
  /** The column was just dragged, so the button released on swallows its click */
  dragged: boolean;
  menuOpen: boolean;
  themeEditorOpen: boolean;
  themeEditorRef: HTMLTextAreaElement;
  toastTs: Record<string, number>;
  y: number;
  minY: number;
  /** Width (px) of the main menu popup — resizable, persisted */
  menuWidth: number;
  /** Height (px) of the main menu popup's scrollable body — resizable, persisted */
  menuHeight: number;
  resizing: boolean;
  /** Clicked once and awaiting its confirming click — `null` when nothing is */
  unconfirmed: null | Unconfirmed;
  unconfirmedTimeoutId: number;
  /** Controlled, so an unconfirmed option can keep the popup open — see `onStateSelectOpenChange` */
  stateSelectOpen: boolean;
  timeSliderOpen: boolean;
  /** Shows or hides the time scale slider, keeping its number */
  toggleTimeSlider(): void;
  /** Controlled, so picking an extra fx keeps the popup open */
  extraFxSelectOpen: boolean;
  /** `true` if this click confirms `value`; otherwise `value` becomes the unconfirmed one */
  confirm(value: Unconfirmed): boolean;
  clearUnconfirmed(): void;
  /** Either restore this map's state from another world, or reset it — each after confirming */
  onSelectState(value: null | string): void;
  onExtraFxSelectOpenChange(open: boolean, reason: Select.Root.ChangeEventReason): void;
  /** Resets the camera, after confirming */
  onResetCamera(): void;
  /** Remounts the World via its ui meta's `mountKey`, after confirming */
  onRemountWorld(): void;
  onStateSelectOpenChange(open: boolean, reason: Select.Root.ChangeEventReason): void;
  getMaxY(): number;
  getClampedY(y: number): number;
  getMaxMenuWidth(): number;
  getClampedMenuWidth(width: number): number;
  getMaxMenuHeight(): number;
  getClampedMenuHeight(height: number): number;
  onResize(): void;
  /** `startMenuY` is the column's `y` as a resize from the TOP began */
  setMenuHeight(startHeight: number, dy: number, startMenuY?: number): void;
  onResizeMouseDown(e: React.MouseEvent, top?: boolean): void;
  onResizeTouchStart(e: React.TouchEvent, top?: boolean): void;
  persistY(): void;
  persistMenuSize(): void;
  saveThemeDev(): Promise<void>;
  saveThemeDevDebounced(): void;
};

/** Enlarges the menu controls on touch devices */
const touchDeviceZoom = 1.25;

/** A section's label row, e.g. "player" or "debug" — every section is always unfolded */
const sectionHeaderClass = (touch: boolean) =>
  cn("px-2 py-1 text-xs text-neutral-400", touch && "px-3 py-2.5 text-sm border-t border-neutral-800");

/** Every `<input type="range">` in the menu — touch gets a fatter thumb and more room to drag */
/** The time scale slider's stops: its bottom half is logarithmic from `0` to `1`, its top half linear to `2` */
const timeScaleStops = 200;
const stopToTimeScale = (stop: number) =>
  stop === 0 ? 0 : stop <= 100 ? 2 ** (stop / 20 - 5) : 1 + (stop - 100) / 100;
const timeScaleToStop = (scale: number) =>
  scale <= 0
    ? 0
    : scale <= 1
      ? Math.max(1, Math.round(20 * (Math.log2(scale) + 5)))
      : Math.min(timeScaleStops, Math.round(100 + 100 * (scale - 1)));

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

/** How long something stays unconfirmed, before it forgets it was ever clicked */
const confirmMs = 5000;

const minMenuWidth = 200;
const minMenuHeight = 120;
/** How long a toast lingers after its pending key clears */
const toastLingerMs = 2000;
/** Minimum time the trigger's spinner stays up */
const spinnerMinMs = 300;

const cameraModes: CameraModeType[] = ["free", "embodied"];
const debugItems = ["door ui", "hud debug", "modals", "npcs", "overlay", "post fx", "rgb shift", "view pick"] as const;

/** Shorten a select trigger's displayed label (e.g. an npc/symbol key) to fit the compact lights grid */
const truncateLabel = (label: string, max = 5) => (label.length > max ? `${label.slice(0, max)}…` : label);

/** Debug options merged into one multiselect, by its label */
const debugGroups = {
  npcs: [
    { key: "contextmenu", value: "npc contextmenu" },
    { key: "lit", value: "lit npcs" },
    { key: "outline", value: "npc outline" },
  ],
  overlay: [
    "colliders",
    "decor points",
    "decorations",
    "door normals",
    "grid",
    "navmesh",
    "room outlines",
    "spots",
  ].map((value) => ({
    key: value,
    value,
  })),
  "door ui": [
    { key: "pick", value: "pick doors" },
    { key: "toggle", value: "toggle doors" },
  ],
};

type DebugGroup = keyof typeof debugGroups;

/** Debug options that each open a modal, picked from "modals" */
const modalItems = ["graphs", "room hit", "skins"].map((value) => ({ key: value, value }));

const debugButtonClassName = (touch: boolean, active: boolean) =>
  cn(
    "text-xs px-1.5 py-0.5 rounded cursor-pointer text-left",
    touch && "text-sm px-2 py-2 bg-neutral-800",
    active ? "text-amber-300 bg-neutral-700" : "text-neutral-400 hover:bg-neutral-700 hover:text-neutral-200",
  );

/** Marks `selected` from our `value`, since base-ui keeps the old index selected whilst open */
const selectItemClassName = (touch: boolean, selected: boolean) =>
  cn(
    "px-2 py-1 text-xs cursor-pointer text-neutral-300 data-highlighted:bg-neutral-700",
    selected && "text-amber-300",
    touch && "px-3 py-2.5 text-sm",
  );

export function MenuSelect<T extends string>({
  caret,
  className,
  items,
  label,
  side = "right",
  value,
  onValueChange,
  open,
  onOpenChange,
}: {
  /** Shows a down-caret, so it reads as a select rather than a button */
  caret?: boolean;
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
          "flex items-center gap-1 px-2 py-1 text-xs text-neutral-300 cursor-pointer hover:bg-neutral-700 w-full min-w-0",
          touch && "px-3 py-2 text-sm",
          className,
          caret && "justify-between",
        )}
      >
        <Select.Value placeholder={label} className="truncate">
          {label ?? items.find((item) => item.value === value)?.key ?? label}
        </Select.Value>
        {caret && <CaretDownIcon className="size-3 shrink-0 opacity-60" />}
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
          <Select.Popup className="bg-neutral-800 border border-neutral-700 rounded shadow-lg py-1 max-h-60 overflow-auto scrollbar-thin">
            <Select.List>
              {items.map((item) => (
                <Select.Item
                  key={item.key}
                  value={item.value}
                  className={selectItemClassName(touch, item.value === value)}
                >
                  <Select.ItemText>{item.el ?? item.key}</Select.ItemText>
                </Select.Item>
              ))}
            </Select.List>
          </Select.Popup>
        </Select.Positioner>
      </Select.Portal>
    </Select.Root>
  );
}

/** Like `MenuSelect`, but each item toggles, and the popup stays open */
function MenuMultiSelect<T extends string>({
  className,
  items,
  label,
  side = "bottom",
  value,
  onValueChange,
}: {
  className?: string;
  items: { key: string; value: T; disabled?: boolean }[];
  label: string;
  side?: "left" | "right" | "bottom" | "top";
  value: T[];
  onValueChange: (value: T[]) => void;
}) {
  const w = useContext(WorldContext);
  const touch = w.touchDevice;

  return (
    <Select.Root multiple value={value} onValueChange={onValueChange}>
      <Select.Trigger className={cn(className, "flex items-center justify-between gap-1")}>
        {label}
        <CaretDownIcon className="size-3 shrink-0 opacity-60" />
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
          <Select.Popup className="bg-neutral-800 border border-neutral-700 rounded shadow-lg py-1 max-h-60 overflow-auto scrollbar-thin">
            <Select.List>
              {items.map((item) => (
                <Select.Item
                  key={item.key}
                  value={item.value}
                  disabled={item.disabled}
                  className={cn(
                    selectItemClassName(touch, value.includes(item.value)),
                    "data-disabled:opacity-40 data-disabled:cursor-default",
                  )}
                >
                  <Select.ItemText>{item.key}</Select.ItemText>
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
    return () => {
      Object.values(timers.current).forEach(clearTimeout);
      timers.current = {}; // a Fast Refresh re-runs the effect above, which must re-arm them
    };
  }, []);

  return visible;
}
