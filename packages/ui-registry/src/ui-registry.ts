import Blog from "@npc-cli/ui__blog";
import Global from "@npc-cli/ui__global";
import Jsh from "@npc-cli/ui__jsh";
import Tabs from "@npc-cli/ui__tabs";
import Template from "@npc-cli/ui__template";
import World from "@npc-cli/ui__world";
import type { UiPackageDef } from "@npc-cli/ui-sdk";

// https://github.com/microsoft/TypeScript/issues/47663#issuecomment-1519138189
export const uiRegistry: {
  Blog: typeof Blog;
  Global: typeof Global;
  Jsh: typeof Jsh;
  Tabs: typeof Tabs;
  Template: typeof Template;
  World: typeof World;
} = {
  Blog,
  Global,
  Jsh,
  Tabs,
  Template,
  World,
} satisfies Record<string, UiPackageDef>;

export type UiRegistry = typeof uiRegistry;

export type UiRegistryKey = keyof typeof uiRegistry;

export const uiRegistryKeys = Object.keys(uiRegistry) as UiRegistryKey[];
