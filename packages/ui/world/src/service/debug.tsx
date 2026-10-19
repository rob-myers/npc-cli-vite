import { Dialog } from "@base-ui/react/dialog";
import { cn } from "@npc-cli/util";
import { Rect } from "@npc-cli/util/geom/rect";
import { preventPopupGestures, useSvgZoom } from "@npc-cli/util/use-svg-zoom";
import { ArrowSquareOutIcon, XIcon } from "@phosphor-icons/react";
import { useContext, useMemo, useState } from "react";
import { WorldContext } from "../components/world-context";
import { eyeFrames, skinSliceDims } from "../const.both";
import { gmFloorExtraScale, roomHitTextureScaleDown, worldToSguScale } from "../const.env";
import { getWorldStore } from "./storage";

export type DebugModalProps = { open: boolean; onOpenChange: (open: boolean) => void; container?: HTMLElement | null };

/** The live `roomHitCt` canvases in a row, in metres, panned and zoomed like the graphs */
export function RoomHitModal({ open, onOpenChange, container }: DebugModalProps) {
  const w = useContext(WorldContext);

  const { items, bounds } = useMemo(() => {
    const scale = roomHitTextureScaleDown * worldToSguScale * gmFloorExtraScale;
    let x = 0;
    const items = w.seenGmKeys.map((gmKey) => {
      const { canvas } = w.gmsData.byKey[gmKey].roomHitCt;
      const rect = new Rect(x, 0, canvas.width / scale, canvas.height / scale);
      x += rect.width + 1; // a metre apart
      return { gmKey, canvas, rect };
    });
    const r = items.length === 0 ? new Rect(0, 0, 10, 10) : Rect.fromRects(...items.map((item) => item.rect)).outset(1);
    return { items, bounds: { minX: r.x, minY: r.y, width: r.width, height: r.height } };
  }, [w.seenGmKeys, w.gmsData]);
  const svgZoom = useSvgZoom(bounds);

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal container={container}>
        <Dialog.Backdrop className="absolute inset-0 z-50 bg-black/60" />
        <Dialog.Popup
          className={cn(
            "absolute left-1/2 top-[5%] z-50 -translate-x-1/2",
            "bg-slate-900 border border-slate-700 rounded-lg shadow-2xl",
            "max-w-4xl w-[90%] h-[90%] flex flex-col touch-none",
          )}
          ref={preventPopupGestures}
        >
          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-700">
            <Dialog.Title className="text-sm font-semibold text-slate-200">Room Hit Canvases</Dialog.Title>
            <Dialog.Close className="p-1 hover:bg-slate-700 rounded cursor-pointer">
              <XIcon className="size-5 text-slate-400" />
            </Dialog.Close>
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
              {items.map(({ gmKey, canvas, rect }) => (
                <g key={gmKey}>
                  <foreignObject x={rect.x} y={rect.y} width={rect.width} height={rect.height}>
                    <div
                      className="size-full"
                      ref={(el) => {
                        canvas.className = "size-full block";
                        el?.replaceChildren(canvas);
                      }}
                    />
                  </foreignObject>
                  <rect {...rect.json} fill="none" stroke="white" vectorEffect="non-scaling-stroke" />
                  <text x={rect.x} y={rect.y - 0.3} fontSize={0.8} fill="#94a3b8">
                    {gmKey}
                  </text>
                </g>
              ))}
            </svg>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function GeomorphGraphsModal({ open, onOpenChange, container }: DebugModalProps) {
  const w = useContext(WorldContext);
  const store = getWorldStore(w.key);
  const [activeGraph, setActiveGraph] = useState<"gm" | "room">(() => store.read().gmGraphsFilter);
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
    const nodes = w.gmRoomGraph.nodesArray.filter((n): n is Graph.GmRoomGraphNodeRoom => n.type === "room");
    if (!nodes.length) return [];
    const gap = nodeRadius * 1.5;
    const placed: { x: number; y: number; w: number; h: number }[] = [];
    return nodes.map((node) => {
      const cx = node.astar.centroid.x;
      const cy = node.astar.centroid.y;
      const label = node.id;
      const gm = w.gms[node.gmId];
      const worldRoom = gm.rooms[node.roomId]?.clone().applyMatrix(gm.matrix);
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
  /** `lineOfSight` edges — neither a door's colour nor a window's, being neither */
  const seesColor = "#22d3ee";
  const toggleClass = "px-2 py-0.5 text-xs rounded cursor-pointer";

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal container={container}>
        <Dialog.Backdrop className="absolute inset-0 z-50 bg-black/60" />
        <Dialog.Popup
          className={cn(
            "absolute left-1/2 top-[5%] z-50 -translate-x-1/2",
            "bg-slate-900 border border-slate-700 rounded-lg shadow-2xl",
            "max-w-4xl w-[90%] h-[90%] flex flex-col touch-none",
          )}
          ref={preventPopupGestures}
        >
          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-700">
            <Dialog.Title className="text-sm font-semibold text-slate-200">Geomorph Graphs</Dialog.Title>
            <div className="flex items-center gap-1">
              <button
                type="button"
                className={cn(toggleClass, showGm ? "bg-green-900/50 text-green-400" : "text-slate-500")}
                onClick={() => {
                  setActiveGraph("gm");
                  store.patch({ gmGraphsFilter: "gm" });
                }}
              >
                Gm
              </button>
              <button
                type="button"
                className={cn(toggleClass, showRoom ? "bg-blue-900/50 text-blue-400" : "text-slate-500")}
                onClick={() => {
                  setActiveGraph("room");
                  store.patch({ gmGraphsFilter: "room" });
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

              {/* Room Graph door/window edges (entry-to-entry, extended) */}
              {showRoom &&
                w.gmRoomGraph.nodesArray
                  .filter(
                    (n): n is Graph.GmRoomGraphNodeDoor | Graph.GmRoomGraphNodeWindow =>
                      n.type === "door" || n.type === "window",
                  )
                  .map((node) => {
                    const gm = w.gms[node.gmId];
                    const connector = node.type === "door" ? gm.doors[node.doorId] : gm.windows[node.windowId];
                    if (!connector) return null;
                    const e0 = gm.matrix.transformPoint(connector.entries[0].clone());
                    const e1 = gm.matrix.transformPoint(connector.entries[1].clone());
                    const dx = e1.x - e0.x,
                      dy = e1.y - e0.y;
                    const len = Math.sqrt(dx * dx + dy * dy) || 1;
                    const ext = 0.5;
                    const ux = (dx / len) * ext,
                      uy = (dy / len) * ext;
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
              {/* `lineOfSight`: what a door/window can SEE through, as opposed to reach */}
              {showRoom &&
                w.gmRoomGraph.nodesArray.flatMap((node) =>
                  (node.lineOfSight ?? []).flatMap((seesId) => {
                    const other = w.gmRoomGraph.getNode(seesId);
                    // symmetric, so draw each pair once
                    if (other === null || other.index < node.index) return [];
                    return (
                      <line
                        key={`${node.id}-sees-${seesId}`}
                        x1={node.astar.centroid.x}
                        y1={node.astar.centroid.y}
                        x2={other.astar.centroid.x}
                        y2={other.astar.centroid.y}
                        stroke={seesColor}
                        strokeWidth={strokeWidth * 0.7}
                        strokeDasharray={`${strokeWidth * 2} ${strokeWidth}`}
                        opacity={0.9}
                      />
                    );
                  }),
                )}

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
                  .filter(
                    (n): n is Graph.GmRoomGraphNodeDoor | Graph.GmRoomGraphNodeWindow =>
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

/** A skin's face front with one of its slices over it — see `docs/skin-slices.md` */
function readFaceWithSlice(w: import("../components/World").State, skinIndex: number, sliceId: number) {
  const { cell, slice } = skinSliceDims;
  const perRow = cell / slice;
  const out = new ImageData(slice, slice);
  const copy = (tex: import("./tex-array").TexArray, x: number, y: number, over: boolean) => {
    const data = tex.tex.image.data as Uint8Array;
    const { width, height } = tex.opts;
    for (let row = 0; row < slice; row++) {
      const from = (skinIndex * height + y + row) * width * 4 + x * 4;
      for (let i = 0; i < slice * 4; i += 4) {
        if (over === true && data[from + i + 3] === 0) continue;
        out.data.set(data.subarray(from + i, from + i + 4), row * slice * 4 + i);
      }
    }
  };
  copy(w.texSkin, slice, slice, false); // the face front is a slice in from the skin's corner
  copy(w.texSkinSlices, (sliceId % perRow) * slice, Math.floor(sliceId / perRow) * slice, true);
  return out;
}

export function SkinsModal({ open, onOpenChange, container }: DebugModalProps) {
  const w = useContext(WorldContext);
  const { entries, manifest } = w.npc.skin;
  /** Skins by family, each with its index in the skin texture */
  const families = Object.entries(
    Object.groupBy(
      entries.map((entry, index) => ({ entry, index })),
      ({ entry }) => manifest.byKey[entry.key]?.meta.prefix ?? entry.key.replace(/-\d+$/, ""),
    ),
  ).sort(([a], [b]) => a.localeCompare(b));
  const [chosen, setChosen] = useState<null | string>(null);
  const [prefix, skins = []] = families.find(([prefix]) => prefix === chosen) ?? families[0] ?? [];
  const [zoom, setZoom] = useState<null | SkinZoom>(null);

  return (
    <Dialog.Root open={open} onOpenChange={(next) => (next === false && zoom !== null ? setZoom(null) : onOpenChange(next))}>
      <Dialog.Portal container={container}>
        <Dialog.Backdrop className="absolute inset-0 z-50 bg-black/60" />
        <Dialog.Popup
          className={cn(
            "absolute left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2",
            "bg-slate-900 border border-slate-700 rounded-lg shadow-2xl",
            "max-w-4xl w-[90%] h-[90%] flex flex-col",
          )}
        >
          <div className="flex items-center justify-between gap-4 px-4 py-3 border-b border-slate-700">
            <div className="flex items-baseline gap-2">
              <Dialog.Title className="text-sm font-semibold text-slate-200">Skins</Dialog.Title>
              <span className="text-xs text-slate-500">
                {entries.length} in {families.length} families
              </span>
            </div>
            <Dialog.Close className="p-1 hover:bg-slate-700 rounded cursor-pointer">
              <XIcon className="size-5 text-slate-400" />
            </Dialog.Close>
          </div>
          <div className="flex flex-wrap justify-center gap-1.5 border-b border-slate-800 px-4 py-2.5">
            {families.map(([key, { length } = []]) => (
              <button
                key={key}
                type="button"
                onClick={() => (setChosen(key), setZoom(null))}
                className={cn(
                  "flex items-baseline gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium cursor-pointer",
                  key === prefix ? "bg-slate-700 text-slate-100" : "text-slate-400 hover:bg-slate-800 hover:text-slate-200",
                )}
              >
                {key}
                <span className={key === prefix ? "text-slate-400" : "text-slate-600"}>{length}</span>
              </button>
            ))}
          </div>
          <div className="relative flex min-h-0 flex-1">
            <div className="flex flex-1 overflow-y-auto p-4" style={{ containerType: "size" }}>
              <div className="m-auto flex flex-wrap justify-center gap-3">
                {skins.map(({ entry, index }) => (
                  <SkinCard
                    key={entry.key}
                    skinKey={entry.key}
                    index={index}
                    width={fitCardWidth(skins.length)}
                    onZoom={setZoom}
                  />
                ))}
              </div>
              {entries.length === 0 && <p className="text-center text-sm text-slate-500">No skins loaded</p>}
            </div>
            {zoom !== null && (
              <button
                type="button"
                className="absolute inset-0 flex cursor-zoom-out flex-col items-center justify-center gap-2 bg-slate-950/95 p-4"
                onClick={() => setZoom(null)}
              >
                <canvas
                  width={zoom.frameId === undefined ? w.texSkin.opts.width : skinSliceDims.slice}
                  height={zoom.frameId === undefined ? w.texSkin.opts.height : skinSliceDims.slice}
                  className="aspect-square min-h-0 max-w-full flex-1 rounded border border-slate-700/70"
                  style={{ imageRendering: "pixelated", background: checkerboard }}
                  ref={(el) => void (el && drawZoom(el, w, zoom))}
                />
                <span className="font-mono text-xs text-slate-400">
                  {zoom.skinKey}
                  {zoom.frameId !== undefined && ` / ${eyeFrames[zoom.frameId]}`}
                </span>
              </button>
            )}
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** One skin: its texture, its eyes by frame, and its meta flags */
function SkinCard({
  skinKey,
  index,
  width,
  onZoom,
}: { skinKey: string; index: number; width: string; onZoom: (zoom: SkinZoom) => void }) {
  const w = useContext(WorldContext);
  const skinEntry = w.npc.skin.manifest.byKey[skinKey];
  const { eyes, noEyes, ...rest } = skinEntry?.meta ?? {};
  const flags = Object.entries(rest).filter(([key]) => key !== "skinKey" && key !== "prefix");

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-slate-700/70 bg-slate-800/50 p-2.5" style={{ width }}>
      <div className="flex items-center justify-between gap-2">
        <span className="truncate font-mono text-sm text-slate-100">{skinKey}</span>
        {skinEntry?.url && (
          <a
            href={skinEntry.url}
            target="_blank"
            rel="noopener noreferrer"
            title="on namemc"
            className="rounded p-0.5 text-slate-500 hover:bg-slate-700 hover:text-slate-200"
          >
            <ArrowSquareOutIcon className="size-4" />
          </a>
        )}
      </div>
      <canvas
        width={w.texSkin.opts.width}
        height={w.texSkin.opts.height}
        className="aspect-square w-full cursor-zoom-in rounded border border-slate-700/70"
        style={{ imageRendering: "pixelated", background: checkerboard }}
        onClick={() => onZoom({ skinKey, index })}
        ref={(el) => void (el && drawZoom(el, w, { skinKey, index }))}
      />
      {eyes !== undefined ? (
        <div className="grid grid-cols-4 gap-1.5">
          {eyeFrames.map((frame, frameId) => (
            <div key={frame} className="flex min-w-0 flex-col items-center gap-0.5" title={frame}>
              <canvas
                width={skinSliceDims.slice}
                height={skinSliceDims.slice}
                className="aspect-square w-full cursor-zoom-in rounded-sm border border-slate-700/70"
                style={{ imageRendering: "pixelated" }}
                onClick={() => onZoom({ skinKey, index, frameId })}
                ref={(el) => void (el && drawZoom(el, w, { skinKey, index, frameId }))}
              />
              <span className="max-w-full truncate text-[10px] text-slate-500">{frame}</span>
            </div>
          ))}
        </div>
      ) : (
        <span className="text-[11px] text-slate-500">{noEyes === true ? "no eyes, by meta" : "no eyes found"}</span>
      )}
      {flags.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {flags.map(([key, value]) => (
            <span key={key} className="rounded bg-slate-700/60 px-1.5 py-0.5 font-mono text-[11px] text-slate-300">
              {value === true ? key : `${key}=${typeof value === "object" ? JSON.stringify(value) : String(value)}`}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

/** A skin's texture shown large, or one of its eye frames if `frameId` */
type SkinZoom = { skinKey: string; index: number; frameId?: number };

/** Draws a skin's texture, or its face with an eye frame's slice over it */
function drawZoom(el: HTMLCanvasElement, w: import("../components/World").State, { index, frameId }: SkinZoom) {
  const ct = el.getContext("2d");
  if (ct === null) return;
  if (frameId !== undefined) return ct.putImageData(readFaceWithSlice(w, index, frameId), 0, 0);
  const { width: tw, height: th } = w.texSkin.opts;
  const layerSize = tw * th * 4;
  const data = w.texSkin.tex.image.data as Uint8Array;
  const layer = new Uint8ClampedArray(data.slice(index * layerSize, (index + 1) * layerSize).buffer);
  ct.putImageData(new ImageData(layer, tw, th), 0, 0);
}

/**
 * The widest card that fits `count` to a row of the panel, and fits its height.
 * A card stands about 1.5 times as tall as it is wide, plus its header.
 */
const fitCardWidth = (count: number) => {
  const perRow = Math.min(count, 4);
  return `max(12rem, min(calc((100cqw - ${(perRow - 1) * 0.75}rem) / ${perRow}), calc((100cqh - 6rem) / 1.5)))`;
};

/** Behind a skin, so its transparent texels show */
const checkerboard = "repeating-conic-gradient(#1e293b 0% 25%, #273449 0% 50%) 0 0 / 16px 16px";

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
