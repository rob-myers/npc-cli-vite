import { lazy } from "react";

export const uiRegistry = {
  Blog: lazy(() => import("@npc-cli/ui__blog")),
  Global: lazy(() => import("@npc-cli/ui__global")),
  Jsh: lazy(() => import("@npc-cli/ui__jsh")),
  Template: lazy(() => import("@npc-cli/ui__template")),
  World: lazy(() => import("@npc-cli/ui__world")),
};

export type UiRegistryKey = keyof typeof uiRegistry;

export const uiRegistryKeys = Object.keys(uiRegistry) as UiRegistryKey[];
