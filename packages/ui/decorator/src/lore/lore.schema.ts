import z from "zod";

export const loreKinds = ["setting", "level", "place", "faction", "character"] as const;
export type LoreKind = (typeof loreKinds)[number];

/** A file's name, and an entry's key after its kind */
export const loreSlugRe = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** One file, `packages/media/lore/{kind}/{slug}.json` — see `docs/lore.md` */
export const LoreEntrySchema = z.object({
  /** `{kind}/{slug}`, as its path */
  key: z.string(),
  kind: z.enum(loreKinds),
  title: z.string().default(""),
  /** One line */
  summary: z.string().default(""),
  backstory: z.string().default(""),
  /** How they speak */
  voice: z.string().default(""),
  /** A character's npc in the World */
  npcKey: z.string().optional(),
  /** A character's skin, e.g. `medic-0` */
  skin: z.string().optional(),
  /** By mapKey: the rooms that are theirs (or are this place), and the doors a character may open */
  maps: z
    .record(z.string(), z.object({ rooms: z.array(z.string()).default([]), doors: z.array(z.string()).default([]) }))
    .default({}),
  /** e.g. `{ role: "watchman" }` — each is a grammar rule too */
  facts: z.record(z.string(), z.string()).default({}),
  /** Other entries' keys, whose grammars this one inherits */
  links: z.array(z.string()).default([]),
  /** Tracery rules — see `tracery.ts` */
  grammar: z.record(z.string(), z.array(z.string())).default({}),
  /** Ink or Yarn source, unused as yet */
  dialogue: z.string().optional(),
});

export type LoreEntry = z.infer<typeof LoreEntrySchema>;

/** A character with an npc, who can be spawned */
export type LoreCharacter = LoreEntry & { kind: "character"; npcKey: string };

export function isLoreCharacter(entry: LoreEntry): entry is LoreCharacter {
  return entry.kind === "character" && entry.npcKey !== undefined;
}

export function isLoreKey(key: string) {
  const [kind, slug, ...rest] = key.split("/");
  return rest.length === 0 && (loreKinds as readonly string[]).includes(kind) && loreSlugRe.test(slug ?? "");
}

/** Development endpoint: GET every entry by key; POST or DELETE `{loreApiPath}/file/{kind}/{slug}` */
export const loreApiPath = "/api/lore";

/** Sent when a lore file is added, changed or removed */
export const loreChangedEvent = "lore-changed";
