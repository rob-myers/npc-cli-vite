import z from "zod";

/** A folder of entries each */
export const scenarioKinds = ["character", "route"] as const;

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

/** A way a guard walks on one map, stopping at each point to look either side — `act guard route:{slug}` */
export const RouteEntrySchema = z.object({
  ...EntryBase,
  kind: z.literal("route"),
  mapKey: z.string(),
  /** Floor points `[x, y]`, in metres */
  points: z.array(z.tuple([z.number(), z.number()])).min(2),
  /** Back to the first after the last, else back and forth */
  cycle: z.boolean().default(false),
  /** Who walks it, else `guard-0` */
  npcKey: z.string().optional(),
  /** Who they watch for: none listed is the player */
  watch: z.array(z.string()).default([]),
  /** What they say on seeing one */
  say: z.string().default("Halt!"),
  /** Their sighting is left to a script reading `guard-spotted`: they neither halt nor speak */
  custom: z.boolean().default(false),
  /** Game seconds stopped at each point, then looking each way, and how far each way in degrees */
  stop: z
    .object({ secs: z.number().default(2), lookSecs: z.number().default(2), lookDeg: z.number().default(60) })
    .default({ secs: 2, lookSecs: 2, lookDeg: 60 }),
});

/** One file, `packages/media/src/scenario/{kind}/{slug}.json` — see `docs/scenarios.md` */
export const ScenarioEntrySchema = z.discriminatedUnion("kind", [CharacterEntrySchema, RouteEntrySchema]);

export type ScenarioEntry = z.infer<typeof ScenarioEntrySchema>;
export type CharacterEntry = z.infer<typeof CharacterEntrySchema>;
export type RouteEntry = z.infer<typeof RouteEntrySchema>;

/** A character with an npc, who can be spawned */
export type ScenarioCharacter = CharacterEntry & { npcKey: string };

export function isCharacterEntry(entry: ScenarioEntry): entry is CharacterEntry {
  return entry.kind === "character";
}

export function isScenarioCharacter(entry: ScenarioEntry): entry is ScenarioCharacter {
  return entry.kind === "character" && entry.npcKey !== undefined;
}

export function isRouteEntry(entry: ScenarioEntry): entry is RouteEntry {
  return entry.kind === "route";
}

export function isScenarioKey(key: string) {
  const [kind, slug, ...rest] = key.split("/");
  return rest.length === 0 && (scenarioKinds as readonly string[]).includes(kind) && scenarioSlugRe.test(slug ?? "");
}

/** Development endpoint: GET every entry by key; POST or DELETE `{scenarioApiPath}/file/{kind}/{slug}` */
export const scenarioApiPath = "/api/scenario";

/** Sent when a scenario file is added, changed or removed */
export const scenarioChangedEvent = "scenario-changed";
