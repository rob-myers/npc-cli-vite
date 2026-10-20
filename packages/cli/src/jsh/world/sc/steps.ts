import type { ScenarioDef } from "@npc-cli/ui__world/scenario.schema";
import type { Task } from "@npc-cli/util";
import { spotQuery } from "../plan.main";
import type { ScInstance } from "./instance";

/** What a step runs with: its npc, its instance, and a game-time task cancelled by a kill or a change of cell */
export type StepCtx = { ct: JshCli.RunArg; npcKey: string; inst: ScInstance; def: ScenarioDef; task: Task };

/**
 * A cell's line, e.g. `go to:start`, run as `npcKey`. `$name` reads the definition's params — see `docs/scenarios.md`
 */
export async function runLine(ctx: StepCtx, line: string) {
  const [name, ...args] = line
    .replace(/\$(\w+)/g, (_, key: string) => String(ctx.def.params[key] ?? ""))
    .trim()
    .split(/\s+/);
  const step = steps[name];
  if (step === undefined) throw Error(`${name}: no such step`);
  await step(ctx, args);
}

/** A step of that name exists, e.g. `hide` */
export function isStep(name: string) {
  return Object.hasOwn(steps, name);
}

type Step = (ctx: StepCtx, args: string[]) => Promise<void>;

const steps: Record<string, Step> = {
  /** `go to:<place>`: a named place (`start`, `near-start`), a spot key, or an npc */
  async go(ctx, args) {
    const { to } = ctx.ct.api.jsArg(args) as { to?: string };
    if (to === undefined) throw Error("go: expected to:<place>");
    await goTo(ctx, await placePoint(ctx, to));
  },
  /** `face wall`, towards their spot's nearest occluder; else `face` an npc, the nearest of a role, or a spot key */
  async face(ctx, [at]) {
    const npc = ctx.ct.w.npc.get(ctx.npcKey);
    const point = at === undefined ? null : at === "wall" ? await wallPoint(ctx) : await facingPoint(ctx, at);
    if (point === null) {
      throw Error(`face ${at ?? ""}: not wall, npc, role or spot`);
    }
    await ctx.task.wait(npc.look({ at: point }));
  },
  /** `pose eyes:shut`, `pose crouch`, `pose stand` */
  async pose(ctx, args) {
    const { anim } = ctx.ct.w.npc.get(ctx.npcKey);
    const opts = ctx.ct.api.jsArg(args) as { eyes?: string; crouch?: boolean; stand?: boolean };
    if (opts.eyes !== undefined) anim.setEyes(opts.eyes as Parameters<typeof anim.setEyes>[0]);
    if (opts.crouch === true) anim.setCrouch(2);
    if (opts.stand === true) anim.setCrouch(0);
  },
  /** `say <words>` */
  async say(ctx, words) {
    ctx.ct.w.speech.say(ctx.npcKey, words.join(" "));
  },
  /** `count to:<n> [every:<secs>]`: says each number in turn, a game second apart unless `every` says */
  async count(ctx, args) {
    const opts = ctx.ct.api.jsArg(args) as { to?: number; every?: number };
    const every = Number(opts.every ?? 1);
    for (let i = 1; i <= Number(opts.to ?? 10); i++) {
      ctx.ct.w.speech.say(ctx.npcKey, `${i}`);
      await waitSecs(ctx, every);
    }
  },
  /** `hide from:<role or npcs> [prefer:<kinds>]`: to a free spot of the area none of them sees, reserved for them */
  async hide(ctx, args) {
    const opts = ctx.ct.api.jsArg(args) as { from?: string; prefer?: string };
    if (opts.from === undefined) throw Error("hide: expected from:<role>");
    const spot = await reserveHidingSpot(ctx, opts.from, opts.prefer?.split(","));
    if (spot !== null) await goTo(ctx, spot);
  },
  /**
   * `stay hidden from:<role or npcs>`: every `perceiveSecs`, are they seen from where those stand or are headed?
   * Still so after `reactSecs`, they crouch behind cover if it hides them, else hide again
   */
  async stay(ctx, args) {
    const { from } = ctx.ct.api.jsArg(args) as { from?: string };
    if (from === undefined) throw Error("stay: expected hidden from:<role>");
    const anim = ctx.ct.w.npc.get(ctx.npcKey).anim;
    while (true) {
      await waitSecs(ctx, param(ctx, "perceiveSecs", 0.25));
      if ((await threat(ctx, from)) === null) continue;
      await waitSecs(ctx, param(ctx, "reactSecs", 0.6));
      const still = await threat(ctx, from);
      if (still === null) continue;
      if (still.crouchHides) {
        anim.setCrouch(2);
      } else {
        anim.setCrouch(0);
        const spot = await reserveHidingSpot(ctx, from, undefined, still.at);
        if (spot !== null) await goTo(ctx, spot);
      }
    }
  },
  /** `search`: to the spot seeing most of the area not yet seen, again and again. All seen, it starts over */
  async search(ctx) {
    const { ct, inst, npcKey } = ctx;
    while (true) {
      const [spot] = await spotQuery(ct, [{ q: "search", npc: npcKey, rooms: ctx.def.rooms, seen: inst.seen }]);
      if (isSpot(spot) === false) {
        inst.seen = [];
        await waitSecs(ctx, param(ctx, "perceiveSecs", 0.25));
        continue;
      }
      await goTo(ctx, spot);
      const [seen] = await spotQuery(ct, [{ q: "seenBy", a: spot.key }]);
      const keys = [spot.key, ...(Array.isArray(seen) ? seen.map((s) => s.key) : [])];
      inst.seen = [...new Set([...inst.seen, ...keys])];
    }
  },
};

/** Whether any of `role` sees their spot, from where they stand or are headed. `crouchHides`: crouching hides them from all */
async function threat(ctx: StepCtx, role: string) {
  const { w } = ctx.ct;
  const watchers = keysInRole(ctx, role).filter((key) => w.n[key] !== undefined);
  const headed = watchers.flatMap((key) => (w.n[key].isMoving() ? [w.n[key].last.dst] : []));
  const spots = await spotQuery(ctx.ct, [
    { q: "of", npc: ctx.npcKey },
    ...watchers.map((npc): WW.SpotQuery => ({ q: "of", npc })),
    ...headed.map((point): WW.SpotQuery => ({ q: "at", point: { x: point.x, y: point.y } })),
  ]);
  const [mine, ...theirs] = spots;
  if (isSpot(mine) === false) return null;
  const from = theirs.filter(isSpot).map((s) => s.key);
  const answers = await spotQuery(
    ctx.ct,
    from.map((a): WW.SpotQuery => ({ q: "sees", a, b: mine.key })),
  );
  const seeing = answers.filter((x) => x !== null && "crouchHides" in x && x.sees) as { crouchHides: boolean }[];
  return seeing.length === 0 ? null : { at: mine.key, crouchHides: seeing.every((x) => x.crouchHides) };
}

/** A free spot none of `role` sees, now reserved for this npc in place of any they held. `null` if there is none */
async function reserveHidingSpot(ctx: StepCtx, role: string, prefer?: string[], avoid?: string) {
  const { inst, npcKey } = ctx;
  const taken = Object.keys(inst.reserved).filter((key) => inst.reserved[key] !== npcKey);
  const [spot] = await spotQuery(ctx.ct, [
    {
      q: "hide",
      npc: npcKey,
      from: keysInRole(ctx, role),
      rooms: ctx.def.rooms,
      prefer,
      exclude: avoid === undefined ? taken : [...taken, avoid],
    },
  ]);
  if (isSpot(spot) === false) return null;
  for (const key of Object.keys(inst.reserved)) if (inst.reserved[key] === npcKey) delete inst.reserved[key];
  inst.reserved[spot.key] = npcKey;
  return spot;
}

/** Whom `from` names, but this npc: a role's npcs in the instance, else npcs by key, comma-separated */
function keysInRole(ctx: StepCtx, from: string) {
  const npcs = Object.values(ctx.inst.npcs);
  return from.split(",").flatMap((name) => {
    const inRole = npcs.flatMap((n) => (n.role === name ? n.key : []));
    return (inRole.length > 0 ? inRole : ctx.ct.w.n[name] !== undefined ? [name] : []).filter(
      (key) => key !== ctx.npcKey,
    );
  });
}

function goTo(ctx: StepCtx, at: Geom.VectJson) {
  return ctx.task.wait(ctx.ct.w.e.move({ npcKey: ctx.npcKey, to: { x: at.x, y: at.y } }));
}

/** Waits game seconds, unless cancelled */
function waitSecs(ctx: StepCtx, secs: number) {
  return ctx.task.wait(undefined, 1000 * secs);
}

function param(ctx: StepCtx, key: string, otherwise: number) {
  const value = Number(ctx.def.params[key]);
  return Number.isFinite(value) ? value : otherwise;
}

function isSpot(answer: undefined | WW.SpotAnswer): answer is WW.SpotJson {
  return answer != null && !Array.isArray(answer) && "x" in answer;
}

/** A point a metre from them towards their spot's nearest occluder */
async function wallPoint(ctx: StepCtx) {
  const [spot] = await spotQuery(ctx.ct, [{ q: "of", npc: ctx.npcKey }]);
  if (isSpot(spot) === false) return null;
  const { x, y } = ctx.ct.w.npc.get(ctx.npcKey).point;
  return { x: x + Math.cos(spot.wall), y: y + Math.sin(spot.wall) };
}

/** An npc's point, the nearest npc of a role's, else a spot's: `null` if `at` is none of them */
async function facingPoint(ctx: StepCtx, at: string): Promise<null | Geom.VectJson> {
  const { w } = ctx.ct;
  const from = w.npc.get(ctx.npcKey).point;
  const npcs = [w.n[at], ...keysInRole(ctx, at).map((key) => w.n[key])].filter((npc) => npc !== undefined);
  const nearest = npcs.sort((u, v) => u.distanceTo(from) - v.distanceTo(from))[0];
  if (nearest !== undefined) return { x: nearest.point.x, y: nearest.point.y };
  if (/^g\d+s\d+$/.test(at) === false) return null;
  const [spot] = await spotQuery(ctx.ct, [{ q: "get", key: at }]);
  return isSpot(spot) ? { x: spot.x, y: spot.y } : null;
}

/** A place's point: `near-start` is this npc's own, a named place its spot, else a spot key or an npc */
async function placePoint(ctx: StepCtx, place: string): Promise<Geom.VectJson> {
  const { inst, ct } = ctx;
  const key = inst.places[place === "near-start" ? `near-start:${ctx.npcKey}` : place] ?? place;
  const npc = ct.w.n[key];
  if (npc !== undefined) return { x: npc.point.x, y: npc.point.y };
  const [spot] = await spotQuery(ct, [{ q: "get", key }]);
  if (spot === null || spot === undefined || !("x" in spot)) throw Error(`${place}: no such place`);
  return { x: spot.x, y: spot.y };
}
