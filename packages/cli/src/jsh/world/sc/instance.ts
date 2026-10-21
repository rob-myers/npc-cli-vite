import type { ScenarioDef } from "@npc-cli/ui__world/scenario.schema";
import { loadScenarioEntries } from "@npc-cli/ui__world/scenario-shared";
import { toProcessStatus } from "../../../shell/const";
import { sessionApi, sharedFolder } from "../../../shell/session";

/** A running scenario, at `/shared/sc/{id}`: shared by its director and actors, and kept over HMR */
export type ScInstance = {
  id: string;
  defKey: string;
  sessionKey: string;
  /** The `sc run` process */
  directorPid: number;
  status: "running" | "ended";
  phase: string;
  /** Game seconds the phase began */
  phaseAt: number;
  /** Bumped by each phase or role change: an actor seeing it change starts its cell afresh */
  rev: number;
  npcs: Record<string, ScNpc>;
  /** Spot keys by name, e.g. `start`, or `near-start:{npcKey}` */
  places: Record<string, string>;
  /** Spot keys seen so far, e.g. by a search */
  seen: string[];
  /** By spot key, the npc holding it */
  reserved: Record<string, string>;
  /** Who sees whom, as `{watcher} {seen}`: eyes open, facing them, and in sight. Updated each check */
  sight: string[];
  /** By npc key, their actor's pid, set by the actor itself */
  actorPids: Record<string, number>;
};

/** A cast member. Rules may add marks, e.g. `found` */
export type ScNpc = {
  key: string;
  role: string;
  done: boolean;
  spawned: boolean;
  /** Bumped by a role change: their actor starts their new cell */
  rev: number;
  /** Times their actor was lost: a second time, they are out */
  lost?: number;
  /** Out of the instance: their actor was lost twice */
  out?: boolean;
  /** Held by a rule running its lines: their actor stops, then resumes its line */
  held?: boolean;
  [mark: string]: unknown;
};

/** What a condition is given: the instance, its params, and helpers */
export type ScState = ScInstance & {
  phaseSecs: number;
  params: Record<string, unknown>;
  /** Every npc, or every npc of `role`, passes `pred` */
  all(roleOrPred: string | NpcPred, pred?: NpcPred): boolean;
  some(roleOrPred: string | NpcPred, pred?: NpcPred): boolean;
  inRole(role: string): ScNpc[];
  /** An npc of `role` who sees `n`, as of the last check */
  seenBy(role: string, n: ScNpc): undefined | ScNpc;
};

type NpcPred = (n: ScNpc) => boolean;

export function getInstances() {
  return (sharedFolder.sc ??= {}) as Record<string, ScInstance>;
}

export function getInstance(id: undefined | string) {
  const inst = id === undefined ? undefined : getInstances()[id];
  if (inst === undefined) throw Error(`no scenario instance ${id ?? "(none chosen: sc default {id})"}`);
  return inst;
}

/** Running, and its director still alive, e.g. not lost to a page reload */
export function isLive(inst: ScInstance) {
  return (
    inst.status === "running" &&
    sessionApi.getProcess({ sessionKey: inst.sessionKey, pid: inst.directorPid }) !== undefined
  );
}

/** `{short}-{n}`, one past the highest in use. Ended instances are dropped first */
export function nextInstanceId(short: string) {
  const instances = getInstances();
  for (const [id, inst] of Object.entries(instances)) if (isLive(inst) === false) delete instances[id];
  const used = Object.keys(instances).flatMap((id) =>
    id.startsWith(`${short}-`) ? Number(id.slice(short.length + 1)) : [],
  );
  return `${short}-${Math.max(0, ...used) + 1}`;
}

/** A definition by its short form, slug or key */
export async function findDef(name: undefined | string): Promise<ScenarioDef> {
  const defs = Object.values(await loadScenarioEntries()).filter((e) => e.kind === "scenario");
  const def = defs.find((d) => d.short === name || d.key === name || d.key === `scenario/${name}`);
  if (def === undefined) throw Error(`no scenario ${name ?? ""}: try sc list`);
  return def;
}

export function stateOf(inst: ScInstance, def: ScenarioDef, nowSecs: number): ScState {
  const npcs = Object.values(inst.npcs);
  const filter = (roleOrPred: string | NpcPred, pred?: NpcPred) =>
    typeof roleOrPred === "string"
      ? { list: npcs.filter((n) => n.role === roleOrPred), pred: pred ?? (() => true) }
      : { list: npcs, pred: roleOrPred };
  return {
    ...inst,
    phaseSecs: nowSecs - inst.phaseAt,
    params: def.params,
    all: (roleOrPred, pred) => {
      const f = filter(roleOrPred, pred);
      return f.list.every(f.pred);
    },
    some: (roleOrPred, pred) => {
      const f = filter(roleOrPred, pred);
      return f.list.some(f.pred);
    },
    inRole: (role) => npcs.filter((n) => n.role === role),
    seenBy: (role, n) => npcs.find((m) => m.role === role && m !== n && inst.sight.includes(`${m.key} ${n.key}`)),
  };
}

/** A condition or rule's source, e.g. `s => s.phaseSecs > 10`, as a function: compiled once */
export function compile<F extends (...args: never[]) => unknown>(src: string): F {
  let fn = compiled.get(src);
  if (fn === undefined) compiled.set(src, (fn = Function(`return (${src})`)() as AnyFn));
  return fn as F;
}

type AnyFn = (...args: never) => unknown;
const compiled = new Map<string, AnyFn>();

/** The process groups of instance `id`: its director and actors */
export function instanceLeaders(inst: ScInstance) {
  const session = sessionApi.getSession(inst.sessionKey);
  return Object.values(session?.process ?? {}).filter((p) => p.ptags?.sc === inst.id && p.key === p.pgid);
}

/** `ended` once its director is gone, else `paused` if all its processes are, `partly paused` if some */
export function instanceStatus(inst: ScInstance) {
  if (isLive(inst) === false) return "ended";
  const leaders = instanceLeaders(inst);
  const paused = leaders.filter((p) => p.status === toProcessStatus.Suspended).length;
  return paused === 0 ? "running" : paused === leaders.length ? "paused" : "partly paused";
}

/**
 * Signals every process group of an instance but `exceptPid`, e.g. `{ SIGINT: true }`. A pause or resume is
 * under the instance's own reason, which a World pause leaves alone
 */
export function signalInstance(
  inst: ScInstance,
  opts: { SIGINT?: true; STOP?: true; CONT?: true },
  exceptPid?: number,
) {
  const pids = instanceLeaders(inst).flatMap((p) => (p.key === exceptPid ? [] : p.key));
  const reason = opts.SIGINT === true ? undefined : `sc ${inst.id}`;
  if (pids.length > 0) sessionApi.kill(inst.sessionKey, pids, { GROUP: true, reason, ...opts });
}
