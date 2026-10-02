import type { WorldState } from "@npc-cli/ui__world";
import { geomorphGridMeters } from "@npc-cli/ui__world/const.env";
import { helper } from "@npc-cli/ui__world/helper";
import { Mat } from "@npc-cli/util/geom";
import { preventPopupGestures, useSvgZoom } from "@npc-cli/util/use-svg-zoom";
import { memo, useEffect, useMemo, useRef } from "react";
import { halfGridMeters, isPress, stepOf, toMap } from "./decor-edit";
import type { DecoratorUiMeta } from "./schema";
import { getDecoratorMapStore } from "./storage";

/**
 * The map from above, in world metres: 2D `x/y` is world `x/z`. Drawn from each geomorph's own
 * layout and the navmesh, so it is where things really are — see `docs/decorator.md`
 */
export function NavMap2d({ w, show, npcKeys, children, onClick, onMarquee, onNpcDrop, cursor, apiRef }: Props) {
  const press = useRef<Press | null>(null);
  const marqueeEl = useRef<SVGRectElement>(null);

  const bounds = useMemo(() => {
    if (w.gms.length === 0) return { minX: 0, minY: 0, width: 10, height: 10 };
    const xs = w.gms.flatMap(({ gridRect: r }) => [r.x, r.x + r.width]);
    const ys = w.gms.flatMap(({ gridRect: r }) => [r.y, r.y + r.height]);
    const [x1, x2, y1, y2] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    const pad = Math.max(x2 - x1, y2 - y1) * 0.05;
    return { minX: x1 - pad, minY: y1 - pad, width: x2 - x1 + 2 * pad, height: y2 - y1 + 2 * pad };
  }, [w.gmsHash]);

  // where the map was left, per World and map
  const store = getDecoratorMapStore(w.key, w.mapKey);
  const zoom = useSvgZoom(bounds, {
    initial: store.read().view ?? undefined,
    onChange: (view) => store.patch({ view }),
  });

  if (apiRef !== undefined) apiRef.current = { centreOn: zoom.centreOn };

  // a press on the map itself: with shift a marquee, else a pan — and, unmoved, a click
  function onPointerDown(e: React.PointerEvent<SVGSVGElement>) {
    if (e.button !== 0 || (e.target as Element).closest?.("[data-no-pan]")) return;
    const at = toMap(e.currentTarget, e.clientX, e.clientY);
    press.current = { at, client: { x: e.clientX, y: e.clientY }, marquee: e.shiftKey && onMarquee !== undefined };
    if (press.current.marquee) {
      e.currentTarget.setPointerCapture(e.pointerId);
    } else {
      zoom.onPointerDown(e);
    }
  }
  function onPointerMove(e: React.PointerEvent<SVGSVGElement>) {
    const p = press.current;
    if (p?.marquee !== true) return zoom.onPointerMove(e);
    const r = rectFrom(p.at, toMap(e.currentTarget, e.clientX, e.clientY));
    const el = marqueeEl.current;
    if (el === null) return;
    el.setAttribute("x", String(r.x));
    el.setAttribute("y", String(r.y));
    el.setAttribute("width", String(r.width));
    el.setAttribute("height", String(r.height));
    el.style.display = "";
  }
  function onPointerUp(e: React.PointerEvent<SVGSVGElement>) {
    const p = press.current;
    press.current = null;
    zoom.onPointerUp();
    if (p === null) return;
    if (p.marquee) {
      if (marqueeEl.current) marqueeEl.current.style.display = "none";
      onMarquee?.(rectFrom(p.at, toMap(e.currentTarget, e.clientX, e.clientY)), e.nativeEvent);
    } else if (Math.hypot(e.clientX - p.client.x, e.clientY - p.client.y) < clickSlopPx) {
      onClick?.(p.at, e.nativeEvent);
    }
  }

  const doors = Object.values(w.door?.byKey ?? {});

  return (
    <svg
      ref={preventPopupGestures}
      className="size-full touch-none select-none bg-(--deco-bg)"
      style={{ cursor }}
      viewBox={zoom.viewBox}
      onWheel={zoom.onWheel}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onTouchStart={zoom.onTouchStart}
      onTouchMove={zoom.onTouchMove}
      onTouchEnd={zoom.onTouchEnd}
    >
      <defs>
        <pattern id={gridId} width={geomorphGridMeters} height={geomorphGridMeters} patternUnits="userSpaceOnUse">
          {/* in metres: `non-scaling-stroke` does nothing inside a pattern tile */}
          <path
            d={`M${geomorphGridMeters} 0H0V${geomorphGridMeters}`}
            fill="none"
            stroke={ink.grid}
            strokeWidth={0.03}
          />
        </pattern>
        {/* and each square halved, fainter */}
        <pattern id={halfGridId} width={halfGridMeters} height={halfGridMeters} patternUnits="userSpaceOnUse">
          <path
            d={`M${halfGridMeters} 0H0V${halfGridMeters}`}
            fill="none"
            stroke={ink.grid}
            strokeOpacity={0.8}
            strokeWidth={0.02}
          />
        </pattern>
      </defs>

      <Geomorphs w={w} gmsHash={w.gmsHash} nav={w.nav} showNav={show.nav} showObstacles={show.obstacles} />

      {show.grid &&
        [halfGridId, gridId].map((id) => (
          <rect
            key={id}
            x={bounds.minX}
            y={bounds.minY}
            width={bounds.width}
            height={bounds.height}
            fill={`url(#${id})`}
            pointerEvents="none"
          />
        ))}

      {/* doors are the World's own, in world space, so they show what is open and what is locked */}
      {doors.map((door) => (
        <line
          key={door.gdKey}
          x1={door.src.x}
          y1={door.src.y}
          x2={door.dst.x}
          y2={door.dst.y}
          stroke={door.locked ? ink.doorLocked : door.open ? ink.doorOpen : ink.door}
          strokeWidth={door.open ? 1.5 : 3}
          strokeDasharray={door.open ? "3 3" : undefined}
          vectorEffect="non-scaling-stroke"
        >
          <title>{`${door.gdKey}${door.locked ? " (locked)" : ""}`}</title>
        </line>
      ))}

      {show.labels && <Labels w={w} doors={doors} />}

      {children}

      <rect
        ref={marqueeEl}
        style={{ display: "none" }}
        fill="var(--deco-selected)"
        fillOpacity={0.1}
        stroke="var(--deco-selected)"
        strokeWidth={1}
        strokeDasharray="4 2"
        vectorEffect="non-scaling-stroke"
        pointerEvents="none"
      />

      <NpcDots w={w} npcKeys={npcKeys} onNpcDrop={onNpcDrop} />
    </svg>
  );
}

/**
 * The geomorphs themselves, each drawn in ITS OWN space and placed by its transform. Memoised, so
 * a pan or a selection does not redraw them: `gmsHash` and `nav` say when the layout has changed
 */
const Geomorphs = memo(function Geomorphs(props: {
  w: WorldState;
  gmsHash: WorldState["gmsHash"];
  nav: WorldState["nav"];
  showNav: boolean;
  showObstacles: boolean;
}) {
  const { w, nav, showNav, showObstacles } = props;
  return w.gms.map((gm, gmId) => {
    const { a, b, c, d, e, f } = gm.transform;
    return (
      <g key={gmId} transform={`matrix(${a},${b},${c},${d},${e},${f})`}>
        <path d={gm.hullPoly.map((p) => p.svgPath).join(" ")} fill={ink.hull} fillRule="evenodd" />
        <path d={gm.rooms.map((p) => p.svgPath).join(" ")} fill={ink.room} />
        {showNav && (
          <path
            d={navPath(nav?.toNavTris[gmId])}
            fill={ink.nav}
            stroke={ink.navEdge}
            strokeWidth={0.5}
            vectorEffect="non-scaling-stroke"
          />
        )}
        {/* one path EACH: merged, overlapping obstacles would cut holes in each other under the nonzero rule */}
        {showObstacles &&
          gm.obstacles.map((o, i) => (
            <path
              key={i}
              d={o.origPoly.clone().applyMatrix(tmpMat.setMatrixValue(o.transform)).svgPath}
              fill={ink.obstacle}
            />
          ))}
        <path d={gm.walls.map((p) => p.svgPath).join(" ")} fill={ink.wall} strokeWidth={0.04} stroke={ink.wallStroke} />
        <path d={gm.windows.map((c) => c.poly.svgPath).join(" ")} fill={ink.window} />
      </g>
    );
  });
});

/** The navigable area as the floor itself draws it: triangles, as `x y z` triples */
function navPath(tris: NonNullable<WorldState["nav"]>["toNavTris"][number] = []) {
  let d = "";
  for (const [ps] of tris) {
    for (let i = 0; i < ps.length; i += 9) {
      d += `M${ps[i]} ${ps[i + 2]}L${ps[i + 3]} ${ps[i + 5]}L${ps[i + 6]} ${ps[i + 8]}Z`;
    }
  }
  return d;
}

/** Room labels, and the keys the shell and the lore name things by: every room's and every door's */
function Labels({ w, doors }: { w: WorldState; doors: Geomorph.DoorState[] }) {
  // `byKey` is remade whenever the decor are
  const labels = useMemo(() => Object.values(w.decor?.byKey ?? {}).filter(helper.isRoomLabel), [w.decor?.byKey]);

  /** A room's key goes beneath its label, else at its centre */
  const roomKeys = useMemo(() => {
    const labelOf = new Map(labels.map((label) => [label.meta.grKey, label]));
    return w.gms.flatMap((gm, gmId) =>
      gm.rooms.map((room, roomId) => {
        const grKey = helper.getGmRoomKey(gmId, roomId);
        const label = labelOf.get(grKey);
        if (label !== undefined) return { grKey, x: label.x, y: label.y + keyFontSize * 1.3 };
        const { a, b, c, d, e, f } = gm.transform;
        const { x, y } = room.center;
        return { grKey, x: a * x + c * y + e, y: b * x + d * y + f };
      }),
    );
  }, [w.gmsHash, labels]);

  return (
    <>
      {labels.map((label) => (
        <text
          key={label.key}
          x={label.x}
          y={label.y}
          fontSize={0.22}
          textAnchor="middle"
          dominantBaseline="central"
          fill={ink.label}
          pointerEvents="none"
          style={{ letterSpacing: "0.04em" }}
        >
          {label.meta.label}
        </text>
      ))}
      {roomKeys.map(({ grKey, x, y }) => (
        <text key={grKey} x={x} y={y} {...keyTextProps}>
          {grKey}
        </text>
      ))}
      {doors.map((door) => (
        <text
          key={door.gdKey}
          x={(door.src.x + door.dst.x) / 2}
          y={(door.src.y + door.dst.y) / 2}
          {...keyTextProps}
          // legible over the door's own line
          stroke={ink.hull}
          strokeWidth={0.05}
          paintOrder="stroke"
        >
          {door.gdKey}
        </text>
      ))}
    </>
  );
}

/**
 * The chosen npcs, moved straight through their refs on the World's frames, not by rendering.
 * One can be dragged and dropped, onto the grid with shift or ctrl — let go off the map, or Escape, cancels
 */
function NpcDots({ w, npcKeys, onNpcDrop }: Pick<Props, "w" | "npcKeys" | "onNpcDrop">) {
  const els = useRef(new Map<string, SVGGElement>());
  /** Whoever is being dragged follows the pointer, not themself: `at` once it has moved */
  const drag = useRef<null | { npcKey: string; client: Geom.VectJson; at: null | Geom.VectJson }>(null);
  const shown = npcKeys.filter((npcKey) => w.n?.[npcKey] !== undefined);

  function place(npcKey: string) {
    const position = w.n[npcKey]?.position;
    const dragged = drag.current?.npcKey === npcKey ? drag.current.at : null;
    const at = dragged ?? (position === undefined ? null : { x: position.x, y: position.z });
    if (at !== null) els.current.get(npcKey)?.setAttribute("transform", `translate(${at.x} ${at.y})`);
  }

  useEffect(() => {
    if (shown.length === 0) return;
    const placeAll = () => shown.forEach(place);
    placeAll();
    return w.e.addFrameCallback(placeAll);
  }, [w, shown.join(" ")]);

  /** Lets go of whoever is dragged, back where they stand */
  function endDrag() {
    const npcKey = drag.current?.npcKey;
    drag.current = null;
    window.removeEventListener("keydown", onDragKey, true);
    if (npcKey === undefined) return;
    els.current.get(npcKey)?.removeAttribute("opacity");
    place(npcKey);
  }
  function onDragKey(e: KeyboardEvent) {
    if (e.key !== "Escape") return;
    e.stopPropagation(); // else it changes the tool too
    endDrag();
  }
  function isOverMap(e: React.PointerEvent<SVGElement>) {
    const r = e.currentTarget.ownerSVGElement?.getBoundingClientRect();
    return (
      r !== undefined && e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom
    );
  }

  const dragProps = (npcKey: string) =>
    onNpcDrop !== undefined && {
      "data-no-pan": true,
      pointerEvents: "all",
      className: "cursor-grab active:cursor-grabbing",
      // ctrl is the fine step, not the decor menu
      onContextMenu(e: React.MouseEvent) {
        e.preventDefault();
        e.stopPropagation();
      },
      onPointerDown(e: React.PointerEvent<SVGCircleElement>) {
        if (isPress(e) === false) return;
        e.stopPropagation();
        e.currentTarget.setPointerCapture(e.pointerId);
        drag.current = { npcKey, client: { x: e.clientX, y: e.clientY }, at: null };
        window.addEventListener("keydown", onDragKey, true);
      },
      onPointerMove(e: React.PointerEvent<SVGCircleElement>) {
        const d = drag.current;
        const svg = e.currentTarget.ownerSVGElement;
        if (d?.npcKey !== npcKey || svg === null) return;
        // a press let go where it landed moves nobody
        if (d.at === null && Math.hypot(e.clientX - d.client.x, e.clientY - d.client.y) < clickSlopPx) return;
        const at = toMap(svg, e.clientX, e.clientY);
        // by the half grid, as drawn
        const step = stepOf(e, true);
        d.at = step === undefined ? at : { x: Math.round(at.x / step) * step, y: Math.round(at.y / step) * step };
        // fainter off the map, where letting go cancels
        els.current.get(npcKey)?.setAttribute("opacity", isOverMap(e) ? "1" : "0.3");
        place(npcKey);
      },
      onPointerUp(e: React.PointerEvent<SVGCircleElement>) {
        const d = drag.current;
        endDrag();
        if (d?.npcKey === npcKey && d.at !== null && isOverMap(e)) onNpcDrop(npcKey, d.at);
      },
      onPointerCancel: endDrag,
    };

  return shown.map((npcKey) => (
    <g
      key={npcKey}
      ref={(el) => void (el === null ? els.current.delete(npcKey) : els.current.set(npcKey, el))}
      pointerEvents="none"
    >
      <circle
        r={0.3}
        fill={ink.npc}
        fillOpacity={0.35}
        stroke={ink.npc}
        strokeWidth={1.5}
        vectorEffect="non-scaling-stroke"
        {...dragProps(npcKey)}
      />
      {onNpcDrop !== undefined && (
        <title>{`${npcKey}: drag to put them elsewhere, with shift or ctrl onto the grid`}</title>
      )}
      <text y={-0.45} fontSize={0.3} textAnchor="middle" fill={ink.npc}>
        {npcKey}
      </text>
    </g>
  ));
}

type Props = {
  w: WorldState;
  show: DecoratorUiMeta["show"];
  npcKeys: string[];
  /** Drawn over the map and under the npcs, in world metres e.g. the decor */
  children?: React.ReactNode;
  /** A press on the map itself, let go where it landed */
  onClick?(at: Geom.VectJson, e: PointerEvent): void;
  /** A shift-drag on the map itself, let go */
  onMarquee?(rect: Geom.RectJson, e: PointerEvent): void;
  /** A shown npc dragged, and let go on the map: without it they cannot be */
  onNpcDrop?(npcKey: string, at: Geom.VectJson): void;
  cursor?: string;
  /** For whoever renders it to steer the map */
  apiRef?: React.RefObject<NavMap2dApi | null>;
};

export type NavMap2dApi = {
  centreOn(x: number, y: number, minZoom?: number): void;
};

type Press = { at: Geom.VectJson; client: Geom.VectJson; marquee: boolean };

function rectFrom(a: Geom.VectJson, b: Geom.VectJson): Geom.RectJson {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(b.x - a.x), height: Math.abs(b.y - a.y) };
}

/** In screen px: a press let go within it is a click, not a pan */
const clickSlopPx = 4;

const gridId = "nav-map-2d-grid";
const halfGridId = "nav-map-2d-half-grid";
const tmpMat = new Mat();

const keyFontSize = 0.13;

/** The World's own steel: its hull fill, its panel lips, its amber doors — per theme, in `decorator.css` */
const ink = {
  hull: "var(--deco-hull)",
  room: "var(--deco-room)",
  nav: "var(--deco-nav)",
  navEdge: "var(--deco-nav-edge)",
  obstacle: "var(--deco-obstacle)",
  wall: "var(--deco-wall)",
  wallStroke: "var(--deco-wall-stroke)",
  window: "var(--deco-window)",
  door: "var(--deco-door)",
  doorOpen: "var(--deco-door-open)",
  doorLocked: "var(--deco-door-locked)",
  grid: "var(--deco-grid)",
  label: "var(--deco-label)",
  key: "var(--deco-key)",
  npc: "var(--deco-npc)",
};

/** A key can be selected, to copy */
const keyTextProps = {
  fontSize: keyFontSize,
  textAnchor: "middle",
  dominantBaseline: "central",
  fill: ink.key,
  className: "select-text cursor-text",
  // else the press pans the map, or starts a marquee
  onPointerDown: (e: React.PointerEvent) => e.stopPropagation(),
} as const;
