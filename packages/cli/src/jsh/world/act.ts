import { Task } from "@npc-cli/util";
import { spotQuery } from "./plan.main";

/**
 * An npc acting on the spots about them, until done or killed — see `docs/scenarios.md`.
 * `from` names npcs, comma-separated. `rooms` limits the spots, else the whole map
 *
 * ```sh
 * act count rob to:10
 * act face rob wall
 * act hide cal from:rob away:6 prefer:cover,corner
 * ```
 */
export async function act(ct: JshCli.RunArg) {
  const [verb, npcKey, ...args] = ct.args;
  const run = verb === undefined ? undefined : verbs[verb];
  if (run === undefined || npcKey === undefined) {
    throw Error(`usage: act {${Object.keys(verbs).join(",")}} <npc> …`);
  }
  ct.w.npc.get(npcKey);
  const task = new Task(
    () => false,
    () => 1000 * ct.w.gameTime.now(),
  );
  const handlers = ct.api.handleStatus({
    cleanup: () => (task.cancel(), ct.w.n[npcKey]?.rejectAll(Error("killed"))),
  });
  try {
    await task.run(() => run({ ct, npcKey, task }, ct.api.jsArg(args) as Opts, args));
  } finally {
    handlers.dispose();
  }
}

/** What a verb runs with: its npc, and a game-time task a kill cancels */
type Ctx = { ct: JshCli.RunArg; npcKey: string; task: Task };
type Opts = Record<string, undefined | string | number | boolean>;
type Verb = (ctx: Ctx, opts: Opts, args: string[]) => Promise<void>;

const verbs: Record<string, Verb> = {
  /** `to:<n> [every:<secs>]`: says each number in turn, a game second apart unless `every` says */
  async count(ctx, opts) {
    for (let i = 1; i <= Number(opts.to ?? 10); i++) {
      ctx.ct.w.speech.say(ctx.npcKey, `${i}`);
      await waitSecs(ctx, Number(opts.every ?? 1));
    }
  },
  /** `wall`, towards their spot's nearest occluder; else an npc or a spot key */
  async face(ctx, _, [at]) {
    const point = at === undefined ? null : at === "wall" ? await wallPoint(ctx) : await facingPoint(ctx, at);
    if (point === null) throw Error(`face ${at ?? ""}: not wall, npc or spot`);
    await ctx.task.wait(ctx.ct.w.npc.get(ctx.npcKey).look({ at: point }));
  },
  /**
   * `from:<npcs> [prefer:<kinds>] [away:<m>]`: to a spot none of them sees, `away` metres from them if one is.
   * Spots others stand at or head for are skipped. Already hidden, they stay put
   */
  async hide(ctx, opts) {
    if (await isHidden(ctx, opts)) return;
    /** Spots they were blocked from */
    const blocked: string[] = [];
    for (let i = 0; i < hideTries; i++) {
      const spot = await hidingSpot(ctx, opts, blocked);
      if (spot === null) throw Error("no hiding spot");
      if (await goTo(ctx, spot)) return;
      blocked.push(spot.key);
    }
    throw Error("blocked");
  },
};

/** A spot none of `from` sees, skipping those others nearby stand at or head for. `null` if there is none */
async function hidingSpot(ctx: Ctx, opts: Opts, avoid: string[]) {
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
      exclude: [...exclude, ...avoid],
      away: opts.away === undefined ? undefined : Number(opts.away),
    },
  ]);
  return isSpot(spot) ? spot : null;
}

/** Unseen by `from`, where they stand or are headed, and `away` metres from them if asked */
async function isHidden(ctx: Ctx, opts: Opts) {
  const { w } = ctx.ct;
  const npc = w.npc.get(ctx.npcKey);
  const watchers = fromKeys(ctx, opts);
  if (watchers.some((key) => npc.distanceTo(w.n[key].point) < Number(opts.away ?? 0))) return false;
  const headed = watchers.flatMap((key) => (w.n[key].isMoving() ? [w.n[key].last.dst] : []));
  const ahead =
    headed.length === 0
      ? []
      : await spotQuery(
          ctx.ct,
          headed.map((point): WW.SpotQuery => ({ q: "at", point: { x: point.x, y: point.y } })),
        );
  const answers = await spotQuery(
    ctx.ct,
    [...watchers, ...ahead.filter(isSpot).map((s) => s.key)].map(
      (a): WW.SpotQuery => ({ q: "sees", a, b: ctx.npcKey }),
    ),
  );
  return answers.every((x) => x == null || !("crouchHides" in x) || x.sees === false);
}

/** The npcs `from` names, but this one */
function fromKeys(ctx: Ctx, opts: Opts) {
  if (typeof opts.from !== "string") throw Error("expected from:<npcs>");
  return opts.from.split(",").filter((key) => key !== ctx.npcKey && ctx.ct.w.n[key] !== undefined);
}

/** Walks there, giving up once they stall or are stuck, e.g. blocked by the player. Resolves whether they arrived */
async function goTo(ctx: Ctx, at: Geom.VectJson) {
  const npc = ctx.ct.w.npc.get(ctx.npcKey);
  const move = ctx.ct.w.e.move({ npcKey: ctx.npcKey, to: { x: at.x, y: at.y } }).then(
    () => true,
    (e) => (e instanceof Error && (e.message === "blocked" || e.message === "stuck") ? false : Promise.reject(e)),
  );
  for (let from = npc.point; ; from = npc.point) {
    const arrived = await ctx.task.wait(move, 1000 * stall.secs);
    if (arrived !== undefined) return arrived;
    if (npc.distanceTo(from) < stall.dist) {
      npc.rejectAll(Error("blocked"));
      return move;
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

/** Spots `hide` tries, each it is blocked from skipped, before failing */
const hideTries = 3;
/** Under `dist` metres walked in `secs` of game time is a stall */
const stall = { secs: 2, dist: 0.3 };
