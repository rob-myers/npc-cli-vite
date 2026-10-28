/**
 * The nav worker's raycasts, along one world-space `SegGrid`. Walls stop a ray, and so does a door
 * unless it crosses that door's gap. A window leads it on into the room beyond. Obstacles and shields it
 * passes are named, nearest first
 */
import { Mat, Poly } from "@npc-cli/util/geom"; // 🔔 @npc-cli/util breaks worker via react-refresh window undefined
import { type Occluder, SegGrid, segsHit } from "../service/seg-grid";

/** Walls and obstacles in world coords, as of the last navmesh request */
let statics: { walls: Seg[]; obstacles: RayObstacle[]; windows: RayWindow[] } = {
  walls: [],
  obstacles: [],
  windows: [],
};
/** As `Doors` last sent them */
let doors: WW.RayDoor[] = [];
/** By gdKey, each door's open ratio */
const ratios = new Map<string, number>();
let shields: { key: string; points: Geom.VectJson[] }[] = [];
/** The decor that stops a shot, by its id in the grid. A rebuilt grid has them all again */
const decorById = new Map<number, WW.RayDecor>();
const decorIds = new Map<string, number>();
let nextDecorId = 0;
/** Made on the next ray once the walls, obstacles or doors change */
let grid: null | SegGrid = null;

export function setRaycastStatics(gmKeyToData: WW.RaycastSetupData, gmGeoms: WW.GmGeomForNav[]) {
  const walls: Seg[] = [];
  const obstacles: RayObstacle[] = [];
  const windows: RayWindow[] = [];
  gmGeoms.forEach((gm, gmId) => {
    const { walls: wallPolys, obstacles: gmObstacles, windows: gmWindows = [] } = gmKeyToData[gm.key];
    const toWorld = new Mat(gm.mat3);
    for (const json of wallPolys) for (const seg of Poly.from(json).applyMatrix(toWorld).lineSegs) walls.push(seg);
    for (const { outline, ...obstacle } of gmObstacles) {
      obstacles.push({ ...obstacle, gmId, outline: Poly.from(outline).applyMatrix(toWorld).outline });
    }
    for (const { seg, roomIds } of gmWindows) {
      windows.push({
        seg: [toWorld.transformPoint({ ...seg[0] }), toWorld.transformPoint({ ...seg[1] })],
        grKeys: roomIds.map((roomId) => (roomId === null ? null : (`g${gmId}r${roomId}` as const))),
      });
    }
  });
  statics = { walls, obstacles, windows };
  grid = null;
}

export function setRaycastDoors({ doors: next }: Extract<WW.MsgToNavWorker, { type: "set-raycast-doors" }>) {
  doors = next;
  ratios.clear();
  for (const { gdKey, ratio } of doors) ratios.set(gdKey, ratio);
  grid = null;
}

export function setDoorRatios({ ratios: changed }: Extract<WW.MsgToNavWorker, { type: "set-door-ratios" }>) {
  for (const [gdKey, ratio] of Object.entries(changed)) ratios.set(gdKey, ratio);
}

export function setRaycastDecor({ full, boxes, removed }: Extract<WW.MsgToNavWorker, { type: "set-raycast-decor" }>) {
  if (full === true) {
    decorById.clear();
    decorIds.clear();
    grid = null;
  }
  for (const decorKey of [...removed, ...boxes.map((box) => box.decorKey)]) {
    const id = decorIds.get(decorKey);
    if (id === undefined) continue;
    grid?.removeDecor(id);
    decorById.delete(id);
    decorIds.delete(decorKey);
  }
  for (const box of boxes) {
    const id = nextDecorId++;
    decorById.set(id, box);
    decorIds.set(box.decorKey, id);
    if (grid !== null) addDecor(grid, id, box);
  }
}

export function setRayCastShields(msg: Extract<WW.MsgToNavWorker, { type: "set-raycast-shields" }>) {
  shields = msg.shields;
}

/** Always answers, else main waits forever */
export function sendRaycastResult(msg: WW.GetRaycast) {
  let output: null | JshCli.RaycastResult = null;
  let error: undefined | string;
  try {
    output = raycast(msg);
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }
  self.postMessage({ uid: msg.uid, output, error } satisfies WW.NavWorkerReply);
}

/** Always answers, `null` for each cast that failed */
export function sendRaycastResults(msg: WW.GetRaycasts) {
  const output = msg.casts.map((cast) => {
    try {
      return raycast(cast);
    } catch {
      return null;
    }
  });
  self.postMessage({ uid: msg.uid, output } satisfies WW.NavWorkerReply);
}

function raycast({ src, dst, grKey }: WW.GetRaycasts["casts"][number]): JshCli.RaycastResult {
  const crossed: { o: Occluder; lambda: number }[] = [];
  getGrid().forEachOn(src, dst, (o, lambda) => void crossed.push({ o, lambda }));
  crossed.sort((a, b) => a.lambda - b.lambda);

  /** Where along it a wall or door stopped it */
  let stop = Infinity;
  let hitDoor: null | Geomorph.GmDoorKey = null;
  const passed: Geomorph.GmDoorKey[] = [];
  const rooms: Geomorph.GmRoomKey[] = [grKey];
  /** By obstacle index, where it first and last meets it */
  const met = new Map<number, [number, number]>();
  /** By decor id, the same */
  const metDecor = new Map<number, [number, number]>();

  for (const { o, lambda } of crossed) {
    if (o.kind === "wall") {
      stop = lambda;
      break;
    }
    if (o.kind === "window") {
      const next = nextRoom(statics.windows[o.id].grKeys, rooms);
      if (next !== null) rooms.push(next);
      continue;
    }
    if (o.kind !== "door") {
      const byId = o.kind === "decor" ? metDecor : met;
      const at = byId.get(o.id);
      if (at === undefined) byId.set(o.id, [lambda, lambda]);
      else at[1] = lambda;
      continue;
    }
    const door = doors[o.id];
    if (inGap(door, pointAt(src, dst, lambda)) === false) {
      [stop, hitDoor] = [lambda, door.gdKey];
      break;
    }
    passed.push(door.gdKey);
    const next = nextRoom(door.grKeys, rooms);
    if (next !== null) rooms.push(next);
  }

  const length = Math.hypot(dst.x - src.x, dst.y - src.y);
  /** Metres from where it meets `outline` to where it leaves: begun or ended inside, it meets it there */
  const spanOf = (outline: Geom.VectJson[], enter: number, leave: number) => ({
    dist: (contains(outline, src) ? 0 : enter) * length,
    leave: (contains(outline, dst) ? 1 : leave) * length,
  });
  const obstacles = [...met].flatMap(([index, [enter, leave]]) => {
    const { outline, ...obstacle } = statics.obstacles[index];
    return enter > stop ? [] : [{ ...obstacle, ...spanOf(outline, enter, leave) }];
  });
  const decor = [...metDecor].flatMap(([id, [enter, leave]]) => {
    const box = decorById.get(id);
    if (box === undefined || enter > stop) return [];
    const { decorKey, top, bottom, outline } = box;
    return [{ decorKey, top, bottom, ...spanOf(outline, enter, leave) }];
  });
  const hit = stop === Infinity ? null : round(pointAt(src, dst, stop));
  return {
    success: hit === null,
    hit,
    hitDoor,
    doors: passed,
    rooms,
    shields: shieldsPassed(src, dst, stop),
    obstacles: obstacles.sort((a, b) => a.dist - b.dist),
    decor: decor.sort((a, b) => a.dist - b.dist),
  };
}

function getGrid() {
  if (grid !== null) return grid;
  const next = new SegGrid(1);
  for (const seg of statics.walls) next.add(seg, "wall", -1);
  doors.forEach(({ src, dst }, index) => next.add([src, dst], "door", index));
  statics.windows.forEach(({ seg }, index) => next.add(seg, "window", index));
  statics.obstacles.forEach(({ outline }, index) => {
    outline.forEach((p, i) => next.add([p, outline[(i + 1) % outline.length]], "obstacle", index));
  });
  for (const [id, box] of decorById) addDecor(next, id, box);
  return (grid = next);
}

function addDecor(into: SegGrid, id: number, { outline }: WW.RayDecor) {
  outline.forEach((p, i) => into.add([p, outline[(i + 1) % outline.length]], "decor", id));
}

/** As `Doors` slides it: its gap grows from one end by its open ratio */
function inGap(door: WW.RayDoor, p: Geom.VectJson) {
  const ratio = ratios.get(door.gdKey) ?? 0;
  if (ratio === 0) return false;
  const [dx, dy] = [door.dst.x - door.src.x, door.dst.y - door.src.y];
  const lambda = ((p.x - door.src.x) * dx + (p.y - door.src.y) * dy) / (dx ** 2 + dy ** 2);
  return door.gapAtHighLambda ? lambda >= 1 - ratio : lambda <= ratio;
}

/** The room beyond a door or window joining `grKeys`. A hull door's second record leads to its own room, unless that is already listed */
function nextRoom(grKeys: (null | Geomorph.GmRoomKey)[], rooms: Geomorph.GmRoomKey[]) {
  const current = rooms[rooms.length - 1];
  if (grKeys.includes(current)) return grKeys.find((grKey) => grKey !== null && grKey !== current) ?? null;
  return grKeys.find((grKey) => grKey !== null && rooms.includes(grKey) === false) ?? null;
}

/** Decor keys of the shields it meets before `stop`, nearest first */
function shieldsPassed(src: Geom.VectJson, dst: Geom.VectJson, stop: number) {
  return shields
    .flatMap(({ key, points }) => {
      let first = contains(points, src) ? 0 : Infinity;
      points.forEach((p, i) => {
        const lambda = segsHit(src, dst, p, points[(i + 1) % points.length]);
        if (lambda !== -1 && lambda < first) first = lambda;
      });
      return first !== Infinity && first <= stop ? [{ key, first }] : [];
    })
    .sort((a, b) => a.first - b.first)
    .map(({ key }) => key);
}

/** Even-odd: is `p` inside the polygon `points`? */
function contains(points: Geom.VectJson[], p: Geom.VectJson) {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [a, b] = [points[i], points[j]];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

const pointAt = (src: Geom.VectJson, dst: Geom.VectJson, lambda: number) => ({
  x: src.x + lambda * (dst.x - src.x),
  y: src.y + lambda * (dst.y - src.y),
});

const round = ({ x, y }: Geom.VectJson) => ({ x: Math.round(x * 100) / 100, y: Math.round(y * 100) / 100 });

type Seg = [Geom.VectJson, Geom.VectJson];
type RayWindow = { seg: Seg; grKeys: (null | Geomorph.GmRoomKey)[] };
type RayObstacle = Omit<WW.RaycastObstacle, "dist" | "leave"> & { gmId: number; outline: Geom.VectJson[] };
