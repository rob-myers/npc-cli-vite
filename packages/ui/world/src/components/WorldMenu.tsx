import { Dialog } from "@base-ui/react/dialog";
import { Menu } from "@base-ui/react/menu";
import { uiClassName } from "@npc-cli/ui-sdk/const";
import { UiContext } from "@npc-cli/ui-sdk/UiContext";
import { cn, Spinner, useStateRef } from "@npc-cli/util";
import { hashJson, tryLocalStorageGetParsed, tryLocalStorageSet } from "@npc-cli/util/legacy/generic";
import { CaretDownIcon, CaretRightIcon, GlobeStandIcon, SunIcon, XIcon } from "@phosphor-icons/react";
import { motion, useMotionValue } from "motion/react";
import { ANY_QUERY_FILTER, findRandomPoint } from "navcat";
import { useCallback, useContext, useMemo, useRef, useState } from "react";
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
      debugHitOpen: false,
      gmGraphsOpen: false,
      skinDebugOpen: false,
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
    <>
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
                    const result = findRandomPoint(w.nav.navMesh, ANY_QUERY_FILTER, Math.random);
                    if (!result.success) return;
                    const [x, y, z] = result.position;
                    const key = `npc-${Date.now().toString(36)}`;
                    w.npc.spawn({ npcKey: key, at: [x, y, z] });
                    w.update();
                  }}
                >
                  Spawn NPC
                </Menu.Item>

                <Menu.Item
                  className="flex items-center gap-2 px-2 py-1 text-xs text-slate-300 hover:bg-slate-700 cursor-pointer"
                  closeOnClick={false}
                  onClick={() => {
                    w.npc.remove(...Object.keys(w.npc.npc));
                    w.view.forceUpdate();
                  }}
                >
                  Clear NPCs
                </Menu.Item>

                <div className="my-1 border-t border-slate-700" />
                <div className="px-2 py-0.5 text-[10px] text-slate-500 uppercase tracking-wider">Debug</div>

                <Menu.Item
                  className="flex items-center gap-2 px-2 py-1 text-xs text-slate-300 hover:bg-slate-700 cursor-pointer"
                  closeOnClick={false}
                  onClick={() => {
                    objectPick.value = objectPick.value === 1 ? 0 : 1;
                    w.view.forceUpdate();
                  }}
                >
                  View Pick
                </Menu.Item>

                <Menu.Item
                  className="flex items-center gap-2 px-2 py-1 text-xs text-slate-300 hover:bg-slate-700 cursor-pointer"
                  closeOnClick={false}
                  onClick={() => state.set({ debugHitOpen: true })}
                >
                  Room Hit
                </Menu.Item>

                <Menu.Item
                  className="flex items-center gap-2 px-2 py-1 text-xs text-slate-300 hover:bg-slate-700 cursor-pointer"
                  closeOnClick={false}
                  onClick={() => state.set({ gmGraphsOpen: true })}
                >
                  Gm Graphs
                </Menu.Item>

                <Menu.Item
                  className="flex items-center gap-2 px-2 py-1 text-xs text-slate-300 hover:bg-slate-700 cursor-pointer"
                  closeOnClick={false}
                  onClick={() => state.set({ skinDebugOpen: true })}
                >
                  Skins
                </Menu.Item>
              </Menu.Popup>
            </Menu.Positioner>
          </Menu.Portal>
        </Menu.Root>
      </motion.div>

      <RoomHitModal open={state.debugHitOpen} onOpenChange={(open) => state.set({ debugHitOpen: open })} />
      <GeomorphGraphsModal open={state.gmGraphsOpen} onOpenChange={(open) => state.set({ gmGraphsOpen: open })} />
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
const gmGraphsFilterKey = "world-gm-graphs-filter";

function useSvgZoom(bounds: { minX: number; minY: number; width: number; height: number }) {
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const dragRef = useRef<{ startX: number; startY: number; panX: number; panY: number } | null>(null);

  const viewBox = useMemo(() => {
    const w = bounds.width / zoom;
    const h = bounds.height / zoom;
    const cx = bounds.minX + bounds.width / 2 + pan.x;
    const cy = bounds.minY + bounds.height / 2 + pan.y;
    return `${cx - w / 2} ${cy - h / 2} ${w} ${h}`;
  }, [bounds, zoom, pan]);

  const onWheel = useCallback(
    (e: React.WheelEvent<SVGSVGElement>) => {
      const svg = e.currentTarget;
      const rect = svg.getBoundingClientRect();
      const fx = (e.clientX - rect.left) / rect.width;
      const fy = (e.clientY - rect.top) / rect.height;

      const factor = e.deltaY < 0 ? 1.05 : 1 / 1.05;
      const newZoom = Math.min(20, Math.max(0.5, zoom * factor));

      const vw = bounds.width / zoom;
      const vh = bounds.height / zoom;
      const curVx = bounds.minX + bounds.width / 2 + pan.x - vw / 2;
      const curVy = bounds.minY + bounds.height / 2 + pan.y - vh / 2;
      const mouseVx = curVx + vw * fx;
      const mouseVy = curVy + vh * fy;

      const newVw = bounds.width / newZoom;
      const newVh = bounds.height / newZoom;
      const newCx = mouseVx - newVw * fx + newVw / 2;
      const newCy = mouseVy - newVh * fy + newVh / 2;

      setPan({
        x: newCx - (bounds.minX + bounds.width / 2),
        y: newCy - (bounds.minY + bounds.height / 2),
      });
      setZoom(newZoom);
    },
    [zoom, pan, bounds],
  );

  const onPointerDown = useCallback(
    (e: React.PointerEvent<SVGSVGElement>) => {
      if ((e.target as Element).closest?.("text")) return;
      e.currentTarget.setPointerCapture(e.pointerId);
      dragRef.current = { startX: e.clientX, startY: e.clientY, panX: pan.x, panY: pan.y };
    },
    [pan],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent<SVGSVGElement>) => {
      if (!dragRef.current) return;
      const svg = e.currentTarget;
      const rect = svg.getBoundingClientRect();
      const scaleX = bounds.width / zoom / rect.width;
      const scaleY = bounds.height / zoom / rect.height;
      setPan({
        x: dragRef.current.panX - (e.clientX - dragRef.current.startX) * scaleX,
        y: dragRef.current.panY - (e.clientY - dragRef.current.startY) * scaleY,
      });
    },
    [bounds, zoom],
  );

  const onPointerUp = useCallback(() => {
    dragRef.current = null;
  }, []);

  const reset = useCallback(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, []);

  return { viewBox, onWheel, onPointerDown, onPointerMove, onPointerUp, reset, zoom };
}

function RoomHitModal({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const w = useContext(WorldContext);
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Backdrop className={cn(uiClassName, "fixed inset-0 z-50 bg-black/60")} />
        <Dialog.Popup
          className={cn(
            uiClassName,
            "fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2",
            "bg-slate-900 border border-slate-700 rounded-lg shadow-2xl",
            "max-w-3xl w-[90vw] max-h-[80vh] flex flex-col",
          )}
        >
          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-700">
            <Dialog.Title className="text-sm font-semibold text-slate-200">Room Hit Canvases</Dialog.Title>
            <Dialog.Close className="p-1 hover:bg-slate-700 rounded cursor-pointer">
              <XIcon className="size-5 text-slate-400" />
            </Dialog.Close>
          </div>
          <div className="flex-1 overflow-y-auto p-4 flex flex-wrap justify-center gap-4">
            {w.seenGmKeys.map((gmKey) => (
              <div key={gmKey} className="flex flex-col items-center gap-1">
                <span className="text-xs text-slate-400">{gmKey}</span>
                <div
                  ref={(el) => {
                    if (!el) return;
                    const canvas = w.gmsData.byKey[gmKey].roomHitCt.canvas;
                    el.replaceChildren(canvas);
                    canvas.style.width = "200px";
                    canvas.style.height = "auto";
                  }}
                />
              </div>
            ))}
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function GeomorphGraphsModal({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const w = useContext(WorldContext);
  const [activeGraph, setActiveGraph] = useState<"gm" | "room">(
    () => (tryLocalStorageGetParsed<string>(gmGraphsFilterKey) as "gm" | "room") || "room",
  );
  const showGm = activeGraph === "gm";
  const showRoom = activeGraph === "room";

  const { minX, minY, width, height } = useMemo(() => {
    if (!w.gms.length) return { minX: 0, minY: 0, width: 100, height: 100 };
    let x1 = Infinity,
      y1 = Infinity,
      x2 = -Infinity,
      y2 = -Infinity;
    for (const gm of w.gms) {
      const r = gm.gridRect;
      x1 = Math.min(x1, r.x);
      y1 = Math.min(y1, r.y);
      x2 = Math.max(x2, r.x + r.width);
      y2 = Math.max(y2, r.y + r.height);
    }
    const pad = Math.max(x2 - x1, y2 - y1) * 0.15;
    return { minX: x1 - pad, minY: y1 - pad, width: x2 - x1 + 2 * pad, height: y2 - y1 + 2 * pad };
  }, [w.gms]);

  const nodeRadius = Math.max(width, height) * 0.005;
  const fontSize = Math.max(width, height) * 0.012;
  const strokeWidth = Math.max(width, height) * 0.003;
  const svgZoom = useSvgZoom({ minX, minY, width, height });

  const gmLabels = useMemo(() => {
    if (!showGm) return [];
    const nodes = w.gmGraph.nodesArray;
    if (!nodes.length) return [];
    const gap = nodeRadius * 1.5;
    const placed: { x: number; y: number; w: number; h: number }[] = [];
    return nodes.map((node) => {
      const cx = node.astar.centroid.x;
      const cy = node.astar.centroid.y;
      const label = node.type === "gm" ? `gm${node.gmId}` : `g${node.gmId}d${node.doorId}${node.sealed ? "✕" : ""}`;
      const color = node.type === "gm" ? "#4ade80" : node.sealed ? "#ef4444" : "#fb923c";
      const tw = label.length * fontSize * 0.6 + fontSize * 1.2;
      const th = fontSize * 1.8;
      const candidates = octantCandidates(cx, cy, tw, th, gap);
      const pos = pickBest(candidates, tw, th, placed);
      placed.push({ x: pos.x, y: pos.y, w: tw, h: th });
      return { cx, cy, label, color, lx: pos.x, ly: pos.y, tw, th };
    });
  }, [w.gmGraph.nodesArray, nodeRadius, fontSize, showGm]);

  const roomFontSize = fontSize * 0.6;

  const roomLabels = useMemo(() => {
    if (!showRoom) return [];
    const nodes = w.gmRoomGraph.nodesArray;
    if (!nodes.length) return [];
    const gap = nodeRadius * 1.5;
    const placed: { x: number; y: number; w: number; h: number }[] = [];
    return nodes.map((node) => {
      const cx = node.astar.centroid.x;
      const cy = node.astar.centroid.y;
      const label = node.id;
      const gm = w.gms[node.gmId];
      const worldRoom = gm.rooms[node.roomId]?.clone().applyMatrix(gm.matrix);
      if (worldRoom) {
        const c = worldRoom.center;
        const s = 0.92;
        for (const p of worldRoom.outline) {
          p.x = c.x + (p.x - c.x) * s;
          p.y = c.y + (p.y - c.y) * s;
        }
        for (const hole of worldRoom.holes)
          for (const p of hole) {
            p.x = c.x + (p.x - c.x) * s;
            p.y = c.y + (p.y - c.y) * s;
          }
      }
      const roomPath = worldRoom?.svgPath ?? "";
      const tw = label.length * roomFontSize * 0.6 + roomFontSize * 1.2;
      const th = roomFontSize * 1.8;
      const candidates = octantCandidates(cx, cy, tw, th, gap);
      const pos = pickBest(candidates, tw, th, placed);
      placed.push({ x: pos.x, y: pos.y, w: tw, h: th });
      return { cx, cy, label, roomPath, lx: pos.x, ly: pos.y, tw, th };
    });
  }, [w.gmRoomGraph.nodesArray, w.gms, nodeRadius, fontSize, showRoom]);

  const roomColor = "#60a5fa";
  const toggleClass = "px-2 py-0.5 text-xs rounded cursor-pointer";

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Backdrop className={cn(uiClassName, "fixed inset-0 z-50 bg-black/60")} />
        <Dialog.Popup
          className={cn(
            uiClassName,
            "fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2",
            "bg-slate-900 border border-slate-700 rounded-lg shadow-2xl",
            "max-w-4xl w-[90vw] h-[85vh] flex flex-col touch-none",
          )}
          ref={(el) => {
            if (!el) return;
            const preventTouch = (e: TouchEvent) => {
              if (e.touches.length >= 2) e.preventDefault();
            };
            el.addEventListener("touchstart", preventTouch, { passive: false });
            el.addEventListener("touchmove", preventTouch, { passive: false });
            el.addEventListener("wheel", (e) => e.preventDefault(), { passive: false });
          }}
        >
          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-700">
            <Dialog.Title className="text-sm font-semibold text-slate-200">Geomorph Graphs</Dialog.Title>
            <div className="flex items-center gap-1">
              <button
                type="button"
                className={cn(toggleClass, showGm ? "bg-green-900/50 text-green-400" : "text-slate-500")}
                onClick={() => {
                  setActiveGraph("gm");
                  tryLocalStorageSet(gmGraphsFilterKey, '"gm"');
                }}
              >
                Gm
              </button>
              <button
                type="button"
                className={cn(toggleClass, showRoom ? "bg-blue-900/50 text-blue-400" : "text-slate-500")}
                onClick={() => {
                  setActiveGraph("room");
                  tryLocalStorageSet(gmGraphsFilterKey, '"room"');
                }}
              >
                Room
              </button>
              <Dialog.Close className="p-1 hover:bg-slate-700 rounded cursor-pointer ml-2">
                <XIcon className="size-5 text-slate-400" />
              </Dialog.Close>
            </div>
          </div>
          <div className="flex-1 min-h-0 overflow-hidden p-2">
            <svg
              viewBox={svgZoom.viewBox}
              onWheel={svgZoom.onWheel}
              onPointerDown={svgZoom.onPointerDown}
              onPointerMove={svgZoom.onPointerMove}
              onPointerUp={svgZoom.onPointerUp}
              className="size-full touch-none"
            >
              <style>{`text { user-select: none; cursor: default; } text:hover { user-select: text; cursor: text; } .edge-label:hover { font-size: ${fontSize * 0.6}px; fill: white; }`}</style>
              {w.gms.map((gm, gmId) => {
                const { a, b, c, d, e, f } = gm.transform;
                return (
                  <image
                    key={gmId}
                    href={`/starship-symbol/${gm.key}.png`}
                    x={gm.bounds.x}
                    y={gm.bounds.y}
                    width={gm.bounds.width}
                    height={gm.bounds.height}
                    transform={`matrix(${a},${b},${c},${d},${e},${f})`}
                    opacity={0.3}
                  />
                );
              })}

              {/* Gm Graph edges */}
              {showGm &&
                w.gmGraph.edgesArray.map((edge) => (
                  <line
                    key={edge.id}
                    x1={edge.src.astar.centroid.x}
                    y1={edge.src.astar.centroid.y}
                    x2={edge.dst.astar.centroid.x}
                    y2={edge.dst.astar.centroid.y}
                    stroke="white"
                    strokeWidth={strokeWidth}
                    opacity={0.5}
                  />
                ))}

              {/* Room Graph edge lines routed through door centers */}
              {showRoom &&
                w.gmRoomGraph.edgesArray.map((edge) => {
                  const sx = edge.src.astar.centroid.x,
                    sy = edge.src.astar.centroid.y;
                  const dx = edge.dst.astar.centroid.x,
                    dy = edge.dst.astar.centroid.y;

                  if (edge.doors.length === 0) {
                    return (
                      <line
                        key={edge.id}
                        x1={sx}
                        y1={sy}
                        x2={dx}
                        y2={dy}
                        stroke="cyan"
                        strokeWidth={strokeWidth * 0.7}
                        opacity={0.4}
                      />
                    );
                  }

                  return (
                    <g key={edge.id}>
                      {edge.doors.map(({ gdKey, gmId, doorId }) => {
                        const gm = w.gms[gmId];
                        const door = gm.doors[doorId];
                        if (!door) return null;
                        const mid = gm.matrix.transformPoint(door.center.clone());
                        return (
                          <g key={gdKey}>
                            <line
                              x1={sx}
                              y1={sy}
                              x2={mid.x}
                              y2={mid.y}
                              stroke="white"
                              strokeWidth={strokeWidth * 0.7}
                              opacity={0.4}
                            />
                            <line
                              x1={mid.x}
                              y1={mid.y}
                              x2={dx}
                              y2={dy}
                              stroke="white"
                              strokeWidth={strokeWidth * 0.7}
                              opacity={0.4}
                            />
                          </g>
                        );
                      })}
                    </g>
                  );
                })}

              {/* Room Graph nodes (polygons) — rendered first so they don't cover gm nodes */}
              {roomLabels.map(({ label, roomPath }) => (
                <path
                  key={label}
                  d={roomPath}
                  fill={roomColor}
                  fillOpacity={0.15}
                  stroke={roomColor}
                  strokeWidth={strokeWidth * 0.3}
                />
              ))}
              {/* Gm Graph nodes */}
              {gmLabels.map(({ cx, cy, color }, i) => (
                <circle key={i} cx={cx} cy={cy} r={nodeRadius} fill={color} opacity={0.85} />
              ))}

              {/* Room Graph labels — rendered first so door/gm labels appear on top */}
              {roomLabels.map(({ label, lx, ly, tw, th }) => (
                <g key={label}>
                  <rect
                    x={lx}
                    y={ly}
                    width={tw}
                    height={th}
                    rx={roomFontSize * 0.25}
                    fill="rgba(0,0,0,0.75)"
                    stroke={roomColor}
                    strokeWidth={strokeWidth * 0.3}
                  />
                  <text
                    x={lx + tw / 2}
                    y={ly + th / 2}
                    textAnchor="middle"
                    dominantBaseline="central"
                    fill={roomColor}
                    fontSize={roomFontSize}
                  >
                    {label}
                  </text>
                </g>
              ))}
              {/* Gm Graph labels */}
              {gmLabels.map(({ label, color, lx, ly, tw, th }) => (
                <g key={label}>
                  <rect
                    x={lx}
                    y={ly}
                    width={tw}
                    height={th}
                    rx={fontSize * 0.25}
                    fill="rgba(0,0,0,0.75)"
                    stroke={color}
                    strokeWidth={strokeWidth * 0.5}
                  />
                  <text
                    x={lx + tw / 2}
                    y={ly + th / 2}
                    textAnchor="middle"
                    dominantBaseline="central"
                    fill={color}
                    fontSize={fontSize}
                  >
                    {label}
                  </text>
                </g>
              ))}
              {/* Door edge labels — topmost layer */}
              {showRoom &&
                w.gmRoomGraph.edgesArray.flatMap((edge) => {
                  const edgeFontSize = fontSize * 0.4;
                  return edge.doors.map(({ gdKey, gmId, doorId }) => {
                    const gm = w.gms[gmId];
                    const door = gm.doors[doorId];
                    if (!door) return null;
                    const mid = gm.matrix.transformPoint(door.center.clone());
                    const seg0 = gm.matrix.transformPoint(door.seg[0].clone());
                    const seg1 = gm.matrix.transformPoint(door.seg[1].clone());
                    const segDx = seg1.x - seg0.x,
                      segDy = seg1.y - seg0.y;
                    const segLen = Math.sqrt(segDx * segDx + segDy * segDy) || 1;
                    const perpX = -segDy / segLen,
                      perpY = segDx / segLen;
                    return (
                      <text
                        key={`${edge.id}-${gdKey}`}
                        className="edge-label"
                        x={mid.x + perpX * edgeFontSize}
                        y={mid.y + perpY * edgeFontSize}
                        textAnchor="middle"
                        dominantBaseline="central"
                        fill="#94a3b8"
                        fontSize={edgeFontSize}
                        paintOrder="stroke"
                        stroke="rgba(0,0,0,0.8)"
                        strokeWidth={edgeFontSize * 0.3}
                      >
                        {gdKey}
                      </text>
                    );
                  });
                })}
            </svg>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function octantCandidates(cx: number, cy: number, tw: number, th: number, gap: number) {
  return [
    { x: cx + gap, y: cy - th / 2 },
    { x: cx - tw - gap, y: cy - th / 2 },
    { x: cx - tw / 2, y: cy - gap - th },
    { x: cx - tw / 2, y: cy + gap },
    { x: cx + gap, y: cy - gap - th },
    { x: cx - tw - gap, y: cy - gap - th },
    { x: cx + gap, y: cy + gap },
    { x: cx - tw - gap, y: cy + gap },
  ];
}

function pickBest(
  candidates: { x: number; y: number }[],
  tw: number,
  th: number,
  placed: { x: number; y: number; w: number; h: number }[],
) {
  let bestIdx = 0;
  let bestOverlap = Infinity;
  for (let c = 0; c < candidates.length; c++) {
    const cand = candidates[c];
    let overlap = 0;
    for (const p of placed) {
      const ox = Math.max(0, Math.min(cand.x + tw, p.x + p.w) - Math.max(cand.x, p.x));
      const oy = Math.max(0, Math.min(cand.y + th, p.y + p.h) - Math.max(cand.y, p.y));
      overlap += ox * oy;
    }
    if (overlap === 0) {
      bestIdx = c;
      break;
    }
    if (overlap < bestOverlap) {
      bestOverlap = overlap;
      bestIdx = c;
    }
  }
  return candidates[bestIdx];
}

function SkinDebugModal({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const w = useContext(WorldContext);
  const { manifest } = w.npc.skin;
  const entries = useMemo(() => (manifest ? Object.values(manifest.byKey) : []), [manifest]);

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Backdrop className={cn(uiClassName, "fixed inset-0 z-50 bg-black/60")} />
        <Dialog.Popup
          className={cn(
            uiClassName,
            "fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2",
            "bg-slate-900 border border-slate-700 rounded-lg shadow-2xl",
            "max-w-4xl w-[90vw] max-h-[80vh] flex flex-col",
          )}
        >
          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-700">
            <Dialog.Title className="text-sm font-semibold text-slate-200">Skins ({entries.length})</Dialog.Title>
            <Dialog.Close className="p-1 hover:bg-slate-700 rounded cursor-pointer">
              <XIcon className="size-5 text-slate-400" />
            </Dialog.Close>
          </div>
          <div className="flex-1 overflow-y-auto p-4 flex flex-wrap justify-center gap-4">
            {entries.map((entry, i) => (
              <div key={entry.key} className="flex flex-col items-center gap-1">
                <canvas
                  width={64}
                  height={64}
                  className="w-48 h-48 border border-slate-700"
                  style={{ imageRendering: "pixelated" }}
                  ref={(el) => {
                    if (!el) return;
                    const ct = el.getContext("2d");
                    if (!ct) return;
                    const data = w.texSkin.tex.image.data as Uint8Array;
                    const layerSize = 64 * 64 * 4;
                    const slice = new Uint8ClampedArray(data.slice(i * layerSize, (i + 1) * layerSize).buffer);
                    const imageData = new ImageData(slice, 64, 64);
                    ct.putImageData(imageData, 0, 0);
                  }}
                />
                <a
                  href={entry.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-slate-400 font-mono hover:text-blue-400 underline"
                >
                  {entry.key}
                </a>
                <div className="flex flex-wrap justify-center gap-2 mt-1">
                  {entry.tags.map((tag) => (
                    <span key={tag} className="px-3 py-1 text-sm rounded-md bg-slate-700 text-slate-200">
                      {tag}
                    </span>
                  ))}
                </div>
              </div>
            ))}
            {entries.length === 0 && <span className="text-sm text-slate-500">No skins loaded</span>}
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
