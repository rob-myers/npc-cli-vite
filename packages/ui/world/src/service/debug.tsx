import { Dialog } from "@base-ui/react/dialog";
import { uiClassName } from "@npc-cli/ui-sdk/const";
import { cn } from "@npc-cli/util";
import { tryLocalStorageGetParsed, tryLocalStorageSet } from "@npc-cli/util/legacy/generic";
import { XIcon } from "@phosphor-icons/react";
import { useCallback, useContext, useMemo, useRef, useState } from "react";
import { WorldContext } from "../components/world-context";

export type DebugModalProps = { open: boolean; onOpenChange: (open: boolean) => void };

const gmGraphsFilterKey = "world-gm-graphs-filter";

export function RoomHitModal({ open, onOpenChange }: DebugModalProps) {
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

export function GeomorphGraphsModal({ open, onOpenChange }: DebugModalProps) {
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
    const nodes = w.gmRoomGraph.nodesArray.filter(
      (n): n is Graph.GmRoomGraphNodeRoom => n.type === "room",
    );
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
              onTouchStart={svgZoom.onTouchStart}
              onTouchMove={svgZoom.onTouchMove}
              onTouchEnd={svgZoom.onTouchEnd}
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

              {/* Room Graph door edges (entry-to-entry, extended) */}
              {showRoom &&
                w.gmRoomGraph.nodesArray
                  .filter((n): n is Graph.GmRoomGraphNodeDoor => n.type === "door")
                  .map((node) => {
                    const gm = w.gms[node.gmId];
                    const door = gm.doors[node.doorId];
                    if (!door) return null;
                    const e0 = gm.matrix.transformPoint(door.entries[0].clone());
                    const e1 = gm.matrix.transformPoint(door.entries[1].clone());
                    const dx = e1.x - e0.x, dy = e1.y - e0.y;
                    const len = Math.sqrt(dx * dx + dy * dy) || 1;
                    const ext = 0.5;
                    const ux = dx / len * ext, uy = dy / len * ext;
                    return (
                      <line
                        key={node.id}
                        x1={e0.x - ux}
                        y1={e0.y - uy}
                        x2={e1.x + ux}
                        y2={e1.y + uy}
                        stroke="#fb923c"
                        strokeWidth={strokeWidth * 0.7}
                        opacity={0.7}
                      />
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
              {/* Door/window node labels — topmost layer */}
              {showRoom &&
                w.gmRoomGraph.nodesArray
                  .filter((n): n is Graph.GmRoomGraphNodeDoor | Graph.GmRoomGraphNodeWindow =>
                    n.type === "door" || n.type === "window",
                  )
                  .map((node) => {
                    const edgeFontSize = fontSize * 0.4;
                    const color = node.type === "door" ? "#fb923c" : "#a78bfa";
                    return (
                      <g key={node.id}>
                        <text
                          className="edge-label"
                          x={node.astar.centroid.x}
                          y={node.astar.centroid.y - nodeRadius}
                          textAnchor="middle"
                          dominantBaseline="central"
                          fill={color}
                          fontSize={edgeFontSize}
                          paintOrder="stroke"
                          stroke="rgba(0,0,0,0.8)"
                          strokeWidth={edgeFontSize * 0.3}
                        >
                          {node.id}
                        </text>
                      </g>
                    );
                  })}
            </svg>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function SkinDebugModal({ open, onOpenChange }: DebugModalProps) {
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

function useSvgZoom(bounds: { minX: number; minY: number; width: number; height: number }) {
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const dragRef = useRef<{ startX: number; startY: number; panX: number; panY: number } | null>(null);
  const pinchRef = useRef<{
    dist: number;
    midX: number;
    midY: number;
    startZoom: number;
    startPanX: number;
    startPanY: number;
  } | null>(null);

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
      if (!dragRef.current || pinchRef.current) return;
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

  const onTouchStart = useCallback(
    (e: React.TouchEvent<SVGSVGElement>) => {
      if (e.touches.length === 2) {
        dragRef.current = null;
        const [t0, t1] = [e.touches[0], e.touches[1]];
        pinchRef.current = {
          dist: Math.hypot(t1.clientX - t0.clientX, t1.clientY - t0.clientY),
          midX: (t0.clientX + t1.clientX) / 2,
          midY: (t0.clientY + t1.clientY) / 2,
          startZoom: zoom,
          startPanX: pan.x,
          startPanY: pan.y,
        };
      }
    },
    [zoom, pan],
  );

  const onTouchMove = useCallback(
    (e: React.TouchEvent<SVGSVGElement>) => {
      if (e.touches.length !== 2 || !pinchRef.current) return;
      const [t0, t1] = [e.touches[0], e.touches[1]];
      const dist = Math.hypot(t1.clientX - t0.clientX, t1.clientY - t0.clientY);
      const midX = (t0.clientX + t1.clientX) / 2;
      const midY = (t0.clientY + t1.clientY) / 2;

      const scale = dist / pinchRef.current.dist;
      const newZoom = Math.min(20, Math.max(0.5, pinchRef.current.startZoom * scale));

      const rect = e.currentTarget.getBoundingClientRect();
      const scaleX = bounds.width / pinchRef.current.startZoom / rect.width;
      const scaleY = bounds.height / pinchRef.current.startZoom / rect.height;

      setPan({
        x: pinchRef.current.startPanX - (midX - pinchRef.current.midX) * scaleX,
        y: pinchRef.current.startPanY - (midY - pinchRef.current.midY) * scaleY,
      });
      setZoom(newZoom);
    },
    [bounds],
  );

  const onTouchEnd = useCallback(() => {
    pinchRef.current = null;
  }, []);

  const reset = useCallback(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, []);

  return { viewBox, onWheel, onPointerDown, onPointerMove, onPointerUp, onTouchStart, onTouchMove, onTouchEnd, reset, zoom };
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
