import Blog from "@npc-cli/ui__blog";
import Global from "@npc-cli/ui__global";
import Jsh from "@npc-cli/ui__jsh";
import Template from "@npc-cli/ui__template";
import World from "@npc-cli/ui__world";
import type { UiPackageDef } from "@npc-cli/ui-sdk";

// https://github.com/microsoft/TypeScript/issues/47663#issuecomment-1519138189
export const uiRegistry: {
  Blog: typeof Blog;
  Global: typeof Global;
  Jsh: typeof Jsh;
  Template: typeof Template;
  World: typeof World;
} = {
  Blog,
  Global,
  Jsh,
  Template,
  World,
} satisfies Record<string, UiPackageDef>;

export type UiRegistryKey = keyof typeof uiRegistry;

export const uiRegistryKeys = Object.keys(uiRegistry) as UiRegistryKey[];
