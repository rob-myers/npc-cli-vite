/** Provided by `@npc-cli/scripts/vite-plugin-jobs-examples` */
declare module "virtual:jobs-examples" {
  /** Markdown keyed by filename e.g. `core.md`; empty during development */
  const byFilename: Record<string, string>;
  export default byFilename;
}
