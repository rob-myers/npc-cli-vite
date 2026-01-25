import Blog from "@npc-cli/ui__blog";
import Global from "@npc-cli/ui__global";
import Jsh from "@npc-cli/ui__jsh";
import Template from "@npc-cli/ui__template";
import World from "@npc-cli/ui__world";
import type { UiPackageDef } from "@npc-cli/ui-sdk";

export const uiRegistry = {
  Blog,
  Global,
  Jsh,
  Template,
  World,
} satisfies Record<string, UiPackageDef>;

export type UiRegistryKey = keyof typeof uiRegistry;

export const uiRegistryKeys = Object.keys(uiRegistry) as UiRegistryKey[];
