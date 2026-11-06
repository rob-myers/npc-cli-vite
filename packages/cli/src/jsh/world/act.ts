import { type GraphEntry, GraphEntrySchema, type GraphNode } from "@npc-cli/ui__world/scenario.schema";
import { spotKeyRe } from "@npc-cli/ui__world/spot.schema";
import { Task } from "@npc-cli/util";
import { Vect } from "@npc-cli/util/geom";
import { graphs } from "./graph";
import { isSpot, perceive, spotQuery } from "./perception.main";
import { isPaused, npcQuery, parkedNow, requestDetached, roomOthers } from "./plan.main";
import { padded, parked } from "./pred";

/**
 * An npc acting on the spots about them, until done or killed — see `docs/scenarios.md`.
 * `from` names npcs, comma-separated. `rooms` limits the spots, else the whole map.
 * Npc first, a verb takes its main option as `<verb>:<value>`. `park` and `pad` take several npcs
 *
 * ```sh
 * act count rob to:10
 * act face rob wall
 * act hide cal from:rob away:6 prefer:cover,corner
 * act avoid cal from:rob
 * act cal avoid:rob away:3
 * act rob count:10
 * act park rob kate
 * act pad kate by:1
 * act pad kate rob walls:0.3 npcs:1
 * act kate nudge:rob
 * act patrol test-patrol npc:guard-0 watch:rob
 * act patrol cycle:$( pick 4 ) npcs:$( [] guard-{0..1} ) say:""
 * ```
 */
export async function act(ct: JshCli.RunArg) {
  const { verb, npcKey, args } = parseAct(ct.args);
  const found = verb === undefined ? undefined : verbs[verb];
  if (verb === undefined || found === undefined || (npcKey === undefined && !npclessVerbs.has(verb))) {
    const names = Object.keys(verbs).join(",");
    throw Error(`usage: act {${names}} <npc> …, or act <npc> {${names}}:<value> …`);
  }
  // several, as `rob kate` or `rob,kate`: its options are `key:value`
  const several = severalVerbs.has(verb) ? args.filter((arg) => arg.includes(":") === false) : [];
  const npcKeys = [...(npcKey === undefined ? [] : [npcKey]), ...several].flatMap((key) => key.split(","));
  const opts = args.filter((arg) => several.includes(arg) === false);
  if (npcKeys.length > 1 && !severalVerbs.has(verb) && !npclessVerbs.has(verb)) throw Error(`${verb}: one npc only`);
  if (npclessVerbs.has(verb) === false) for (const key of npcKeys) ct.w.npc.get(key);
  ct.api.meta.stack.push(verb); // an error then names it, e.g. `act: hide: …`
  // its waits run down only whilst it runs
  const task = new Task(
    () => ct.api.isRunning() === false,
    () => 1000 * ct.w.gameTime.now(),
  );
  const rejectAll = (e: Error) => npcKeys.forEach((key) => ct.w.n[key]?.rejectAll(e));
  const handlers = ct.api.handleStatus({
    cleanup: () => (task.cancel(), rejectAll(Error("killed"))),
    // paused by more than the World, which holds them itself, they stop, to go on once resumed
    onSuspend: () => (ct.api.isHeldOnlyBy("world") === false && rejectAll(Error("paused")), true),
  });
  try {
    await task.run(() => found({ ct, npcKey: npcKeys[0] ?? "", npcKeys, task }, ct.api.jsArg(opts) as Opts, opts));
  } finally {
    handlers.dispose();
  }
}

/** `act <verb> <npc> …`, else `act <npc> <verb>:<value> …` as the args that verb takes */
function parseAct([first, ...rest]: string[]) {
  if (first !== undefined && npclessVerbs.has(first)) return { verb: first, npcKey: undefined, args: rest };
  if (first !== undefined && Object.hasOwn(verbs, first)) return { verb: first, npcKey: rest[0], args: rest.slice(1) };
  for (const [i, arg] of rest.entries()) {
    const [verb, value] = [arg.slice(0, arg.indexOf(":")), arg.slice(arg.indexOf(":") + 1)];
    if (arg.includes(":") && Object.hasOwn(shorthands, verb)) {
      return { verb, npcKey: first, args: [...shorthands[verb](value), ...rest.toSpliced(i, 1)] };
    }
  }
  return { verb: undefined, npcKey: first, args: rest };
}

/** `act <npc> <verb>:<value>`: the args each verb takes `value` as */
const shorthands: Record<string, (value: string) => string[]> = {
  avoid: (value) => [`from:${value}`],
  count: (value) => [`to:${value}`],
  face: (value) => [value],
  hide: (value) => [`from:${value}`],
  nudge: (value) => [`from:${value}`],
};

/** Verbs taking several npcs, planned together */
const severalVerbs = new Set(["park", "pad"]);
/** Verbs taking no npc first: their args are their own, and they add those they act with to `npcKeys` */
const npclessVerbs = new Set(["patrol"]);

/** What a verb runs with: its npc (the first of `npcKeys`), and a game-time task a kill cancels */
type Ctx = { ct: JshCli.RunArg; npcKey: string; npcKeys: string[]; task: Task };
type Opts = Record<string, undefined | string | number | boolean | unknown[]>;
type Verb = (ctx: Ctx, opts: Opts, args: string[]) => Promise<void>;

const verbs: Record<string, Verb> = {
  /**
   * `[from:<n>] [to:<n>] [every:<secs>] [down]`: says each number from `from` to `to`, `every` game seconds apart.
   * By default 1 to 10, a second apart. `from` alone counts down to 1, as does `down` from `to`
   */
  async count(ctx, opts) {
    const [from, to] =
      opts.from !== undefined
        ? [Number(opts.from), Number(opts.to ?? 1)]
        : opts.down === true
          ? [Number(opts.to ?? 10), 1]
          : [1, Number(opts.to ?? 10)];
    const step = from <= to ? 1 : -1;
    for (let i = from; i !== to + step; i += step) {
      ctx.ct.w.speech.say(ctx.npcKey, `${i}`);
      await waitSecs(ctx, Number(opts.every ?? 1));
    }
  },
  /** `wall`, towards their spot's nearest occluder; else an npc or a spot key */
  async face(ctx, _, [at]) {
    const point = at === undefined ? null : at === "wall" ? await wallPoint(ctx) : await facingPoint(ctx, at);
    if (point === null) throw Error(`${at ?? "nothing"}: not wall, npc or spot`);
    const npc = ctx.ct.w.npc.get(ctx.npcKey);
    await resumable(ctx, () => npc.look({ at: point }));
  },
  /**
   * `<graph> [npc:<key>] [npcs:<keys>] [watch:<keys>]`, else `path:` or `cycle:` points: they walk its closed walk, looking about at each node.
   * Those absent are spawned. A sighting emits `guard-spotted`, then they halt and say `say`, unless it is empty
   */
  async patrol(ctx, opts, args) {
    const { ct } = ctx;
    const [cycle, path] = [opts.cycle, opts.path];
    const points = Array.isArray(cycle) ? cycle : Array.isArray(path) ? path : undefined;
    const positional = args.filter((arg) => arg.includes(":") === false);
    const name = points === undefined ? positional.shift() : undefined;
    if (points === undefined && name === undefined)
      throw Error("expected a graph's name, else path:<points> or cycle:<points>");
    if (positional.length > 0) throw Error(`unexpected ${positional.join(" ")}: npc:<key> or npcs:<keys>`);
    const graph =
      points === undefined
        ? await settled(ctx, graphs.find(ct, name))
        : await settled(ctx, unsavedGraph(ct, points, Array.isArray(cycle)));
    ctx.npcKeys.push(...(keysOf(opts.npcs ?? opts.npc) ?? ["guard-0"]));
    const stop = {
      secs: Number(opts.secs ?? 2),
      lookSecs: Number(opts.lookSecs ?? 2),
      lookDeg: Number(opts.lookDeg ?? 60),
    };
    const route = await settled(ctx, routeOf(ct, graph, stop));
    const guards = startsOf(ct.w, route, ctx.npcKeys.length).map((start, i) => ({ key: ctx.npcKeys[i], ...start }));
    await settled(ctx, Promise.all(guards.map((g, i) => postGuard(ctx, g, i))));
    const say = typeof opts.say === "string" ? opts.say : "Halt!";
    await walkPatrol(ctx, { key: graph.key, watch: keysOf(opts.watch) ?? [], say }, route, guards);
  },
  /** As `avoid`, judged by every spot they will be at, their room's doors open: they open one going in, or stand by one */
  hide: (ctx, opts) => hideFrom(ctx, opts, true),
  /**
   * `from:<npcs> [prefer:<kinds>] [away:<m>]`: to a spot none of them sees, `away` metres from them if one is.
   * Spots others stand at or head for are skipped. Already unseen, they stay put, else they get up first.
   * Blocked, they try another. Seen on arrival, it fails saying why
   */
  avoid: (ctx, opts) => hideFrom(ctx, opts, false),
  /** `[from:<npc|point>] [by:<m>]`: `by` metres (0.5) away from `from`, else a random way, slid along the navmesh */
  async nudge(ctx, opts) {
    const { w } = ctx.ct;
    const npc = w.npc.get(ctx.npcKey);
    const by = Number(opts.by ?? 0.5);
    const delta = Vect.from(npc.point)
      .sub(nudgeFrom(ctx, opts.from, by))
      .normalize(by);
    const op = {
      key: "nudge",
      npc: npcQuery(w, npc),
      to: { x: npc.point.x + delta.x, y: npc.point.y + delta.y },
    } as const;
    const to = await settled(ctx, requestDetached(w, op));
    if (to === null || npc.distanceTo(to) < nudgeMinMove) return; // backed against something
    await goTo(ctx, to);
  },
  /**
   * `[walls:<m>] [npcs:<m>]`: where there is room to walk right round them, from walls and doorways, and from others.
   * `by` is `npcs` — see `padBy`
   */
  async pad(ctx, opts) {
    const { w } = ctx.ct;
    const by = padBy(opts);
    // those padded with as much room already stay as they are
    const npcs = ctx.npcKeys
      .map((key) => w.npc.get(key))
      .filter((npc) => {
        const had = padded.get().get(npc.key);
        return had === undefined || had.walls < by.walls || had.npcs < by.npcs;
      });
    if (npcs.length === 0) return;
    const op = { key: "pad", npcs: npcs.map((npc) => npcQuery(w, npc)), others: roomOthers(w, npcs), by } as const;
    const plans = await settled(ctx, requestDetached(w, op));
    await placeAll(ctx, "padded", npcs, plans, async (npc, { at }) => {
      if ((await walkTo(ctx, npc, at)) === false) return false;
      padded.mark(npc.key, by);
      return true;
    });
  },
  /** Against a nearby wall, clear of its corners, the room's doorways and others parked — see `pred.ts` */
  async park(ctx) {
    const { w } = ctx.ct;
    // those parked already stay as they are
    const npcs = ctx.npcKeys.map((key) => w.npc.get(key)).filter((npc) => parked.get().has(npc.key) === false);
    if (npcs.length === 0) return;
    const op = { key: "park", npcs: npcs.map((npc) => npcQuery(w, npc)), parked: parkedNow(w) } as const;
    const plans = await settled(ctx, requestDetached(w, op));
    await placeAll(ctx, "parked", npcs, plans, async (npc, { at, facing, seg }) => {
      if ((await walkTo(ctx, npc, at)) === false) return false;
      // hurt, they cannot look: they stay facing the way they came
      if (npc.anim.hurt === null) await resumable(ctx, () => npc.look({ at: facing }));
      parked.mark(npc.key, seg);
      return true;
    });
  },
};

/** A graph from `path:` or `cycle:` points, unsaved */
async function unsavedGraph(ct: JshCli.RunArg, points: unknown[], cycle: boolean) {
  const { nodes, edges } = await graphs.through(ct, points, cycle, false);
  return GraphEntrySchema.parse({ key: "", kind: "graph", mapKey: ct.w.mapKey, nodes, edges });
}

type Stop = { secs: number; lookSecs: number; lookDeg: number };

/** The graph's closed walk: each step's node, point and stop, its node's meta over `stop` */
async function routeOf(ct: JshCli.RunArg, graph: GraphEntry, stop: Stop) {
  const at = await graphs.resolve(ct, graph);
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const walk = graphs.closedWalk(graph);
  return walk.map((id, i) => {
    const { meta } = byId.get(id) as GraphNode;
    const num = (k: keyof Stop) => (typeof meta[k] === "number" ? (meta[k] as number) : stop[k]);
    return {
      at: at.get(id) as Geom.VectJson,
      stop: { secs: num("secs"), lookSecs: num("lookSecs"), lookDeg: num("lookDeg") },
      /** The walk turns straight back here, so they need not look either side */
      uTurn: walk[(i + walk.length - 1) % walk.length] === walk[(i + 1) % walk.length],
    };
  });
}

type Route = Awaited<ReturnType<typeof routeOf>>;

/**
 * Each guard's start on the route, as far apart in a straight line as can be: the farthest pair of samples first, then
 * each sample farthest from those chosen. One guard starts at the route's start
 */
function startsOf(w: JshCli.WorldState, route: Route, count: number) {
  const pts = route.map((step) => step.at);
  const legs = pts.map((a, i) => ({ a, b: pts[(i + 1) % pts.length], next: (i + 1) % pts.length }));
  const total = legs.reduce((sum, { a, b }) => sum + Vect.distanceBetween(a, b), 0);
  const step = Math.max(guardStartStep, total / guardStartSamples);
  const samples = legs.flatMap(({ a, b, next }) => {
    const n = Math.max(1, Math.ceil(Vect.distanceBetween(a, b) / step));
    return Array.from({ length: n }, (_, j) => ({
      at: { x: a.x + (j / n) * (b.x - a.x), y: a.y + (j / n) * (b.y - a.y) },
      next,
      heading: Math.atan2(b.y - a.y, b.x - a.x),
    }));
  });
  const dist = (i: number, j: number) => Vect.distanceBetween(samples[i].at, samples[j].at);

  const chosen = [0];
  if (count > 1) {
    let far = -1;
    for (let i = 0; i < samples.length; i++)
      for (let j = i + 1; j < samples.length; j++) {
        const d = dist(i, j);
        if (d > far) [chosen[0], chosen[1], far] = [i, j, d];
      }
  }
  /** Each sample's distance to the nearest chosen */
  const nearest = samples.map((_, i) => Math.min(...chosen.map((c) => dist(i, c))));
  while (chosen.length < count) {
    const next = nearest.indexOf(Math.max(...nearest));
    chosen.push(next);
    for (let i = 0; i < samples.length; i++) nearest[i] = Math.min(nearest[i], dist(i, next));
  }

  return chosen.map((i) => {
    const { at, next, heading } = samples[i];
    const found = w.npc.getClosestPoly(at, 0.5);
    return { at: found.success ? { x: found.position[0], y: found.position[2] } : at, next, heading };
  });
}

type GuardStart = ReturnType<typeof startsOf>[number] & { key: string };

/** Spawned at their start in an `mtf` skin facing along the patrol, else walked there */
async function postGuard(ctx: Ctx, g: GuardStart, i: number) {
  const { w } = ctx.ct;
  if (w.n[g.key] === undefined) {
    return void (await w.npc.spawn({ npcKey: g.key, at: g.at, facing: along(g.at, g.heading), as: `mtf-${i % 3}` }));
  }
  if ((await goTo({ ...ctx, npcKey: g.key }, g.at)) === false) throw Error(`${g.key}: blocked from their start`);
}

/**
 * Until killed, each tick: every guard walks, stops, looks left, looks right, or is halted — see `docs/npc-graphs.md`.
 * One loop for all, so a kill or a pause holds them at once
 */
async function walkPatrol(
  ctx: Ctx,
  patrol: { key: string; watch: string[]; say: string },
  route: Route,
  starts: GuardStart[],
) {
  const { ct } = ctx;
  const { w } = ct;
  const pts = route.map((step) => step.at);
  const guards = starts.map((s) => ({
    ...s,
    phase: "walk" as GuardPhase,
    /** Game seconds the phase began */
    since: 0,
    move: null as null | GuardMove,
    /** Who they halted for */
    seen: null as null | string,
    /** By whom they saw, game seconds last seen */
    sightings: new Map<string, number>(),
  }));
  type Guard = (typeof guards)[number];

  const walk = (g: Guard, now: number) => {
    const npc = w.npc.get(g.key);
    const to = pts[g.next];
    g.heading = Math.atan2(to.y - npc.point.y, to.x - npc.point.x);
    const move: GuardMove = { result: undefined, from: { ...npc.point }, at: now };
    w.e.move({ npcKey: g.key, to }).then(
      () => void (move.result = true),
      (e) => void (move.result = e instanceof Error ? (walkEnds[e.message] ?? e) : Error(String(e))),
    );
    [g.phase, g.since, g.move] = ["walk", now, move];
  };
  const advance = (g: Guard) => void (g.next = (g.next + 1) % pts.length);
  const face = (g: Guard, angle: number) => w.n[g.key]?.look({ at: along(w.n[g.key].point, angle) }).catch(noop);

  const distracted = new Set<string>();
  const sub = w.events.subscribe({
    next(e) {
      if (e.key === "psi-action" && e.action === "distract") distracted.add(e.npcKey);
    },
  });
  for (const g of guards) walk(g, w.gameTime.now());
  try {
    while (true) {
      await waitSecs(ctx, guardTickSecs);
      const now = w.gameTime.now();
      for (const g of guards) {
        if (w.n[g.key] === undefined) throw Error(`${g.key}: gone`);
        const done = distracted.delete(g.key);
        const { stop, uTurn } = route[g.next];
        const look = (stop.lookDeg * Math.PI) / 180;
        switch (g.phase) {
          case "walk": {
            const move = g.move as GuardMove;
            const npc = w.npc.get(g.key);
            if (move.result === undefined) {
              if (now - move.at < stall.secs) break;
              if (npc.distanceTo(move.from) < stall.dist) npc.rejectAll(Error("blocked"));
              [move.from, move.at] = [{ ...npc.point }, now];
            } else if (move.result === "paused" || move.result === "again") {
              walk(g, now);
            } else if (move.result instanceof Error) {
              throw move.result;
            } else if (move.result === false) {
              ct.api.writeInfo(`${g.key}: blocked from point ${g.next}`);
              advance(g);
              walk(g, now);
            } else {
              [g.phase, g.since] = ["stop", now];
              face(g, g.heading);
            }
            break;
          }
          case "stop":
            if (done || now - g.since >= stop.secs) {
              if (uTurn) advance(g), walk(g, now);
              else ([g.phase, g.since] = ["left", now]), face(g, g.heading + look);
            }
            break;
          case "left":
            if (done || now - g.since >= stop.lookSecs)
              ([g.phase, g.since] = ["right", now]), face(g, g.heading - look);
            break;
          case "right":
            if (done || now - g.since >= stop.lookSecs) advance(g), walk(g, now);
            break;
          case "halt": {
            const seenAt = g.sightings.get(g.seen as string) ?? -Infinity;
            if (now - seenAt > guardLoseSecs) {
              const npc = w.npc.get(g.key);
              g.next = pts.reduce((best, p, i) => (npc.distanceTo(p) < npc.distanceTo(pts[best]) ? i : best), 0);
              g.seen = null;
              walk(g, now);
            }
            break;
          }
        }
      }

      const keys = guards.map((g) => g.key);
      const watched = (patrol.watch.length > 0 ? patrol.watch : [w.player.key]).filter(
        (key): key is string => key !== undefined && w.n[key] !== undefined && keys.includes(key) === false,
      );
      if (watched.length === 0) continue;
      const pairs = keys.flatMap((a) => watched.map((b): [string, string] => [a, b]));
      for (const [key, seen] of await settled(ctx, perceive(ct, pairs, false))) {
        const g = guards[keys.indexOf(key)];
        const fresh = now - (g.sightings.get(seen) ?? -Infinity) > guardLoseSecs;
        g.sightings.set(seen, now);
        if (fresh) w.events.next({ key: "guard-spotted", npcKey: key, seen, graph: patrol.key || null });
        if (patrol.say === "") continue;
        if (g.phase !== "halt") {
          [g.phase, g.since, g.seen] = ["halt", now, seen];
          g.move = null;
          w.npc.get(key).rejectAll(Error("halt"));
          w.speech.say(key, patrol.say, guardSaySecs);
        }
        if (g.seen === seen) w.n[key]?.look({ at: seen }).catch(noop);
      }
    }
  } finally {
    sub.unsubscribe();
  }
}

type GuardPhase = "walk" | "stop" | "left" | "right" | "halt";
/** A move in flight, not awaited: `result` once it ends, and where and when they last made headway */
type GuardMove = { result: undefined | boolean | "paused" | "again" | Error; from: Geom.VectJson; at: number };

/** A metre from `p` at `angle` */
const along = (p: Geom.VectJson, angle: number) => ({ x: p.x + Math.cos(angle), y: p.y + Math.sin(angle) });

const noop = () => {};

/**
 * Each npc to their plan at once, `place` saying whether they got there. Those with none stay where they stand.
 * Once the rest are done, those with none or who fell short are named, e.g. `not parked: kate, rob blocked`
 */
async function placeAll<P>(
  ctx: Ctx,
  done: string,
  npcs: JshCli.Npc[],
  plans: (null | P)[],
  place: (npc: JshCli.Npc, plan: P) => Promise<boolean>,
) {
  const reached = await ctx.task.wait(
    Promise.all(npcs.map((npc, i) => (plans[i] === null ? false : place(npc, plans[i])))),
  );
  const missed = npcs.flatMap((npc, i) =>
    plans[i] === null ? [npc.key] : reached?.[i] === false ? [`${npc.key} blocked`] : [],
  );
  if (missed.length > 0) throw Error(`not ${done}: ${missed.join(", ")}`);
}

/** Walks them to `at` unless they are there already: whether they got there */
async function walkTo(ctx: Ctx, npc: JshCli.Npc, at: Geom.VectJson) {
  return npc.distanceTo(at) <= standConfig.parkMinMove || (await goTo({ ...ctx, npcKey: npc.key }, at));
}

/** `pad`'s room from `walls` and from `npcs`, else `by`: each defaults to `standConfig.padClearance` */
function padBy(opts: Opts): { walls: number; npcs: number } {
  const { walls, npcs } = standConfig.padClearance;
  return { walls: Number(opts.walls ?? walls), npcs: Number(opts.npcs ?? opts.by ?? npcs) };
}

/** An npc's point, a point, else one `by` metres from them a random way */
function nudgeFrom(ctx: Ctx, from: unknown, by: number): Geom.VectJson {
  const { w } = ctx.ct;
  if (typeof from === "string") return w.npc.get(from).point;
  if (from !== undefined) return w.helper.parseGroundPoint(from as JshCli.PointAnyFormat);
  const { x, y } = w.npc.get(ctx.npcKey).point;
  const angle = Math.random() * 2 * Math.PI;
  return { x: x + by * Math.cos(angle), y: y + by * Math.sin(angle) };
}

/** What `promise` resolves, unless the task is cancelled: with no timeout it never gives `undefined` */
const settled = <T>(ctx: Ctx, promise: Promise<T>) => ctx.task.wait(promise) as Promise<T>;

/** What `start` resolves, started again once resumed whenever a pause rejects it */
async function resumable<T>(ctx: Ctx, start: () => Promise<T>): Promise<T> {
  while (true) {
    const ended = await settled(
      ctx,
      start().then(
        (value) => ({ value }),
        (e) => (isPaused(e) ? null : Promise.reject(e)),
      ),
    );
    if (ended !== null) return ended.value;
    await ctx.task.wait(ctx.ct.api.awaitResume());
  }
}

/** `hide` or `avoid`: `strict` judges their whole region, their room's doors open, else the spot alone */
async function hideFrom(ctx: Ctx, opts: Opts, strict: boolean) {
  if ((await seenWhy(ctx, opts, strict)) === null) return;
  await getUp(ctx);
  /** Spots they were blocked from */
  const blocked: string[] = [];
  for (let i = 0; i < hideTries; i++) {
    const spot = await hidingSpot(ctx, opts, blocked, strict);
    if (spot === null) throw Error("no hiding spot");
    if ((await goTo(ctx, spot)) === false) {
      blocked.push(spot.key);
      continue;
    }
    const why = await seenWhy(ctx, opts, strict);
    if (why === null) return;
    throw Error(`seen at ${spot.key}: ${why}`);
  }
  throw Error(`blocked from ${blocked.join(",")}`);
}

/** A spot none of `from` sees, skipping those others nearby stand at or head for. `null` if there is none */
async function hidingSpot(ctx: Ctx, opts: Opts, skip: string[], strict: boolean) {
  const { w } = ctx.ct;
  /** Only those within two doors: hiding spots are tried nearest first */
  const others = w.e.getNpcsInReach(ctx.npcKey, 2);
  const headed = others.flatMap((npc) => (npc.isMoving() ? [npc.last.dst] : []));
  const taken = await spotQuery(ctx.ct, [
    ...others.map((npc): WW.SpotQuery => ({ q: "of", npc: npc.key })),
    ...headed.map((point): WW.SpotQuery => ({ q: "at", point: { x: point.x, y: point.y } })),
  ]);
  const exclude = taken.filter(isSpot).map((s) => s.key);
  const [spot] = await spotQuery(ctx.ct, [
    {
      q: "hide",
      npc: ctx.npcKey,
      from: fromKeys(ctx, opts),
      rooms: keysOf(opts.rooms),
      prefer: keysOf(opts.prefer),
      exclude: [...exclude, ...skip],
      away: opts.away === undefined ? undefined : Number(opts.away),
      ahead: aheadOf(ctx, opts),
      strict,
    },
  ]);
  return isSpot(spot) ? spot : null;
}

/**
 * Why `from` may see them, or they are within `away` metres, else `null`. By lines from their eyes, as `sees --los`.
 * `strict`, by the lists over every spot they are at, their rooms' doors open, also from where `from` are headed
 */
async function seenWhy(ctx: Ctx, opts: Opts, strict: boolean) {
  const { w } = ctx.ct;
  const npc = w.npc.get(ctx.npcKey);
  const from = fromKeys(ctx, opts);
  const near = from.find((key) => npc.distanceTo(w.n[key].point) < Number(opts.away ?? 0));
  if (near !== undefined) return `within ${opts.away}m of ${near}`;
  if (strict === false) return seenBy(ctx, from);
  const [answer] = await spotQuery(ctx.ct, [{ q: "hidden", npc: ctx.npcKey, from, ahead: aheadOf(ctx, opts) }]);
  if (answer == null || !("hidden" in answer)) return "not answered";
  if (answer.hidden) return null;
  return answer.seen.map(({ spot, metres, by }) => `${by} may see ${spot}, ${metres.toFixed(1)}m off`).join("; ");
}

/** Which of `from` sees them now, and how, whichever way they face: `null` if none */
async function seenBy(ctx: Ctx, from: string[]) {
  const answers = await spotQuery(
    ctx.ct,
    from.map((a): WW.SpotQuery => ({ q: "explain", a, b: ctx.npcKey })),
  );
  for (const [i, x] of answers.entries()) {
    if (x == null || !("lines" in x) || x.sees === false) continue;
    const clear = x.lines.findIndex((line) => line.hit === null);
    return `${from[i]} sees them, ${x.settled === "lines" ? `ray ${["direct", "right", "left"][clear]}` : x.settled}`;
  }
  return null;
}

/** Where any of `from` are walking to */
function aheadOf(ctx: Ctx, opts: Opts) {
  const { w } = ctx.ct;
  return fromKeys(ctx, opts).flatMap((key) =>
    w.n[key].isMoving() ? [{ x: w.n[key].last.dst.x, y: w.n[key].last.dst.y }] : [],
  );
}

/** The npcs `from` names, but this one */
function fromKeys(ctx: Ctx, opts: Opts) {
  const from = keysOf(opts.from);
  if (from === undefined) throw Error("expected from:<npcs>");
  return from.filter((key) => key !== ctx.npcKey && ctx.ct.w.n[key] !== undefined);
}

/** Off a seat or bed onto the floor beside it: a move from there would fade them all the way */
async function getUp(ctx: Ctx) {
  const { w } = ctx.ct;
  if (typeof w.npc.npcToDoable[ctx.npcKey] !== "string") return;
  const npc = w.npc.get(ctx.npcKey);
  const near = w.npc.getClosestPoly(npc.point, 4);
  if (near.success === false) throw Error("nowhere to stand");
  await resumable(ctx, () => npc.fadeSpawn({ at: { x: near.position[0], y: near.position[2] } }));
}

/**
 * Walks there, giving up once they stall or are stuck, e.g. blocked by the player. Resolves whether they arrived.
 * Stopped by a pause, they walk on once resumed
 */
async function goTo(ctx: Ctx, at: Geom.VectJson) {
  const { api, w } = ctx.ct;
  const npc = w.npc.get(ctx.npcKey);
  const walk = () =>
    w.e.move({ npcKey: ctx.npcKey, to: { x: at.x, y: at.y } }).then(
      () => true as const,
      (e) => (e instanceof Error ? walkEnds[e.message] : undefined) ?? Promise.reject(e),
    );
  let move = walk();
  for (let from = npc.point; ; from = npc.point) {
    const arrived = await ctx.task.wait(move, 1000 * stall.secs);
    if (arrived === "again") {
      move = walk();
    } else if (arrived === "paused") {
      await ctx.task.wait(api.awaitResume());
      move = walk();
    } else if (arrived !== undefined) {
      return arrived;
    } else if (npc.distanceTo(from) < stall.dist) {
      npc.rejectAll(Error("blocked"));
      return (await move) === true;
    }
  }
}

/** Waits game seconds, unless cancelled */
function waitSecs(ctx: Ctx, secs: number) {
  return ctx.task.wait(undefined, 1000 * secs);
}

/** A point a metre from them towards their spot's nearest occluder */
async function wallPoint(ctx: Ctx) {
  const [spot] = await spotQuery(ctx.ct, [{ q: "of", npc: ctx.npcKey }]);
  if (isSpot(spot) === false) return null;
  const { x, y } = ctx.ct.w.npc.get(ctx.npcKey).point;
  return { x: x + Math.cos(spot.wall), y: y + Math.sin(spot.wall) };
}

/** An npc's point, else a spot's: `null` if `at` is neither */
async function facingPoint(ctx: Ctx, at: string): Promise<null | Geom.VectJson> {
  const npc = ctx.ct.w.n[at];
  if (npc !== undefined) return npc.point;
  if (spotKeyRe.test(at) === false) return null;
  const [spot] = await spotQuery(ctx.ct, [{ q: "get", key: at }]);
  return isSpot(spot) ? { x: spot.x, y: spot.y } : null;
}

/** A list from an array or `a,b,c`, e.g. `rooms:g0r1,g0r2`, `npcs:$( [] guard-{0..1} )` */
const keysOf = (x: Opts[string]) =>
  Array.isArray(x) ? x.map(String) : typeof x === "string" ? x.split(",") : undefined;

/** How a walk ends besides arriving, by its error: given up on, stopped by a pause, or cut short by a look and walked again */
const walkEnds: Partial<Record<string, false | "paused" | "again">> = {
  blocked: false,
  stuck: false,
  paused: "paused",
  "look again": "again",
};
/** Below this, a nudge slid short against something is no move at all */
const nudgeMinMove = 0.05;
/** Spots `hide` tries, each it is blocked from skipped, before failing */
const hideTries = 3;
/** Metres between the points along a route where a guard might start, at least */
const guardStartStep = 0.25;
/** At most this many points along a route where a guard might start */
const guardStartSamples = 400;
/** Game seconds between a patrol's ticks: their checks for whom they watch */
const guardTickSecs = 0.25;
/** Game seconds unseen before a halted guard walks on, and before a sighting is told again */
const guardLoseSecs = 3;
/** Seconds a halted guard's words stay over their head */
const guardSaySecs = 3;
/** Under `dist` metres walked in `secs` of game time is a stall */
const stall = { secs: 2, dist: 0.3 };

/**
 * Where `park` and `pad` stand npcs. `as const` is load-bearing: `plan.worker` keeps typed copies
 * of these, and only literal types make a drifted copy a compile error
 */
export const standConfig = {
  /** Below this much of a move, `park` turns them on the spot instead */
  parkMinMove: 0.02,
  /** How far out `park` looks for a wall to stand against */
  parkQueryRange: 2,
  /** How much room `pad` wants round them by default, from walls and doorways, and from others */
  padClearance: { walls: 0.3, npcs: 0.6 },
  /** How far from where they stand `pad` looks for such a spot */
  padQueryRange: 3,
  /** How far clear of a door somebody must stand to be out of the traffic through it */
  doorwayClearance: 0.6,
} as const;
