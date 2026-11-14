import { geomService } from "@npc-cli/util/geom-service";
import { ansi } from "../../shell/const";
import { getRoomDoorKeys } from "./worker.main";

/**
 * Who each walker is in the way of: walkers × idle npcs in their rooms, each through the numbered stages below.
 * Owned by jsh `sidestep`, which acts on what it yields — see `docs/sidestep.md`
 */
export class SidestepLookout {
  /** By npcKey, the walker they made way for on this approach, and when in world seconds */
  asked = new Map<string, { walker: string; at: number }>();
  /** By npcKey, the walker slowed beside them, and since when in world seconds */
  beside = new Map<string, { walker: string; since: number }>();
  /** What `coming` tested since the last `status` */
  tally: Tally;
  /** The moving npcs, by npcKey */
  walkers = new Map<string, Walker>();

  constructor(w: JshCli.WorldState) {
    this.tally = { since: w.gameTime.now(), looks: new Map(), tested: new Map() };
    for (const key in w.n) if (w.n[key].isMoving() === true) this.walkers.set(key, this.place(w, key));
  }

  /**
   * Each walker due a look: whom they are coming at, and in how many seconds.
   * Looks again as soon as anyone in their rooms could matter
   */
  *coming(w: JshCli.WorldState, now: number, isFree: IsFree, ignore: Ignore): Generator<Coming> {
    const c = lookoutConfig;
    for (const [key, walker] of this.walkers) {
      // 1. due
      const by = w.n[key];
      if (walker.nextLook > now || by?.agent == null || by.isMoving() === false || ignore(key)) continue;
      const { agent } = by;
      const speed = Math.hypot(agent.velocity[0], agent.velocity[2]);
      const heading = headingOf(by);
      const path = pathOf(by);
      /** The furthest apart they can be, for the walker to reach them in time */
      const reach = speed * c.anticipateSecs + 2 * agent.radius;
      bump(this.tally.looks, key);
      let nearest = Infinity;

      // 2. candidates
      for (const npc of this.candidates(w, walker, key, path, reach)) {
        const [dx, dy] = [npc.position.x - by.position.x, npc.position.z - by.position.z];
        nearest = Math.min(nearest, Math.max(Math.abs(dx), Math.abs(dy)));
        // 3. box
        if (Math.abs(dx) > reach || Math.abs(dy) > reach) {
          this.note(npc.key, "failed-box");
          continue;
        }
        // 4. ahead: one behind is falling away
        if (heading === null || heading.x * dx + heading.y * dy <= 0) {
          this.note(npc.key, "failed-ahead");
          continue;
        }
        // 5. free, and not yet asked this approach
        if (this.asked.get(npc.key)?.walker === key || isFree(npc) !== null) {
          this.note(npc.key, "failed-free");
          continue;
        }
        // 6. on course: the walker's body would meet theirs
        if (offPath(npc.point, path) > c.collideNear) {
          this.note(npc.key, "failed-course");
          continue;
        }
        // 7. soon, and before the walker arrives
        const between = Math.hypot(dx, dy);
        const eta = Math.max(0, between - agent.radius - (npc.agent?.radius ?? 0)) / Math.max(speed, c.headingMin);
        if (eta > c.anticipateSecs || by.distanceTo(by.last.dst) < between) {
          this.note(npc.key, "failed-soon");
          continue;
        }
        this.note(npc.key, "passed-coming");
        yield { walker: by, npc, eta };
      }

      // 8. next look: no sooner than they could be in reach of the nearest
      const wait = (nearest - 2 * agent.radius) / Math.max(agent.maxSpeed, c.headingMin) - c.anticipateSecs;
      walker.nextLook = now + Math.min(c.lookMaxSecs, Math.max(c.lookSecs, wait));
    }
  }

  /** The npcs in `walker`'s room, and beyond any open door of it their way crosses within `reach` */
  *candidates(
    w: JshCli.WorldState,
    walker: Walker,
    self: string,
    path: Geom.VectJson[],
    reach: number,
  ): Generator<JshCli.Npc> {
    const rooms = walker.room === null ? [] : [walker.room];
    const [at] = path;
    for (const door of walker.doors) {
      if (door.beyond === null || w.door.byKey[door.gdKey]?.open !== true) continue;
      if (Math.abs(door.centre.x - at.x) > reach || Math.abs(door.centre.y - at.y) > reach) continue;
      if (crossesWithin(path, door, reach) === true) rooms.push(door.beyond);
    }
    yield* w.npc.near.inRooms(rooms, self);
  }

  /** Forgets whom each made way for, once that walker has stopped, gone or passed them, or `askedSecs` on */
  forget(w: JshCli.WorldState, now: number) {
    for (const [npcKey, { walker, at }] of this.asked) {
      const [npc, by] = [w.n[npcKey], w.n[walker]];
      const passed = npc === undefined || by === undefined || by.isMoving() === false || isBehind(npc, by);
      if (passed || now - at >= lookoutConfig.askedSecs) this.asked.delete(npcKey);
    }
  }

  /**
   * The fallback, each tick: whom each walker is held up by, among their crowd neighbours.
   * `why` says why a neighbour is not, else is `null`
   */
  *heldUp(w: JshCli.WorldState, now: number, isFree: IsFree, ignore: Ignore): Generator<HeldUp> {
    const c = lookoutConfig;
    const seen = new Set<string>();
    for (const key of this.walkers.keys()) {
      const by = w.n[key];
      if (by?.agent == null || by.isMoving() === false || ignore(key)) continue;
      // 1. near: the crowd's own neighbours
      const beside = w.npc.near.beside(key, c.dist);
      if (beside.length === 0) continue;
      const { agent } = by;
      const [heading, path] = [headingOf(by), pathOf(by)]; // once per walker with someone near
      for (const { npc } of beside) {
        seen.add(npc.key);
        const [dx, dy] = [npc.position.x - by.position.x, npc.position.z - by.position.z];
        // 2. ahead
        if (heading !== null && heading.x * dx + heading.y * dy <= 0) {
          yield { walker: by, npc, why: "passed", seg: [by.point, npc.point] };
          continue;
        }
        // 3. on their way: near enough that their bodies meet
        const onPath = nearestOnPath(npc.point, path);
        if (dist(npc.point, onPath) > agent.radius + (npc.agent?.radius ?? 0) + c.pathMargin) {
          yield { walker: by, npc, why: "path clear", seg: [npc.point, onPath] };
          continue;
        }
        // 4. free, and not yet asked this approach
        const why = this.asked.get(npc.key)?.walker === key ? "asked" : isFree(npc);
        if (why !== null) {
          this.beside.delete(npc.key);
          yield { walker: by, npc, why };
          continue;
        }
        // 5. slowed for `lingerSecs`
        const slowed = Math.hypot(agent.velocity[0], agent.velocity[2]) < c.slowShare * agent.maxSpeed;
        const prev = this.beside.get(npc.key);
        if (prev?.walker !== key || slowed === false) {
          this.beside.set(npc.key, { walker: key, since: now }); // timed afresh
        } else if (now - prev.since >= c.lingerSecs) {
          this.beside.delete(npc.key);
          yield { walker: by, npc, why: null };
        }
      }
    }
    for (const npcKey of this.beside.keys()) if (seen.has(npcKey) === false) this.beside.delete(npcKey);
  }

  /** Counts `npcKey`'s `outcome` in `coming`, for `status` */
  note(npcKey: string, outcome: ComingOutcome) {
    const outcomes = this.tally.tested.get(npcKey) ?? new Map<ComingOutcome, number>();
    this.tally.tested.set(npcKey, outcomes);
    bump(outcomes, outcome);
  }

  /** Notes `npcKey` made way for `walker`, so they do not again this approach */
  noteAsked(npcKey: string, walker: string, now: number) {
    this.asked.set(npcKey, { walker, at: now });
  }

  /** Walkers come and go. One changing room has their rooms and doors placed afresh. Each then looks at once */
  onEvent(e: JshCli.Event, w: JshCli.WorldState) {
    switch (e.key) {
      case "started-moving":
        this.walkers.set(e.npcKey, this.place(w, e.npcKey));
        break;
      case "enter-room":
        if (this.walkers.has(e.npcKey)) this.walkers.set(e.npcKey, this.place(w, e.npcKey));
        break;
      case "stopped-moving":
      case "removed-npcs":
        for (const npcKey of e.key === "removed-npcs" ? e.npcKeys : [e.npcKey]) this.walkers.delete(npcKey);
        // someone new may stand in anyone's way
        for (const walker of this.walkers.values()) walker.nextLook = -Infinity;
        break;
    }
  }

  /** `npcKey`'s room and its doors, each with the room beyond, as `trackDoorway` finds it. Due a look at once */
  place(w: JshCli.WorldState, npcKey: string): Walker {
    const room = w.npc.npcToRoom.get(npcKey) ?? null;
    const doors = (room === null ? [] : getRoomDoorKeys(w, room.grKey)).flatMap((gdKey): LookoutDoor[] => {
      const door = w.door.byKey[gdKey];
      if (door === undefined) return [];
      const { src, dst, connector } = door;
      const sides = connector.roomIds.map((roomId, i) =>
        roomId === null
          ? w.gmGraph.getOtherGmRoomId(door, connector.roomIds[1 - i] ?? -1)
          : { gmId: door.gmId, roomId },
      );
      const beyond = sides.find((r) => r !== null && (r.gmId !== room?.gmId || r.roomId !== room.roomId)) ?? null;
      const centre = { x: (src.x + dst.x) / 2, y: (src.y + dst.y) / 2 };
      return [{ gdKey, src, dst, centre, beyond }];
    });
    return { nextLook: -Infinity, room, doors };
  }

  /** What `coming` tested since the last call, then forgotten, as tables: each walker's looks, each npc's outcomes */
  *status(w: JshCli.WorldState) {
    const now = w.gameTime.now();
    yield `${heading("over")} ${(now - this.tally.since).toFixed(1)}s`;
    yield heading("walkers");
    yield* table(
      ["walker", "looks", "next", "doors"],
      [...this.walkers].map(([key, walker]) => [
        key,
        this.tally.looks.get(key) ?? 0,
        `${Math.max(0, walker.nextLook - now).toFixed(2)}s`,
        walker.doors.length,
      ]),
    );
    const untracked = Object.keys(w.n).filter((key) => w.n[key].isMoving() && this.walkers.has(key) === false);
    if (untracked.length > 0) yield `  ${ansi.Red}moving but untracked:${ansi.Reset} ${untracked.join(" ")}`;
    yield `${heading("tests")} ${ansi.Grey}where each stopped${ansi.Reset}`;
    yield* table(
      ["npc", "tests", ...comingOutcomes.map((outcome) => outcome.replace(/^\w+-/, ""))],
      [...this.tally.tested].map(([key, counts]) => [
        key,
        [...counts.values()].reduce((sum, n) => sum + n, 0),
        ...comingOutcomes.map((outcome) => counts.get(outcome) ?? 0),
      ]),
      ansi.GreenBright,
    );
    this.tally = { since: now, looks: new Map(), tested: new Map() };
  }
}

/** Why they cannot make way now, else `null` */
type IsFree = (npc: JshCli.Npc) => null | string;

/** Walkers passed over: sidestep's own steps and returns, which make way rather than ask for it */
type Ignore = (walkerKey: string) => boolean;

/** A walker coming at an npc, and in how many seconds they reach them */
type Coming = { walker: JshCli.Npc; npc: JshCli.Npc; eta: number };

/**
 * A walker's crowd neighbour, holding them up when `why` is `null`. `seg` shows why not, for `--debug`:
 * from the walker to them once passed, else from them to the walker's path once clear of it
 */
type HeldUp = { walker: JshCli.Npc; npc: JshCli.Npc; why: null | string; seg?: [Geom.VectJson, Geom.VectJson] };

/** A moving npc's cached candidates, placed when they start or change room */
type Walker = {
  /** When they next look, in world seconds */
  nextLook: number;
  /** Their room, else `null` outside every room */
  room: null | { gmId: number; roomId: number };
  doors: LookoutDoor[];
};

/** A door of a walker's room, and the room beyond it, if any */
type LookoutDoor = {
  gdKey: Geomorph.GmDoorKey;
  src: Geom.VectJson;
  dst: Geom.VectJson;
  centre: Geom.VectJson;
  beyond: null | { gmId: number; roomId: number };
};

/** Each outcome, in the order `coming` tests: its columns in `status` */
const comingOutcomes = [
  "failed-box",
  "failed-ahead",
  "failed-free",
  "failed-course",
  "failed-soon",
  "passed-coming",
] as const satisfies readonly ComingOutcome[];

/** A `sidestep status` section's title */
export const heading = (title: string) => `${ansi.Cyan}${title}${ansi.Reset}`;

/**
 * Rows under a grey `header`, indented under their heading, else `none`. Numbers, units and all, are right-aligned.
 * A zero is dimmed, and the last column's other counts are `lastColor`
 */
export function* table(header: string[], rows: (string | number)[][], lastColor = ansi.White) {
  if (rows.length === 0) {
    yield `  ${ansi.GreyDark}none${ansi.Reset}`;
    return;
  }
  const widths = header.map((_, i) => Math.max(...[header, ...rows].map((row) => `${row[i]}`.length)));
  const right = header.map((_, i) => i > 0 && /^-?[\d.]+[a-z/]*$/.test(`${rows[0][i]}`));
  const pad = (cell: string | number, i: number) =>
    right[i] ? `${cell}`.padStart(widths[i]) : `${cell}`.padEnd(widths[i]);
  yield `  ${ansi.Grey}${header.map(pad).join("  ")}${ansi.Reset}`;
  for (const row of rows) {
    const color = (cell: string | number, i: number) =>
      cell === 0 ? ansi.GreyDark : i === row.length - 1 ? lastColor : ansi.White;
    yield `  ${row.map((cell, i) => color(cell, i) + pad(cell, i)).join("  ")}${ansi.Reset}`;
  }
}

/**
 * An npc's outcome in one run of `coming`'s tests, tallied by name for `sidestep status`: the test they failed,
 * else `passed-coming` once all pass.
 * Each test, in order, and what failing it means:
 * - `failed-box`: within `reach` of the walker in both x and z? Else too far to matter yet
 * - `failed-ahead`: in front of the walker's heading? Else falling away behind
 * - `failed-free`: free to move (`isFree`), and not yet asked by this walker this approach? Else left be
 * - `failed-course`: within `collideNear` of the walker's path? Else their bodies won't meet
 * - `failed-soon`: reached within `anticipateSecs`, before the walker stops? Else not yet, or never
 * - `passed-coming`: passed every test, so yielded to make way
 */
type ComingOutcome = "failed-box" | "failed-ahead" | "failed-free" | "failed-course" | "failed-soon" | "passed-coming";

type Tally = { since: number; looks: Map<string, number>; tested: Map<string, Map<ComingOutcome, number>> };

export const lookoutConfig = {
  /** Within this of a walker, the crowd's `collisionQueryRange`, its avoidance holds one up */
  dist: 0.7,
  /** Held up: the walker's way within both agents' radii and this of them, so their bodies meet */
  pathMargin: 0.1,
  /** Held up: the walker below this share of their top speed, for `lingerSecs`. Sooner than `stuckDuration` */
  slowShare: 0.5,
  lingerSecs: 0.05,
  /** Asked again after this many game seconds, if still in that walker's way, e.g. jammed */
  askedSecs: 1,
  /** Coming: game seconds between a walker's looks, at most `lookMaxSecs` whilst nobody is near */
  lookSecs: 0.1,
  lookMaxSecs: 1,
  /** Coming: reached within this many seconds, the walker's way within `collideNear` metres of them */
  anticipateSecs: 0.7,
  collideNear: 0.3,
  /** Below this speed, desired or actual, a walker's heading is unknown */
  headingMin: 0.05,
};

/** Where `walker` is, then their next corners */
export function pathOf(walker: JshCli.Npc) {
  return [walker.point, ...(walker.agent?.corners ?? []).map(({ position: [x, , z] }) => ({ x, y: z }))];
}

/** Metres from `p` to the nearest leg of `path` */
export function offPath(p: Geom.VectJson, path: Geom.VectJson[]) {
  return Math.min(...path.map((a, i) => geomService.getDistanceToSeg(p.x, p.y, a, path[i + 1] ?? a)));
}

/** The point of `path` nearest `p`, on any leg */
export function nearestOnPath(p: Geom.VectJson, path: Geom.VectJson[]) {
  let [nearest, least] = [path[0], Infinity];
  for (const [i, a] of path.entries()) {
    const b = path[i + 1] ?? a;
    const [ex, ey] = [b.x - a.x, b.y - a.y];
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * ex + (p.y - a.y) * ey) / (ex * ex + ey * ey || 1)));
    const q = { x: a.x + ex * t, y: a.y + ey * t };
    if (dist(p, q) < least) [nearest, least] = [q, dist(p, q)];
  }
  return nearest;
}

const dist = (u: Geom.VectJson, v: Geom.VectJson) => Math.hypot(u.x - v.x, u.y - v.y);

/** Which way `walker` means to go, their desired velocity, else as they move. Held up, they barely move */
export function headingOf({ agent }: JshCli.Npc) {
  for (const [x, , z] of agent === null ? [] : [agent.desiredVelocity, agent.velocity]) {
    if (Math.hypot(x, z) > lookoutConfig.headingMin) return { x, y: z };
  }
  return null;
}

/** Whether `npc` is behind `walker`, as they head */
function isBehind(npc: JshCli.Npc, walker: JshCli.Npc) {
  const heading = headingOf(walker);
  const [dx, dy] = [npc.position.x - walker.position.x, npc.position.z - walker.position.z];
  return heading !== null && heading.x * dx + heading.y * dy <= 0;
}

/** Whether `path` crosses the door's line on a leg starting within `reach` of where it starts */
function crossesWithin(path: Geom.VectJson[], { src, dst }: LookoutDoor, reach: number) {
  const [at] = path;
  for (let i = 0; i + 1 < path.length; i++) {
    const [a, b] = [path[i], path[i + 1]];
    if (Math.abs(a.x - at.x) > reach || Math.abs(a.y - at.y) > reach) return false;
    if (side(src, dst, a) * side(src, dst, b) <= 0 && side(a, b, src) * side(a, b, dst) <= 0) return true;
  }
  return false;
}

/** Which side of the line `ab` `p` lies: its sign */
const side = (a: Geom.VectJson, b: Geom.VectJson, p: Geom.VectJson) =>
  Math.sign((b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x));

function bump<K>(counts: Map<K, number>, key: K) {
  counts.set(key, (counts.get(key) ?? 0) + 1);
}
