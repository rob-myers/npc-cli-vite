import type { WorldState } from "@npc-cli/ui__world";
import { cn } from "@npc-cli/util";
import { MapPinIcon } from "@phosphor-icons/react";
import { useRef } from "react";
import { imgSize, moved, toMap } from "./decor-edit";

/**
 * The map's decor, over `NavMap2d`: static decor faint for context, runtime decor selectable and
 * draggable. A drag moves the selection as one and commits on release, as one `create` per decor
 */
export function DecorLayer({ w, selected, showStatic, onSelect, onCommit }: Props) {
  const drag = useRef<Drag | null>(null);

  function onItemPointerDown(e: React.PointerEvent<SVGGElement>, key: string) {
    if (e.button !== 0) return;
    e.stopPropagation();
    const keys = e.shiftKey
      ? selected.includes(key)
        ? selected.filter((k) => k !== key)
        : [...selected, key]
      : selected.includes(key)
        ? selected
        : [key];
    onSelect(keys);
    if (e.shiftKey) return;
    const svg = e.currentTarget.ownerSVGElement;
    if (svg === null) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { svg, key, start: toMap(svg, e.clientX, e.clientY), dx: 0, dy: 0, keys };
  }

  function onItemPointerMove(e: React.PointerEvent<SVGGElement>) {
    const d = drag.current;
    if (d === null) return;
    const at = toMap(d.svg, e.clientX, e.clientY);
    d.dx = at.x - d.start.x;
    d.dy = at.y - d.start.y;
    // the dragged decor follow the pointer through their transforms, not through React
    for (const key of d.keys)
      d.svg
        .querySelector<SVGGElement>(`[data-decor="${key}"]`)
        ?.setAttribute("transform", `translate(${d.dx} ${d.dy})`);
  }

  function onItemPointerUp() {
    const d = drag.current;
    drag.current = null;
    if (d === null) return;
    for (const key of d.keys) d.svg.querySelector<SVGGElement>(`[data-decor="${key}"]`)?.removeAttribute("transform");
    if (Math.hypot(d.dx, d.dy) < dragThreshold) {
      // a click: the press kept the selection so a drag could move it all; narrow to the one
      if (d.keys.length > 1) onSelect([d.key]);
      return;
    }
    onCommit(
      d.keys.flatMap((key) =>
        key in w.decor.runtime.defByKey ? [moved(w.decor.runtime.defByKey[key], d.dx, d.dy)] : [],
      ),
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
          >
            <title>{`${d.key} (${d.type}${d.meta.grKey ? `, ${d.meta.grKey}` : ""})`}</title>
            <Shape w={w} decor={d} color={isSelected ? ink.selected : ink[d.type]} />
          </g>
        );
      })}
    </g>
  );
}

/** One decor as its 2D footprint */
function Shape({ w, decor: d, color }: { w: WorldState; decor: Geomorph.Decor; color: string }) {
  const stroke = { stroke: color, strokeWidth: 1.5, vectorEffect: "non-scaling-stroke" as const };
  switch (d.type) {
    case "point": {
      const size = imgSize(w, d.meta.img);
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
            href={`/decor/${d.meta.img}.svg`}
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
          <image href={`/decor/${d.meta.img}.svg`} width={size.width} height={size.height} opacity={0.8} />
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
type Drag = { svg: SVGSVGElement; key: string; start: Geom.VectJson; dx: number; dy: number; keys: string[] };

type Props = {
  w: WorldState;
  selected: string[];
  showStatic: boolean;
  onSelect(keys: string[]): void;
  onCommit(defs: Geomorph.DecorDef[]): void;
};

/** Metres: the pin stands this tall; its tip is this far down its box */
const pinHeight = 0.5;
const pinTipFrac = 232 / 256;
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
