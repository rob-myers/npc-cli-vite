import {
  isScenarioKey,
  type PatrolEntry,
  PatrolEntrySchema,
  type ScenarioEntry,
  scenarioKinds,
} from "@npc-cli/ui__world/scenario.schema";
import { deleteScenarioEntry, loadScenarioEntries, saveScenarioEntry } from "@npc-cli/ui__world/scenario-shared";
import { spotKeyRe } from "@npc-cli/ui__world/spot.schema";
import { spotQuery } from "./perception.main";

/**
 * Scenario entries, as saved in `packages/media/src/scenario` — see `docs/scenarios.md`.
 * `list` or `ls` a kind's, patrols on this map unless `--all`. `get` one. `save` a patrol, or `rm` an entry (DEV)
 *
 * ```sh
 * sc ls patrol
 * sc list patrol --all
 * sc get patrol/basic-patrol
 * sc save patrol/basic-patrol path:$( pick 3 ) npc:guard-0
 * sc save patrol/basic-patrol cycle watch:rob,kate say:Stop!
 * sc rm patrol/basic-patrol
 * ```
 */
export async function* sc(ct: JshCli.RunArg) {
  ct.api.setPausable("world", false); // nothing here waits on the World
  const [sub, ...rest] = ct.args;
  switch (sub) {
    case "list":
    case "ls": {
      const all = rest.includes("--all");
      const kind = rest.find((arg) => arg.startsWith("-") === false);
      if (kind !== undefined && (scenarioKinds as readonly string[]).includes(kind) === false)
        throw Error(`unknown kind: ${kind}`);
      for (const entry of Object.values(await loadScenarioEntries())) {
        if (kind !== undefined && entry.kind !== kind) continue;
        if (entry.kind === "patrol" && all === false && entry.mapKey !== ct.w.mapKey) continue;
        yield summary(entry, all);
      }
      return;
    }
    case "get":
      yield await getEntry(rest[0]);
      return;
    case "save":
      return void (await savePatrol(ct, rest));
    case "rm": {
      const { key } = await getEntry(rest[0]);
      if (import.meta.env.DEV !== true) throw Error("removing needs the dev server");
      await deleteScenarioEntry(key);
      return;
    }
    default:
      throw Error("usage: sc {list,ls,get,save,rm} …");
  }
}

async function getEntry(key: undefined | string) {
  if (key === undefined || isScenarioKey(key) === false) throw Error(`expected {${scenarioKinds}}/{slug}: ${key}`);
  const entry = (await loadScenarioEntries())[key];
  if (entry === undefined) throw Error(`not found: ${key}`);
  return entry;
}

/** One line, e.g. `patrol/basic-patrol guard-0 3 points cycle` */
function summary(entry: ScenarioEntry, all: boolean) {
  if (entry.kind === "character") return `${entry.key} ${entry.npcKey ?? "-"}`;
  const cycle = entry.cycle ? " cycle" : "";
  return `${entry.key} ${entry.npcKey ?? "-"} ${entry.points.length} points${cycle}${all ? ` on ${entry.mapKey}` : ""}`;
}

/**
 * A patrol on this map, from `path:` or `cycle:` points, else the saved one's.
 * Options given replace the saved patrol's
 */
async function savePatrol(ct: JshCli.RunArg, [key, ...args]: string[]) {
  if (key === undefined || isScenarioKey(key) === false || key.startsWith("patrol/") === false)
    throw Error(`expected patrol/{slug}: ${key}`);
  if (import.meta.env.DEV !== true) throw Error("saving needs the dev server");
  const opts = ct.api.jsArg(args) as {
    path?: unknown[];
    cycle?: boolean | unknown[];
    npc?: string;
    watch?: string | string[];
    say?: string;
    name?: string;
  };
  const prev = (await loadScenarioEntries())[key] as undefined | PatrolEntry;
  const given = Array.isArray(opts.cycle) ? opts.cycle : opts.path;
  if (given === undefined && prev === undefined) throw Error("expected path:<points> or cycle:<points>");
  const points = given === undefined ? undefined : await toPoints(ct, given);
  const watch = typeof opts.watch === "string" ? opts.watch.split(",") : opts.watch;
  const entry = PatrolEntrySchema.parse({
    ...prev,
    key,
    kind: "patrol",
    name: opts.name ?? prev?.name ?? key.slice("patrol/".length),
    mapKey: points === undefined ? prev?.mapKey : ct.w.mapKey,
    points: points ?? prev?.points,
    cycle: opts.cycle === undefined ? prev?.cycle : opts.cycle !== false,
    npcKey: opts.npc ?? prev?.npcKey,
    watch: watch ?? prev?.watch,
    say: opts.say ?? prev?.say,
  });
  await saveScenarioEntry(entry);
  ct.api.writeInfo(`saved ${summary(entry, true)}`);
}

/** Floor points on the navmesh, to the cm: pick events, `[x, y]`, `{ x, y }` or spot keys */
async function toPoints(ct: JshCli.RunArg, given: unknown[]): Promise<[number, number][]> {
  const spotKeys = given.filter((x): x is string => typeof x === "string");
  const unknown = spotKeys.find((x) => spotKeyRe.test(x) === false);
  if (unknown !== undefined) throw Error(`not a spot: ${unknown}`);
  const answers = await spotQuery(
    ct,
    spotKeys.map((spotKey) => ({ q: "get", key: spotKey })),
  );
  const spots = new Map(spotKeys.map((spotKey, i) => [spotKey, answers[i]]));
  return given.map((x, i) => {
    const spot = typeof x === "string" ? spots.get(x) : undefined;
    const at =
      spot != null && !Array.isArray(spot) && "x" in spot
        ? { x: spot.x, y: spot.y }
        : typeof x === "string"
          ? null
          : ct.w.helper.parseGroundPoint(x as JshCli.PointAnyFormat);
    if (at === null) throw Error(`point ${i}: no spot ${x}`);
    const found = ct.w.npc.getClosestPoly(at, 0.5);
    if (found.success === false) throw Error(`point ${i}: off the navmesh`);
    return [cm(found.position[0]), cm(found.position[2])];
  });
}

const cm = (x: number) => Math.round(x * 100) / 100;

/** For `act patrol`: kept off the shell as an object */
export const patrols = {
  /** A saved patrol by `{slug}` or `patrol/{slug}`, else a patrol value, e.g. `$( sc get … )`: on this map */
  async find(ct: JshCli.RunArg, value: unknown): Promise<PatrolEntry> {
    const key = typeof value === "string" ? (value.startsWith("patrol/") ? value : `patrol/${value}`) : null;
    const entry = key === null ? value : (await loadScenarioEntries())[key];
    if (entry === undefined) throw Error(`not found: ${key}`);
    const patrol = PatrolEntrySchema.parse(entry);
    if (patrol.mapKey !== ct.w.mapKey) throw Error(`${patrol.key} is on ${patrol.mapKey}`);
    return patrol;
  },
  toPoints,
};
