/** Provided by `@npc-cli/scripts/vite-plugin-scenario` */
declare module "virtual:scenario" {
  /** Entries by key e.g. `character/rob`; empty during development */
  const byKey: Record<string, import("../scenario.schema").ScenarioEntry>;
  export default byKey;
}
