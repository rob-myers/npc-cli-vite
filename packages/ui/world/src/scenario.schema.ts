import z from "zod";

/** A folder of entries each */
export const scenarioKinds = ["graph"] as const;

/** A file's name, and an entry's key after its kind */
export const scenarioSlugRe = /^[a-z0-9]+(-[a-z0-9]+)*$/;

const EntryBase = {
  /** `{kind}/{slug}`, as its path */
  key: z.string(),
  name: z.string().default(""),
};

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

const GraphEdgeSchema = z.object({
  /** Stable, e.g. `e3`: parallel edges share their ends */
  id: z.string(),
  from: z.string(),
  to: z.string(),
  meta: GraphMetaSchema,
});

/** A directed multigraph on one map, read by jsh behaviours, e.g. `act patrol {slug}` — see `docs/graphs.md` */
export const GraphEntrySchema = z
  .object({
    ...EntryBase,
    kind: z.literal("graph"),
    mapKey: z.string(),
    /** Read as its symmetric closure: each edge may also be taken backwards */
    undirected: z.boolean().default(false),
    meta: GraphMetaSchema,
    nodes: z.array(GraphNodeSchema).min(1),
    edges: z.array(GraphEdgeSchema).default([]),
  })
  .superRefine((graph, ctx) => {
    const ids = new Set(graph.nodes.map((n) => n.id));
    if (ids.size < graph.nodes.length) ctx.addIssue({ code: "custom", message: "node ids repeat" });
    if (new Set(graph.edges.map((e) => e.id)).size < graph.edges.length)
      ctx.addIssue({ code: "custom", message: "edge ids repeat" });
    for (const { id, from, to } of graph.edges) {
      if (!ids.has(from) || !ids.has(to)) ctx.addIssue({ code: "custom", message: `edge ${id}: no such node` });
      if (from === to) ctx.addIssue({ code: "custom", message: `edge ${id}: a loop` });
    }
  });

/** One file, `packages/media/src/scenario/{kind}/{slug}.json` — see `docs/graphs.md` */
export const ScenarioEntrySchema = z.discriminatedUnion("kind", [GraphEntrySchema]);

export type ScenarioEntry = z.infer<typeof ScenarioEntrySchema>;
export type GraphEntry = z.infer<typeof GraphEntrySchema>;
export type GraphNode = z.infer<typeof GraphNodeSchema>;
export type GraphEdge = z.infer<typeof GraphEdgeSchema>;

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
