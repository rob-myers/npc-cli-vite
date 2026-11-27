/** Provided by `@npc-cli/scripts/vite-plugin-skip-net-articles` */
declare module "virtual:skip-net-articles" {
  /** Each article's size and last modified time, by key e.g. `npc-spawn`. Its `parts`, each file's own times, by path e.g. `npc/npc-spawn.mdx` */
  const byKey: Record<
    string,
    { bytes: number; modifiedMs: number; parts: Record<string, { createdMs: number; modifiedMs: number }> }
  >;
  export default byKey;
}
