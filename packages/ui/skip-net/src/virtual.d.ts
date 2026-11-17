/** Provided by `@npc-cli/scripts/vite-plugin-skip-net-articles` */
declare module "virtual:skip-net-articles" {
  /** Each article's size and last modified time, by key e.g. `npc-spawn` */
  const byKey: Record<string, { bytes: number; modifiedMs: number }>;
  export default byKey;
}
