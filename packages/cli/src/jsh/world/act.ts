import { type RouteEntry, RouteEntrySchema } from "@npc-cli/ui__world/scenario.schema";
import { spotKeyRe } from "@npc-cli/ui__world/spot.schema";
import { Task } from "@npc-cli/util";
import { Vect } from "@npc-cli/util/geom";
import { perceive, spotQuery } from "./perception.main";
import { isPaused, npcQuery, parkedNow, requestDetached, roomOthers } from "./plan.main";
import { padded, parked } from "./pred";
import { routes } from "./scenario";

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
 * act kate nudge:rob
 * act guard route:basic-route
 * act guard cycle:$( pick 4 ) guard-0,guard-1 custom
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
  const several =
    severalVerbs.has(verb) || npclessVerbs.has(verb)
      ? args.filter((arg) => arg.includes(":") === false && verbFlags[verb]?.has(arg) !== true)
      : [];
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
    // paused by more than the World, which holds them itself, they stop, to go on once resumed. A fade finishes
    onSuspend: () => (
      ct.api.isHeldOnlyBy("world") === false && fadeVerbs.has(verb) === false && rejectAll(Error("paused")), true
    ),
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
/** Verbs whose npcs, if any, follow as `rob,kate`: they add those they act with to `npcKeys` */
const npclessVerbs = new Set(["guard"]);
/** Bare options a verb takes, which are not npcs */
const verbFlags: Partial<Record<string, Set<string>>> = { guard: new Set(["custom"]) };
/** Verbs a pause lets finish, as `rejectAll` would zero their fade */
const fadeVerbs = new Set(["park", "pad"]);

/** What a verb runs with: its npc (the first of `npcKeys`), and a game-time task a kill cancels */
type Ctx = { ct: JshCli.RunArg; npcKey: string; npcKeys: string[]; task: Task };
type Opts = Record<string, undefined | string | number | boolean>;
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
   * `route:<slug>`, else `path:<points>` or `cycle:<points>`, then `[npcs]`: they walk it, stopping at each point to look either side.
   * Those absent are spawned. Seeing whom they watch, they emit `guard-spotted`, then halt and speak unless `custom`
   */
  async guard(ctx, opts) {
    const { ct } = ctx;
    const [cycle, path]: unknown[] = [opts.cycle, opts.path];
    const given = Array.isArray(cycle) ? cycle : Array.isArray(path) ? path : undefined;
    const saved =
      given === undefined
        ? await settled(ctx, routes.find(ct, opts.route))
        : RouteEntrySchema.parse({
            key: "",
            kind: "route",
            mapKey: ct.w.mapKey,
            points: await settled(ctx, routes.toPoints(ct, given)),
            cycle: Array.isArray(cycle),
          });
    const route: RouteEntry = {
      ...saved,
      watch: typeof opts.watch === "string" ? opts.watch.split(",") : saved.watch,
      say: typeof opts.say === "string" ? opts.say : saved.say,
      custom: typeof opts.custom === "boolean" ? opts.custom : saved.custom,
      stop: {
        secs: Number(opts.secs ?? saved.stop.secs),
        lookSecs: Number(opts.lookSecs ?? saved.stop.lookSecs),
        lookDeg: Number(opts.lookDeg ?? saved.stop.lookDeg),
      },
    };
    if (ctx.npcKeys.length === 0) ctx.npcKeys.push(route.npcKey ?? "guard-0");
    const guards = startsOf(ct.w, route, ctx.npcKeys.length).map((start, i) => ({ key: ctx.npcKeys[i], ...start }));
    await settled(ctx, Promise.all(guards.map((g, i) => postGuard(ctx, g, i))));
    await patrol(ctx, route, guards);
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
  /** `[by:<m>]`: where there is room to walk right round them, `by` metres from walls, doorways and others */
  async pad(ctx, opts) {
    const { w } = ctx.ct;
    const npcs = ctx.npcKeys.map((key) => w.npc.get(key));
    const by = opts.by === undefined ? standConfig.padClearance : Number(opts.by);
    const op = { key: "pad", npcs: npcs.map((npc) => npcQuery(w, npc)), others: roomOthers(w, npcs), by } as const;
    const plans = await settled(ctx, requestDetached(w, op));
    await placeAll(ctx, "padded", npcs, plans, async (npc, { at }) => {
      if (npc.distanceTo(at) > standConfig.parkMinMove) await npc.fadeSpawn({ at, angle: npc.rotation.y });
      padded.mark(npc.key);
    });
  },
  /** Against a nearby wall, clear of its corners, the room's doorways and others parked — see `pred.ts` */
  async park(ctx) {
    const { w } = ctx.ct;
    const npcs = ctx.npcKeys.map((key) => w.npc.get(key));
    const op = { key: "park", npcs: npcs.map((npc) => npcQuery(w, npc)), parked: parkedNow(w) } as const;
    const plans = await settled(ctx, requestDetached(w, op));
    await placeAll(ctx, "parked", npcs, plans, async (npc, { at, facing, seg }) => {
      // hurt, they cannot look: a respawn turns them, and keeps the hurt clip
      if (npc.distanceTo(at) > standConfig.parkMinMove || npc.anim.hurt !== null) await npc.fadeSpawn({ at, facing });
      else await npc.look({ at: facing });
      parked.mark(npc.key, seg);
    });
  },
};

/** Where each of `count` guards starts, spaced evenly round a cycle, else along a path there and back */
function startsOf(w: JshCli.WorldState, route: RouteEntry, count: number) {
  const pts = route.points.map(([x, y]) => ({ x, y }));
  // the legs walked in one round: a path's back the same way
  const order = route.cycle ? [...pts.keys(), 0] : [...pts.keys(), ...[...pts.keys()].reverse().slice(1)];
  const legs = order
    .slice(1)
    .map((to, i) => ({ from: order[i], to, len: Vect.distanceBetween(pts[order[i]], pts[to]) }));
  const total = legs.reduce((sum, leg) => sum + leg.len, 0);
  return Array.from({ length: count }, (_, k) => {
    let s = (k * total) / count;
    const leg = legs.find((leg) => (s -= leg.len) < 0) ?? legs[0];
    const t = leg.len === 0 ? 0 : 1 + s / leg.len;
    const [a, b] = [pts[leg.from], pts[leg.to]];
    const at = { x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) };
    const found = w.npc.getClosestPoly(at, 0.5);
    return {
      at: found.success ? { x: found.position[0], y: found.position[2] } : a,
      next: leg.to,
      dir: (route.cycle || leg.to > leg.from ? 1 : -1) as 1 | -1,
      heading: Math.atan2(b.y - a.y, b.x - a.x),
    };
  });
}

type GuardStart = ReturnType<typeof startsOf>[number] & { key: string };

/** Spawned at their start in an `mtf` skin facing along the route, else walked there */
async function postGuard(ctx: Ctx, g: GuardStart, i: number) {
  const { w } = ctx.ct;
  if (w.n[g.key] === undefined) {
    return void (await w.npc.spawn({ npcKey: g.key, at: g.at, facing: along(g.at, g.heading), as: `mtf-${i % 3}` }));
  }
  if ((await goTo({ ...ctx, npcKey: g.key }, g.at)) === false) throw Error(`${g.key}: blocked from their start`);
}

/**
 * Until killed, each tick: every guard walks, stops, looks left, looks right, or is halted — see `docs/scenarios.md`.
 * One loop for all, so a kill or a pause holds them at once
 */
async function patrol(ctx: Ctx, route: RouteEntry, starts: GuardStart[]) {
  const { ct } = ctx;
  const { w } = ct;
  const pts = route.points.map(([x, y]) => ({ x, y }));
  const { secs, lookSecs, lookDeg } = route.stop;
  const look = (lookDeg * Math.PI) / 180;
  const isEnd = (i: number) => route.cycle === false && (i === 0 || i === pts.length - 1);
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
  /** The next point: round a cycle, else turning back at a path's end */
  const advance = (g: Guard) => {
    if (route.cycle) return void (g.next = (g.next + g.dir + pts.length) % pts.length);
    if (g.next + g.dir < 0 || g.next + g.dir >= pts.length) g.dir = -g.dir as 1 | -1;
    g.next += g.dir;
  };
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
        switch (g.phase) {
          case "walk": {
            const move = g.move as GuardMove;
            const npc = w.npc.get(g.key);
            if (move.result === undefined) {
              if (now - move.at < stall.secs) break;
              if (npc.distanceTo(move.from) < stall.dist) npc.rejectAll(Error("blocked"));
              [move.from, move.at] = [{ ...npc.point }, now];
            } else if (move.result === "paused") {
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
            if (done || now - g.since >= secs) {
              if (isEnd(g.next)) advance(g), walk(g, now);
              else ([g.phase, g.since] = ["left", now]), face(g, g.heading + look);
            }
            break;
          case "left":
            if (done || now - g.since >= lookSecs) ([g.phase, g.since] = ["right", now]), face(g, g.heading - look);
            break;
          case "right":
            if (done || now - g.since >= lookSecs) advance(g), walk(g, now);
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
      const watched = (route.watch.length > 0 ? route.watch : [w.player.key]).filter(
        (key): key is string => key !== undefined && w.n[key] !== undefined && keys.includes(key) === false,
      );
      if (watched.length === 0) continue;
      const pairs = keys.flatMap((a) => watched.map((b): [string, string] => [a, b]));
      for (const [key, seen] of await settled(ctx, perceive(ct, pairs, false))) {
        const g = guards[keys.indexOf(key)];
        const fresh = now - (g.sightings.get(seen) ?? -Infinity) > guardLoseSecs;
        g.sightings.set(seen, now);
        if (fresh) w.events.next({ key: "guard-spotted", npcKey: key, seen, route: route.key || null });
        if (route.custom) continue;
        if (g.phase !== "halt") {
          [g.phase, g.since, g.seen] = ["halt", now, seen];
          g.move = null;
          w.npc.get(key).rejectAll(Error("halt"));
          w.speech.say(key, route.say, guardSaySecs);
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
type GuardMove = { result: undefined | boolean | "paused" | Error; from: Geom.VectJson; at: number };

/** A metre from `p` at `angle` */
const along = (p: Geom.VectJson, angle: number) => ({ x: p.x + Math.cos(angle), y: p.y + Math.sin(angle) });

const noop = () => {};

/** Each npc to their plan at once. Those with none are left where they stand, and named once the rest are done */
async function placeAll<P>(
  ctx: Ctx,
  done: string,
  npcs: JshCli.Npc[],
  plans: (null | P)[],
  place: (npc: JshCli.Npc, plan: P) => Promise<void>,
) {
  await ctx.task.wait(Promise.all(npcs.map((npc, i) => (plans[i] === null ? undefined : place(npc, plans[i])))));
  const leftOut = npcs.filter((_, i) => plans[i] === null);
  if (leftOut.length > 0) throw Error(`not ${done}: ${leftOut.map((npc) => npc.key).join(" ")}`);
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
      rooms: csv(opts.rooms),
      prefer: csv(opts.prefer),
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
  if (typeof opts.from !== "string") throw Error("expected from:<npcs>");
  return opts.from.split(",").filter((key) => key !== ctx.npcKey && ctx.ct.w.n[key] !== undefined);
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
    if (arrived === "paused") {
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

function isSpot(answer: undefined | WW.SpotAnswer): answer is WW.SpotJson {
  return answer != null && !Array.isArray(answer) && "x" in answer;
}

/** `a,b,c` as a list, e.g. `rooms:g0r1,g0r2` */
const csv = (x: Opts[string]) => (typeof x === "string" ? x.split(",") : undefined);

/** How a walk ends besides arriving, by its error: given up on, or stopped by a pause */
const walkEnds: Partial<Record<string, false | "paused">> = { blocked: false, stuck: false, paused: "paused" };
/** Below this, a nudge slid short against something is no move at all */
const nudgeMinMove = 0.05;
/** Spots `hide` tries, each it is blocked from skipped, before failing */
const hideTries = 3;
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
  /** How much room `pad` wants round them, from walls and from the parked or padded */
  padClearance: 0.6,
  /** How far from where they stand `pad` looks for such a spot */
  padQueryRange: 3,
  /** How far clear of a door somebody must stand to be out of the traffic through it */
  doorwayClearance: 0.6,
} as const;
