import z from "zod";

/** Each a folder of its own, `packages/media/src/scenario/{kind}` */
export const scenarioKinds = ["character", "scenario"] as const;

/** A file's name, and an entry's key after its kind */
export const scenarioSlugRe = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** One character, `character/{slug}.json` — see `docs/scenarios.md` */
export const CharacterEntrySchema = z.object({
  /** `character/{slug}`, as its path */
  key: z.string(),
  kind: z.literal("character"),
  name: z.string().default(""),
  /** Their npc in the World */
  npcKey: z.string().optional(),
  /** e.g. `medic-0` */
  skin: z.string().optional(),
  /** By mapKey: the rooms that are theirs, and the doors they hold keys to */
  maps: z
    .record(z.string(), z.object({ rooms: z.array(z.string()).default([]), doors: z.array(z.string()).default([]) }))
    .default({}),
});

/** One scenario's definition, `scenario/{slug}.json`: roles by phases, each cell its lines — see `docs/scenarios.md` */
export const ScenarioDefSchema = z.object({
  /** `scenario/{slug}`, as its path */
  key: z.string(),
  kind: z.literal("scenario"),
  /** Prefixes an instance's id, e.g. `hns` for `hns-1` */
  short: z.string(),
  title: z.string(),
  summary: z.string().default(""),
  /** The map it is played on, and the rooms of it played in */
  map: z.string(),
  rooms: z.array(z.string()).default([]),
  /** By role: how many, and a skin key or prefix for those spawned */
  roles: z.record(z.string(), z.object({ count: z.number(), skin: z.string().optional() })),
  /** By role: npcs named to play it, else spawned */
  cast: z.record(z.string(), z.array(z.string())).default({}),
  /** Read by a line's `$name`, and by conditions as `s.params` */
  params: z.record(z.string(), z.unknown()).default({}),
  /** In order, each ending once `until`, a function of the state, holds */
  phases: z.array(z.object({ key: z.string(), until: z.string() })),
  /** By role, then phase: the lines each npc of that role runs, in order */
  cells: z.record(z.string(), z.record(z.string(), z.array(z.string()))),
  /** Checked for each npc of `for`: once `when` holds, it runs `do`, then `apply` changes the state */
  rules: z
    .array(
      z.object({
        for: z.string(),
        /** Checked only in these phases, else in every one */
        phases: z.array(z.string()).optional(),
        when: z.string(),
        do: z.array(z.string()).default([]),
        apply: z.string().optional(),
      }),
    )
    .default([]),
});

export const ScenarioEntrySchema = z.discriminatedUnion("kind", [CharacterEntrySchema, ScenarioDefSchema]);

export type CharacterEntry = z.infer<typeof CharacterEntrySchema>;
export type ScenarioDef = z.infer<typeof ScenarioDefSchema>;
export type ScenarioEntry = z.infer<typeof ScenarioEntrySchema>;

/** A character with an npc, who can be spawned */
export type ScenarioCharacter = CharacterEntry & { npcKey: string };

export function isScenarioCharacter(entry: ScenarioEntry): entry is ScenarioCharacter {
  return entry.kind === "character" && entry.npcKey !== undefined;
}

export function isScenarioKey(key: string) {
  const [kind, slug, ...rest] = key.split("/");
  return rest.length === 0 && (scenarioKinds as readonly string[]).includes(kind) && scenarioSlugRe.test(slug ?? "");
}

/** Development endpoint: GET every entry by key; POST or DELETE `{scenarioApiPath}/file/{kind}/{slug}` */
export const scenarioApiPath = "/api/scenario";

/** Sent when a scenario file is added, changed or removed */
export const scenarioChangedEvent = "scenario-changed";
