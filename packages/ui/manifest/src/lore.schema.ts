import z from "zod";

/** Only characters, as yet: still a folder of their own, so another kind can join them */
export const loreKinds = ["character"] as const;

/** A file's name, and an entry's key after its kind */
export const loreSlugRe = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** One file, `packages/media/lore/{kind}/{slug}.json` — see `docs/manifest-lore.md` */
export const LoreEntrySchema = z.object({
  /** `{kind}/{slug}`, as its path */
  key: z.string(),
  kind: z.enum(loreKinds),
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
