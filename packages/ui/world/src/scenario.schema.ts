import z from "zod";

/** A folder of entries each */
export const scenarioKinds = ["character", "graph"] as const;

/** A file's name, and an entry's key after its kind */
export const scenarioSlugRe = /^[a-z0-9]+(-[a-z0-9]+)*$/;

const EntryBase = {
  /** `{kind}/{slug}`, as its path */
  key: z.string(),
  name: z.string().default(""),
};

export const CharacterEntrySchema = z.object({
  ...EntryBase,
  kind: z.literal("character"),
  /** Their npc in the World */
  npcKey: z.string().optional(),
  /** e.g. `medic-0` */
  skin: z.string().optional(),
  /** By mapKey: the rooms that are theirs, and the doors they hold keys to */
  maps: z
    .record(z.string(), z.object({ rooms: z.array(z.string()).default([]), doors: z.array(z.string()).default([]) }))
    .default({}),
});

/** Free-form, read by the behaviours using a graph */
const GraphMetaSchema = z.record(z.string(), z.unknown()).default({});

const GraphNodeSchema = z.object({
  /** Stable, e.g. `n3`, so edges survive edits */
  id: z.string(),
  /** Floor point `[x, y]`, in metres: its spot's when last saved */
  at: z.tuple([z.number(), z.number()]),
  /** A spot's alias or key, e.g. `g0r12-3`: readers take its point over `at` */
  spot: z.string().optional(),
  meta: GraphMetaSchema,
});

const GraphEdgeSchema = z.object({ from: z.string(), to: z.string(), meta: GraphMetaSchema });

/** Two edges with one key are the same edge: either way round unless directed */
export function edgeKey(from: string, to: string, directed: boolean) {
  return directed || from < to ? `${from} ${to}` : `${to} ${from}`;
}

/** Nodes and edges on one map, read by jsh behaviours, e.g. `act patrol {slug}` — see `docs/npc-graphs.md` */
export const GraphEntrySchema = z
  .object({
    ...EntryBase,
    kind: z.literal("graph"),
    mapKey: z.string(),
    directed: z.boolean().default(false),
    meta: GraphMetaSchema,
    nodes: z.array(GraphNodeSchema).min(1),
    edges: z.array(GraphEdgeSchema).default([]),
  })
  .superRefine((graph, ctx) => {
    const ids = new Set(graph.nodes.map((n) => n.id));
    if (ids.size < graph.nodes.length) ctx.addIssue({ code: "custom", message: "node ids repeat" });
    const seen = new Set<string>();
    for (const { from, to } of graph.edges) {
      if (!ids.has(from) || !ids.has(to)) ctx.addIssue({ code: "custom", message: `edge ${from} ${to}: no such node` });
      if (from === to) ctx.addIssue({ code: "custom", message: `edge ${from} ${to}: a loop` });
      const key = edgeKey(from, to, graph.directed);
      if (seen.has(key)) ctx.addIssue({ code: "custom", message: `edge ${from} ${to}: repeated` });
      seen.add(key);
    }
  });

/** One file, `packages/media/src/scenario/{kind}/{slug}.json` — see `docs/scenarios.md` */
export const ScenarioEntrySchema = z.discriminatedUnion("kind", [CharacterEntrySchema, GraphEntrySchema]);

export type ScenarioEntry = z.infer<typeof ScenarioEntrySchema>;
export type CharacterEntry = z.infer<typeof CharacterEntrySchema>;
export type GraphEntry = z.infer<typeof GraphEntrySchema>;
export type GraphNode = z.infer<typeof GraphNodeSchema>;
export type GraphEdge = z.infer<typeof GraphEdgeSchema>;

/** A character with an npc, who can be spawned */
export type ScenarioCharacter = CharacterEntry & { npcKey: string };

export function isCharacterEntry(entry: ScenarioEntry): entry is CharacterEntry {
  return entry.kind === "character";
}

export function isScenarioCharacter(entry: ScenarioEntry): entry is ScenarioCharacter {
  return entry.kind === "character" && entry.npcKey !== undefined;
}

export function isGraphEntry(entry: ScenarioEntry): entry is GraphEntry {
  return entry.kind === "graph";
}

export function isScenarioKey(key: string) {
  const [kind, slug, ...rest] = key.split("/");
  return rest.length === 0 && (scenarioKinds as readonly string[]).includes(kind) && scenarioSlugRe.test(slug ?? "");
}

/** Development endpoint: GET every entry by key; POST or DELETE `{scenarioApiPath}/file/{kind}/{slug}` */
export const scenarioApiPath = "/api/scenario";

/** Sent when a scenario file is added, changed or removed */
export const scenarioChangedEvent = "scenario-changed";
