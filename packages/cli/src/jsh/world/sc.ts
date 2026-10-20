import type { ScenarioDef } from "@npc-cli/ui__world/scenario.schema";
import { loadScenarioEntries } from "@npc-cli/ui__world/scenario-shared";
import { Task } from "@npc-cli/util";
import { warn } from "@npc-cli/util/legacy/generic";
import { sessionApi } from "../../shell/session";
import { wSleep } from "./core";
import { spotQuery } from "./plan.main";
import {
  compile,
  findDef,
  getInstance,
  getInstances,
  killInstanceProcesses,
  nextInstanceId,
  type ScInstance,
  type ScNpc,
  type ScState,
  stateOf,
} from "./sc/instance";
import { isStep, runLine } from "./sc/steps";

/**
 * Scenarios: their definitions, and instances of them run in this tty — see `docs/scenarios.md`
 *
 * ```sh
 * sc list
 * sc info hns
 * sc run hns seeker:rob --switch
 * sc do npc:rob go to:start
 * sc hide cal from:rob
 * ```
 */
export async function* sc(ct: JshCli.RunArg) {
  const [sub, ...args] = ct.args;
  switch (sub) {
    case "list":
      for (const d of Object.values(await loadScenarioEntries())) {
        if (d.kind === "scenario") yield `${d.short} ${d.title} (${d.map})`;
      }
      return;
    case "info":
      yield await info(ct, args);
      return;
    case "run":
      yield* run(ct, args);
      return;
    case "do":
      await doLine(ct, args);
      return;
    case "actor":
      await actor(ct, args);
      return;
    case "?": {
      const opts = ct.api.jsArg(args.filter((a) => a.startsWith("id:"))) as { id?: string };
      const inst = getInstance(opts.id ?? defaultId(ct));
      const s = stateOf(inst, await findDef(inst.defKey), ct.w.gameTime.now());
      yield compile<(s: ScState) => unknown>(args.find((a) => !a.startsWith("id:")) ?? "s => s")(s);
      return;
    }
    default: {
      // a step, e.g. `sc hide cal from:rob`, is `sc do npc:cal hide from:rob`
      if (sub !== undefined && isStep(sub)) {
        const [first, ...rest] = args;
        const npcFirst = first !== undefined && ct.w.n[first] !== undefined;
        await doLine(ct, npcFirst ? [`npc:${first}`, sub, ...rest] : [sub, ...args]);
        return;
      }
      throw Error(
        "usage: sc list | info [hns] | run hns [role:npc,…] [--switch] | do [id:hns-1] npc:abe <line> | <step> <npc> … | ? 's => …'",
      );
    }
  }
}

/** A definition's summary, its whole with `--json`; with no name, the default instance */
async function info(ct: JshCli.RunArg, args: string[]) {
  const opts = ct.api.jsArg(args, { "--json": "json" }) as { json?: boolean; id?: string };
  const name = args.find(isNaked);
  if (name === undefined) return getInstance(opts.id ?? defaultId(ct));
  const def = await findDef(name);
  if (opts.json === true) return def;
  return {
    title: `${def.title} (${def.short})`,
    area: `${def.map}: ${def.rooms.join(" ")}`,
    roles: Object.entries(def.roles).map(([role, r]) => `${role} ×${r.count}${r.skin ? ` as ${r.skin}` : ""}`),
    phases: def.phases.map((p) => p.key),
  };
}

/**
 * Starts an instance and directs it: casts it, starts an actor per npc, then moves through the phases
 * as each `until` holds, until the last ends or it is killed
 */
async function* run(ct: JshCli.RunArg, args: string[]) {
  const opts = ct.api.jsArg(args, { "--switch": "switch" }) as Record<string, unknown> & { switch?: boolean };
  const def = await findDef(args.find(isNaked));
  await ensureMap(ct, def, opts.switch === true);

  const [area] = await spotQuery(ct, [{ q: "list", rooms: def.rooms }]);
  const spots = (Array.isArray(area) ? area : []).filter((s) => standKinds.includes(s.kind));
  if (spots.length === 0) throw Error(`${def.short}: no spots in ${def.rooms.join(" ")}`);
  const firstRoom = spots.filter((s) => s.grKey === def.rooms[0]);
  /** The spot of the first room seeing most */
  const start = (firstRoom.length > 0 ? firstRoom : spots).reduce((u, v) => (v.sees > u.sees ? v : u));
  const byNearness = spots.filter((s) => s !== start).sort((u, v) => dist(u, start) - dist(v, start));

  const id = nextInstanceId(def.short);
  const inst: ScInstance = {
    id,
    defKey: def.key,
    sessionKey: ct.api.meta.sessionKey,
    directorPid: ct.api.meta.pid,
    status: "running",
    phase: def.phases[0].key,
    phaseAt: ct.w.gameTime.now(),
    rev: 0,
    npcs: {},
    places: { start: start.key },
    seen: [],
    reserved: {},
    sight: [],
  };

  getInstances()[id] = inst;
  ct.home.SC_DEFAULT = id;
  yield id;

  let failed = false;
  try {
    // named npcs play their roles, others are spawned furthest from the start
    const furthest = [...byNearness].reverse();
    for (const [role, { count, skin }] of Object.entries(def.roles)) {
      const named = csv(opts[role]) ?? def.cast[role] ?? [];
      for (let i = 0; i < count; i++) {
        const key = named[i] ?? freshName(ct.w);
        const spawned = named[i] === undefined;
        inst.npcs[key] = { key, role, done: false, spawned, rev: 0 };
        if (spawned) {
          const at = furthest.shift() ?? start;
          await ct.w.npc.spawn({ npcKey: key, at: { x: at.x, y: at.y }, as: skin });
        } else ct.w.npc.get(key);
      }
    }
    Object.keys(inst.npcs).forEach((key, i) => {
      if (byNearness[i] !== undefined) inst.places[`near-start:${key}`] = byNearness[i].key;
    });

    emit(ct, { id, kind: "started", phase: inst.phase });
    const shell = sessionApi.getSession(inst.sessionKey).ttyShell;
    for (const key of Object.keys(inst.npcs)) {
      shell
        .sourceExternal(`sc actor id:${id} npc:${key}`, { background: true, ptags: { sc: id } })
        .catch((e) => warn(`${id} actor ${key}: ${e}`));
    }

    const tick = Number(def.params.perceiveSecs ?? defaultPerceiveSecs);
    for (let index = 0; index < def.phases.length; ) {
      await wSleep(ct, tick);
      await updateSight(ct, inst);
      const s = stateOf(inst, def, ct.w.gameTime.now());
      await applyRules(ct, inst, def, s);
      if (compile<(s: ScState) => boolean>(def.phases[index].until)(s) !== true) continue;
      if (++index < def.phases.length) enterPhase(ct, inst, def.phases[index].key);
    }
  } catch (e) {
    failed = true;
    throw e;
  } finally {
    inst.status = "ended";
    killInstanceProcesses(inst, inst.directorPid);
    // killed or failed, the npcs it spawned go too: ended, they are left to be seen
    if (failed) ct.w.e.removeNpcs(...Object.values(inst.npcs).flatMap((n) => (n.spawned ? n.key : [])));
    emit(ct, { id, kind: "ended", phase: inst.phase });
  }
}

/**
 * An actor: runs its npc's cell (role by phase), and starts afresh on each phase or role change
 * — started per npc by `sc run`
 */
async function actor(ct: JshCli.RunArg, args: string[]) {
  const { id, npc: npcKey } = ct.api.jsArg(args) as { id?: string; npc?: string };
  const inst = getInstance(id);
  const def = await findDef(inst.defKey);
  if (npcKey === undefined || inst.npcs[npcKey] === undefined) throw Error(`${id}: no cast member ${npcKey}`);

  let rev = "";
  let current: null | Task = null;
  const stop = () => {
    current?.cancel();
    ct.w.n[npcKey]?.rejectAll(Error("cancelled"));
  };
  const handlers = ct.api.handleStatus({ cleanup: stop });
  try {
    while (inst.status === "running" && getInstances()[inst.id] === inst) {
      const n = inst.npcs[npcKey];
      if (`${inst.rev}.${n.rev}` !== rev) {
        if (current !== null) stop();
        rev = `${inst.rev}.${n.rev}`;
        const lines = def.cells[n.role]?.[inst.phase] ?? [];
        const task = (current = gameTask(ct));
        task
          .run(async () => {
            for (const line of lines) await runLine({ ct, npcKey, inst, def, task }, line);
          })
          .catch((e) => task.isCancelled || warn(`${id} ${npcKey}: ${e instanceof Error ? e.message : e}`))
          .finally(() => current === task && (n.done = true));
      }
      await wSleep(ct, actorPollSecs);
    }
  } finally {
    handlers.dispose();
    stop();
  }
}

/** One line run as an npc in the default instance, e.g. to try a step: `sc do npc:rob go to:start` */
async function doLine(ct: JshCli.RunArg, args: string[]) {
  const opts = ct.api.jsArg(args) as { id?: string; npc?: string };
  const inst = getInstance(opts.id ?? defaultId(ct));
  const def = await findDef(inst.defKey);
  const npcKey = opts.npc ?? "";
  ct.w.npc.get(npcKey);
  const line = args.filter((a) => !a.startsWith("id:") && !a.startsWith("npc:")).join(" ");
  const task = gameTask(ct);
  const handlers = ct.api.handleStatus({
    cleanup: () => (task.cancel(), ct.w.n[npcKey]?.rejectAll(Error("killed"))),
  });
  try {
    await task.run(() => runLine({ ct, npcKey, inst, def, task }, line));
  } finally {
    handlers.dispose();
  }
}

/** Who sees whom, for the rules: each pair's spots in sight, their eyes open, and facing them */
async function updateSight(ct: JshCli.RunArg, inst: ScInstance) {
  const { w } = ct;
  const keys = Object.keys(inst.npcs).filter((key) => w.n[key] !== undefined);
  const pairs = keys.flatMap((a) => keys.flatMap((b) => (a === b ? [] : [[a, b] as const])));
  const answers =
    pairs.length === 0
      ? []
      : await spotQuery(
          ct,
          pairs.map(([a, b]) => ({ q: "sees", a, b })),
        );
  inst.sight = pairs.flatMap(([a, b], i) => {
    const x = answers[i];
    if (x === null || x === undefined || !("crouchHides" in x) || x.sees === false) return [];
    const [watcher, seen] = [w.n[a], w.n[b]];
    if (watcher.anim.eyes.look === "shut" || (x.crouchHides && seen.anim.crouchLevel === 2)) return [];
    const off = watcher.anim.bearingOf(seen.point) - watcher.rotation.y;
    return Math.abs(Math.atan2(Math.sin(off), Math.cos(off))) <= sightHalfArc ? `${a} ${b}` : [];
  });
}

/** Each rule, for each npc of its role whose `when` holds: its lines, then its change. A role change restarts their actor */
async function applyRules(ct: JshCli.RunArg, inst: ScInstance, def: ScenarioDef, s: ScState) {
  for (const rule of def.rules) {
    if (rule.phases !== undefined && rule.phases.includes(inst.phase) === false) continue;
    const when = compile<(s: ScState, n: ScNpc) => boolean>(rule.when);
    const apply = rule.apply === undefined ? undefined : compile<(s: ScState, n: ScNpc) => void>(rule.apply);
    for (const n of s.inRole(rule.for)) {
      if (when(s, n) !== true) continue;
      const role = n.role;
      for (const line of rule.do) {
        await runLine({ ct, npcKey: n.key, inst, def, task: gameTask(ct) }, line).catch((e) =>
          warn(`${inst.id}: ${e}`),
        );
      }
      apply?.(s, n);
      if (n.role !== role) {
        n.rev++;
        n.done = false;
        emit(ct, { id: inst.id, kind: "role", npc: n.key, role: n.role });
      }
    }
  }
}

function enterPhase(ct: JshCli.RunArg, inst: ScInstance, phase: string) {
  inst.phase = phase;
  inst.phaseAt = ct.w.gameTime.now();
  for (const n of Object.values(inst.npcs)) n.done = false;
  inst.rev++;
  emit(ct, { id: inst.id, kind: "phase", phase });
}

/** On the definition's map, else switched to it with `--switch`, once settled */
async function ensureMap(ct: JshCli.RunArg, def: ScenarioDef, allowSwitch: boolean) {
  if (ct.w.mapKey === def.map) return;
  if (allowSwitch === false) {
    throw Error(`map is ${ct.w.mapKey}, ${def.short} is played on ${def.map}: sc run ${def.short} --switch`);
  }
  await ct.w.changeMap(def.map);
  const task = new Task();
  const handlers = ct.api.handleStatus({ cleanup: () => task.cancel() });
  try {
    await task.until(() => ct.w.mapKey === def.map && ct.w.isMapChanging() === false && ct.w.isReady(), 30_000, 100);
  } finally {
    handlers.dispose();
  }
  if (task.isCancelled === true) throw ct.api.getKillError();
}

function emit(ct: JshCli.RunArg, e: Omit<JshCli.ScenarioEvent, "key">) {
  ct.w.events.next({ key: "scenario", ...e });
}

/** Waits counted in game seconds */
function gameTask(ct: JshCli.RunArg) {
  return new Task(
    () => false,
    () => 1000 * ct.w.gameTime.now(),
  );
}

/** The session's default instance, set by `sc run` */
const defaultId = (ct: JshCli.RunArg) => ct.home.SC_DEFAULT as undefined | string;
/** A short name no npc in the World has, for one spawned */
function freshName(w: JshCli.WorldState) {
  const free = castNames.find((name) => w.n[name] === undefined);
  if (free !== undefined) return free;
  for (let i = 1; ; i++) {
    const name = `${castNames[i % castNames.length]}${i}`;
    if (w.n[name] === undefined) return name;
  }
}

const csv = (x: unknown) => (typeof x === "string" ? x.split(",") : undefined);
const dist = (u: Geom.VectJson, v: Geom.VectJson) => Math.hypot(u.x - v.x, u.y - v.y);
const isNaked = (arg: string) => arg.includes(":") === false && arg.startsWith("-") === false;

/** Spawned npcs are named from these */
const castNames = [
  "ada",
  "ben",
  "cal",
  "dee",
  "eli",
  "fay",
  "gus",
  "ivy",
  "jon",
  "kit",
  "lou",
  "max",
  "ned",
  "oli",
  "pam",
  "rex",
  "sam",
  "tia",
  "uma",
  "vic",
  "wes",
  "zoe",
];
/** Spots a cast member may be placed at: not a doable, nor in a doorway */
const standKinds = ["wall", "corner", "cover", "fill", "decor"];
/** Game seconds between the director's checks, unless its params say */
const defaultPerceiveSecs = 0.25;
/** Radians either side of their facing that an npc sees */
const sightHalfArc = Math.PI / 3;
/** Game seconds between an actor's looks at its instance */
const actorPollSecs = 0.1;
