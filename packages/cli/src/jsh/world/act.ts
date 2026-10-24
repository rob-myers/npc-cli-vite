import { Task } from "@npc-cli/util";
import { spotQuery } from "./perception.main";

/**
 * An npc acting on the spots about them, until done or killed — see `docs/scenarios.md`.
 * `from` names npcs, comma-separated. `rooms` limits the spots, else the whole map.
 * Npc first, a verb takes its main option as `<verb>:<value>`
 *
 * ```sh
 * act count rob to:10
 * act face rob wall
 * act hide cal from:rob away:6 prefer:cover,corner
 * act avoid cal from:rob
 * act cal avoid:rob away:3
 * act rob count:10
 * ```
 */
export async function act(ct: JshCli.RunArg) {
  const { verb, npcKey, args } = parseAct(ct.args);
  const found = verb === undefined ? undefined : verbs[verb];
  if (verb === undefined || found === undefined || npcKey === undefined) {
    const names = Object.keys(verbs).join(",");
    throw Error(`usage: act {${names}} <npc> …, or act <npc> {${names}}:<value> …`);
  }
  ct.w.npc.get(npcKey);
  ct.api.meta.stack.push(verb); // an error then names it, e.g. `act: hide: …`
  // its waits run down only whilst it runs
  const task = new Task(
    () => ct.api.isRunning() === false,
    () => 1000 * ct.w.gameTime.now(),
  );
  const handlers = ct.api.handleStatus({
    cleanup: () => (task.cancel(), ct.w.n[npcKey]?.rejectAll(Error("killed"))),
    // paused by more than the World, which holds them itself, they stop, to walk on once resumed
    onSuspend: () => (ct.api.isHeldOnlyBy("world") === false && ct.w.n[npcKey]?.rejectAll(Error("paused")), true),
  });
  try {
    await task.run(() => found({ ct, npcKey, task }, ct.api.jsArg(args) as Opts, args));
  } finally {
    handlers.dispose();
  }
}

/** `act <verb> <npc> …`, else `act <npc> <verb>:<value> …` as the args that verb takes */
function parseAct([first, ...rest]: string[]) {
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
};

/** What a verb runs with: its npc, and a game-time task a kill cancels */
type Ctx = { ct: JshCli.RunArg; npcKey: string; task: Task };
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
    await ctx.task.wait(ctx.ct.w.npc.get(ctx.npcKey).look({ at: point }));
  },
  /** As `avoid`, judged by every spot they will be at, their room's doors open: they open one going in, or stand by one */
  hide: (ctx, opts) => hideFrom(ctx, opts, true),
  /**
   * `from:<npcs> [prefer:<kinds>] [away:<m>]`: to a spot none of them sees, `away` metres from them if one is.
   * Spots others stand at or head for are skipped. Already unseen, they stay put, else they get up first.
   * Blocked, they try another. Seen on arrival, it fails saying why
   */
  avoid: (ctx, opts) => hideFrom(ctx, opts, false),
};

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
  return answer.hidden ? null : `their spots ${answer.seen.join(",")} may be seen`;
}

/** Which of `from` sees them now, and how, whichever way they face: `null` if none */
async function seenBy(ctx: Ctx, from: string[]) {
  const answers = await spotQuery(
    ctx.ct,
    from.map((a): WW.SpotQuery => ({ q: "explain", a, b: ctx.npcKey })),
  );
  for (const [i, x] of answers.entries()) {
    if (x == null || !("settled" in x) || x.sees === false) continue;
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
  await ctx.task.wait(npc.fadeSpawn({ at: { x: near.position[0], y: near.position[2] } }));
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
  if (/^g\d+s\d+$/.test(at) === false) return null;
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
/** Spots `hide` tries, each it is blocked from skipped, before failing */
const hideTries = 3;
/** Under `dist` metres walked in `secs` of game time is a stall */
const stall = { secs: 2, dist: 0.3 };
