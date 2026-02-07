import Blog from "@npc-cli/ui__blog";
import Global from "@npc-cli/ui__global";
import Jsh from "@npc-cli/ui__jsh";
import Tabs from "@npc-cli/ui__tabs";
import Template from "@npc-cli/ui__template";
import World from "@npc-cli/ui__world";
import type { UiPackageDef } from "@npc-cli/ui-sdk";

export type UiRegistry = {
  Blog: typeof Blog;
  Global: typeof Global;
  Jsh: typeof Jsh;
  Tabs: typeof Tabs;
  Template: typeof Template;
  World: typeof World;
};

export const uiRegistryFactory = (): UiRegistry =>
  ({
    Blog,
    Global,
    Jsh,
    Tabs,
    Template,
    World,
  }) satisfies Record<string, UiPackageDef>;

export let uiRegistry: UiRegistry;
if (import.meta.hot) {
  const curr = import.meta.hot.data.__UI_REGISTRY__;
  const next = uiRegistryFactory();
  if (!curr) {
    uiRegistry = import.meta.hot.data.__UI_REGISTRY__ = next;
  } else {
    Object.keys(next).forEach((key) => (curr[key] ??= next[key as UiRegistryKey]));
    // Object.keys(curr).forEach((key) => !(key in next) && delete curr[key]);
    uiRegistry = curr;
  }
} else {
  uiRegistry = uiRegistryFactory();
}

export type UiRegistryKey = keyof typeof uiRegistry;

export const uiRegistryKeys = Object.keys(uiRegistry) as UiRegistryKey[];
