import z from "zod";

/** Only characters, as yet: still a folder of their own, so another kind can join them */
export const scenarioKinds = ["character"] as const;

/** A file's name, and an entry's key after its kind */
export const scenarioSlugRe = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** One file, `packages/media/src/scenario/{kind}/{slug}.json` — see `docs/scenarios.md` */
export const ScenarioEntrySchema = z.object({
  /** `{kind}/{slug}`, as its path */
  key: z.string(),
  kind: z.enum(scenarioKinds),
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

export type ScenarioEntry = z.infer<typeof ScenarioEntrySchema>;

/** A character with an npc, who can be spawned */
export type ScenarioCharacter = ScenarioEntry & { kind: "character"; npcKey: string };

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
