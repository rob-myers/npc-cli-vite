/** Provided by `@npc-cli/scripts/vite-plugin-lore` */
declare module "virtual:lore" {
  /** Entries by key e.g. `character/ilse`; empty during development */
  const byKey: Record<string, import("./lore.schema").LoreEntry>;
  export default byKey;
}
