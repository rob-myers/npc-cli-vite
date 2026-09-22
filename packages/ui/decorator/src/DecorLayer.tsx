import type { WorldState } from "@npc-cli/ui__world";
import { cn } from "@npc-cli/util";
import { MapPinIcon } from "@phosphor-icons/react";
import { useRef, useState } from "react";
import {
  anchorOf,
  circleResized,
  imgSize,
  moved,
  pointCorner,
  pointResized,
  rectCorners,
  rectResized,
  toMap,
} from "./decor-edit";

/**
 * The map's decor, over `NavMap2d`: static decor faint for context, runtime decor selectable and
 * draggable. A drag moves the selection as one and commits on release, as one `create` per decor.
 * A selected rect or circle has handles: its corners, or a point on its rim; a point with an
 * image has one at the image's corner, which scales it
 */
export function DecorLayer({ w, selected, showStatic, onSelect, onCommit }: Props) {
  const drag = useRef<Drag | null>(null);
  /** The def as a handle drags it, drawn in place of the decor until let go */
  const [resizing, setResizing] = useState<Geomorph.DecorDef | null>(null);
  const resized = useRef<Geomorph.DecorDef | null>(null); // the same, for the release to commit

  function onHandlePointerDown(e: React.PointerEvent<SVGElement>, key: string, i: number) {
    if (isPress(e) === false) return;
    e.stopPropagation();
    const handle = e.currentTarget; // React drops `currentTarget` once the handler returns
    const svg = handle.ownerSVGElement;
    const def = w.decor.runtime.defByKey[key];
    if (svg === null || def === undefined) return;
    handle.setPointerCapture(e.pointerId);
    blockMenu();
    const onMove = (ev: PointerEvent) => {
      const at = toMap(svg, ev.clientX, ev.clientY);
      const step = stepOf(ev);
      resized.current =
        def.type === "rect"
          ? rectResized(def, i, at, step)
          : def.type === "circle"
            ? circleResized(def, at, step)
            : def.type === "point"
              ? pointResized(w, def, at, step)
              : null;
      setResizing(resized.current);
    };
    const onUp = () => {
      handle.removeEventListener("pointermove", onMove);
      handle.removeEventListener("pointerup", onUp);
      handle.removeEventListener("pointercancel", onUp);
      unblockMenu();
      if (resized.current !== null) onCommit([resized.current]);
      resized.current = null;
      setResizing(null);
    };
    handle.addEventListener("pointermove", onMove);
    handle.addEventListener("pointerup", onUp);
    handle.addEventListener("pointercancel", onUp);
  }

  function onItemPointerDown(e: React.PointerEvent<SVGGElement>, key: string) {
    if (isPress(e) === false) return;
    e.stopPropagation();
    // shift adds at once, so a drag moves it too; taking away waits, since a drag keeps it
    const keys = selected.includes(key) ? selected : e.shiftKey ? [...selected, key] : [key];
    if (keys !== selected) onSelect(keys);
    const svg = e.currentTarget.ownerSVGElement;
    const def = w.decor.runtime.defByKey[key];
    if (svg === null || def === undefined) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    blockMenu();
    const start = toMap(svg, e.clientX, e.clientY);
    const shift = e.shiftKey === false ? null : keys === selected ? "remove" : "added";
    drag.current = { svg, key, start, anchor: anchorOf(def), dx: 0, dy: 0, travel: 0, keys, shift };
  }

  function onItemPointerMove(e: React.PointerEvent<SVGGElement>) {
    const d = drag.current;
    if (d === null) return;
    const at = toMap(d.svg, e.clientX, e.clientY);
    const step = stepOf(e);
    d.dx = at.x - d.start.x;
    d.dy = at.y - d.start.y;
    d.travel = Math.max(d.travel, Math.hypot(d.dx, d.dy));
    if (step !== undefined) {
      // the pressed decor's anchor onto the grid, the rest keeping their places about it
      d.dx = Math.round((d.anchor.x + d.dx) / step) * step - d.anchor.x;
      d.dy = Math.round((d.anchor.y + d.dy) / step) * step - d.anchor.y;
    }
    // the dragged decor, and their handles, follow the pointer through their transforms, not React
    for (const el of dragged(d)) el.setAttribute("transform", `translate(${d.dx} ${d.dy})`);
  }

  function onItemPointerUp() {
    const d = drag.current;
    drag.current = null;
    if (d === null) return;
    unblockMenu();
    for (const el of dragged(d)) el.removeAttribute("transform");
    if (d.travel < dragThreshold) {
      // a click: the press kept the selection so a drag could move it all. A shift-click toggles
      // the one, else narrows to it
      if (d.shift === "remove") {
        onSelect(d.keys.filter((k) => k !== d.key));
      } else if (d.shift === null && d.keys.length > 1) {
        onSelect([d.key]);
      }
      return;
    }
    if (d.dx === 0 && d.dy === 0) return; // snapped back to where it was
    onCommit(
      d.keys.flatMap((key) =>
        key in w.decor.runtime.defByKey ? [moved(w.decor.runtime.defByKey[key], d.dx, d.dy)] : [],
      ),
    );
  }

  function dragged(d: Drag) {
    return d.svg.querySelectorAll<SVGElement>(
      d.keys.map((key) => `[data-decor="${key}"], [data-handle="${key}"]`).join(","),
    );
  }

  const runtime = Object.values(w.decor.runtime.byKey);
  const statics = showStatic ? Object.values(w.decor.byKey).filter((d) => !(d.key in w.decor.runtime.byKey)) : [];

  return (
    <g>
      {statics.map((d) => (
        <g key={d.key} opacity={0.25} pointerEvents="none">
          <Shape w={w} decor={d} color={ink.static} />
        </g>
      ))}
      {runtime.map((d) => {
        const isSelected = selected.includes(d.key);
        return (
          <g
            key={d.key}
            data-decor={d.key}
            data-no-pan
            className={cn("cursor-move", isSelected && "drop-shadow-[0_0_3px_#ffe066]")}
            onPointerDown={(e) => onItemPointerDown(e, d.key)}
            onPointerMove={onItemPointerMove}
            onPointerUp={onItemPointerUp}
            onPointerCancel={onItemPointerUp}
            onContextMenu={preventDefault}
          >
            <title>{`${d.key} (${d.type}${d.meta.grKey ? `, ${d.meta.grKey}` : ""})`}</title>
            {resizing?.key === d.key ? (
              <Preview w={w} def={resizing} color={ink.selected} />
            ) : (
              <Shape w={w} decor={d} color={isSelected ? ink.selected : ink[d.type]} />
            )}
          </g>
        );
      })}
      {selected.map((key) => {
        const def = resizing?.key === key ? resizing : w.decor.runtime.defByKey[key];
        if (def === undefined) return null;
        const corner = def.type === "point" ? pointCorner(w, def) : null;
        const handles =
          def.type === "rect"
            ? rectCorners(def)
            : def.type === "circle"
              ? [{ x: def.center.x + def.radius, y: def.center.y }]
              : corner !== null
                ? [corner]
                : [];
        // no bigger than a share of the thing itself, e.g. a small image's corner
        const extent =
          def.type === "rect"
            ? Math.min(def.width, def.height)
            : def.type === "circle"
              ? def.radius
              : def.type === "point"
                ? Math.min(...Object.values(imgSize(w, def.img, def.scale) ?? { w: Infinity }))
                : Infinity;
        const size = Math.min(handleSize, extent * handleShare);
        return handles.map((p, i) => (
          <rect
            key={`${key}:${i}`}
            data-handle={key}
            data-no-pan
            x={p.x - size / 2}
            y={p.y - size / 2}
            width={size}
            height={size}
            fill={ink.selected}
            stroke="#000"
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
            className="cursor-crosshair"
            onPointerDown={(e) => onHandlePointerDown(e, key, i)}
            onContextMenu={preventDefault} // ctrl is the fine step, not a menu
          />
        ));
      })}
    </g>
  );
}

function preventDefault(e: Pick<Event, "preventDefault">) {
  e.preventDefault();
}

/** A primary press, or a ctrl one: macOS makes ctrl-click a right one */
function isPress(e: React.PointerEvent) {
  return e.button === 0 || (e.button === 2 && e.ctrlKey);
}

/** Shift is the coarse step, ctrl or alt the fine */
function stepOf(e: { shiftKey: boolean; ctrlKey: boolean; altKey: boolean }) {
  return e.shiftKey ? coarseStep : e.ctrlKey || e.altKey ? fineStep : undefined;
}

/** A snapped drag lags the pointer, so a menu on release would land beside what was pressed */
function blockMenu() {
  window.addEventListener("contextmenu", preventDefault, true);
}

function unblockMenu() {
  setTimeout(() => window.removeEventListener("contextmenu", preventDefault, true), menuAfterUpMs);
}

/** A rect, circle or point as a handle drags it */
function Preview({ w, def, color }: { w: WorldState; def: Geomorph.DecorDef; color: string }) {
  const stroke = { stroke: color, strokeWidth: 1.5, vectorEffect: "non-scaling-stroke" as const };
  if (def.type === "rect") {
    const points = rectCorners(def)
      .map((p) => `${p.x},${p.y}`)
      .join(" ");
    return <polygon points={points} fill={color} fillOpacity={0.15} {...stroke} />;
  }
  if (def.type === "circle") {
    return <circle cx={def.center.x} cy={def.center.y} r={def.radius} fill={color} fillOpacity={0.15} {...stroke} />;
  }
  if (def.type === "point") {
    const size = imgSize(w, def.img, def.scale);
    if (size === null) return null;
    return (
      <rect
        x={-size.width / 2}
        y={-size.height / 2}
        width={size.width}
        height={size.height}
        transform={`translate(${def.x} ${def.y}) rotate(${def.orient ?? 0})`}
        fill={color}
        fillOpacity={0.15}
        {...stroke}
      />
    );
  }
  return null;
}

/** One decor as its 2D footprint */
function Shape({ w, decor: d, color }: { w: WorldState; decor: Geomorph.Decor; color: string }) {
  const stroke = { stroke: color, strokeWidth: 1.5, vectorEffect: "non-scaling-stroke" as const };
  switch (d.type) {
    case "point": {
      const size = imgSize(w, d.meta.img, d.scale);
      if (size === null) {
        // abstract: a pin, its tip on the point
        return (
          <g transform={`translate(${d.x} ${d.y})`}>
            {/* under the pin: its hole would let a press through */}
            <rect
              x={-pinHeight / 2}
              y={-pinHeight * pinTipFrac}
              width={pinHeight}
              height={pinHeight}
              fill="transparent"
            />
            <MapPinIcon
              x={-pinHeight / 2}
              y={-pinHeight * pinTipFrac}
              width={pinHeight}
              height={pinHeight}
              color={color}
              weight="duotone"
            />
          </g>
        );
      }
      return (
        <g transform={`translate(${d.x} ${d.y}) rotate(${d.orient})`}>
          <image
            href={`/decor/${d.meta.img}.thumbnail.png`}
            x={-size.width / 2}
            y={-size.height / 2}
            width={size.width}
            height={size.height}
          />
          <rect
            x={-size.width / 2}
            y={-size.height / 2}
            width={size.width}
            height={size.height}
            fill="transparent"
            {...stroke}
            strokeOpacity={0.5}
          />
        </g>
      );
    }
    case "rect":
      return (
        <polygon points={d.points.map((p) => `${p.x},${p.y}`).join(" ")} fill={color} fillOpacity={0.15} {...stroke} />
      );
    case "circle":
      return <circle cx={d.center.x} cy={d.center.y} r={d.radius} fill={color} fillOpacity={0.15} {...stroke} />;
    case "quad": {
      const size = imgSize(w, d.meta.img) ?? { width: 1, height: 1 };
      const [a, b, c, e, f, g] = d.transform;
      return (
        <g transform={`matrix(${a} ${b} ${c} ${e} ${f} ${g})`}>
          <image href={`/decor/${d.meta.img}.thumbnail.png`} width={size.width} height={size.height} opacity={0.8} />
          <rect
            width={size.width}
            height={size.height}
            fill="transparent"
            {...stroke}
            strokeDasharray={d.meta.tilt ? "3 2" : undefined}
          />
          {/* its top, which a tilt stands it up along */}
          <line x1={0} y1={0} x2={size.width} y2={0} {...stroke} strokeWidth={3} />
        </g>
      );
    }
  }
}

/** `key` was pressed; `keys` move with it */
type Drag = {
  svg: SVGSVGElement;
  key: string;
  start: Geom.VectJson;
  /** The pressed decor's, which a snapped drag puts on the grid */
  anchor: Geom.VectJson;
  dx: number;
  dy: number;
  /** The furthest the pointer got, unsnapped: less than `dragThreshold` is a click */
  travel: number;
  keys: string[];
  /** Pressed with shift: a click takes away what was selected, and keeps what the press added */
  shift: null | "remove" | "added";
};

type Props = {
  w: WorldState;
  selected: string[];
  showStatic: boolean;
  onSelect(keys: string[]): void;
  onCommit(defs: Geomorph.DecorDef[]): void;
};

/** Metres, at most; and at most this share of the decor's own smallest extent */
const handleSize = 0.16;
const handleShare = 0.4;
/** Metres: a drag or resize with shift held goes by this, with ctrl or alt by the finer */
const coarseStep = 0.5;
const fineStep = 0.1;
/** Metres: the pin stands this tall; its tip is this far down its box */
const pinHeight = 0.5;
const pinTipFrac = 232 / 256;
/** Some platforms raise a ctrl or right click's menu after `pointerup` */
const menuAfterUpMs = 100;
/** In map metres: less is a click */
const dragThreshold = 0.02;
const ink = {
  static: "#8a97a8",
  selected: "#ffe066",
  point: "#9fb4cc",
  rect: "#7fc3d9",
  circle: "#9ccf8f",
  quad: "#e09a6a",
};
