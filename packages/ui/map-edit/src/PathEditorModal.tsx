import { Dialog } from "@base-ui/react/dialog";
import { cn, useStateRef } from "@npc-cli/util";
import { geomService } from "@npc-cli/util/geom";
import { MinusCircleIcon, PlusCircleIcon, XIcon } from "@phosphor-icons/react";
import { useEffect } from "react";
import type { MapEditFileSpecifier } from "./editor.schema";
import type { ParsedPath } from "./PathPickerModal";

export function PathEditorModal({
  fileSpecifier,
  initialFilename,
  initialPaths,
  open,
  onApply,
  onOpenChange,
}: {
  fileSpecifier: MapEditFileSpecifier;
  initialFilename?: string;
  initialPaths?: ProvidedPath[];
  open: boolean;
  onApply: (paths: ParsedPath[]) => void;
  onOpenChange: (open: boolean) => void;
}) {
  const state = useStateRef(
    (): State => ({
      paths: [],
      activePathIdx: 0,
      selectedIdx: -1,
      dragging: false,
      filename: "",
      saving: false,
      undoStack: [],
      redoStack: [],

      // --- active path accessors ---

      getActive(): PathItem {
        return state.paths[state.activePathIdx] ?? emptyPathItem;
      },
      getPoints(): Point[] {
        return state.getActive().points;
      },
      getClosed(): boolean {
        return state.getActive().closed;
      },
      setClosed(v: boolean) {
        state.getActive().closed = v;
      },

      // --- history ---

      snapshot(): MultiSnapshot {
        return { paths: state.paths.map((p) => ({ ...p, points: p.points.map((pt) => ({ ...pt })) })) };
      },
      pushUndo() {
        state.undoStack.push(state.snapshot());
        state.redoStack.length = 0;
        state.persist();
      },
      undo() {
        const prev = state.undoStack.pop();
        if (!prev) return;
        state.redoStack.push(state.snapshot());
        state.paths = prev.paths;
        state.selectedIdx = -1;
        state.persist();
        state.update();
      },
      redo() {
        const next = state.redoStack.pop();
        if (!next) return;
        state.undoStack.push(state.snapshot());
        state.paths = next.paths;
        state.selectedIdx = -1;
        state.persist();
        state.update();
      },

      // --- lifecycle ---

      reset(initPaths, filename) {
        if (initPaths && initPaths.length > 0) {
          state.paths = initPaths.map((ip) => {
            const poly = geomService.svgPathToPolygon(ip.d);
            const domMat = new DOMMatrix(ip.transform);
            return {
              points: poly ? poly.outline.map((v) => domMat.transformPoint({ x: v.x, y: v.y })) : [],
              closed: true,
              title: ip.title,
            };
          });
        } else {
          state.paths = [{ points: [], closed: false, title: "" }];
        }
        state.activePathIdx = 0;
        state.selectedIdx = -1;
        state.filename = filename ?? "";
        state.saving = false;
        state.undoStack.length = 0;
        state.redoStack.length = 0;
        state.update();
      },

      onKeyDown(e) {
        const mod = e.metaKey || e.ctrlKey;
        if (mod && e.key === "z" && !e.shiftKey) {
          e.preventDefault();
          state.undo();
        } else if (mod && e.key === "z" && e.shiftKey) {
          e.preventDefault();
          state.redo();
        } else if ((e.key === "Delete" || e.key === "Backspace") && !(e.target instanceof HTMLInputElement)) {
          if (state.selectedIdx >= 0) {
            e.preventDefault();
            state.pushUndo();
            state.deleteVertex(state.selectedIdx);
          }
        }
      },

      // --- path management ---

      switchPath(idx) {
        state.selectedIdx = -1;
        state.activePathIdx = idx;
        state.update();
      },
      addPath() {
        state.pushUndo();
        state.paths.push({ points: [], closed: false, title: "" });
        state.activePathIdx = state.paths.length - 1;
        state.selectedIdx = -1;
        state.update();
      },
      removePath(idx) {
        if (state.paths.length <= 1) return;
        state.pushUndo();
        state.paths.splice(idx, 1);
        if (state.activePathIdx >= state.paths.length) state.activePathIdx = state.paths.length - 1;
        state.selectedIdx = -1;
        state.update();
      },

      // --- geometry helpers ---

      getAllBounds() {
        let maxX = 0,
          maxY = 0;
        for (const p of state.paths) {
          for (const pt of p.points) {
            maxX = Math.max(maxX, pt.x);
            maxY = Math.max(maxY, pt.y);
          }
        }
        return { x: 0, y: 0, width: maxX || 100, height: maxY || 100 };
      },
      normalizeOrigin() {
        const pts = state.getPoints();
        if (pts.length === 0) return;
        let minX = Infinity,
          minY = Infinity;
        for (const p of pts) {
          minX = Math.min(minX, p.x);
          minY = Math.min(minY, p.y);
        }
        if (minX !== 0 || minY !== 0) {
          for (const p of pts) {
            p.x -= minX;
            p.y -= minY;
          }
        }
      },
      pathToD(pathItem) {
        if (pathItem.points.length === 0) return "";
        return pathItem.points.map((p, i) => `${i === 0 ? "M" : "L"}${p.x},${p.y}`).join(" ") + " Z";
      },
      clientToSvg(svg, clientX, clientY) {
        const ctm = svg.getScreenCTM();
        if (!ctm) return { x: 0, y: 0 };
        const pt = svg.createSVGPoint();
        pt.x = clientX;
        pt.y = clientY;
        const svgPt = pt.matrixTransform(ctm.inverse());
        return { x: Math.round(svgPt.x * 10) / 10, y: Math.round(svgPt.y * 10) / 10 };
      },

      // --- vertex mutations ---

      insertVertex(e, i, mx, my) {
        e.stopPropagation();
        state.pushUndo();
        state.getPoints().splice(i + 1, 0, { x: Math.round(mx * 10) / 10, y: Math.round(my * 10) / 10 });
        state.set({ selectedIdx: i + 1 });
      },
      deleteVertex(i) {
        state.getPoints().splice(i, 1);
        if (state.getPoints().length < 3) state.setClosed(false);
        state.set({ selectedIdx: -1 });
        if (state.getPoints().length > 0) {
          const next = Math.min(i, state.getPoints().length - 1);
          const onKeyUp = (e: KeyboardEvent) => {
            if (e.key === "Delete" || e.key === "Backspace") {
              document.removeEventListener("keyup", onKeyUp);
              state.set({ selectedIdx: next });
            }
          };
          document.addEventListener("keyup", onKeyUp);
        }
      },
      clearPolygon() {
        if (state.getPoints().length === 0 || !window.confirm("Clear all vertices?")) return;
        state.pushUndo();
        state.getActive().points = [];
        state.setClosed(false);
        state.selectedIdx = -1;
        state.update();
      },
      setVertexX(x) {
        if (state.selectedIdx >= 0 && state.selectedIdx < state.getPoints().length) {
          state.pushUndo();
          state.getPoints()[state.selectedIdx].x = x;
          state.update();
        }
      },
      setVertexY(y) {
        if (state.selectedIdx >= 0 && state.selectedIdx < state.getPoints().length) {
          state.pushUndo();
          state.getPoints()[state.selectedIdx].y = y;
          state.update();
        }
      },

      // --- SVG event handlers ---

      onSvgClick(e) {
        if (state.getClosed() || state.dragging) return;
        state.pushUndo();
        const svg = e.currentTarget;
        let pt: Point;
        if (state.getPoints().length === 0) {
          pt = { x: 0, y: 0 };
        } else {
          pt = state.clientToSvg(svg, e.clientX, e.clientY);
          if (e.shiftKey) {
            const prev = state.getPoints()[state.getPoints().length - 1];
            const dx = Math.abs(pt.x - prev.x);
            const dy = Math.abs(pt.y - prev.y);
            pt = dx >= dy ? { x: pt.x, y: prev.y } : { x: prev.x, y: pt.y };
          }
        }
        state.getPoints().push(pt);
        state.set({ selectedIdx: state.getPoints().length - 1 });
      },
      selectVertex(e, i) {
        e.stopPropagation();
        state.set({ selectedIdx: i });
      },
      onVertexDoubleClick(e, i) {
        e.stopPropagation();
        if (i === 0 && !state.getClosed() && state.getPoints().length >= 3) {
          state.pushUndo();
          state.set({ closed: true } as any);
        }
      },
      onVertexPointerDown(e, i) {
        e.stopPropagation();
        e.preventDefault();
        state.pushUndo();
        state.set({ selectedIdx: i, dragging: true });
        const svg = e.currentTarget.closest("svg");
        if (!svg) return;
        const onMove = (ev: PointerEvent) => {
          const pt = state.clientToSvg(svg, ev.clientX, ev.clientY);
          if (ev.shiftKey && state.getPoints().length > 1) {
            const useNext = ev.ctrlKey || ev.metaKey || i === 0;
            const ref = useNext
              ? state.getPoints()[(i + 1) % state.getPoints().length]
              : state.getPoints()[(i - 1 + state.getPoints().length) % state.getPoints().length];
            const dx = Math.abs(pt.x - ref.x);
            const dy = Math.abs(pt.y - ref.y);
            state.getPoints()[i] = dx >= dy ? { x: pt.x, y: ref.y } : { x: ref.x, y: pt.y };
          } else {
            state.getPoints()[i] = pt;
          }
          state.update();
        };
        const onUp = () => {
          state.dragging = false;
          state.update();
          document.removeEventListener("pointermove", onMove);
          document.removeEventListener("pointerup", onUp);
        };
        document.addEventListener("pointermove", onMove);
        document.addEventListener("pointerup", onUp);
      },

      // --- localStorage persistence ---

      persist() {
        try {
          localStorage.setItem(storageKey, JSON.stringify({ paths: state.paths, filename: state.filename }));
        } catch {}
      },
      restore(): boolean {
        try {
          const raw = localStorage.getItem(storageKey);
          if (!raw) return false;
          const data = JSON.parse(raw);
          if (!Array.isArray(data.paths) || data.paths.length === 0) return false;
          state.paths = data.paths;
          state.activePathIdx = 0;
          state.filename = data.filename ?? "";
          state.selectedIdx = -1;
          state.update();
          return true;
        } catch {
          return false;
        }
      },
      clearPersisted() {
        localStorage.removeItem(storageKey);
      },

      // --- save / apply ---

      async save() {
        if (!state.filename) return;
        const closedPaths = state.paths.filter((p) => p.closed && p.points.length >= 3);
        if (closedPaths.length === 0) return;
        state.saving = true;
        state.update();
        try {
          const b = state.getAllBounds();
          const resp = await fetch(`/api/map-edit/path/${encodeURIComponent(state.filename)}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              width: Math.ceil(b.width),
              height: Math.ceil(b.height),
              paths: closedPaths.map((p) => ({ d: state.pathToD(p), title: p.title || state.filename })),
            }),
          });
          if (!resp.ok) throw new Error(await resp.text());
          state.clearPersisted();
        } finally {
          state.saving = false;
          state.update();
        }
      },
      apply() {
        const closedPaths = state.paths.filter((p) => p.closed && p.points.length >= 3);
        if (closedPaths.length === 0) return;
        const b = state.getAllBounds();
        state.clearPersisted();
        onApply(
          closedPaths.map((p) => ({
            d: state.pathToD(p),
            name: p.title || "path",
            svgWidth: Math.ceil(b.width),
            svgHeight: Math.ceil(b.height),
          })),
        );
        onOpenChange(false);
      },
    }),
  );

  useEffect(() => {
    if (open) {
      if (initialPaths) {
        state.reset(initialPaths, initialFilename);
      } else if (state.paths.length <= 1 && state.getPoints().length === 0 && !state.getClosed()) {
        if (!state.restore()) state.reset(undefined, initialFilename);
      }
    } else {
      state.paths = [];
      state.activePathIdx = 0;
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    document.addEventListener("keydown", state.onKeyDown);
    return () => document.removeEventListener("keydown", state.onKeyDown);
  }, [open]);

  const bounds = state.getAllBounds();
  const viewBounds = { x: bounds.x - 20, y: bounds.y - 20, w: bounds.width + 40, h: bounds.height + 40 };
  const viewBox = `${viewBounds.x} ${viewBounds.y} ${viewBounds.w} ${viewBounds.h}`;
  const hasClosedPaths = state.paths.some((p) => p.closed && p.points.length >= 3);
  const active = state.getActive();
  const pts = state.getPoints();

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        if (!next && state.paths.some((p) => p.points.length > 0)) state.persist();
        onOpenChange(next);
      }}
    >
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-50 bg-black/60" />
        <Dialog.Popup className={popupClass}>
          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-700">
            <Dialog.Title className="text-sm font-semibold text-slate-200">
              {initialPaths ? "Edit Paths" : "Create Path"}
            </Dialog.Title>
            <Dialog.Close className="p-1 hover:bg-slate-700 rounded transition-colors cursor-pointer">
              <XIcon className="size-5 text-slate-400" />
            </Dialog.Close>
          </div>

          <div className="flex flex-1 overflow-hidden">
            <svg className="flex-1 bg-slate-950 cursor-crosshair" viewBox={viewBox} onClick={state.onSvgClick}>
              <defs>
                <pattern id="grid-60" width={60} height={60} patternUnits="userSpaceOnUse">
                  <rect
                    width={60}
                    height={60}
                    fill="rgba(255,255,255,0.03)"
                    stroke="rgba(255,255,255,0.08)"
                    strokeWidth={0.5}
                  />
                </pattern>
              </defs>

              {/* grid */}
              <rect x={viewBounds.x} y={viewBounds.y} width={viewBounds.w} height={viewBounds.h} fill="url(#grid-60)" />

              {/* background image */}
              {fileSpecifier.type === "symbol" && (
                <image x={0} y={0} className="scale-20" href={`/starship-symbol/${fileSpecifier.key}.png`} />
              )}

              {/* inactive paths */}
              {state.paths.map((pathItem, pi) => {
                if (pi === state.activePathIdx || pathItem.points.length < 2) return null;
                return (
                  <g key={`path-${pi}`} opacity={0.3}>
                    {pathItem.closed && pathItem.points.length >= 3 && (
                      <polygon
                        points={pathItem.points.map((p) => `${p.x},${p.y}`).join(" ")}
                        fill="rgba(234, 179, 8, 0.4)"
                        stroke="rgba(234, 179, 8, 0.8)"
                        strokeWidth={1}
                      />
                    )}
                  </g>
                );
              })}

              {/* active path fill */}
              {active.closed && pts.length >= 3 && (
                <polygon
                  points={pts.map((p) => `${p.x},${p.y}`).join(" ")}
                  fill="rgba(234, 179, 8, 0.4)"
                  stroke="rgba(234, 179, 8, 0.8)"
                  strokeWidth={1}
                />
              )}

              {/* active path edges with arrows */}
              {pts.length >= 2 &&
                pts.map((p, i) => {
                  const next = active.closed ? pts[(i + 1) % pts.length] : pts[i + 1];
                  if (!next) return null;
                  const mx = p.x + (next.x - p.x) * 0.75;
                  const my = p.y + (next.y - p.y) * 0.75;
                  const angle = Math.atan2(next.y - p.y, next.x - p.x) * (180 / Math.PI);
                  return (
                    <g key={`edge-${i}`}>
                      <line x1={p.x} y1={p.y} x2={next.x} y2={next.y} stroke="rgba(234, 179, 8, 0.8)" strokeWidth={1} />
                      <path
                        d="M-1.5,-1 L1.5,0 L-1.5,1 Z"
                        fill="rgba(234, 179, 8, 0.8)"
                        transform={`translate(${mx},${my}) rotate(${angle})`}
                      />
                    </g>
                  );
                })}

              {/* active path midpoint insert handles */}
              {active.closed &&
                pts.map((p, i) => {
                  const next = pts[(i + 1) % pts.length];
                  const mx = (p.x + next.x) / 2;
                  const my = (p.y + next.y) / 2;
                  return (
                    <circle
                      key={`mid-${i}`}
                      cx={mx}
                      cy={my}
                      r={1}
                      fill="transparent"
                      stroke="rgba(0, 246, 130, 0.8)"
                      strokeWidth={0.25}
                      className="cursor-copy"
                      onClick={(e) => state.insertVertex(e, i, mx, my)}
                    />
                  );
                })}

              {/* active path vertex handles */}
              {pts.map((p, i) => (
                <circle
                  key={`v-${i}`}
                  data-vertex={i}
                  cx={p.x}
                  cy={p.y}
                  r={1}
                  fill={i === state.selectedIdx ? "#3b82f6" : i === 0 && !active.closed ? "#22c55e" : "#eab308"}
                  stroke="#fff"
                  strokeWidth={0.1}
                  className={cn("cursor-grab outline-0 focus:stroke-[0.4]")}
                  onClick={(e) => state.selectVertex(e, i)}
                  onDoubleClick={(e) => state.onVertexDoubleClick(e, i)}
                  onPointerDown={(e) => state.onVertexPointerDown(e, i)}
                  onFocus={() => state.set({ selectedIdx: i })}
                  tabIndex={0}
                />
              ))}
            </svg>

            {/* Controls panel */}
            <div className="w-56 p-3 border-l border-slate-700 overflow-y-auto flex flex-col gap-3 text-xs text-slate-300">
              {/* Path list */}
              <div className="flex flex-col gap-1">
                <div className="flex items-center justify-between">
                  <span className="text-slate-500">Paths</span>
                  <button
                    type="button"
                    className="cursor-pointer text-green-400 hover:text-green-300"
                    onClick={state.addPath}
                  >
                    <PlusCircleIcon className="size-4" />
                  </button>
                </div>
                {state.paths.map((p, i) => (
                  <div
                    key={i}
                    className={cn(
                      "flex items-center gap-1 rounded",
                      i === state.activePathIdx ? "bg-slate-700" : "hover:bg-slate-800",
                    )}
                    onClick={() => state.switchPath(i)}
                  >
                    <input
                      className="flex-1 bg-transparent px-1 py-0.5 text-xs text-slate-200 outline-none truncate cursor-pointer focus:cursor-text"
                      value={p.title}
                      placeholder={`path ${i}`}
                      onChange={(e) => {
                        p.title = e.target.value;
                        state.update();
                      }}
                      onClick={(e) => {
                        e.stopPropagation();
                        state.switchPath(i);
                      }}
                    />
                    {state.paths.length > 1 && (
                      <button
                        type="button"
                        className="cursor-pointer text-red-400 hover:text-red-300 p-0.5"
                        onClick={(e) => {
                          e.stopPropagation();
                          state.removePath(i);
                        }}
                      >
                        <MinusCircleIcon className="size-3.5" />
                      </button>
                    )}
                  </div>
                ))}
              </div>

              <div className="border-t border-slate-700" />
              <Field label="Filename">
                <input
                  className={inputClass}
                  value={state.filename}
                  onChange={(e) => state.set({ filename: e.target.value })}
                  placeholder="e.g. my-shape"
                />
              </Field>

              {state.selectedIdx >= 0 && state.selectedIdx < pts.length && (
                <div className="flex flex-col gap-1">
                  <span className="text-slate-500">Vertex {state.selectedIdx}</span>
                  <div className="flex gap-1">
                    <Field label="x" className="flex-1">
                      <input
                        key={`x-${state.selectedIdx}-${pts[state.selectedIdx].x}`}
                        type="number"
                        className={inputClass}
                        defaultValue={pts[state.selectedIdx].x}
                        onBlur={(e) => {
                          const v = Number(e.target.value);
                          if (!Number.isNaN(v)) state.setVertexX(v);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") e.currentTarget.blur();
                        }}
                      />
                    </Field>
                    <Field label="y" className="flex-1">
                      <input
                        key={`y-${state.selectedIdx}-${pts[state.selectedIdx].y}`}
                        type="number"
                        className={inputClass}
                        defaultValue={pts[state.selectedIdx].y}
                        onBlur={(e) => {
                          const v = Number(e.target.value);
                          if (!Number.isNaN(v)) state.setVertexY(v);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") e.currentTarget.blur();
                        }}
                      />
                    </Field>
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      className="text-red-400 hover:text-red-300 cursor-pointer"
                      onClick={() => {
                        state.pushUndo();
                        state.deleteVertex(state.selectedIdx);
                      }}
                    >
                      delete
                    </button>
                    <button
                      type="button"
                      className="text-blue-400 hover:text-blue-300 cursor-pointer"
                      onClick={() => {
                        const el = document.querySelector(`circle[data-vertex="${state.selectedIdx}"]`);
                        if (el instanceof SVGElement) el.focus();
                      }}
                    >
                      focus
                    </button>
                  </div>
                </div>
              )}

              <div className="flex gap-1">
                <span className="text-slate-500 flex-1">
                  {pts.length} vertices · {active.closed ? "closed" : "open"}
                </span>
                {!active.closed && pts.length >= 3 && (
                  <button
                    type="button"
                    className="px-2 py-0.5 rounded text-xs cursor-pointer bg-yellow-600 hover:bg-yellow-500 text-white"
                    onClick={() => {
                      state.pushUndo();
                      state.setClosed(true);
                      state.update();
                    }}
                  >
                    Close
                  </button>
                )}
                {pts.length > 0 && (
                  <button
                    type="button"
                    className="px-2 py-0.5 rounded text-xs cursor-pointer bg-red-700 hover:bg-red-600 text-white"
                    onClick={state.clearPolygon}
                  >
                    Clear
                  </button>
                )}
              </div>

              <div className="flex flex-col gap-1 mt-auto pt-3 border-t border-slate-700">
                <div className="flex gap-1">
                  <button
                    type="button"
                    className={cn(
                      "flex-1 px-2 py-1.5 rounded text-xs cursor-pointer bg-blue-600 hover:bg-blue-500 text-white",
                      (!state.filename || !hasClosedPaths) && disabledClass,
                    )}
                    onClick={state.save}
                    disabled={state.saving}
                  >
                    {state.saving ? "saving..." : "Save SVG"}
                  </button>
                  <button
                    type="button"
                    className={cn(
                      "flex-1 px-2 py-1.5 rounded text-xs cursor-pointer bg-green-600 hover:bg-green-500 text-white",
                      !hasClosedPaths && disabledClass,
                    )}
                    onClick={state.apply}
                  >
                    Apply
                  </button>
                </div>
              </div>
            </div>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function Field({ label, className, children }: { label: string; className?: string; children: React.ReactNode }) {
  return (
    <label className={cn("flex flex-col gap-0.5", className)}>
      <span className="text-slate-500">{label}</span>
      {children}
    </label>
  );
}

type Point = { x: number; y: number };
type PathItem = { points: Point[]; closed: boolean; title: string };
type MultiSnapshot = { paths: PathItem[] };
const emptyPathItem: PathItem = { points: [], closed: false, title: "" };

type State = {
  paths: PathItem[];
  activePathIdx: number;
  selectedIdx: number;
  dragging: boolean;
  filename: string;
  saving: boolean;
  undoStack: MultiSnapshot[];
  redoStack: MultiSnapshot[];

  getActive(): PathItem;
  getPoints(): Point[];
  getClosed(): boolean;
  setClosed(v: boolean): void;

  snapshot(): MultiSnapshot;
  pushUndo(): void;
  undo(): void;
  redo(): void;

  reset(initPaths?: ProvidedPath[], filename?: string): void;
  onKeyDown(e: KeyboardEvent): void;

  switchPath(idx: number): void;
  addPath(): void;
  removePath(idx: number): void;

  getAllBounds(): { x: number; y: number; width: number; height: number };
  normalizeOrigin(): void;
  pathToD(pathItem: PathItem): string;
  clientToSvg(svg: SVGSVGElement, clientX: number, clientY: number): Point;

  onSvgClick(e: React.MouseEvent<SVGSVGElement>): void;
  selectVertex(e: React.MouseEvent, i: number): void;
  onVertexDoubleClick(e: React.MouseEvent, i: number): void;
  onVertexPointerDown(e: React.PointerEvent<SVGCircleElement>, i: number): void;
  insertVertex(e: React.MouseEvent, i: number, mx: number, my: number): void;
  deleteVertex(i: number): void;
  clearPolygon(): void;
  setVertexX(x: number): void;
  setVertexY(y: number): void;

  persist(): void;
  restore(): boolean;
  clearPersisted(): void;
  save(): Promise<void>;
  apply(): void;
};

const popupClass = cn(
  "fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2",
  "bg-slate-900 border border-slate-700 rounded-lg shadow-2xl",
  "max-w-4xl w-[90vw] max-h-[90vh] flex flex-col",
);
const inputClass = "bg-slate-800 border border-slate-600 rounded px-2 py-1 text-slate-200 w-full";
const disabledClass = "opacity-50 pointer-events-none";
const storageKey = "path-editor-draft";

export type ProvidedPath = { d: string; title: string; transform: string };
