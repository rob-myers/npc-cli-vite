/// <reference path="./worker/jsh-worker.d.ts" />

import { type ThemeName, themeApi } from "@npc-cli/theme";
import { warn } from "@npc-cli/util/legacy/generic";
import { createElement } from "react";
import { ansi } from "../../shell/const";
import { sharedFolder } from "../../shell/session";
import { npcQuery, requestDetached } from "./plan.main";
import { sidestepRules } from "./pred";
import {
  type SidestepBack,
  SidestepDebug,
  type SidestepDebugState,
  type SidestepReturns,
  type SidestepRule,
  type SidestepRules,
} from "./sidestep-debug";
import { heading, headingOf, pathOf, SidestepLookout, table } from "./sidestep-lookout";

/**
 * Npcs make way for a walker coming at them or held up by them
 * - idempotent since it attaches a keyed listener
 * - bare, it also prints its settings, which `on` leaves out
 * - chooses sidestep kind via its SkipNet pane
 * - `kind:` and `back:` set that item's picks, and a number tunes the kind, e.g. `reach:2`.
 * - `--debug` logs each choice and why to the tty, and moreover draws in-world lines, until killed.
 * - `--debug:rob,kate` restricts it to those npcs
 * - `for:rob,kate` sets their own rule on this map, `reset` drops it, and alone it prints theirs
 * - `status` says whom the lookout tested since it was last asked — see `docs/sidestep.md`
 *
 * ```sh
 * sidestep
 * sidestep on
 * sidestep --debug
 * sidestep --debug:rob,kate
 * sidestep for:rob,kate kind:wall back:home
 * sidestep for:rob
 * sidestep for:rob reset
 * sidestep kind:turn back:home
 * sidestep kind:wall reach:2
 * sidestep chain:false
 * sidestep status
 * sidestep off
 * ```
 */
export async function* sidestep(ct: JshCli.RunArg) {
  const { api, args, w } = ct;
  if (args[0] === "off") {
    w.e.keyedListener.delete("sidestep");
    w.e.keyedTick.delete("sidestep");
    w.skipNet?.remove("sidestep");
    watcher = null;
    return;
  }
  if (args[0] === "status") {
    if (watcher === null) throw Error("sidestep is not running");
    yield* watcher.look.status(w);
    yield* askedStatus(w, watcher.look, watcher.s);
    yield* homeStatus(w, watcher.s);
    yield* perfStatus(watcher.s);
    return;
  }
  const quiet = args[0] === "on";
  const {
    debug,
    for: npcKeys,
    reset,
    ...picks
  } = api.jsArg(quiet ? args.slice(1) : args, { "--debug": "debug" }) as Record<string, unknown>;
  if (npcKeys !== undefined) return yield* forNpcs(`${npcKeys}`.split(",").filter(Boolean), picks, reset === true);
  if (reset !== undefined) throw Error("reset needs for:, e.g. sidestep for:rob reset");
  setChoices(picks);
  watchWalkers(w);
  if (args.length === 0) yield* settings();
  if (debug !== undefined) yield* watchChoices(ct, debug === true ? [] : `${debug}`.split(","));
}

/** `for:` npcs' own rules: `reset` drops them, then picks set them. With neither, each one's choices */
function* forNpcs(npcKeys: string[], picks: Record<string, unknown>, reset: boolean): Generator<unknown> {
  if (npcKeys.length === 0) throw Error("for: takes npcKeys, e.g. for:rob,kate");
  const rules = sidestepRules.get();
  const defaults = watcher?.s.choices ?? debugChoices();
  const setting = Object.keys(picks).length > 0;
  if (reset === false && setting === false) {
    for (const npcKey of npcKeys) {
      const { open: _, ...shown } = choicesOf(defaults, rules.get(npcKey));
      yield { npcKey, ...shown };
    }
    return;
  }
  for (const npcKey of npcKeys) {
    if (reset === true) rules.delete(npcKey);
    if (setting === false) continue;
    const rule = rules.get(npcKey) ?? {};
    mergeRule(rule, ruleOf(picks, rule.kind ?? defaults.kind));
    rules.set(npcKey, rule);
  }
  if (watcher !== null) notifyRules(watcher.s);
}

/** Redraws the pane's per-npc list */
function notifyRules(s: Sidestep) {
  for (const onChange of s.rulesChanged) onChange();
}

/** The defaults at `/shared/sidestep`, then any rules on this map as one object by npcKey */
function* settings(): Generator<unknown> {
  yield watcher?.s.choices;
  const rules = sidestepRules.get();
  if (rules.size > 0) yield Object.fromEntries(rules);
}

/** The running watcher's lookout and state, for `sidestep status` */
let watcher: null | { look: SidestepLookout; s: Sidestep } = null;

/** Ends the running `sidestep --debug`, which a new one replaces */
let endDebug: null | (() => void) = null;

/** Keyed on the World: each tick, whom the lookout finds in a walker's way, and who steps back once a walker has gone */
function watchWalkers(w: JshCli.WorldState) {
  const s: Sidestep = {
    fell: new Map(),
    home: new Map(),
    ownIdle: new Map(),
    choices: debugChoices(),
    skipped: new Map(),
    stepping: new Map(),
    perf: newPerf(),
    rulesChanged: new Set(),
  };
  const look = new SidestepLookout(w);
  watcher = { look, s };
  const rules: SidestepRules = {
    list: () =>
      [...sidestepRules.get()].map(([npcKey, rule]) => ({
        npcKey,
        text: ruleText(rule),
        spawned: w.n[npcKey] !== undefined,
      })),
    listen: (onChange) => {
      s.rulesChanged.add(onChange);
      return () => void s.rulesChanged.delete(onChange);
    },
    remove: (npcKey) => void sidestepRules.get().delete(npcKey),
  };
  w.skipNet?.add({
    key: "sidestep",
    title: "sidestep",
    Component: () =>
      createElement(SidestepDebug, { w, s: s.choices, kinds: sidestepKinds, backs: sidestepBacks, rules }),
  });
  w.e.addKeyedListener("sidestep", (e, w) => {
    // after `pred` points at the new map's rules
    if (e.key === "map-settled") queueMicrotask(() => notifyRules(s));
    if (w.client === true) return;
    if (e.key === "npc-hurt" && e.clip === "collapsed") s.fell.set(e.npcKey, w.gameTime.now());
    look.onEvent(e, w);
  });
  w.e.addKeyedTick("sidestep", (w) => {
    if (w.client === true) return;
    const started = performance.now();
    // released or removed
    for (const npcKey of s.fell.keys()) if (w.n[npcKey]?.anim.hurt == null) s.fell.delete(npcKey);
    for (const npcKey of s.ownIdle.keys()) if (w.n[npcKey] === undefined) s.ownIdle.delete(npcKey);
    const now = w.gameTime.now();
    /** Why they cannot make way now, else `null` */
    const isFree = (npc: JshCli.Npc) => (s.stepping.has(npc.key) ? "stepping" : whyNot(w, npc, s));
    /** Sidestep's own steps and returns, which make way rather than ask for it */
    const ownMove = (key: string) => isOwnMover(s, key) && choicesFor(s, key).chain !== true;

    look.forget(w, now);
    for (const { walker, npc, eta } of look.coming(w, now, isFree, ownMove)) {
      look.noteAsked(npc.key, walker.key, now);
      makeWay(w, npc, walker, s, `coming ${eta.toFixed(1)}s`);
    }
    const near = new Set<string>();
    for (const { walker, npc, why, seg } of look.heldUp(w, now, isFree, ownMove)) {
      near.add(npc.key);
      if (why === null) {
        look.noteAsked(npc.key, walker.key, now);
        makeWay(w, npc, walker, s, "held up");
      } else skip(w, s, npc, walker, why, seg);
    }
    for (const npcKey of s.skipped.keys()) if (near.has(npcKey) === false) s.skipped.delete(npcKey);
    returnBack(w, s);
    notePerf(s.perf, "tick", performance.now() - started);
  });
}

/** What the watcher keeps, by npcKey */
type Sidestep = {
  /** When they collapsed, in world seconds */
  fell: Map<string, number>;
  /** Its SkipNet pane's: how npcs make way next, and where they go back to — kept in `/shared/sidestep` */
  choices: SidestepDebugState;
  /** Where each stood before their first step aside, whilst they mean to go back — see `returnBack` */
  home: Map<string, Home>;
  /** When sidestep's own step or return ended, as their `last.idleTime`: they settle only `ownSettleSecs` after it */
  ownIdle: Map<string, number>;
  /** Why they last did not make way, as `--debug` was told */
  skipped: Map<string, string>;
  /** Npcs making way: where to once planned, and how far the step has got */
  stepping: Map<string, Stepping>;
  /** What it cost since the last `sidestep status` */
  perf: Perf;
  /** The pane's redraws, on a `for:` change */
  rulesChanged: Set<() => void>;
};

/** A step under way: where to once planned, its stage and since when, and their `spawns` then, for `sidestep status` */
type Stepping = { to: null | Geom.VectJson; stage: string; since: number; spawns: number };

/** Whether `key` is moving by sidestep's own step or return */
const isOwnMover = (s: Sidestep, key: string) => s.stepping.has(key) || s.home.get(key)?.returning === true;

/** Worker requests, each from asking to the plan's arrival, and ticks: counts and real milliseconds */
type Perf = { since: number; plan: Timed; tick: Timed };
type Timed = { count: number; ms: number; most: number };

const newPerf = (): Perf => ({ since: performance.now(), plan: newTimed(), tick: newTimed() });
const newTimed = (): Timed => ({ count: 0, ms: 0, most: 0 });

function notePerf(perf: Perf, what: "plan" | "tick", ms: number) {
  const timed = perf[what];
  Object.assign(timed, { count: timed.count + 1, ms: timed.ms + ms, most: Math.max(timed.most, ms) });
}

/** For `sidestep status`: worker requests per second and how long each plan took, and each tick, then forgotten */
function* perfStatus(s: Sidestep): Generator<string> {
  const { since, plan, tick } = s.perf;
  const secs = (performance.now() - since) / 1000;
  const mean = ({ count, ms }: Timed) => (count === 0 ? 0 : ms / count).toFixed(2);
  yield `${heading("cost")} ${ansi.Grey}(real ms)${ansi.Reset}`;
  yield* table(
    ["", "count", "/s", "mean", "most"],
    [
      ["plans", plan.count, (plan.count / secs).toFixed(1), `${mean(plan)}ms`, `${plan.most.toFixed(2)}ms`],
      ["ticks", tick.count, (tick.count / secs).toFixed(1), `${mean(tick)}ms`, `${tick.most.toFixed(2)}ms`],
    ],
  );
  s.perf = newPerf();
}

/**
 * Where an npc stood before their first step aside (`at`). Later steps keep it, noting where the latest
 * began (`prev`) and ended (`last`), for whom, and how many there have been. `returning` whilst on their way back
 */
type Home = {
  at: Geom.VectJson;
  prev: Geom.VectJson;
  last: Geom.VectJson;
  walker: string;
  steps: number;
  returning: boolean;
  /** Returns broken off in a row since their last step: home is given up at `returnTries` */
  fails: number;
};

/** Why they cannot make way now, else `null`. Idle for `stillSecs`, stood or collapsed. The player once still `playerStillSecs` */
function whyNot(w: JshCli.WorldState, npc: JshCli.Npc, s: Sidestep) {
  const { hurt, dragged } = npc.anim;
  const returning = s.home.get(npc.key)?.returning === true;
  if (npc.agent === null) return "off the navmesh";
  if (npc.hardPinned === true) return "hard pinned";
  if (hurt !== null && hurt.key !== "pacified" && dragged === false) return "hurt";
  if (npc.isMoving() && returning === false) return "moving";
  if (npc.isLooking() || npc.isFading()) return "busy";
  if (npc.isNotStanding()) return "not standing";
  if (returning === true) return null; // neither a return's moves nor the pause between them hold them
  const since = Math.max(npc.last.idleTime, s.fell.get(npc.key) ?? -Infinity);
  const own = s.ownIdle.get(npc.key) === npc.last.idleTime;
  const { ownSettleSecs, playerStillSecs, stillSecs } = sidestepConfig;
  const settle = own ? ownSettleSecs : npc.key === w.player.key ? playerStillSecs : stillSecs;
  return w.gameTime.now() - since < settle ? "settling" : null;
}

/** Asks the worker how `npc` makes way for `walker`, as `s.choices.kind`, then has them make way after `reactSecs`, if still free to */
function makeWay(w: JshCli.WorldState, npc: JshCli.Npc, walker: JshCli.Npc, s: Sidestep, cause: string) {
  s.skipped.delete(npc.key);
  noteStage(w, s, npc, "planning");

  const asked = performance.now();
  const { kind, tune, back } = choicesFor(s, npc.key);
  void Promise.resolve()
    .then(() =>
      requestDetached(w, {
        key: "sidestep",
        kind,
        tune,
        npc: { ...npcQuery(w, npc), dragged: npc.anim.dragged },
        walker: { ...npcQuery(w, walker), path: pathOf(walker), heading: headingOf(walker) },
        others: othersNear(w, npc, walker, s.stepping),
      }),
    )
    .then(async (choice) => {
      notePerf(s.perf, "plan", performance.now() - asked);
      const { kind, to, reason, draw } = choice;
      emit(w, npc.key, walker.key, kind, to !== null || kind === "stand", `${cause}, ${reason}`, draw);
      if (to === null) return; // stood, or no room
      noteStage(w, s, npc, "reacting", to);
      const [lo, hi] = sidestepConfig.reactSecs;
      await w.e.wait(lo + Math.random() * (hi - lo));
      if (whyNot(w, npc, s) === null) await perform(w, npc, walker, choice, s, back);
    })
    .catch((e) => warn(`sidestep: ${e}`))
    .finally(() => s.stepping.delete(npc.key));
}

/** Notes how far `npc`'s step has got, keeping where to once planned */
function noteStage(
  w: JshCli.WorldState,
  s: Sidestep,
  npc: JshCli.Npc,
  stage: string,
  to = s.stepping.get(npc.key)?.to ?? null,
) {
  s.stepping.set(npc.key, { to, stage, since: w.gameTime.now(), spawns: npc.spawns });
}

/** Steps them as chosen, maybe saying something. Facing the walker only if free to: a player's aim is kept */
async function perform(
  w: JshCli.WorldState,
  npc: JshCli.Npc,
  walker: JshCli.Npc,
  { kind, to, via, face, faceWalker, faceFirst, shuffle }: WW.SidestepPlan,
  s: Sidestep,
  back: SidestepBack,
) {
  const { lines, chance } = sidestepConfig.says;
  if (lines.length > 0 && Math.random() < chance)
    w.speech.say(npc.key, lines[Math.floor(Math.random() * lines.length)]);
  const kept = s.home.get(npc.key);
  /** Kept from their first step, else where they stand now: noted before the step, so one cut short still has it */
  const home: Home = {
    at: kept?.at ?? npc.point,
    steps: kept?.steps ?? 0,
    // a step interrupting a return keeps where the step before began
    prev: kept?.returning === true ? kept.prev : npc.point,
    last: npc.point,
    walker: walker.key,
    returning: false,
    fails: 0,
  };
  // the player is never walked back: where they go is theirs
  if (to !== null && back !== "stay" && npc.key !== w.player.key) s.home.set(npc.key, home);
  const free = npc.anim.hurt === null && npc.anim.face.aim === null;
  /** Eased round whilst stepping, dropped at rest: to face the walker, else to `face` from the start */
  const aimAt = faceWalker === true ? walker.point : faceFirst === true ? face : null;
  const aim = { at: aimAt ?? walker.point, rate: 1, untilRest: true };
  if (aimAt !== null && free === true) npc.anim.face.aim = aim;
  try {
    for (const at of via === null ? [to] : [via, to]) {
      if (at === null) continue;
      noteStage(w, s, npc, at === via ? "moving via" : "moving");
      await w.e.moveOrThrow({ npcKey: npc.key, to: at, strafe: true, shove: true, shuffle: shuffle || undefined });
    }
    if (face !== null && free === true) {
      if (npc.anim.face.aim === aim) npc.anim.face.aim = null;
      noteStage(w, s, npc, "looking");
      await npc.look({ at: face });
    }
  } catch (e) {
    if (npc.anim.face.aim === aim) npc.anim.face.aim = null; // a new push or move may interrupt
    const message = e instanceof Error ? e.message : `${e}`;
    emit(w, npc.key, walker.key, kind, false, `step cut short: ${message}`);
    // another move taking them over leaves `last`, so home is forgotten. Stuck, say, it is still their step
    if (message === "move again") return;
  }
  s.ownIdle.set(npc.key, npc.last.idleTime);
  // where the step ended is theirs to go back from, unless `stay` has since forgotten it
  if (s.home.get(npc.key) === home) Object.assign(home, { last: npc.point, steps: home.steps + 1 });
}

/**
 * Sends each back, once their latest walker has gone (`walkerGone`): to where their latest step began (`last`), or
 * home (`home`) however many steps aside they took, through doorways too. They forget home once there, or once
 * moved off their last step by anything else
 */
function returnBack(w: JshCli.WorldState, s: Sidestep) {
  const { returnExact, returnSlack } = sidestepConfig;
  for (const [npcKey, home] of s.home) {
    const npc = w.n[npcKey];
    const { back, returns } = returnOf(s, npcKey);
    if (npc === undefined || back === "stay") {
      s.home.delete(npcKey);
      continue;
    }
    if (home.returning === true || s.stepping.has(npcKey) || npc.isMoving() === true) continue;
    const to = backTo(back, home);
    const pushed = npc.distanceTo(home.last);
    const forgets = pushed > returnSlack ? `pushed ${pushed.toFixed(2)}m off` : null;
    if (forgets !== null || npc.distanceTo(to) <= returnExact) {
      s.home.delete(npcKey);
      if (forgets !== null) emit(w, npcKey, home.walker, "forget", false, forgets);
      continue;
    }
    const { off, stopped, gone } = walkerGone(w, home.walker, to, returns);
    if (gone === false || whyNot(w, npc, s) !== null) continue;

    home.returning = true;
    const steps = `${home.steps} step${home.steps === 1 ? "" : "s"}`;
    const away = `${back} ${npc.distanceTo(to).toFixed(1)}m${back === "home" ? ` after ${steps}` : ""}`;
    const where = off === undefined ? "gone" : `${stopped ? "stopped " : ""}${off.toFixed(1)}m off`;
    emit(w, npcKey, home.walker, "return", true, `${away}, ${home.walker} ${where}`, [
      { points: [npc.point, to].map(drawPoint), role: "back" },
    ]);
    void returnTo(w, npc, to)
      .then(() => {
        s.ownIdle.set(npcKey, npc.last.idleTime);
        if (s.home.get(npcKey) === home) s.home.delete(npcKey);
      })
      .catch((e) => {
        emit(w, npcKey, home.walker, "return", false, `${e}`);
        if (s.home.get(npcKey) !== home) return; // a step aside took over, keeping home
        if (e instanceof Error && e.message === "move again") {
          s.home.delete(npcKey); // another move took them on: theirs, so not undone
          return void emit(w, npcKey, home.walker, "forget", false, "moved on");
        }
        // kept, to try again: where they stopped is theirs
        Object.assign(home, { returning: false, last: npc.point, fails: home.fails + 1 });
        if (home.fails < sidestepConfig.returnTries) return;
        s.home.delete(npcKey); // e.g. a shuffle into place stuck against an edge, again and again
        emit(w, npcKey, home.walker, "forget", false, `gave up after ${home.fails} tries`);
      });
  }
}

/** Where and when `npcKey` goes back, their rule over the pane's. Merged only if their rule tunes `returns` */
function returnOf(s: Sidestep, npcKey: string) {
  const rule = sidestepRules.get().get(npcKey);
  const returns = rule?.returns === undefined ? s.choices.returns : { ...s.choices.returns, ...rule.returns };
  return { back: rule?.back ?? s.choices.back, returns };
}

/** Where `home` goes back to as `back` says: home itself, else where their latest step began */
const backTo = (back: SidestepBack, home: Home) => (back === "home" ? home.at : home.prev);

/** Whether `walker` has gone from `to`: `clear` of it, or `idle` of it once stopped. Gone from the World counts */
function walkerGone(w: JshCli.WorldState, walker: string, to: Geom.VectJson, returns: SidestepReturns) {
  const by = w.n[walker];
  const off = by?.distanceTo(to);
  const stopped = by !== undefined && by.isMoving() === false;
  const gone = off === undefined || off >= returns.clear || (stopped && off >= returns.idle);
  return { off, stopped, gone };
}

/** For `sidestep status`: who made way lately or is making way, and whether free to again */
function* askedStatus(w: JshCli.WorldState, look: SidestepLookout, s: Sidestep): Generator<string> {
  const now = w.gameTime.now();
  yield heading("asked");
  yield* table(
    ["npc", "walker", "ago", "now"],
    [...new Set([...look.asked.keys(), ...s.stepping.keys()])].map((npcKey) => {
      const [asked, npc, step] = [look.asked.get(npcKey), w.n[npcKey], s.stepping.get(npcKey)];
      const respawned = step !== undefined && npc !== undefined && npc.spawns !== step.spawns;
      const state =
        step !== undefined
          ? `${step.stage} ${(now - step.since).toFixed(1)}s${respawned ? " (respawned)" : ""}`
          : npc === undefined
            ? "gone"
            : (whyNot(w, npc, s) ?? "free");
      return [npcKey, asked?.walker ?? "-", asked === undefined ? "-" : `${(now - asked.at).toFixed(1)}s`, state];
    }),
  );
}

/** For `sidestep status`: each home, how far off, and why they have not gone back yet */
function* homeStatus(w: JshCli.WorldState, s: Sidestep): Generator<string> {
  yield `${heading("homes")} ${ansi.Grey}back: ${s.choices.back}${ansi.Reset}`;
  const rows = [...s.home].flatMap(([npcKey, home]) => {
    const npc = w.n[npcKey];
    if (npc === undefined) return [];
    const { back, returns } = returnOf(s, npcKey);
    const to = backTo(back, home);
    const { off, gone } = walkerGone(w, home.walker, to, returns);
    const why = home.returning
      ? "returning"
      : s.stepping.has(npcKey)
        ? "stepping"
        : (whyNot(w, npc, s) ?? (gone || off === undefined ? "due" : `${home.walker} ${off.toFixed(1)}m from it`));
    return [[npcKey, `${npc.distanceTo(to).toFixed(2)}m`, home.steps, home.fails, why]];
  });
  yield* table(["npc", "off", "steps", "fails", "why not back yet"], rows);
}

/** Its pane's choices at `/shared/sidestep`, so a hot reload or a page reload keeps them: else the defaults */
function debugChoices(): SidestepDebugState {
  const saved = sharedFolder.sidestep as undefined | Partial<SidestepDebugState>;
  const choices: SidestepDebugState = {
    kind: saved?.kind ?? "aside",
    back: saved?.back ?? sidestepConfig.back,
    tune: tuneOf(saved?.tune),
    returns: { ...returnDefaults, ...saved?.returns },
    open: { tune: true, returns: true, rules: true, ...saved?.open },
    chain: saved?.chain ?? true,
  };
  sharedFolder.sidestep = choices; // the pane writes to it as they are picked
  return choices;
}

/** Saved tuning over the defaults, kind by kind, so a limit added since gets its default */
function tuneOf(saved?: Partial<WW.SidestepTune>) {
  const kinds = Object.keys(tuneDefaults) as WW.SidestepYield[];
  return Object.fromEntries(kinds.map((k) => [k, { ...tuneDefaults[k], ...saved?.[k] }])) as WW.SidestepTune;
}

/** Sets the hud item's picks, e.g. from `kind:wall back:home reach:2 clear:2`, which the next watcher reads */
function setChoices(picks: Record<string, unknown>) {
  const choices = debugChoices();
  mergeRule(choices, ruleOf(picks, choices.kind));
}

/** Picks as a rule. A number tunes the picked kind, else `current`, or going back. `kind:none` is `stand` */
function ruleOf({ kind, back, ...rest }: Record<string, unknown>, current: WW.SidestepYield): SidestepRule {
  const rule: SidestepRule = {};
  if (kind !== undefined) {
    const picked = kind === "none" ? "stand" : kind;
    if (sidestepKinds.includes(picked as WW.SidestepYield) === false)
      throw Error(`kind: ${sidestepKinds.join(", ")}, none`);
    rule.kind = picked as WW.SidestepYield;
  }
  if (back !== undefined) {
    if (sidestepBacks.includes(back as SidestepBack) === false) throw Error(`back: ${sidestepBacks.join(", ")}`);
    rule.back = back as SidestepBack;
  }
  const tuned = rule.kind ?? current;
  for (const [key, value] of Object.entries(rest)) {
    if (key === "chain" && typeof value === "boolean") rule.chain = value;
    else if (typeof value === "number" && key in returnDefaults) rule.returns = { ...rule.returns, [key]: value };
    else if (typeof value === "number" && key in tuneDefaults[tuned])
      rule.tune = { ...rule.tune, [tuned]: { ...rule.tune?.[tuned], [key]: value } };
    else
      throw Error(
        `${tuned} takes: ${[...Object.keys(tuneDefaults[tuned]), ...Object.keys(returnDefaults), "chain"].join(", ")}`,
      );
  }
  return rule;
}

/** Writes `rule` over `into`, kind by kind */
function mergeRule(into: SidestepRule, rule: SidestepRule) {
  if (rule.kind !== undefined) into.kind = rule.kind;
  if (rule.back !== undefined) into.back = rule.back;
  if (rule.chain !== undefined) into.chain = rule.chain;
  if (rule.returns !== undefined) into.returns = { ...into.returns, ...rule.returns };
  for (const [kind, tune] of Object.entries(rule.tune ?? {}))
    into.tune = { ...into.tune, [kind]: { ...into.tune?.[kind as WW.SidestepYield], ...tune } };
}

/** The defaults with `rule` over them */
function choicesOf(defaults: SidestepDebugState, rule?: SidestepRule): SidestepDebugState {
  if (rule === undefined) return defaults;
  const choices = { ...defaults, tune: { ...defaults.tune }, returns: { ...defaults.returns } };
  mergeRule(choices, rule);
  return choices;
}

/** How `npcKey` makes way and goes back: their rule on this map over the pane's */
const choicesFor = (s: Sidestep, npcKey: string) => choicesOf(s.choices, sidestepRules.get().get(npcKey));

/** A rule as `for:` takes it, e.g. `kind:wall reach:2`. Another kind's tuning is prefixed, e.g. `aside.by:1` */
function ruleText({ tune = {}, returns = {}, ...rest }: SidestepRule) {
  const pairs = (values: object, prefix = "") =>
    Object.entries(values).map(([key, value]) => `${prefix}${key}:${value}`);
  const tuned = Object.entries(tune).flatMap(([kind, values]) => pairs(values, kind === rest.kind ? "" : `${kind}.`));
  return [...pairs(rest), ...tuned, ...pairs(returns)].join(" ");
}

/** The ways of making way, and where they go back to, as the hud's item and `kind:` / `back:` take them */
const sidestepKinds: WW.SidestepYield[] = ["aside", "turn", "shuffle", "back", "wall", "doorway", "stand"];
const sidestepBacks: SidestepBack[] = ["last", "home", "stay"];

/** Going back until tuned, in metres: once their walker is `clear` of the spot, or `idle` of it once stopped */
const returnDefaults: SidestepReturns = { clear: 1.5, idle: 1 };

/** Each kind's limits until tuned, in metres: how far they step, or how far they look for room */
const tuneDefaults: WW.SidestepTune = {
  aside: { by: 0.8 },
  turn: { by: 0.2 },
  shuffle: { by: 0.3 },
  back: { narrow: 1.4, max: 3 },
  wall: { reach: 1 },
  doorway: { reach: 2, through: 0.5 },
  stand: {},
};

/** Walks them back to `from`, then a move short enough to shuffle the little a walk stops short by */
async function returnTo(w: JshCli.WorldState, npc: JshCli.Npc, from: Geom.VectJson) {
  await w.e.moveOrThrow({ npcKey: npc.key, to: from });
  if (npc.distanceTo(from) > sidestepConfig.returnExact) await w.e.moveOrThrow({ npcKey: npc.key, to: from });
}

/** Where `npc`'s neighbours stand, bar `walker`, and where others are stepping to */
function othersNear(w: JshCli.WorldState, npc: JshCli.Npc, walker: JshCli.Npc, stepping: Map<string, Stepping>) {
  return [
    ...w.npc.near.beside(npc.key, Infinity).flatMap(({ npc: other }) => (other === walker ? [] : [other.point])),
    ...[...stepping.values()].flatMap(({ to }) => to ?? []),
  ];
}

/** Tells the World, and so `--debug`, what `npcKey` did for `walker` or didn't, and why */
function emit(
  w: JshCli.WorldState,
  npcKey: string,
  walker: string,
  kind: SidestepEvent["kind"],
  ok: boolean,
  reason: string,
  draw: SidestepEvent["draw"] = [],
) {
  w.events.next({ key: "sidestep", npcKey, walker, kind, ok, reason, draw });
}

type SidestepEvent = Extract<JshCli.Event, { key: "sidestep" }>;

/** Whilst `--debug` listens, why they did not make way, each time that changes. A `seg` is drawn, styled by `why` */
function skip(
  w: JshCli.WorldState,
  s: Sidestep,
  npc: JshCli.Npc,
  walker: JshCli.Npc,
  why: string,
  seg?: Geom.VectJson[],
) {
  if (w.e.keyedListener.has(debugKey) === false) return;
  // a `chain`'s own movers' skips go unsaid: in a crowd there are too many
  if (isOwnMover(s, walker.key)) return;
  const said = `${walker.key} ${why}`;
  if (s.skipped.get(npc.key) === said) return;
  s.skipped.set(npc.key, said);
  const style = skipStyles[why];
  const draw =
    seg === undefined || style === undefined
      ? []
      : [
          { points: pathOf(walker).map(drawPoint), role: "path" },
          { points: seg.map(drawPoint), ...style },
        ];
  emit(w, npc.key, walker.key, "none", false, why, draw);
}

/** A ground point as `--debug` draws it, a little off the floor */
const drawPoint = ({ x, y }: Geom.VectJson): [number, number, number] => [x, y, 0.05];
/** How `skip` draws a reason's `seg`: clear of the walker's path faint green, passed by them dashed amber */
const skipStyles: Record<string, { role: WW.SidestepRole; opacity?: number; dash?: number; discRadius?: number }> = {
  "path clear": { role: "clear", opacity: 0.6 },
  passed: { role: "passed", dash: 0.08, discRadius: 0 },
};

/** Until killed, each `sidestep` event said and its lines drawn, for `debugSecs` or until that npc's next */
async function* watchChoices({ api, w }: JshCli.RunArg, only: string[]) {
  const said: string[] = [];
  const drawn = new Map<string, { keys: string[]; cancel: () => void }>();
  type Draw = SidestepEvent["draw"];
  type Entry = Parameters<typeof w.debug.setPolylines>[0] extends Iterable<infer E> ? E : never;
  /** Each npc's lines to draw next, else `null` to clear theirs: drawn together, once a tick, by `flush` */
  const pending = new Map<string, null | Draw>();
  const flush = () => {
    const theme = themeApi.getName();
    const entries: Entry[] = [];
    for (const [npcKey, draw] of pending) {
      const prev = drawn.get(npcKey);
      prev?.cancel();
      const keys = (draw ?? []).map((_, i) => `${debugKey}/${npcKey}/${i}`);
      for (const key of prev?.keys ?? []) if (keys.includes(key) === false) entries.push([key, null]);
      // a line's own style first
      draw?.forEach(({ role, ...line }, i) =>
        entries.push([keys[i], { ...lineStyles[theme], ...line, color: colorOf(role, theme) }]),
      );
      if (draw === null) drawn.delete(npcKey);
      else drawn.set(npcKey, { keys, cancel: w.e.after(sidestepConfig.debugSecs, () => redraw(npcKey, null)) });
    }
    pending.clear();
    w.debug.setPolylines(entries);
    // a frame alone: `forceUpdate` would run a tick, whose events queue another `flush`, forever
    w.r3f?.invalidate();
  };
  const redraw = (npcKey: string, draw: null | Draw) => {
    if (pending.size === 0) queueMicrotask(flush);
    pending.set(npcKey, draw);
  };
  let wake = () => {};
  const listener: Parameters<typeof w.e.addKeyedListener>[1] = (e) => {
    if (e.key !== "sidestep") return;
    if (only.length > 0 && only.includes(e.npcKey) === false && only.includes(e.walker) === false) return;
    said.push(sayChoice(api.ansi, e));
    if (e.draw.length > 0) redraw(e.npcKey, e.draw); // their last lines replaced
    wake();
  };
  w.e.addKeyedListener(debugKey, listener);

  let killed = () => {};
  const stopped = new Promise<void>((resolve) => void (killed = resolve));
  const handlers = api.handleStatus({ cleanup: () => killed() });
  endDebug?.();
  endDebug = killed;
  try {
    while (true) {
      yield* said.splice(0);
      const woken = new Promise<boolean>((resolve) => void (wake = () => resolve(true)));
      if ((await Promise.race([woken, stopped.then(() => false)])) === false) throw api.getKillError();
    }
  } finally {
    handlers.dispose();
    if (w.e.keyedListener.get(debugKey) === listener) w.e.keyedListener.delete(debugKey);
    if (endDebug === killed) endDebug = null;
    for (const npcKey of drawn.keys()) pending.set(npcKey, null);
    flush();
  }
}

/** A choice as said: who avoided whom in green, else who didn't in red, then how and why */
function sayChoice(ansi: JshCli.RunArg["api"]["ansi"], e: SidestepEvent) {
  if (e.kind === "none") {
    // the names white, the rest faint
    const said = (skipSays[e.reason] ?? `{npc} ${e.reason} for {walker}`).split(/(\{npc\}|\{walker\})/);
    const names = { "{npc}": e.npcKey, "{walker}": e.walker } as Record<string, string>;
    return (
      said.map((part) => (part in names ? ansi.White + names[part] : ansi.YellowFaint + part)).join("") + ansi.Reset
    );
  }
  if (e.kind === "forget") {
    return `${ansi.White}${e.npcKey} ${ansi.YellowFaint}forgets home${ansi.White}:${ansi.Reset} ${e.reason}`;
  }
  if (e.kind === "return") {
    const returns = e.ok ? `${ansi.GreenBright}returns` : `${ansi.Red}didn't return`;
    return `${ansi.White}${e.npcKey} ${returns}${ansi.White}:${ansi.Reset} ${e.reason}`;
  }
  const avoided = e.ok ? `${ansi.GreenBright}avoided` : `${ansi.Red}didn't avoid`;
  return `${ansi.White}${e.npcKey} ${avoided} ${ansi.White}${e.walker}:${ansi.Reset} ${e.kind}, ${e.reason}`;
}

/** Why none was made, as said, naming each where it reads best. Else the reason and "for", e.g. `kate busy for rob` */
const skipSays: Record<string, string> = {
  asked: "{npc} already tried for {walker}",
  busy: "{npc} too busy for {walker}",
  moving: "{npc} moves ignoring {walker}",
  hurt: "{npc} too hurt for {walker}",
  "off the navmesh": "{npc} off the navmesh, ignores {walker}",
  passed: "{walker} passed by {npc}",
  "path clear": "{npc} clear of {walker}",
  settling: "{npc} settling, ignores {walker}",
  stepping: "{npc} avoiding {walker}",
  still: "{npc} held still, ignores {walker}",
};

/** `--debug`'s colour for a line's role, in the theme shown now. Vivid on light, to stand out on the pale floor */
const colorOf = (role: string, theme: ThemeName) => debugPalette[theme][role as WW.SidestepRole] ?? "#808080";
const debugPalette: Record<ThemeName, Record<WW.SidestepRole, string>> = {
  dark: {
    path: "#4080f0",
    probe: "#a0a0a0",
    wall: "#e04040",
    step: "#40d080",
    face: "#c080f0",
    back: "#40c0d0",
    clear: "#4ec98a",
    passed: "#e0a030",
  },
  light: {
    path: "#0050ff",
    probe: "#505050",
    wall: "#e00000",
    step: "#00b040",
    face: "#a000e0",
    back: "#0098b8",
    clear: "#00c060",
    passed: "#ff8800",
  },
};

/** The keyed listener `--debug` adds, and its polylines' key prefix */
const debugKey = "sidestep-debug";
/** Lines as `--debug` draws them: thin, a little faint, with small discs. Wider and opaque on light, the floor being pale */
const lineStyles: Record<ThemeName, { width: number; opacity: number; discRadius: number }> = {
  dark: { width: 0.012, opacity: 0.8, discRadius: 0.04 },
  light: { width: 0.026, opacity: 1, discRadius: 0.055 },
};

const sidestepConfig = {
  /** Game seconds before they react, at random between these. Kept short: a walker held up too long is stuck */
  reactSecs: [0.05, 0.15],
  /** Where they go back to once the walker has gone, until its SkipNet pane says otherwise */
  back: "last" as SidestepBack,
  /** The chance they say something as they make way, and what */
  says: { chance: 0, lines: ["Sorry.", "Excuse me."] },
  /** Seconds after stopping or collapsing before they step aside, so an arrival settles first */
  stillSecs: 2,
  /** As `stillSecs`, for the player: their own walking always wins */
  playerStillSecs: 3,
  /** Seconds after sidestep's own step aside or return, before they may again */
  ownSettleSecs: 0.3,
  /** Returning: moved this far off their last step by anything else, they forget home */
  returnSlack: 0.3,
  /** Returning: further than this from where they stood, they shuffle the rest */
  returnExact: 0.03,
  /** Returning: broken off this many times in a row, they give home up */
  returnTries: 2,
  /** Game seconds `--debug` keeps a choice drawn */
  debugSecs: 4,
};
