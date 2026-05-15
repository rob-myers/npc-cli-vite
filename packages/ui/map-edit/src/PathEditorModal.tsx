import { Dialog } from "@base-ui/react/dialog";
import { cn, useStateRef } from "@npc-cli/util";
import { geomService } from "@npc-cli/util/geom";
import { XIcon } from "@phosphor-icons/react";
import { useEffect } from "react";
import type { ParsedPath } from "./PathPickerModal";

export function PathEditorModal({
  open,
  onOpenChange,
  onApply,
  initialD,
  initialTitle,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onApply: (path: ParsedPath) => void;
  initialD?: string;
  initialTitle?: string;
}) {
  const state = useStateRef(
    (): State => ({
      points: [],
      closed: false,
      selectedIdx: -1,
      dragging: false,
      title: "",
      filename: "",
      saving: false,
      undoStack: [],
      redoStack: [],

      // --- history ---

      snapshot(): Snapshot {
        return { points: state.points.map((p) => ({ ...p })), closed: state.closed };
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
        state.points = prev.points;
        state.closed = prev.closed;
        state.selectedIdx = -1;
        state.persist();
        state.update();
      },
      redo() {
        const next = state.redoStack.pop();
        if (!next) return;
        state.undoStack.push(state.snapshot());
        state.points = next.points;
        state.closed = next.closed;
        state.selectedIdx = -1;
        state.persist();
        state.update();
      },

      // --- lifecycle ---

      reset(d, title) {
        if (d) {
          const poly = geomService.svgPathToPolygon(d);
          state.points = poly ? poly.outline.map((v) => ({ x: v.x, y: v.y })) : [];
          state.closed = true;
        } else {
          state.points = [];
          state.closed = false;
        }
        state.selectedIdx = -1;
        state.title = title ?? "";
        state.filename = "";
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

      // --- geometry helpers ---

      getBounds() {
        if (state.points.length === 0) return { x: 0, y: 0, width: 100, height: 100 };
        let maxX = -Infinity,
          maxY = -Infinity;
        for (const p of state.points) {
          maxX = Math.max(maxX, p.x);
          maxY = Math.max(maxY, p.y);
        }
        return { x: 0, y: 0, width: maxX, height: maxY };
      },
      normalizeOrigin() {
        if (state.points.length === 0) return;
        let minX = Infinity,
          minY = Infinity;
        for (const p of state.points) {
          minX = Math.min(minX, p.x);
          minY = Math.min(minY, p.y);
        }
        if (minX !== 0 || minY !== 0) {
          for (const p of state.points) {
            p.x -= minX;
            p.y -= minY;
          }
        }
      },
      toD() {
        if (state.points.length === 0) return "";
        return state.points.map((p, i) => `${i === 0 ? "M" : "L"}${p.x},${p.y}`).join(" ") + " Z";
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
        state.points.splice(i + 1, 0, { x: Math.round(mx * 10) / 10, y: Math.round(my * 10) / 10 });
        state.set({ selectedIdx: i + 1 });
      },
      deleteVertex(i) {
        state.points.splice(i, 1);
        if (state.points.length < 3) state.closed = false;
        state.set({ selectedIdx: -1 });
        if (state.points.length > 0) {
          const next = Math.min(i, state.points.length - 1);
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
        if (state.points.length === 0 || !window.confirm("Clear all vertices?")) return;
        state.pushUndo();
        state.points.length = 0;
        state.closed = false;
        state.selectedIdx = -1;
        state.update();
      },
      setVertexX(x) {
        if (state.selectedIdx >= 0 && state.selectedIdx < state.points.length) {
          state.pushUndo();
          state.points[state.selectedIdx].x = x;
          state.update();
        }
      },
      setVertexY(y) {
        if (state.selectedIdx >= 0 && state.selectedIdx < state.points.length) {
          state.pushUndo();
          state.points[state.selectedIdx].y = y;
          state.update();
        }
      },

      // --- SVG event handlers ---

      onSvgClick(e) {
        if (state.closed || state.dragging) return;
        state.pushUndo();
        const svg = e.currentTarget;
        let pt: Point;
        if (state.points.length === 0) {
          pt = { x: 0, y: 0 };
        } else {
          pt = state.clientToSvg(svg, e.clientX, e.clientY);
          if (e.shiftKey) {
            const prev = state.points[state.points.length - 1];
            const dx = Math.abs(pt.x - prev.x);
            const dy = Math.abs(pt.y - prev.y);
            pt = dx >= dy ? { x: pt.x, y: prev.y } : { x: prev.x, y: pt.y };
          }
        }
        state.points.push(pt);
        state.set({ selectedIdx: state.points.length - 1 });
      },
      selectVertex(e, i) {
        e.stopPropagation();
        state.set({ selectedIdx: i });
      },
      onVertexDoubleClick(e, i) {
        e.stopPropagation();
        if (i === 0 && !state.closed && state.points.length >= 3) {
          state.pushUndo();
          state.set({ closed: true });
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
          if (ev.shiftKey && state.points.length > 1) {
            const prev = state.points[(i - 1 + state.points.length) % state.points.length];
            const dx = Math.abs(pt.x - prev.x);
            const dy = Math.abs(pt.y - prev.y);
            state.points[i] = dx >= dy ? { x: pt.x, y: prev.y } : { x: prev.x, y: pt.y };
          } else {
            state.points[i] = pt;
          }
          state.update();
        };
        const onUp = () => {
          state.dragging = false;
          state.normalizeOrigin();
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
          localStorage.setItem(
            storageKey,
            JSON.stringify({
              points: state.points,
              closed: state.closed,
              title: state.title,
              filename: state.filename,
            }),
          );
        } catch {}
      },
      restore(): boolean {
        try {
          const raw = localStorage.getItem(storageKey);
          if (!raw) return false;
          const data = JSON.parse(raw);
          if (!Array.isArray(data.points) || data.points.length === 0) return false;
          state.points = data.points;
          state.closed = data.closed ?? false;
          state.title = data.title ?? "";
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
        if (!state.filename || state.points.length < 3) return;
        state.saving = true;
        state.update();
        try {
          const b = state.getBounds();
          const resp = await fetch(`/api/map-edit/path/${encodeURIComponent(state.filename)}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              title: state.title || state.filename,
              width: Math.ceil(b.x + b.width),
              height: Math.ceil(b.y + b.height),
              d: state.toD(),
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
        if (state.points.length < 3) return;
        const b = state.getBounds();
        state.clearPersisted();
        onApply({
          d: state.toD(),
          name: state.title || "path",
          svgWidth: Math.ceil(b.x + b.width),
          svgHeight: Math.ceil(b.y + b.height),
        });
        onOpenChange(false);
      },
    }),
  );

  useEffect(() => {
    if (open && state.points.length === 0 && !state.closed) {
      if (!state.restore()) state.reset(initialD, initialTitle);
    }
    if (!open) {
      state.points = [];
      state.closed = false;
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    document.addEventListener("keydown", state.onKeyDown);
    return () => document.removeEventListener("keydown", state.onKeyDown);
  }, [open]);

  const bounds = state.getBounds();
  const viewBox =
    state.points.length > 0
      ? `${bounds.x - 20} ${bounds.y - 20} ${bounds.width + 40} ${bounds.height + 40}`
      : "0 0 400 400";
  const canSave = state.closed && state.points.length >= 3;

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        if (!next && state.points.length > 0) state.persist();
        onOpenChange(next);
      }}
    >
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-50 bg-black/60" />
        <Dialog.Popup className={popupClass}>
          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-700">
            <Dialog.Title className="text-sm font-semibold text-slate-200">
              {initialD ? "Edit Path" : "Create Path"}
            </Dialog.Title>
            <Dialog.Close className="p-1 hover:bg-slate-700 rounded transition-colors cursor-pointer">
              <XIcon className="size-5 text-slate-400" />
            </Dialog.Close>
          </div>

          <div className="flex flex-1 overflow-hidden">
            {/* SVG canvas */}
            <svg className="flex-1 bg-slate-950 cursor-crosshair" viewBox={viewBox} onClick={state.onSvgClick}>
              {state.points.length > 0 && (
                <rect
                  x={0}
                  y={0}
                  width={bounds.x + bounds.width}
                  height={bounds.y + bounds.height}
                  fill="rgba(255,255,255,0.03)"
                  stroke="rgba(255,255,255,0.1)"
                  strokeWidth={0.5}
                  strokeDasharray="2 2"
                />
              )}
              {canSave && (
                <polygon
                  points={state.points.map((p) => `${p.x},${p.y}`).join(" ")}
                  fill="rgba(234, 179, 8, 0.4)"
                  stroke="rgba(234, 179, 8, 0.8)"
                  strokeWidth={1}
                />
              )}
              {state.points.length >= 2 &&
                state.points.map((p, i) => {
                  const next = state.closed ? state.points[(i + 1) % state.points.length] : state.points[i + 1];
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
              {state.closed &&
                state.points.map((p, i) => {
                  const next = state.points[(i + 1) % state.points.length];
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
              {state.points.map((p, i) => (
                <circle
                  key={`v-${i}`}
                  data-vertex={i}
                  cx={p.x}
                  cy={p.y}
                  r={1}
                  fill={i === state.selectedIdx ? "#3b82f6" : i === 0 && !state.closed ? "#22c55e" : "#eab308"}
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
              <Field label="Title">
                <input
                  className={inputClass}
                  value={state.title}
                  onChange={(e) => state.set({ title: e.target.value })}
                />
              </Field>
              <Field label="Filename">
                <input
                  className={inputClass}
                  value={state.filename}
                  onChange={(e) => state.set({ filename: e.target.value })}
                  placeholder="e.g. my-shape"
                />
              </Field>

              {state.selectedIdx >= 0 && state.selectedIdx < state.points.length && (
                <div className="flex flex-col gap-1">
                  <span className="text-slate-500">Vertex {state.selectedIdx}</span>
                  <div className="flex gap-1">
                    <Field label="x" className="flex-1">
                      <input
                        type="number"
                        className={inputClass}
                        value={state.points[state.selectedIdx].x}
                        onChange={(e) => state.setVertexX(Number(e.target.value))}
                      />
                    </Field>
                    <Field label="y" className="flex-1">
                      <input
                        type="number"
                        className={inputClass}
                        value={state.points[state.selectedIdx].y}
                        onChange={(e) => state.setVertexY(Number(e.target.value))}
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

              <div className="flex flex-col gap-1 mt-auto pt-3 border-t border-slate-700">
                <span className="text-slate-500">
                  {state.points.length} vertices · {state.closed ? "closed" : "open"}
                </span>
                <div className="flex gap-1">
                  {!state.closed && state.points.length >= 3 && (
                    <button
                      type="button"
                      className="flex-1 px-2 py-1 rounded text-xs cursor-pointer bg-yellow-600 hover:bg-yellow-500 text-white"
                      onClick={() => {
                        state.pushUndo();
                        state.set({ closed: true });
                      }}
                    >
                      Close path
                    </button>
                  )}
                  {state.points.length > 0 && (
                    <button
                      type="button"
                      className="flex-1 px-2 py-1 rounded text-xs cursor-pointer bg-red-700 hover:bg-red-600 text-white"
                      onClick={state.clearPolygon}
                    >
                      Clear
                    </button>
                  )}
                </div>
                <div className="flex gap-1">
                  <button
                    type="button"
                    className={cn(
                      "flex-1 px-2 py-1.5 rounded text-xs cursor-pointer bg-blue-600 hover:bg-blue-500 text-white",
                      (!state.filename || !canSave) && disabledClass,
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
                      !canSave && disabledClass,
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
type Snapshot = { points: Point[]; closed: boolean };

type State = {
  points: Point[];
  closed: boolean;
  selectedIdx: number;
  dragging: boolean;
  title: string;
  filename: string;
  saving: boolean;
  undoStack: Snapshot[];
  redoStack: Snapshot[];

  snapshot(): Snapshot;
  pushUndo(): void;
  undo(): void;
  redo(): void;

  reset(d?: string, title?: string): void;
  onKeyDown(e: KeyboardEvent): void;

  getBounds(): { x: number; y: number; width: number; height: number };
  toD(): string;
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
  normalizeOrigin(): void;

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
