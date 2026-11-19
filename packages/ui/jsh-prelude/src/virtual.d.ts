/** Provided by `@npc-cli/scripts/vite-plugin-skip-net-articles` */
declare module "virtual:skip-net-autorun" {
  /** Each SkipNet shell fence with a command autorunning by default, its source as MDX gives it */
  const fences: { articleKey: string; src: string }[];
  export default fences;
}
