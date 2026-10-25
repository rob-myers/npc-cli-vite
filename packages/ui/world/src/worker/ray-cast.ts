/**
 * The nav worker's raycasts, along one world-space `SegGrid`. Walls stop a ray, and so does a door
 * unless it crosses that door's gap. Obstacles and shields it passes are named, nearest first
 */
import { Mat, Poly } from "@npc-cli/util/geom"; // 🔔 @npc-cli/util breaks worker via react-refresh window undefined
import { type Occluder, SegGrid, segsHit } from "../service/seg-grid";

/** Walls and obstacles in world coords, as of the last navmesh request */
let statics: { walls: Seg[]; obstacles: RayObstacle[] } = { walls: [], obstacles: [] };
/** As `Doors` last sent them */
let doors: WW.RayDoor[] = [];
/** By gdKey, each door's open ratio */
const ratios = new Map<string, number>();
let shields: { key: string; points: Geom.VectJson[] }[] = [];
/** Made on the next ray once the walls, obstacles or doors change */
let grid: null | SegGrid = null;

export function setRaycastStatics(gmKeyToData: WW.RaycastSetupData, gmGeoms: WW.GmGeomForNav[]) {
  const walls: Seg[] = [];
  const obstacles: RayObstacle[] = [];
  gmGeoms.forEach((gm, gmId) => {
    const { walls: wallPolys, obstacles: gmObstacles } = gmKeyToData[gm.key];
    const toWorld = new Mat(gm.mat3);
    for (const json of wallPolys) for (const seg of Poly.from(json).applyMatrix(toWorld).lineSegs) walls.push(seg);
    for (const { outline, ...obstacle } of gmObstacles) {
      obstacles.push({ ...obstacle, gmId, outline: Poly.from(outline).applyMatrix(toWorld).outline });
    }
  });
  statics = { walls, obstacles };
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

function raycast({ src, dst, grKey }: WW.GetRaycast): JshCli.RaycastResult {
  const crossed: { o: Occluder; lambda: number }[] = [];
  getGrid().forEachOn(src, dst, (o, lambda) => void crossed.push({ o, lambda }));
  crossed.sort((a, b) => a.lambda - b.lambda);

  /** Where along it a wall or door stopped it */
  let stop = Infinity;
  let hitDoor: null | Geomorph.GmDoorKey = null;
  const passed: Geomorph.GmDoorKey[] = [];
  const rooms: Geomorph.GmRoomKey[] = [grKey];
  /** By obstacle index, where it first meets it */
  const met = new Map<number, number>();

  for (const { o, lambda } of crossed) {
    if (o.kind === "wall") {
      stop = lambda;
      break;
    }
    if (o.kind !== "door") {
      if (met.has(o.id) === false) met.set(o.id, lambda);
      continue;
    }
    const door = doors[o.id];
    if (inGap(door, pointAt(src, dst, lambda)) === false) {
      [stop, hitDoor] = [lambda, door.gdKey];
      break;
    }
    passed.push(door.gdKey);
    const next = nextRoom(door, rooms);
    if (next !== null) rooms.push(next);
  }

  const length = Math.hypot(dst.x - src.x, dst.y - src.y);
  const obstacles = [...met].flatMap(([index, lambda]) => {
    const { outline, ...obstacle } = statics.obstacles[index];
    return lambda > stop || contains(outline, src) ? [] : [{ ...obstacle, dist: lambda * length }];
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
  };
}

function getGrid() {
  if (grid !== null) return grid;
  const next = new SegGrid(1);
  for (const seg of statics.walls) next.add(seg, "wall", -1);
  doors.forEach(({ src, dst }, index) => next.add([src, dst], "door", index));
  statics.obstacles.forEach(({ outline }, index) => {
    outline.forEach((p, i) => next.add([p, outline[(i + 1) % outline.length]], "obstacle", index));
  });
  return (grid = next);
}

/** As `Doors` slides it: its gap grows from one end by its open ratio */
function inGap(door: WW.RayDoor, p: Geom.VectJson) {
  const ratio = ratios.get(door.gdKey) ?? 0;
  if (ratio === 0) return false;
  const [dx, dy] = [door.dst.x - door.src.x, door.dst.y - door.src.y];
  const lambda = ((p.x - door.src.x) * dx + (p.y - door.src.y) * dy) / (dx ** 2 + dy ** 2);
  return door.gapAtHighLambda ? lambda >= 1 - ratio : lambda <= ratio;
}

/** The room beyond `door`. A hull door's second record leads to its own room, unless that is already listed */
function nextRoom(door: WW.RayDoor, rooms: Geomorph.GmRoomKey[]) {
  const current = rooms[rooms.length - 1];
  if (door.grKeys.includes(current)) return door.grKeys.find((grKey) => grKey !== null && grKey !== current) ?? null;
  return door.grKeys.find((grKey) => grKey !== null && rooms.includes(grKey) === false) ?? null;
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
type RayObstacle = Omit<WW.RaycastObstacle, "dist"> & { gmId: number; outline: Geom.VectJson[] };
