import { Mat } from "@npc-cli/util/geom";
import { geomService } from "@npc-cli/util/geom-service";
import { drawRoundedRect, getPolysPath } from "@npc-cli/util/service/canvas";
import * as THREE from "three/webgpu";
import { gmFloorExtraScale, worldToSguScale } from "../const";
import type { TexArray } from "./tex-array";

const texW = 256;
const texH = 512;

/** Draw the shared door panel (everything except the per-door label) */
function drawDoorBasePanel() {
  const canvas = document.createElement("canvas");
  canvas.width = texW;
  canvas.height = texH;
  const ct = canvas.getContext("2d") as CanvasRenderingContext2D;
  const w = texW;
  const h = texH;

  // metal, not a silhouette: it needs an albedo of its own, the player light only ever tinting
  // what is here DOWN (see `service/player-light`) — near black would stay near black
  const base = ct.createLinearGradient(0, 0, 0, h);
  base.addColorStop(0, doorPanelTop);
  base.addColorStop(1, doorPanelBottom);
  ct.fillStyle = base;
  ct.fillRect(0, 0, w, h);

  // 4 recessed panels: sunk a shade below the face, then bevelled light over dark
  for (const p of panels) {
    ct.fillStyle = doorPanelRecess;
    ct.fillRect(panelInset, p.y, w - panelInset * 2, p.h);

    ct.strokeStyle = "rgba(150,170,190,0.25)";
    ct.lineWidth = 5;
    ct.strokeRect(panelInset, p.y, w - panelInset * 2, p.h);

    // top-left catches the light
    ct.strokeStyle = "rgba(205,225,245,0.35)";
    ct.lineWidth = 5;
    ct.beginPath();
    ct.moveTo(panelInset + 1, p.y + p.h);
    ct.lineTo(panelInset + 1, p.y + 1);
    ct.lineTo(w - panelInset - 1, p.y + 1);
    ct.stroke();

    // bottom-right falls into shadow
    ct.strokeStyle = "rgba(0,0,0,0.45)";
    ct.lineWidth = 5;
    ct.beginPath();
    ct.moveTo(w - panelInset - 1, p.y + 1);
    ct.lineTo(w - panelInset - 1, p.y + p.h - 1);
    ct.lineTo(panelInset + 1, p.y + p.h - 1);
    ct.stroke();
  }

  // rivets along edges
  for (const rx of [8, w - 8]) {
    for (let ry = 16; ry < h; ry += 28) {
      ct.fillStyle = "rgba(110,130,150,0.55)";
      ct.beginPath();
      ct.arc(rx, ry, 3, 0, Math.PI * 2);
      ct.fill();
      ct.fillStyle = "rgba(225,240,255,0.85)";
      ct.beginPath();
      ct.arc(rx - 0.5, ry - 0.5, 1.5, 0, Math.PI * 2);
      ct.fill();
    }
  }

  // outer border
  ct.strokeStyle = "rgba(160,180,200,0.35)";
  ct.lineWidth = 5;
  ct.strokeRect(0, 0, w, h);

  // corner accents
  ct.strokeStyle = "rgba(195,215,240,0.7)";
  ct.lineWidth = 3;
  for (const [cx, cy, sx, sy] of [
    [5, 5, 1, 1],
    [w - 5, 5, -1, 1],
    [5, h - 5, 1, -1],
    [w - 5, h - 5, -1, -1],
  ] as const) {
    ct.beginPath();
    ct.moveTo(cx, cy + cornerLen * sy);
    ct.lineTo(cx, cy);
    ct.lineTo(cx + cornerLen * sx, cy);
    ct.stroke();
  }

  return canvas;
}

// --- panel layout constants ---

/** The door's own colour, lit down from here by `player-light` — see `drawDoorBasePanel` */
const doorPanelTop = "#3f464e";
const doorPanelBottom = "#2f353b";
const doorPanelRecess = "#343a41";

const panelInset = 14;
const panels = [
  { y: 8, h: texH * 0.22 },
  { y: texH * 0.24 + 8, h: texH * 0.24 },
  { y: texH * 0.5 + 8, h: texH * 0.22 },
  { y: texH * 0.74 + 8, h: texH * 0.24 - 8 },
];
const cornerLen = 20;

// --- floor texture ---

export const worldToCanvas = worldToSguScale * gmFloorExtraScale;

/** The soft dark edges the floor is drawn with, whilst `Debug`'s `floorShading` is on. METRES */
export const softEdges = {
  /** Inside each room's outline, and each doorway's — see `Floor`'s `drawGm` */
  roomEdge: { width: 0.15, blur: 0.15, ink: "rgba(0, 0, 0, 0.45)" },
};

/** One of `softEdges`' entries as `drawBlurredEdge` wants it, its blur in CANVAS pixels */
export function toEdgeOpts({ width, blur, ink }: (typeof softEdges)["roomEdge"]) {
  return { blurPx: blur * worldToCanvas, lineWidth: width, strokeStyle: ink };
}

/**
 * Everything the deck is drawn from, in ONE MUTABLE place: change a value from the console, call
 * `w.floor.drawAll()`, and it redraws — the plate pattern rebuilds itself when this changes.
 * Lengths are in METRES, since the canvas is already in world units (100 px/m)
 */
export const deckConfig = {
  /** The deck's own colour, under everything else */
  tone: "#2a2e33",

  /** One square plate of decking */
  plate: {
    shown: true,
    size: 1.5 / 2,
    /**
     * A seam is a dark groove PLUS a lit lip just beyond it — the pair is what reads as recessed
     * metal rather than a drawn line. Keep both at least two texels (0.02 m) wide, or they crawl
     */
    seamWidth: 0.03,
    seamInk: "rgba(0, 0, 0, 0.55)",
    lipWidth: 0.02,
    lipInk: "rgba(190, 205, 225, 0.16)",
  },

  /** A rivet at each plate corner, lit from the upper-left like the seams */
  rivet: {
    shown: true,
    radius: 0.03,
    inset: 0.09,
    ink: "rgba(0, 0, 0, 0.5)",
    lipInk: "rgba(205, 220, 240, 0.3)",
  },

  /** A line following the room's walls, held off them */
  outline: {
    shown: true,
    inset: 0.35,
    width: 0.025,
    ink: "rgba(190, 200, 210, 0.1)",
    /** Rooms below this (m²) get none: it would only crowd them */
    minRoomArea: 4,
  },

  /** Conduit run along the deck, in the rooms `rooms` names */
  wiring: {
    shown: true,
    /**
     * Which rooms get it, by the `meta.label` of their labelled decor point — or `"all"` for every
     * room, labelled or not. NOTE only ONE room is labelled `common` across the whole asset set
     */
    rooms: ["common", "corridor"] as "all" | string[],
    /**
     * One colour per conduit, run side by side down the room. Add or remove to change the count —
     * the bundle stays centred on its route, so it widens evenly either side. Two reads as cabling;
     * more starts to read as a painted stripe
     */
    inks: ["rgba(232, 96, 82, 0.25)", "rgba(96, 194, 240, 0.25)"],
    /** Each conduit's width, and the gap between neighbours */
    width: 0.03,
    gap: 0.025,
    /** The bundle sits on a dark backing, so it reads as lying ON the deck rather than in it */
    backingInk: "rgba(0, 0, 0, 0.45)",
    backingOutset: 0.05,
    /** How far inside the walls the bundle is held as it follows them — it hugs them */
    wallOffset: 0.15,
    /** A bracket clamping the bundle down, this far apart along the run */
    clampPitch: 1.5,
    clampWidth: 0.035,
    clampOutset: 0.08,
    clampInk: "rgba(205, 218, 235, 0.6)",
    /** How far clear of a doorway the run stays — conduit never crosses a threshold */
    doorClearance: 1,
    /** How tightly the bundle turns a corner — it hugs the wall, so the turn is tight too */
    bendRadius: 0.2,
    /** How far the turn into the wall takes at each end of a run */
    diveLength: 0.5,
    /**
     * How hard that turn is pulled square, as a fraction of `diveLength`. Lower meets the wall more
     * sharply, higher sweeps into it — but the wire arrives NORMAL to the wall either way
     */
    diveTension: 0.55,
    /** How finely the route is sampled — corners and dives become point lists */
    sampleStep: 0.06,
    /** Rooms below this (m²) get none */
    minRoomArea: 6,
  },

  /** Metallic grates let into the deck, over whatever electronics live under it */
  grate: {
    shown: true,
    /** Which rooms get them, by label — or `"all"` */
    rooms: ["corridor"] as "all" | string[],
    /** One per this much deck (m²), never more than `max` */
    perArea: 16,
    max: 4,
    /** Its footprint. The long side is laid ALONG the wall it sits by */
    width: 0.5,
    height: 0.3,
    /** It sits NEAR a wall: at least `wallClearance` off it, and no further than `wallBand` */
    wallClearance: 0.25,
    wallBand: 1.25,
    /**
     * Clear of any doorway, of each other, and — the PLATE only — of the room's conduit. Its lead
     * may cross the conduit and is drawn under it
     */
    doorClearance: 0.9,
    spacing: 0.6,
    wireClearance: 0.25,
    /** Neither the grate nor its lead goes under an obstacle, where it could not be seen */
    obstacleClearance: 0.1,
    /** How many placements to try before settling for however many landed */
    attempts: 64,

    /** Deliberately loud: a bright plate against a deck of `tone`, so it is easy to pick out */
    fill: "#3b4652",
    /** Bevelled light over dark, lit from the upper-left like every seam on this deck */
    bevelLight: "rgba(225, 238, 252, 0.5)",
    bevelDark: "rgba(0, 0, 0, 0.65)",
    bevelWidth: 0.035,
    edgeInk: "rgba(0, 0, 0, 0.7)",
    edgeWidth: 0.01,
    /** The grating across the plate */
    ventCount: 4,
    ventInk: "rgba(0, 0, 0, 0.62)",
    ventWidth: 0.02,
    ventInset: 0.11,
    boltRadius: 0.018,
    boltInset: 0.075,
    boltInk: "rgba(0, 0, 0, 0.65)",
    boltLipInk: "rgba(230, 242, 255, 0.75)",
    /**
     * The straight wire out of it, to the nearest WALL — never a doorway. EVERY grate has one, so
     * nowhere to run it is a reason not to place the grate at all
     */
    leadInk: "rgba(245, 200, 90, 0.3)",
    leadWidth: 0.035,
    leadBackingInk: "rgba(0, 0, 0, 0.55)",
    leadBackingOutset: 0.025,
    /** Further than this from a wall it does not bother */
    leadMaxLength: 0.75,
  },

  /** The nav mesh over the deck — see `Floor`'s `drawNavMesh` */
  nav: {
    /** The walkable area, lifted a shade */
    fill: "rgba(255, 255, 255, 0.045)",
    ink: "rgba(120, 190, 235, 0.05)",
    /** Two texels at least, else it beats against every seam it crosses */
    lineWidth: 0.02,
  },
};

/** Every room's deck, the doorways between them, and a line inside each room's walls */
export function drawRoomFloors(
  ct: CanvasRenderingContext2D,
  layout: Geomorph.Layout,
  /** The room's `meta.label` by roomId — only `deckConfig.wiring` reads it. See `Floor`'s `drawGm` */
  labelOfRoom: (undefined | string)[] = [],
) {
  ct.save();
  ct.lineJoin = "round";
  ct.lineCap = "round";

  // a doorway is not a room, and the deck reaches the bulkhead, so without this the structural
  // `hullFill` shows through between the decks either side
  for (const door of layout.doors) drawDeck(ct, door.poly);

  // once for the layout, not once per room: nothing on the deck may hide under one of these
  const obstacles = layout.obstacles.map((o) =>
    o.origPoly.clone().applyMatrix(tmpObstacleMat.setMatrixValue(o.transform)).rect.clone(),
  );

  for (const [roomId, room] of layout.rooms.entries()) {
    drawDeck(ct, room);
    drawRoomOutline(ct, room);

    const label = labelOfRoom[roomId];
    const { wiring, grate } = deckConfig;
    const wantsWiring = wantsFeature(wiring.rooms, wiring.shown, label);
    const wantsGrates = wantsFeature(grate.rooms, grate.shown, label);
    if (wantsWiring === false && wantsGrates === false) continue;

    // both want them, and the filter is not free — see `DerivedGmsData`, which fills `roomIds` in
    const roomDoors = layout.doors.filter((door) => door.roomIds.includes(roomId) === true);
    // routed once and shared: the grates need to know where the conduit is so as not to sit on it
    const runs = wantsWiring === true ? wiringRuns(room.clone().removeHoles(), roomDoors) : [];
    // leads go down FIRST so the conduit crosses over them — a grate's wire runs under the bundle,
    // and each plate then covers the end of its own lead
    const grates = wantsGrates === true ? placeGrates(room, roomDoors, runs, obstacles, `${layout.key}:${roomId}`) : [];
    for (const g of grates) drawGrateLead(ct, g);
    if (wantsWiring === true) drawWiring(ct, room, runs);
    for (const g of grates) drawGrate(ct, g);
  }

  ct.restore();
}

/**
 * A bundle of conduits following the room's own walls, held `wallOffset` inside them, clamped down
 * along the way, and diving back into the wall at each end of a run. It never enters a doorway.
 *
 * Following the walls rather than a straight line through the room is what makes it work in an
 * L-shaped or many-doored room: the route comes from `createInset`, so it turns exactly the corners
 * the room turns, and the ends are wherever a doorway pushed them
 */
function drawWiring(ct: CanvasRenderingContext2D, room: Geom.Poly, runs: RunPoint[][]) {
  const { wiring } = deckConfig;
  const whole = room.clone().removeHoles();
  if (wiring.inks.length === 0 || whole.rect.area < wiring.minRoomArea) return;
  if (runs.length === 0) return;

  const pitch = wiring.width + wiring.gap;
  const width = wiring.inks.length * wiring.width + (wiring.inks.length - 1) * wiring.gap;

  /** Every run, `offset` out from the centre line towards the wall, and `lineWidth` wide */
  const strokeRuns = (offset: number, lineWidth: number, ink: string) => {
    ct.strokeStyle = ink;
    ct.lineWidth = lineWidth;
    ct.beginPath();
    for (const run of runs) {
      run.forEach((p, i) => {
        // the centre line already turns into the wall, so all that is left is each conduit's own
        // offset about it — held the whole way, so the bundle keeps its separation round the bend
        // rather than pinching to a point as it goes in
        const [x, y] = [p.x + p.nx * offset, p.y + p.ny * offset];
        i === 0 ? ct.moveTo(x, y) : ct.lineTo(x, y);
      });
    }
    ct.stroke();
  };

  ct.save();
  ct.clip(getPolysPath([whole]));
  ct.lineCap = "butt";
  ct.lineJoin = "round";

  strokeRuns(0, width + wiring.backingOutset * 2, wiring.backingInk);
  // centred on the bundle, so adding a colour widens it evenly either side
  wiring.inks.forEach((ink, i) => strokeRuns((i - (wiring.inks.length - 1) / 2) * pitch, wiring.width, ink));

  // brackets across the lot, holding it down. Not over a dive: there is nothing flat to clamp to
  ct.strokeStyle = wiring.clampInk;
  ct.lineWidth = wiring.clampWidth;
  ct.beginPath();
  const reach = width / 2 + wiring.clampOutset;
  for (const run of runs) {
    let carried = wiring.clampPitch / 2;
    for (let i = 1; i < run.length; i++) {
      const [p, q] = [run[i - 1], run[i]];
      const step = Math.hypot(q.x - p.x, q.y - p.y);
      if (carried > step) {
        carried -= step;
        continue;
      }
      carried += wiring.clampPitch - step;
      if (q.entry === true) continue; // not over a turn into the wall: nothing flat to clamp to
      ct.moveTo(q.x - q.nx * reach, q.y - q.ny * reach);
      ct.lineTo(q.x + q.nx * reach, q.y + q.ny * reach);
    }
  }
  ct.stroke();
  ct.restore();
}

/** A point on the bundle's centre line, and the direction its conduits spread along */
type RunPoint = {
  x: number;
  y: number;
  /** Unit normal ACROSS the run — the wall's along the wall, the curve's turning into it */
  nx: number;
  ny: number;
  /** Whether this is part of a turn into the wall rather than a stretch running along it */
  entry: boolean;
};

/**
 * The bundle's centre line: the room's walls held `wallOffset` inside, corners rounded, sampled into
 * points, broken wherever a doorway comes within `doorClearance`, and curved into the wall at each
 * loose end
 */
function wiringRuns(room: Geom.Poly, doors: Geomorph.Connector[]): RunPoint[][] {
  const { wiring } = deckConfig;
  const runs: RunPoint[][] = [];

  for (const inset of geomService.createInset(room, wiring.wallOffset)) {
    const ring = roundRing(inset.outline, wiring.bendRadius, wiring.sampleStep);
    if (ring.length < 4) continue;

    const pts = ring.map((p, i): RunPoint => {
      const a = ring[(i - 1 + ring.length) % ring.length];
      const b = ring[(i + 1) % ring.length];
      const [tx, ty] = [b.x - a.x, b.y - a.y];
      const len = Math.hypot(tx, ty) || 1;
      return { x: p.x, y: p.y, nx: ty / len, ny: -tx / len, entry: false };
    });

    // Which way is the wall? ASK the polygon rather than trusting a winding: `createInset` need not
    // hand back the room's own, and getting it backwards points every normal into the room, so the
    // dive walks the bundle away from the wall and it ends in mid-air. A step of more than
    // `wallOffset` leaves the room if it is outward, and stays inside it if it is not
    const probe = wiring.wallOffset * 1.5;
    let outward = 0;
    for (let i = 0; i < pts.length; i += Math.max(1, Math.floor(pts.length / 8))) {
      const p = pts[i];
      outward += room.contains({ x: p.x + p.nx * probe, y: p.y + p.ny * probe }) === true ? -1 : 1;
    }
    if (outward < 0) {
      for (const p of pts) {
        p.nx = -p.nx;
        p.ny = -p.ny;
      }
    }

    const clear = pts.map((p) => nearestDoorGap(p, doors) > wiring.doorClearance);
    if (clear.every((ok) => ok === true)) {
      runs.push(pts.concat(pts[0])); // nothing in the way: the bundle goes round unbroken
      continue;
    }
    if (clear.every((ok) => ok === false)) continue;

    // walk from a break, so each run is gathered whole rather than split across the seam
    const start = clear.indexOf(false);
    let run: RunPoint[] = [];
    for (let k = 1; k <= pts.length; k++) {
      const i = (start + k) % pts.length;
      if (clear[i] === true) {
        run.push(pts[i]);
        continue;
      }
      if (run.length > 1) runs.push(withEntries(run));
      run = [];
    }
    if (run.length > 1) runs.push(withEntries(run));
  }

  return runs;
}

/**
 * A run with each loose end turned into the wall, MEETING IT SQUARE. Sliding the bundle sideways
 * over the last stretch cannot do this — however it is eased, the wire still arrives travelling
 * ALONG the wall — so each end is replaced by a cubic whose tangent at the wall IS the wall's normal
 */
function withEntries(run: RunPoint[]): RunPoint[] {
  const { diveLength } = deckConfig.wiring;
  if (run.length < 3) return run;

  const gap = (i: number, j: number) => Math.hypot(run[i].x - run[j].x, run[i].y - run[j].y);
  let total = 0;
  for (let i = 1; i < run.length; i++) total += gap(i, i - 1);

  // both ends need room, and some of the run should still read as running ALONG the wall between them
  const reach = Math.min(diveLength, total / 3);
  if (reach <= 0) return run;

  let head = 0;
  for (let s = 0; head + 1 < run.length && s < reach; head++) s += gap(head, head + 1);
  let tail = run.length - 1;
  for (let s = 0; tail > 0 && s < reach; tail--) s += gap(tail, tail - 1);
  if (head >= tail) return run;

  return [
    // built running out of the wall, then reversed, so both ends come off the one helper
    ...entryCurve(run[head], run[head + 1], run[0], reach).reverse(),
    ...run.slice(head, tail + 1),
    ...entryCurve(run[tail], run[tail - 1], run[run.length - 1], reach),
  ];
}

/**
 * The turn from `anchor` — where the run is still travelling along the wall — into the wall behind
 * `loose`, arriving normal to it. The conduits keep their full separation round it, so they enter
 * the wall side by side — the bundle turning as one ribbon rather than gathering to a point
 */
function entryCurve(anchor: RunPoint, inward: RunPoint, loose: RunPoint, reach: number): RunPoint[] {
  const { wallOffset, diveTension, sampleStep } = deckConfig.wiring;

  // the way the run is travelling as it reaches the anchor, i.e. away from the middle
  let [tx, ty] = [anchor.x - inward.x, anchor.y - inward.y];
  const len = Math.hypot(tx, ty) || 1;
  [tx, ty] = [tx / len, ty / len];

  // `loose` sits `wallOffset` off the wall, so this lands the end ON it
  const wall = { x: loose.x + loose.nx * wallOffset, y: loose.y + loose.ny * wallOffset };
  const c = reach * diveTension;
  // leaves the anchor along the run and arrives at the wall along its NORMAL — the whole point
  const p0 = anchor;
  const p1 = { x: anchor.x + tx * c, y: anchor.y + ty * c };
  const p2 = { x: wall.x - loose.nx * c, y: wall.y - loose.ny * c };
  const p3 = wall;

  const steps = Math.max(4, Math.ceil(reach / sampleStep));
  const out: RunPoint[] = [];
  for (let k = 1; k <= steps; k++) {
    const t = k / steps;
    const m = 1 - t;
    const x = m * m * m * p0.x + 3 * m * m * t * p1.x + 3 * m * t * t * p2.x + t * t * t * p3.x;
    const y = m * m * m * p0.y + 3 * m * m * t * p1.y + 3 * m * t * t * p2.y + t * t * t * p3.y;
    // the derivative, so the spread stays square to wherever the curve is heading
    const dx = 3 * m * m * (p1.x - p0.x) + 6 * m * t * (p2.x - p1.x) + 3 * t * t * (p3.x - p2.x);
    const dy = 3 * m * m * (p1.y - p0.y) + 6 * m * t * (p2.y - p1.y) + 3 * t * t * (p3.y - p2.y);
    const d = Math.hypot(dx, dy) || 1;
    out.push({ x, y, nx: dy / d, ny: -dx / d, entry: true });
  }

  // the normal formula picks a side arbitrarily; the run's own is the one to agree with
  if (out[0].nx * anchor.nx + out[0].ny * anchor.ny < 0) {
    for (const p of out) {
      p.nx = -p.nx;
      p.ny = -p.ny;
    }
  }
  return out;
}

/** Whether a room's label puts one of `deckConfig`'s room-scoped features in it */
function wantsFeature(rooms: "all" | string[], shown: boolean, label: undefined | string) {
  if (shown === false) return false;
  if (rooms === "all") return true;
  return label !== undefined && rooms.includes(label);
}

type Grate = { x: number; y: number; width: number; height: number; lead: Geom.VectJson };

/**
 * Where the metallic grates go: each NEAR a wall, turned to lie along it, with somewhere to run a
 * straight lead into that wall. Rejection sampling from a hash, so a redraw puts them back exactly
 * where they were. Drawing is the caller's, since the leads go down before the conduit.
 *
 * `runs` is the room's own wiring: the PLATE must clear it, or the two features draw over each
 * other wherever a room is set to carry both. The lead may cross it and is drawn underneath
 */
function placeGrates(
  room: Geom.Poly,
  doors: Geomorph.Connector[],
  runs: RunPoint[][],
  /** Every obstacle's footprint in the layout — a grate under one could not be seen */
  obstacles: Geom.Rect[],
  /** Seeds the placement, so a redraw is identical */
  seed: string,
): Grate[] {
  const cfg = deckConfig.grate;
  const whole = room.clone().removeHoles();
  const { rect } = whole;

  const wanted = Math.min(cfg.max, Math.floor(rect.area / cfg.perArea));
  if (wanted < 1) return [];

  // the deck they may sit on: held off the walls, so a grate never overhangs one
  const region = geomService.createInset(whole, cfg.wallClearance);
  if (region.length === 0) return [];

  // the ones that could possibly reach this room, so the tests below stay cheap
  const nearObstacles = obstacles.filter((o) => o.intersects(rect) === true);

  const base = hashString(seed);
  const placed: Grate[] = [];
  for (let attempt = 0; attempt < cfg.attempts && placed.length < wanted; attempt++) {
    const h = hash2(base, attempt, 0x5f);
    const x = rect.x + ((h & 0xffff) / 0xffff) * rect.width;
    const y = rect.y + (((h >>> 16) & 0xffff) / 0xffff) * rect.height;

    // near a wall, and turned to lie ALONG it rather than across it
    const near = nearestWall(x, y, whole);
    if (near.distance > cfg.wallBand) continue;
    const along = Math.abs(near.dx) > Math.abs(near.dy);
    const width = along === true ? cfg.width : cfg.height;
    const height = along === true ? cfg.height : cfg.width;
    const box = { x: x - width / 2, y: y - height / 2, width, height };

    // every corner on the deck, not just the middle, or it hangs off a corner of an L-shaped room
    const corners = [
      { x: box.x, y: box.y },
      { x: box.x + width, y: box.y },
      { x: box.x, y: box.y + height },
      { x: box.x + width, y: box.y + height },
    ];
    if (corners.every((c) => region.some((poly) => poly.contains(c) === true)) === false) continue;
    if (nearestDoorGap({ x, y }, doors) < cfg.doorClearance) continue;
    if (placed.some((q) => overlapping(q, box, cfg.spacing) === true)) continue;
    if (runsNearBox(runs, box, cfg.wireClearance) === true) continue;
    if (nearObstacles.some((o) => overlappingRect(o, box, cfg.obstacleClearance) === true)) continue;

    // it ALWAYS has a lead, so somewhere to run it is part of whether it may be placed at all
    const lead = grateLead(box, whole, doors, nearObstacles);
    if (lead === null) continue;
    placed.push({ ...box, lead });
  }

  return placed;
}

/**
 * Where the grate's lead runs to: the closest point on the room's outline, which makes the line to
 * it perpendicular to that wall — straight out of the grate. `null` if there is nowhere to run it,
 * which is what stops a grate being placed at all
 */
function grateLead(
  box: { x: number; y: number; width: number; height: number },
  room: Geom.Poly,
  doors: Geomorph.Connector[],
  obstacles: Geom.Rect[],
): null | Geom.VectJson {
  const cfg = deckConfig.grate;
  const [cx, cy] = [box.x + box.width / 2, box.y + box.height / 2];

  let best: null | Geom.VectJson = null;
  let bestDist = Number.POSITIVE_INFINITY;
  const ring = room.outline;
  for (let i = 0; i < ring.length; i++) {
    const [u, v] = [ring[i], ring[(i + 1) % ring.length]];
    const p = closestOnSegment(cx, cy, u, v);
    const dist = Math.hypot(p.x - cx, p.y - cy);
    if (dist >= bestDist || dist > cfg.leadMaxLength) continue;
    // never a doorway: a wire crossing a threshold is the one thing the wiring is at pains to avoid.
    // The room's own conduit is fine to cross, though — the lead simply runs under it
    if (nearestDoorGap(p, doors) < cfg.doorClearance) continue;
    // …and it must not disappear under an obstacle on the way there
    if (obstacles.some((o) => segmentHitsRect(cx, cy, p.x, p.y, o, cfg.obstacleClearance) === true)) continue;
    [best, bestDist] = [p, dist];
  }
  return best;
}

/** The straight wire out of the grate, into the wall */
function drawGrateLead(ct: CanvasRenderingContext2D, grate: Grate) {
  const cfg = deckConfig.grate;
  const [cx, cy] = [grate.x + grate.width / 2, grate.y + grate.height / 2];

  ct.save();
  ct.lineCap = "butt";
  for (const [width, ink] of [
    [cfg.leadWidth + cfg.leadBackingOutset * 2, cfg.leadBackingInk],
    [cfg.leadWidth, cfg.leadInk],
  ] as const) {
    ct.strokeStyle = ink;
    ct.lineWidth = width;
    ct.beginPath();
    ct.moveTo(cx, cy);
    ct.lineTo(grate.lead.x, grate.lead.y);
    ct.stroke();
  }
  ct.restore();
}

/** The grate itself: a plate bevelled light over dark, louvred, and bolted down at each corner */
function drawGrate(ct: CanvasRenderingContext2D, grate: Grate) {
  const cfg = deckConfig.grate;
  const { x, y, width, height } = grate;

  ct.save();
  ct.lineJoin = "miter";
  ct.lineCap = "butt";

  ct.fillStyle = cfg.fill;
  ct.fillRect(x, y, width, height);

  // lit from the upper-left, as every seam and rivet on this deck is
  ct.lineWidth = cfg.bevelWidth;
  const inset = cfg.bevelWidth / 2;
  for (const [ink, corner] of [
    [cfg.bevelLight, [x + inset, y + height - inset, x + inset, y + inset, x + width - inset, y + inset]],
    [
      cfg.bevelDark,
      [x + width - inset, y + inset, x + width - inset, y + height - inset, x + inset, y + height - inset],
    ],
  ] as const) {
    ct.strokeStyle = ink;
    ct.beginPath();
    ct.moveTo(corner[0], corner[1]);
    ct.lineTo(corner[2], corner[3]);
    ct.lineTo(corner[4], corner[5]);
    ct.stroke();
  }

  // the grating itself, across the plate's shorter way whichever way it was turned
  ct.strokeStyle = cfg.ventInk;
  ct.lineWidth = cfg.ventWidth;
  ct.beginPath();
  const across = width > height;
  const span = across === true ? height : width;
  const pitch = span / (cfg.ventCount + 1);
  for (let k = 1; k <= cfg.ventCount; k++) {
    if (across === true) {
      ct.moveTo(x + cfg.ventInset, y + pitch * k);
      ct.lineTo(x + width - cfg.ventInset, y + pitch * k);
    } else {
      ct.moveTo(x + pitch * k, y + cfg.ventInset);
      ct.lineTo(x + pitch * k, y + height - cfg.ventInset);
    }
  }
  ct.stroke();

  const b = cfg.boltInset;
  for (const [bx, by] of [
    [x + b, y + b],
    [x + width - b, y + b],
    [x + b, y + height - b],
    [x + width - b, y + height - b],
  ]) {
    ct.fillStyle = cfg.boltInk;
    ct.beginPath();
    ct.arc(bx, by, cfg.boltRadius, 0, Math.PI * 2);
    ct.fill();
    // lit from the upper-left, as the deck's own rivets are
    ct.fillStyle = cfg.boltLipInk;
    ct.beginPath();
    ct.arc(bx - cfg.boltRadius * 0.28, by - cfg.boltRadius * 0.28, cfg.boltRadius * 0.5, 0, Math.PI * 2);
    ct.fill();
  }

  ct.strokeStyle = cfg.edgeInk;
  ct.lineWidth = cfg.edgeWidth;
  ct.strokeRect(x, y, width, height);
  ct.restore();
}

/** The nearest point of the room's outline, and the direction that stretch of wall runs in */
function nearestWall(px: number, py: number, room: Geom.Poly) {
  let best = { distance: Number.POSITIVE_INFINITY, dx: 1, dy: 0 };
  const ring = room.outline;
  for (let i = 0; i < ring.length; i++) {
    const [u, v] = [ring[i], ring[(i + 1) % ring.length]];
    const distance = distanceToSegment(px, py, u.x, u.y, v.x, v.y);
    if (distance < best.distance) best = { distance, dx: v.x - u.x, dy: v.y - u.y };
  }
  return best;
}

/** Whether any conduit passes within `clearance` of `box` */
function runsNearBox(
  runs: RunPoint[][],
  box: { x: number; y: number; width: number; height: number },
  clearance: number,
) {
  for (const run of runs) {
    for (const p of run) {
      if (
        p.x > box.x - clearance &&
        p.x < box.x + box.width + clearance &&
        p.y > box.y - clearance &&
        p.y < box.y + box.height + clearance
      ) {
        return true;
      }
    }
  }
  return false;
}

/** Liang-Barsky: whether the segment meets `r` grown by `pad`, exactly rather than by sampling */
function segmentHitsRect(ax: number, ay: number, bx: number, by: number, r: Geom.Rect, pad: number) {
  const [minX, minY] = [r.x - pad, r.y - pad];
  const [maxX, maxY] = [r.x + r.width + pad, r.y + r.height + pad];
  const [dx, dy] = [bx - ax, by - ay];
  let [t0, t1] = [0, 1];

  for (const [p, q] of [
    [-dx, ax - minX],
    [dx, maxX - ax],
    [-dy, ay - minY],
    [dy, maxY - ay],
  ] as const) {
    if (p === 0) {
      if (q < 0) return false; // parallel to this edge and outside it
      continue;
    }
    const t = q / p;
    if (p < 0) {
      if (t > t1) return false;
      if (t > t0) t0 = t;
    } else {
      if (t < t0) return false;
      if (t < t1) t1 = t;
    }
  }
  return true;
}

function overlappingRect(a: Geom.Rect, b: { x: number; y: number; width: number; height: number }, pad: number) {
  return (
    a.x - pad < b.x + b.width && b.x < a.x + a.width + pad && a.y - pad < b.y + b.height && b.y < a.y + a.height + pad
  );
}

function overlapping(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
  spacing: number,
) {
  return (
    a.x - spacing < b.x + b.width &&
    b.x - spacing < a.x + a.width &&
    a.y - spacing < b.y + b.height &&
    b.y - spacing < a.y + a.height
  );
}

function closestOnSegment(px: number, py: number, a: Geom.VectJson, b: Geom.VectJson): Geom.VectJson {
  const [dx, dy] = [b.x - a.x, b.y - a.y];
  const lenSq = dx * dx + dy * dy;
  const t = lenSq === 0 ? 0 : Math.max(0, Math.min(1, ((px - a.x) * dx + (py - a.y) * dy) / lenSq));
  return { x: a.x + t * dx, y: a.y + t * dy };
}

function hashString(text: string) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

function hash2(base: number, x: number, y: number) {
  let h = Math.imul(base ^ Math.imul(x, 374761393), 668265263);
  h = Math.imul(h ^ Math.imul(y, 2246822519), 3266489917);
  h ^= h >>> 15;
  return h >>> 0;
}

/** How near the closest doorway passes this point */
function nearestDoorGap(p: Geom.VectJson, doors: Geomorph.Connector[]) {
  let nearest = Number.POSITIVE_INFINITY;
  for (const door of doors) {
    const [u, v] = door.seg;
    nearest = Math.min(nearest, distanceToSegment(p.x, p.y, u.x, u.y, v.x, v.y));
  }
  return nearest;
}

function distanceToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number) {
  const [dx, dy] = [bx - ax, by - ay];
  const lenSq = dx * dx + dy * dy;
  const t = lenSq === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/**
 * `ring` with every corner turned through an arc of `radius` and the whole thing sampled at `step`,
 * so the run can be cut and offset point by point without losing the shape of its corners
 */
function roundRing(ring: Geom.VectJson[], radius: number, step: number): Geom.VectJson[] {
  if (ring.length < 3) return [];
  const out: Geom.VectJson[] = [];
  const push = (x: number, y: number) => {
    const last = out[out.length - 1];
    // sample the straight leading up to this point, so no stretch is left too coarse to cut
    if (last !== undefined) {
      const gap = Math.hypot(x - last.x, y - last.y);
      for (let k = 1; k < Math.floor(gap / step); k++) {
        out.push({ x: last.x + ((x - last.x) * k) / (gap / step), y: last.y + ((y - last.y) * k) / (gap / step) });
      }
    }
    out.push({ x, y });
  };

  for (let i = 0; i < ring.length; i++) {
    const curr = ring[i];
    const prev = ring[(i - 1 + ring.length) % ring.length];
    const next = ring[(i + 1) % ring.length];
    const toPrev = Math.hypot(prev.x - curr.x, prev.y - curr.y) || 1;
    const toNext = Math.hypot(next.x - curr.x, next.y - curr.y) || 1;
    const r = Math.min(radius, toPrev / 2, toNext / 2);
    const a = { x: curr.x + ((prev.x - curr.x) / toPrev) * r, y: curr.y + ((prev.y - curr.y) / toPrev) * r };
    const b = { x: curr.x + ((next.x - curr.x) / toNext) * r, y: curr.y + ((next.y - curr.y) / toNext) * r };

    push(a.x, a.y);
    // the corner as a quadratic through `curr`, sampled fine enough to read as a bend
    const steps = Math.max(2, Math.ceil((r * 2) / step));
    for (let k = 1; k <= steps; k++) {
      const t = k / steps;
      const m = 1 - t;
      out.push({
        x: m * m * a.x + 2 * m * t * curr.x + t * t * b.x,
        y: m * m * a.y + 2 * m * t * curr.y + t * t * b.y,
      });
    }
  }
  return out;
}

function drawDeck(ct: CanvasRenderingContext2D, poly: Geom.Poly) {
  const outline = poly.clone().removeHoles();
  const { rect } = outline;
  if (rect.width <= 0 || rect.height <= 0) return;

  ct.save();
  ct.clip(getPolysPath([outline]));

  ct.fillStyle = deckConfig.tone;
  ct.fillRect(rect.x, rect.y, rect.width, rect.height);

  if (deckConfig.plate.shown === true) {
    ct.fillStyle = getPlatePattern();
    ct.fillRect(rect.x, rect.y, rect.width, rect.height);
  }

  ct.restore();
}

function drawRoomOutline(ct: CanvasRenderingContext2D, room: Geom.Poly) {
  const { outline: opts } = deckConfig;
  if (opts.shown === false) return;

  const whole = room.clone().removeHoles();
  if (whole.rect.area < opts.minRoomArea) return;

  ct.save();
  ct.strokeStyle = opts.ink;
  ct.lineWidth = opts.width;
  for (const poly of geomService.createInset(whole, opts.inset)) {
    if (poly.outline.length < 3) continue;
    ct.beginPath();
    poly.outline.forEach((p, i) => (i === 0 ? ct.moveTo(p.x, p.y) : ct.lineTo(p.x, p.y)));
    ct.closePath();
    ct.stroke();
  }
  ct.restore();
}

let cachedPlate: null | { key: string; pattern: CanvasPattern } = null;

/** Rebuilt whenever `deckConfig` changes, so mutating it and redrawing is all it takes */
function getPlatePattern(): CanvasPattern {
  const key = JSON.stringify([deckConfig.plate, deckConfig.rivet]);
  if (cachedPlate === null || cachedPlate.key !== key) {
    cachedPlate = { key, pattern: createPlatePattern() };
  }
  // the pattern canvas is in PIXELS whilst `ct` is in metres
  cachedPlate.pattern.setTransform(new DOMMatrix().scaleSelf(1 / worldToCanvas, 1 / worldToCanvas));
  return cachedPlate.pattern;
}

function createPlatePattern(): CanvasPattern {
  const { plate, rivet } = deckConfig;
  const side = Math.max(1, Math.round(plate.size * worldToCanvas));
  const canvas = document.createElement("canvas");
  canvas.width = side;
  canvas.height = side;
  const ctx = canvas.getContext("2d") as CanvasRenderingContext2D;

  // only the top and left edges: the plate to the right and the one below draw the others
  const seamPx = Math.max(1, Math.round(plate.seamWidth * worldToCanvas));
  const lipPx = Math.max(1, Math.round(plate.lipWidth * worldToCanvas));
  ctx.fillStyle = plate.seamInk;
  ctx.fillRect(0, 0, side, seamPx);
  ctx.fillRect(0, 0, seamPx, side);
  ctx.fillStyle = plate.lipInk;
  ctx.fillRect(0, seamPx, side, lipPx);
  ctx.fillRect(seamPx, 0, lipPx, side);

  if (rivet.shown === true) {
    const radius = rivet.radius * worldToCanvas;
    const inset = rivet.inset * worldToCanvas;
    // biome-ignore format: one rivet per plate corner
    for (const [x, y] of [[inset, inset], [side - inset, inset], [inset, side - inset], [side - inset, side - inset]]) {
      ctx.fillStyle = rivet.ink;
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = rivet.lipInk;
      ctx.beginPath();
      ctx.arc(x - radius * 0.28, y - radius * 0.28, radius * 0.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  return ctx.createPattern(canvas, "repeat") as CanvasPattern;
}

export async function fetchSkinOverlay(svgPath: string, cacheBust: string): Promise<HTMLCanvasElement> {
  const svgText = await fetch(`/${svgPath}${cacheBust}`).then((r) => r.text());
  const parser = new DOMParser();
  const doc = parser.parseFromString(svgText, "image/svg+xml");
  for (const g of Array.from(doc.querySelectorAll("g"))) {
    const titleEl = g.querySelector(":scope > title");
    if (titleEl?.textContent?.trim() === "ignore") {
      g.remove();
    }
  }
  const svgBlob = new Blob([new XMLSerializer().serializeToString(doc.documentElement)], { type: "image/svg+xml" });
  const blobUrl = URL.createObjectURL(svgBlob);
  try {
    const img = await loadSvgImage(blobUrl);
    const canvas = document.createElement("canvas");
    canvas.width = 256;
    canvas.height = 256;
    const ct = canvas.getContext("2d") as CanvasRenderingContext2D;
    ct.imageSmoothingEnabled = false;
    ct.drawImage(img, 0, 0, 256, 256);
    return canvas;
  } finally {
    URL.revokeObjectURL(blobUrl);
  }
}

function loadSvgImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

let basePanelCanvas: HTMLCanvasElement | null = null;

/** How strongly a door's label is drawn, against the part-transparent panel behind it */
const doorLabelAlpha = 0.9;

export function drawDoorLabelLayer(texArray: TexArray, layerIndex: number, label: string) {
  const { ct } = texArray;
  ct.clearRect(0, 0, texW, texH);
  ct.drawImage((basePanelCanvas ??= drawDoorBasePanel()), 0, 0);

  if (label !== "") {
    const logoY = (panels[2].y + panels[2].h / 2 + panels[3].y) / 2;
    ct.save();
    ct.translate(texW / 2, logoY);
    ct.scale(1, -1);
    ct.font = "32px sans-serif";
    ct.textAlign = "center";
    ct.textBaseline = "middle";
    // the PLATE only — the letters below get their own alpha
    ct.globalAlpha = doorLabelAlpha;

    const measured = ct.measureText(label);
    const padding = 12;
    const rw = measured.width + padding * 2;
    const rh = 36 + padding * 2;
    drawRoundedRect(ct, {
      x: -rw / 2,
      y: -rh / 2,
      width: rw,
      height: rh,
      radius: 6,
      fillStyle: "rgba(24, 24, 24, 255)",
      strokeStyle: "rgba(235, 235, 235, 0.34)",
      lineWidth: 3,
    });

    // white is the one value a colour-space round trip leaves alone, so the letters take it
    ct.globalAlpha = 1;
    ct.fillStyle = "#fff";
    ct.fillText(label, 0, 0);
    ct.restore();
  }

  texArray.updateIndex(layerIndex);
}

/**
 * TypeScript is having trouble:
 * >  error TS2590: Expression produces a union type that is too complex to represent.
 */
export type SelectFloatType = (
  x: THREE.Node<"bool">,
  y: THREE.Node<"float">,
  z: THREE.Node<"float">,
) => THREE.Node<"float">;

/**
 * TypeScript is having trouble:
 * >  error TS2590: Expression produces a union type that is too complex to represent.
 */
export type SelectAnyType = (x: THREE.Node<"bool">, y: THREE.Node, z: THREE.Node) => THREE.Node;

export function bootstrapInstanceColor(mesh: THREE.InstancedMesh | null) {
  if (mesh) {
    mesh.instanceColor ??= new THREE.InstancedBufferAttribute(new Float32Array(mesh.count * 3), 3);
    mesh.instanceColor.needsUpdate = true;
  }
}

const gridSize = 1.5;

export function drawFloorGrid(
  ct: CanvasRenderingContext2D,
  bounds: { x: number; y: number; width: number; height: number },
  gridOrigin: { x: number; y: number },
) {
  const ixMin = Math.floor(bounds.x / gridSize);
  const ixMax = Math.ceil((bounds.x + bounds.width) / gridSize);
  const iyMin = Math.floor(bounds.y / gridSize);
  const iyMax = Math.ceil((bounds.y + bounds.height) / gridSize);

  ct.strokeStyle = "rgba(220, 220, 220, 0.05)";
  ct.lineWidth = 0.012 * 4;
  ct.beginPath();
  for (let ix = ixMin; ix <= ixMax; ix++) {
    const x = ix * gridSize;
    ct.moveTo(x, iyMin * gridSize);
    ct.lineTo(x, iyMax * gridSize);
  }
  for (let iy = iyMin; iy <= iyMax; iy++) {
    const y = iy * gridSize;
    ct.moveTo(ixMin * gridSize, y);
    ct.lineTo(ixMax * gridSize, y);
  }
  ct.stroke();

  const worldOffsetX = gridOrigin.x;
  const worldOffsetY = gridOrigin.y;
  ct.fillStyle = "rgba(0, 220, 0, 0.85)";
  ct.font = "0.11px monospace";
  ct.textBaseline = "top";
  for (let ix = ixMin; ix < ixMax; ix++) {
    for (let iy = iyMin; iy < iyMax; iy++) {
      const wx = ix * gridSize + worldOffsetX;
      const wy = iy * gridSize + worldOffsetY;
      ct.fillText(`${wx}, ${wy}`, ix * gridSize + 0.04, iy * gridSize + 0.04);
    }
  }
}

/** Reused for every obstacle footprint — see `drawRoomFloors` */
const tmpObstacleMat = new Mat();
