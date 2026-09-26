import { Menu } from "@base-ui/react/menu";
import { Select } from "@base-ui/react/select";
import { UiContext } from "@npc-cli/ui-sdk/UiContext";
import { cn, Spinner, type UseStateRef, useStateRef } from "@npc-cli/util";
import { hashJson } from "@npc-cli/util/legacy/generic";
import {
  ArrowsClockwiseIcon,
  BrainIcon,
  CaretRightIcon,
  CrosshairSimpleIcon,
  EyeIcon,
  GlobeSimpleIcon,
  GlobeStandIcon,
  type Icon,
  type IconWeight,
  PauseIcon,
  PersonSimpleCircleIcon,
  PersonSimpleIcon,
  PlayIcon,
  RobotIcon,
  SunIcon,
  XIcon,
} from "@phosphor-icons/react";
import debounce from "debounce";
import { AnimatePresence, motion, useDragControls, useMotionValue } from "motion/react";
import type React from "react";
import { useContext, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { WorldThemeSchema } from "../assets.schema";
import {
  compilingShadersText,
  defaultBrightness,
  defaultNpcBrightness,
  type FollowMode,
  followModes,
} from "../const.env";
import { GeomorphGraphsModal, RoomHitModal, SkinsModal } from "../service/debug";
import { queryClientApi } from "../service/query-client";
import { getWorldStore, listWorldKeysWithMap } from "../service/storage";
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
      lookLongPressed: false,
      lookTimeoutId: 0,
      lookEl: null as null | HTMLDivElement,
      followMenuOpen: false,
      menuWidth: saved.menuWidth,
      minY: 40,
      menuOpen: false,
      menuHeight: saved.menuHeight,
      resizing: false,
      skinDebugOpen: false,
      stateSelectOpen: false,
      themeEditorRef: null as any,
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

      // a short press is `WorldView`'s `onLookGesture`, as `f` is; a long one opens the follow menu
      onLookPressStart() {
        state.lookLongPressed = false;
        state.lookTimeoutId = window.setTimeout(() => {
          if (state.dragged === true) return; // dragging the column is not a press
          state.lookLongPressed = true;
          state.set({ followMenuOpen: true });
        }, lookLongPressMs);
      },
      onLookPressEnd(cancelled = false) {
        window.clearTimeout(state.lookTimeoutId);
        if (cancelled === false && state.dragged === false && state.lookLongPressed === false) {
          w.view.onLookGesture(false);
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
      case "view pick":
        return w.view.objectPick?.value === 1;
      case "post fx":
        return w.view.postProcessing ?? false;
      case "npc outline":
        return w.view.npcOutline ?? false;
      case "rgb shift":
        return w.view.rgbShift ?? false;
      case "room outlines":
        return w.view.roomOutline ?? false;
      case "lit npcs":
        return w.view.litNpcsEnabled?.value === 1;
      case "psi":
        return w.psi?.shown ?? false;
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
      case "npc contextmenu":
        return w.debug?.npcContextMenu ?? false;
      default:
        return false;
    }
  };

  const onDebugToggle = (item: string) => {
    switch (item) {
      case "view pick":
        w.view.objectPick.value = w.view.objectPick.value === 1 ? 0 : 1;
        w.view.forceUpdate();
        break;
      case "post fx":
        // both rebuild the post pass, whose shader compile can stall a phone for a moment
        void w.view.runBusy(compilingShadersText, () => {
          w.view.setPostProcessingEnabled();
          state.update();
        });
        break;
      case "npc outline":
        void w.view.runBusy(compilingShadersText, () => {
          w.view.setNpcOutlineEnabled();
          state.update();
        });
        break;
      case "rgb shift":
        // hung off the post pass, so it needs "post fx" on to show
        void w.view.runBusy(compilingShadersText, () => {
          w.view.setRgbShiftEnabled();
          state.update();
        });
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
        state.set({ menuOpen: false, debugHitOpen: true });
        break;
      case "graphs":
        state.set({ menuOpen: false, gmGraphsOpen: true });
        break;
      case "skins":
        state.set({ menuOpen: false, skinDebugOpen: true });
        break;
      case "colliders":
        w.debug?.showPhysicsColliders();
        w.update();
        break;
      case "grid":
        w.debug?.set({ gridShown: !w.debug.gridShown });
        void w.floor?.draw().then(() => w.update());
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
      case "psi":
        w.psi?.setShown(!w.psi.shown);
        state.update();
        break;
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
    }
  };

  const pendingKeys = Object.keys(w.pending);
  const toastKeys = useToastKeys(pendingKeys, toastLingerMs);
  // held briefly, else a fast load just flickers the trigger
  const spinnerKeys = useToastKeys(pendingKeys, spinnerMinMs);
  const toggleToastKeys = useToastTs(state.toastTs);
  // a flash over the look button whenever follow is toggled — by this button, by the row in the
  // debug list, or by `f`. Any of them lands here, since it watches the VALUE
  const followFlash = useChangeCount(w.view.followMode);

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
            <div className={cn("flex justify-end", touch && "max-w-none items-stretch")}>
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
                  title={`follow the player: ${w.view.followMode}`}
                  onClick={() => w.view.setFollowMode(w.view.followMode === "off" ? w.view.followLast : "off")}
                >
                  <CrosshairSimpleIcon
                    className={cn(
                      "size-3.5 cursor-pointer",
                      w.view.followMode !== "off" ? "text-amber-300" : "hover:text-white",
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
                  {state.unconfirmed === "reset-camera" && "confirm"}
                  <ArrowsClockwiseIcon className="size-3.5" />
                </span>
              </div>
            </div>

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
              <MenuSelect
                label={truncateLabel(w.player?.key ?? "no npc", 10)}
                value={w.player?.key ?? ""}
                items={npcKeys.map((k) => ({ key: k, value: k }))}
                side="bottom"
                onValueChange={(v) => v && w.player.setKey(v)}
              />
              <button
                type="button"
                title="cycle player"
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

            <div className={cn("px-2 pb-1 grid grid-cols-2 gap-0.5", touch && "px-3 pb-2 gap-1.5")}>
              {debugItems.map((item) => (
                <button
                  key={item}
                  type="button"
                  className={cn(
                    "text-xs px-1.5 py-0.5 rounded cursor-pointer text-left",
                    touch && "text-sm px-2 py-2 bg-neutral-800",
                    isDebugActive(item)
                      ? "text-amber-300 bg-neutral-700"
                      : "text-neutral-400 hover:bg-neutral-700 hover:text-neutral-200",
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
                <div className={sectionHeaderClass(touch)}>edit theme</div>
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

                <div className={sectionHeaderClass(touch)}>dev scripts</div>
                <div className={cn("flex px-2")}>
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

          {/* a press looks at the player, or stops a follow (amber); a long press opens the follow menu.
              `f` is the same press, and held toggles the follow — see `WorldView`'s `onLookGesture` */}
          <div
            data-keep-menu-open
            className="relative cursor-pointer outline-width-1 grid place-items-center bg-neutral-800 text-white hover:bg-neutral-700 size-9 touch-none select-none"
            ref={state.ref("lookEl")}
            title={`camera: ${w.view.cameraMode}, follow ${w.view.followMode} (long press to choose, hold f to toggle)`}
            onPointerDown={() => state.onLookPressStart()}
            onPointerUp={() => state.onLookPressEnd()}
            onPointerLeave={() => state.onLookPressEnd(true)}
            onContextMenu={(e) => e.preventDefault()}
          >
            {w.view.lookingAt === true && (
              // pulses whilst a pan is under way, which a black screen or a paused world would
              // otherwise hide
              <motion.div
                className="absolute inset-0 pointer-events-none bg-white/60"
                initial={{ opacity: 0 }}
                animate={{ opacity: 0.5 }}
                transition={{ duration: lookingAtPulseMs / 1000, repeat: Infinity, repeatType: "reverse" }}
              />
            )}
            {followFlash > 0 && (
              // keyed by the count, so each toggle remounts it and replays the fade from the top
              <motion.div
                key={followFlash}
                className={cn(
                  "absolute inset-0 pointer-events-none",
                  w.view.followMode !== "off" ? "bg-amber-300" : "bg-neutral-400",
                )}
                initial={{ opacity: 0.55 }}
                animate={{ opacity: 0 }}
                transition={{ duration: followFlashMs / 1000, ease: "easeOut" }}
              />
            )}
            <PersonSimpleCircleIcon
              className={cn("size-5 relative", w.view.followMode !== "off" && "text-amber-300")}
              alt="look/follow"
            />
          </div>

          <Menu.Root
            open={state.followMenuOpen}
            onOpenChange={(open) => open === false && state.set({ followMenuOpen: false })}
            modal={false}
          >
            <Menu.Portal container={w.rootEl}>
              <Menu.Positioner anchor={state.lookEl} side="right" sideOffset={4} className="z-50">
                <Menu.Popup
                  data-keep-menu-open
                  className="select-none bg-neutral-800/90 border border-neutral-700 rounded-md shadow-lg py-1 text-xs"
                  onPointerDown={(e) => e.stopPropagation()} // else the draggable column takes it
                >
                  <Menu.RadioGroup
                    value={w.view.followMode}
                    onValueChange={(mode: FollowMode) => {
                      w.view.setFollowMode(mode);
                      state.set({ followMenuOpen: false });
                    }}
                  >
                    {followModes.map((mode) => (
                      <Menu.RadioItem
                        key={mode}
                        value={mode}
                        className={cn(
                          "px-3 py-1 cursor-pointer text-neutral-300 hover:bg-neutral-700 data-checked:text-amber-300",
                          touch && "py-2 text-sm",
                        )}
                      >
                        {mode}
                      </Menu.RadioItem>
                    ))}
                  </Menu.RadioGroup>
                </Menu.Popup>
              </Menu.Positioner>
            </Menu.Portal>
          </Menu.Root>
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
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}

/** A menu row: a real `Menu.Item` in the desktop popup, a plain row in the touch panel */
/** The two lights the slider below switches between: the environment's, and the npcs' own */
const lights = {
  world: { icon: GlobeSimpleIcon, label: "environment", min: 0.5, max: 2, step: 0.1, fallback: defaultBrightness },
  npc: { icon: PersonSimpleIcon, label: "npc", min: 0.1, max: 1.5, step: 0.05, fallback: defaultNpcBrightness },
} as const;

/** How long the icon must be held to restore a light's default */
const lightResetHoldMs = 500;

/** ONE slider for both: a toggle says which, the brightness icon shows its level and a hold resets it */
function LightSlider({ touch }: { touch: boolean }) {
  const w = useContext(WorldContext);
  const store = getWorldStore(w.key);
  const [key, setKey] = useState<keyof typeof lights>("world");
  const { icon: WhichIcon, label, min, max, step, fallback } = lights[key];
  const other = key === "npc" ? "world" : "npc";
  const value = key === "npc" ? w.npcBrightness : w.brightness;

  function apply(next: number) {
    if (key === "npc") {
      w.npcBrightness = next;
      w.npc?.setBrightness(next); // a uniform, unlike the world's css filter; absent until they are
      store.patch({ npcBrightness: next });
    } else {
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
      <BrightnessPie
        icon={SunIcon}
        weight="bold"
        title={`${label} brightness — hold to reset`}
        // the world's is detented at its default, the npcs' plainly linear
        ratio={key === "npc" ? (value - min) / (max - min) : brightnessToRatio(value)}
        onHold={() => apply(fallback)}
      />
      <button
        type="button"
        className="cursor-pointer text-neutral-300 hover:text-white"
        title={`${label} brightness — click for ${lights[other].label}`}
        onClick={(e) => {
          e.stopPropagation();
          setKey(other);
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

/** An icon with a pie-chart fill showing a brightness ratio (0–1), and a press that can be held */
function BrightnessPie({
  icon: IconCmp,
  weight,
  ratio,
  title,
  onClick,
  onHold,
}: {
  icon: Icon;
  weight?: IconWeight;
  ratio: number;
  title?: string;
  onClick?: () => void;
  onHold?: () => void;
}) {
  const a = Math.min(1, Math.max(0, ratio)) * Math.PI * 2;
  const timeoutId = useRef(0);
  /** Whether the hold already fired, so the click ending it is not also taken as a tap */
  const held = useRef(false);
  const endPress = () => window.clearTimeout(timeoutId.current);

  return (
    <div
      className="relative size-4 cursor-pointer select-none"
      title={title}
      // the panel drags off a pointerdown anywhere in it, which a press being held is not
      onPointerDown={(e) => {
        e.stopPropagation();
        held.current = false;
        timeoutId.current = window.setTimeout(() => {
          held.current = true;
          onHold?.();
        }, lightResetHoldMs);
      }}
      onPointerUp={endPress}
      onPointerLeave={endPress}
      onPointerCancel={endPress}
      onContextMenu={(e) => e.preventDefault()} // touch's own long press
      onClick={(e) => {
        e.stopPropagation();
        held.current === false && onClick?.();
      }}
    >
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
      {/* over the fill, never under it — `relative` puts it last in the paint order */}
      <IconCmp className="relative size-4 text-white" weight={weight} />
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
export type Unconfirmed = "reset-camera" | "reset-world-state" | (string & {});

export type State = {
  debugHitOpen: boolean;
  gmGraphsOpen: boolean;
  skinDebugOpen: boolean;
  /** The column was just dragged, so the button released on swallows its click */
  dragged: boolean;
  menuOpen: boolean;
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
  /** Whether the look button has been held long enough to have switched camera mode */
  lookLongPressed: boolean;
  lookTimeoutId: number;
  lookEl: null | HTMLDivElement;
  /** Opened by a long press on the look button — see `onLookPressStart` */
  followMenuOpen: boolean;
  /** A click looks at the player; a long press switches camera mode — the badge it wears */
  onLookPressStart(): void;
  onLookPressEnd(cancelled?: boolean): void;
  /** Controlled, so an unconfirmed option can keep the popup open — see `onStateSelectOpenChange` */
  stateSelectOpen: boolean;
  /** `true` if this click confirms `value`; otherwise `value` becomes the unconfirmed one */
  confirm(value: Unconfirmed): boolean;
  clearUnconfirmed(): void;
  /** Either restore this map's state from another world, or reset it — each after confirming */
  onSelectState(value: null | string): void;
  /** Resets the camera, after confirming */
  onResetCamera(): void;
  onStateSelectOpenChange(open: boolean, reason: Select.Root.ChangeEventReason): void;
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

/** A section's label row, e.g. "player" or "debug" — every section is always unfolded */
const sectionHeaderClass = (touch: boolean) =>
  cn("px-2 py-1 text-xs text-neutral-400", touch && "px-3 py-2.5 text-sm border-t border-neutral-800");

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

/** How long something stays unconfirmed, before it forgets it was ever clicked */
const confirmMs = 5000;

const minMenuWidth = 200;
const minMenuHeight = 120;
/** How long a toast lingers after its pending key clears */
const toastLingerMs = 2000;
/** Minimum time the trigger's spinner stays up */
const spinnerMinMs = 300;
/** How long the look button must be held before it switches camera mode rather than looking */
const lookLongPressMs = 500;
/** How long the look button's flash takes to fade, when follow is turned on or off */
const followFlashMs = 550;
/** Half a pulse of the look button, whilst a pan is under way */
const lookingAtPulseMs = 350;

const cameraModes: CameraModeType[] = ["free", "canonical"];
const debugItems = [
  "view pick",
  "post fx",
  "npc outline",
  "rgb shift",
  "room outlines",
  "lit npcs",
  "psi",
  "room hit",
  "graphs",
  "skins",
  "colliders",
  "grid",
  "toggle doors",
  "pick doors",
  "door normals",
  "decor points",
  "decorations",
  "npc contextmenu",
  "navmesh",
] as const;

/** Shorten a select trigger's displayed label (e.g. an npc/symbol key) to fit the compact lights grid */
const truncateLabel = (label: string, max = 5) => (label.length > max ? `${label.slice(0, max)}…` : label);

const selectItemClassName = (touch: boolean) =>
  cn(
    "px-2 py-1 text-xs cursor-pointer text-neutral-300",
    "data-highlighted:bg-neutral-700 data-selected:text-amber-300",
    touch && "px-3 py-2.5 text-sm",
  );

export function MenuSelect<T extends string>({
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
          "flex items-center gap-1 px-2 py-1 text-xs text-neutral-300 cursor-pointer hover:bg-neutral-700 w-full min-w-0",
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
          <Select.Popup className="bg-neutral-800 border border-neutral-700 rounded shadow-lg py-1 max-h-60 overflow-auto scrollbar-thin">
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

/** How many times `value` has changed since mount — `0` until the first, so nothing flashes on load */
function useChangeCount(value: unknown): number {
  const [count, setCount] = useState(0);
  const previous = useRef(value);

  useEffect(() => {
    if (previous.current === value) return;
    previous.current = value;
    setCount((x) => x + 1);
  }, [value]);

  return count;
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
