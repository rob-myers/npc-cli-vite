import Blog from "@npc-cli/ui__blog";
import Global from "@npc-cli/ui__global";
import Jsh from "@npc-cli/ui__jsh";
import MapEdit from "@npc-cli/ui__map-edit";
import Tabs from "@npc-cli/ui__tabs";
import Template from "@npc-cli/ui__template";
import World from "@npc-cli/ui__world";
import type { UiPackageDef } from "@npc-cli/ui-sdk";

/**
 * 1. Extend type `UiRegistry`
 * 2. Extend function `uiRegistryFactory`
 * 3. Extend lookup `mirrored` in packages/ui-sdk/src/schema.ts
 */
export type UiRegistry = {
  Blog: typeof Blog;
  Global: typeof Global;
  Jsh: typeof Jsh;
  MapEdit: typeof MapEdit;
  Tabs: typeof Tabs;
  Template: typeof Template;
  World: typeof World;
};

export const uiRegistryFactory = (): UiRegistry =>
  ({
    Blog,
    Global,
    Jsh,
    MapEdit,
    Tabs,
    Template,
    World,
  }) satisfies Record<string, UiPackageDef>;

// preserving uiRegistry fixes hmr of lazy components
export let uiRegistry: UiRegistry;
if (import.meta.hot) {
  const curr = import.meta.hot.data.__UI_REGISTRY__;
  const next = uiRegistryFactory();
  if (!curr) {
    uiRegistry = import.meta.hot.data.__UI_REGISTRY__ = next;
  } else {
    for (const key of Object.keys(curr)) {
      if (curr[key]) {
        curr[key].schema = next[key as UiRegistryKey].schema;
      } else {
        curr[key] = next[key as UiRegistryKey];
      }
    }
    uiRegistry = curr;
  }
} else {
  uiRegistry = uiRegistryFactory();
}

export type UiRegistryKey = keyof typeof uiRegistry;

export const uiRegistryKeys = Object.keys(uiRegistry) as UiRegistryKey[];
