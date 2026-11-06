import {
  type GraphEntry,
  GraphEntrySchema,
  isScenarioKey,
  type ScenarioEntry,
  scenarioKinds,
} from "@npc-cli/ui__world/scenario.schema";
import { deleteScenarioEntry, loadScenarioEntries, saveScenarioEntry } from "@npc-cli/ui__world/scenario-shared";
import { graphs } from "./graph";

/**
 * Scenario entries, as saved in `packages/media/src/scenario` — see `docs/scenarios.md`, `docs/npc-graphs.md`.
 * `list` or `ls` a kind's, graphs on this map unless `--all`. `get` one. `save` a graph, `walk` one, or `rm` an entry (DEV)
 *
 * ```sh
 * sc ls graph
 * sc list graph --all
 * sc get graph/test-patrol
 * sc save graph/my-path path:$( pick 3 )
 * sc save graph/my-loop cycle:$( [] g0r12-3 g0r12-4 g0r3-1 ) directed
 * sc walk graph/my-path
 * sc rm graph/my-path
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
        if (entry.kind === "graph" && all === false && entry.mapKey !== ct.w.mapKey) continue;
        yield summary(entry, all);
      }
      return;
    }
    case "get":
      yield await getEntry(rest[0]);
      return;
    case "save":
      return void (await saveGraph(ct, rest));
    case "walk":
      yield graphs.closedWalk(await graphs.find(ct, rest[0])).join(" ");
      return;
    case "rm": {
      const { key } = await getEntry(rest[0]);
      if (import.meta.env.DEV !== true) throw Error("removing needs the dev server");
      await deleteScenarioEntry(key);
      return;
    }
    default:
      throw Error("usage: sc {list,ls,get,save,walk,rm} …");
  }
}

async function getEntry(key: undefined | string) {
  if (key === undefined || isScenarioKey(key) === false) throw Error(`expected {${scenarioKinds}}/{slug}: ${key}`);
  const entry = (await loadScenarioEntries())[key];
  if (entry === undefined) throw Error(`not found: ${key}`);
  return entry;
}

/** One line, e.g. `graph/my-path 3 nodes 2 edges directed` */
function summary(entry: ScenarioEntry, all: boolean) {
  if (entry.kind === "character") return `${entry.key} ${entry.npcKey ?? "-"}`;
  const directed = entry.directed ? " directed" : "";
  return `${entry.key} ${entry.nodes.length} nodes ${entry.edges.length} edges${directed}${all ? ` on ${entry.mapKey}` : ""}`;
}

/**
 * A graph on this map through `path:` or `cycle:` points, else the saved one's nodes and edges.
 * Options given replace the saved graph's. Its meta is kept
 */
async function saveGraph(ct: JshCli.RunArg, [key, ...args]: string[]) {
  if (key === undefined || isScenarioKey(key) === false || key.startsWith("graph/") === false)
    throw Error(`expected graph/{slug}: ${key}`);
  if (import.meta.env.DEV !== true) throw Error("saving needs the dev server");
  const opts = ct.api.jsArg(args) as {
    path?: unknown[];
    cycle?: unknown[];
    directed?: boolean;
    name?: string;
  };
  const prev = (await loadScenarioEntries())[key] as undefined | GraphEntry;
  const given = Array.isArray(opts.cycle) ? opts.cycle : opts.path;
  if (given === undefined && prev === undefined) throw Error("expected path:<points> or cycle:<points>");
  const directed = opts.directed ?? prev?.directed ?? false;
  const made = given === undefined ? undefined : await graphs.through(ct, given, Array.isArray(opts.cycle), directed);
  const entry = GraphEntrySchema.parse({
    ...prev,
    key,
    kind: "graph",
    name: opts.name ?? prev?.name ?? key.slice("graph/".length),
    mapKey: made === undefined ? prev?.mapKey : ct.w.mapKey,
    directed,
    nodes: made?.nodes ?? prev?.nodes,
    edges: made?.edges ?? prev?.edges,
  });
  await saveScenarioEntry(entry);
  ct.api.writeInfo(`saved ${summary(entry, true)}`);
}
