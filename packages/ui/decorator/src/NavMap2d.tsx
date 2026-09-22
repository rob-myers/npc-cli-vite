import type { WorldState } from "@npc-cli/ui__world";
import { geomorphGridMeters } from "@npc-cli/ui__world/const.env";
import { helper } from "@npc-cli/ui__world/helper";
import { Mat } from "@npc-cli/util/geom";
import { preventPopupGestures, useSvgZoom } from "@npc-cli/util/use-svg-zoom";
import { useEffect, useMemo, useRef } from "react";
import { toMap } from "./decor-edit";
import type { DecoratorUiMeta } from "./schema";
import { getDecoratorMapStore } from "./storage";

/**
 * The map from above, in world metres: 2D `x/y` is world `x/z`. Drawn from each geomorph's own
 * layout and the navmesh, so it is where things really are — see `docs/decorator.md`
 */
export function NavMap2d({ w, show, npcKeys, children, onClick, onMarquee, cursor }: Props) {
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

  // each geomorph's layout as path data in ITS OWN space: the group's transform places it
  const gmPaths = useMemo(
    () =>
      w.gms.map((gm) => ({
        hull: gm.hullPoly.map((p) => p.svgPath).join(" "),
        rooms: gm.rooms.map((p) => p.svgPath).join(" "),
        walls: gm.walls.map((p) => p.svgPath).join(" "),
        windows: gm.windows.map((c) => c.poly.svgPath).join(" "),
        obstacles: gm.obstacles
          .map((o) => o.origPoly.clone().applyMatrix(tmpMat.setMatrixValue(o.transform)).svgPath)
          .join(" "),
      })),
    [w.gmsHash],
  );

  // the navigable area, as the floor itself draws it: triangles, local to their geomorph
  const navPaths = useMemo(
    () =>
      w.gms.map((_, gmId) => {
        let d = "";
        for (const [ps] of w.nav?.toNavTris[gmId] ?? []) {
          for (let i = 0; i < ps.length; i += 9) {
            d += `M${ps[i]} ${ps[i + 2]}L${ps[i + 3]} ${ps[i + 5]}L${ps[i + 6]} ${ps[i + 8]}Z`;
          }
        }
        return d;
      }),
    [w.gmsHash, w.nav],
  );

  const labels = Object.values(w.decor?.byKey ?? {}).filter(helper.isRoomLabel);
  const doors = Object.values(w.door?.byKey ?? {});

  return (
    <svg
      ref={preventPopupGestures}
      className="size-full touch-none select-none bg-slate-950"
      style={{ cursor }}
      viewBox={zoom.viewBox}
      onWheel={zoom.onWheel}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onTouchStart={zoom.onTouchStart}
      onTouchMove={zoom.onTouchMove}
      onTouchEnd={zoom.onTouchEnd}
      onDoubleClick={zoom.reset}
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
      </defs>

      {w.gms.map((gm, gmId) => {
        const { a, b, c, d, e, f } = gm.transform;
        const paths = gmPaths[gmId];
        return (
          <g key={gmId} transform={`matrix(${a},${b},${c},${d},${e},${f})`}>
            <path d={paths.hull} fill={ink.hull} fillRule="evenodd" />
            <path d={paths.rooms} fill={ink.room} />
            {show.nav && (
              <path
                d={navPaths[gmId]}
                fill={ink.nav}
                stroke={ink.navEdge}
                strokeWidth={0.5}
                vectorEffect="non-scaling-stroke"
              />
            )}
            {show.obstacles && <path d={paths.obstacles} fill={ink.obstacle} />}
            <path d={paths.walls} fill={ink.wall} strokeWidth={0.04} stroke={ink.wallStroke} />
            <path d={paths.windows} fill={ink.window} />
          </g>
        );
      })}

      {show.grid && (
        <rect
          x={bounds.minX}
          y={bounds.minY}
          width={bounds.width}
          height={bounds.height}
          fill={`url(#${gridId})`}
          pointerEvents="none"
        />
      )}

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

      {show.labels &&
        labels.map((decor) => (
          <text
            key={decor.key}
            x={decor.x}
            y={decor.y}
            fontSize={0.32}
            textAnchor="middle"
            dominantBaseline="central"
            fill={ink.label}
            pointerEvents="none"
            style={{ letterSpacing: "0.04em" }}
          >
            {decor.meta.label}
          </text>
        ))}

      {children}

      <rect
        ref={marqueeEl}
        style={{ display: "none" }}
        fill="#fde047"
        fillOpacity={0.1}
        stroke="#fde047"
        strokeWidth={1}
        strokeDasharray="4 2"
        vectorEffect="non-scaling-stroke"
        pointerEvents="none"
      />

      <NpcDots w={w} npcKeys={npcKeys} />
    </svg>
  );
}

/** The chosen npcs, moved straight through their refs on the World's frames, not by rendering */
function NpcDots({ w, npcKeys }: Pick<Props, "w" | "npcKeys">) {
  const els = useRef(new Map<string, SVGGElement>());
  const shown = npcKeys.filter((npcKey) => w.n?.[npcKey] !== undefined);

  useEffect(() => {
    if (shown.length === 0) return;
    const place = () => {
      for (const [npcKey, el] of els.current) {
        const position = w.n[npcKey]?.position;
        if (position !== undefined) el.setAttribute("transform", `translate(${position.x} ${position.z})`);
      }
    };
    place();
    return w.e.addFrameCallback(place);
  }, [w, shown.join(" ")]);

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
      />
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
  cursor?: string;
};

type Press = { at: Geom.VectJson; client: Geom.VectJson; marquee: boolean };

function rectFrom(a: Geom.VectJson, b: Geom.VectJson): Geom.RectJson {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(b.x - a.x), height: Math.abs(b.y - a.y) };
}

/** In screen px: a press let go within it is a click, not a pan */
const clickSlopPx = 4;

const gridId = "nav-map-2d-grid";
const tmpMat = new Mat();

const ink = {
  hull: "#0b1220",
  room: "#16213a",
  nav: "rgba(56, 189, 248, 0.05)",
  navEdge: "rgba(56, 189, 248, 0.1)",
  obstacle: "#2a3a5c",
  wall: "#8ea3c744",
  wallStroke: "#fff6",
  window: "#5eead4",
  door: "#fbbf24",
  doorOpen: "#4ade80",
  doorLocked: "#f87171",
  grid: "rgba(148, 233, 184, 0.45)",
  label: "rgba(226, 236, 248, 0.75)",
  npc: "#f0abfc",
};
