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
 * act lurk cal from:rob
 * act search rob rooms:g0r16,g0r12
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
   * Spots others stand at or head for are skipped
   */
  async hide(ctx, opts) {
    const spot = await hidingSpot(ctx, opts);
    if (spot !== null) await goTo(ctx, spot);
  },
  /**
   * `from:<npcs> [react:<secs>]`: every `perceiveSecs`, are they seen from where those stand or are headed?
   * Still so after `react`, they crouch behind cover if it hides them, else hide again
   */
  async lurk(ctx, opts) {
    const anim = ctx.ct.w.npc.get(ctx.npcKey).anim;
    while (true) {
      await waitSecs(ctx, perceiveSecs);
      if ((await threat(ctx, opts)) === null) continue;
      await waitSecs(ctx, Number(opts.react ?? 0.6));
      const still = await threat(ctx, opts);
      if (still === null) continue;
      if (still.crouchHides) {
        anim.setCrouch(2);
      } else {
        anim.setCrouch(0);
        const spot = await hidingSpot(ctx, opts, still.at);
        if (spot !== null) await goTo(ctx, spot);
      }
    }
  },
  /**
   * `[pause:<secs>]`: to the spot seeing most not yet seen, looking either side there, again and again.
   * All seen, it starts over
   */
  async search(ctx, opts) {
    const { ct, npcKey } = ctx;
    let seen: string[] = [];
    /** Spots they were blocked from, skipped until all is seen */
    const blocked = new Set<string>();
    while (true) {
      const [spot] = await spotQuery(ct, [
        { q: "search", npc: npcKey, rooms: rooms(opts), seen, exclude: [...blocked] },
      ]);
      if (isSpot(spot) === false) {
        seen = [];
        blocked.clear();
        await waitSecs(ctx, perceiveSecs);
        continue;
      }
      if ((await goTo(ctx, spot)) === false) {
        blocked.add(spot.key);
        continue;
      }
      await lookAround(ctx, spot, Number(opts.pause ?? 2));
      const [sees] = await spotQuery(ct, [{ q: "seenBy", a: spot.key }]);
      seen = [...new Set([...seen, spot.key, ...(Array.isArray(sees) ? sees.map((s) => s.key) : [])])];
    }
  },
};

/** A spot none of `from` sees, skipping those others stand at or head for. `null` if there is none */
async function hidingSpot(ctx: Ctx, opts: Opts, avoid?: string) {
  const { w } = ctx.ct;
  const others = Object.values(w.n).filter((npc) => npc.key !== ctx.npcKey);
  const headed = others.flatMap((npc) => (npc.isMoving() && npc.last.dst !== null ? [npc.last.dst] : []));
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
      rooms: rooms(opts),
      prefer: typeof opts.prefer === "string" ? opts.prefer.split(",") : undefined,
      exclude: avoid === undefined ? exclude : [...exclude, avoid],
      away: opts.away === undefined ? undefined : Number(opts.away),
    },
  ]);
  return isSpot(spot) ? spot : null;
}

/** Whether any of `from` sees their spot, from where they stand or are headed. `crouchHides`: crouching hides them from all */
async function threat(ctx: Ctx, opts: Opts) {
  const { w } = ctx.ct;
  const watchers = fromKeys(ctx, opts);
  const headed = watchers.flatMap((key) => (w.n[key].isMoving() ? [w.n[key].last.dst] : []));
  const [mine, ...theirs] = await spotQuery(ctx.ct, [
    { q: "of", npc: ctx.npcKey },
    ...watchers.map((npc): WW.SpotQuery => ({ q: "of", npc })),
    ...headed.map((point): WW.SpotQuery => ({ q: "at", point: { x: point.x, y: point.y } })),
  ]);
  if (isSpot(mine) === false) return null;
  const answers = await spotQuery(
    ctx.ct,
    theirs.filter(isSpot).map((s): WW.SpotQuery => ({ q: "sees", a: s.key, b: mine.key })),
  );
  const seeing = answers.filter((x) => x !== null && "crouchHides" in x && x.sees) as { crouchHides: boolean }[];
  return seeing.length === 0 ? null : { at: mine.key, crouchHides: seeing.every((x) => x.crouchHides) };
}

/** The npcs `from` names, but this one */
function fromKeys(ctx: Ctx, opts: Opts) {
  if (typeof opts.from !== "string") throw Error("expected from:<npcs>");
  return opts.from.split(",").filter((key) => key !== ctx.npcKey && ctx.ct.w.n[key] !== undefined);
}

/** Looks to either side of where `spot` faces, else of a random way, pausing `secs` in all */
async function lookAround(ctx: Ctx, spot: WW.SpotJson, secs: number) {
  const npc = ctx.ct.w.npc.get(ctx.npcKey);
  const facing = spot.facing ?? Math.random() * 2 * Math.PI;
  for (const side of [1, -1]) {
    const angle = facing + side * (0.5 + Math.random() * 0.6);
    await ctx.task.wait(npc.look({ at: { x: npc.point.x + Math.cos(angle), y: npc.point.y + Math.sin(angle) } }));
    await waitSecs(ctx, secs / 2);
  }
}

/** Walks there, giving up once they stall, e.g. blocked by the player. Resolves whether they arrived */
async function goTo(ctx: Ctx, at: Geom.VectJson) {
  const npc = ctx.ct.w.npc.get(ctx.npcKey);
  const move = ctx.ct.w.e.move({ npcKey: ctx.npcKey, to: { x: at.x, y: at.y } }).then(
    () => true,
    (e) => (e instanceof Error && e.message === "blocked" ? false : Promise.reject(e)),
  );
  for (let from = { ...npc.point }; ; from = { ...npc.point }) {
    const arrived = await ctx.task.wait(move, 1000 * stall.secs);
    if (arrived !== undefined) return arrived;
    if (Math.hypot(npc.point.x - from.x, npc.point.y - from.y) < stall.dist) {
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
  if (npc !== undefined) return { x: npc.point.x, y: npc.point.y };
  if (/^g\d+s\d+$/.test(at) === false) return null;
  const [spot] = await spotQuery(ctx.ct, [{ q: "get", key: at }]);
  return isSpot(spot) ? { x: spot.x, y: spot.y } : null;
}

function isSpot(answer: undefined | WW.SpotAnswer): answer is WW.SpotJson {
  return answer != null && !Array.isArray(answer) && "x" in answer;
}

const rooms = (opts: Opts) => (typeof opts.rooms === "string" ? opts.rooms.split(",") : undefined);

/** Game seconds between looks at what threatens them, or for a spot to search */
const perceiveSecs = 0.25;
/** Under `dist` metres walked in `secs` of game time is a stall */
const stall = { secs: 2, dist: 0.3 };
