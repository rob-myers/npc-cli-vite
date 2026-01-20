import type { UiBootstrapProps, UiProps } from "@npc-cli/ui-sdk";
import { lazy } from "react";

export const uiRegistry = {
  Blog: lazy(() => import("@npc-cli/ui__blog")),
  Global: lazy(() => import("@npc-cli/ui__global")),
  Jsh: lazy(() => import("@npc-cli/ui__jsh")),
  Template: lazy(() => import("@npc-cli/ui__template")),
  World: lazy(() => import("@npc-cli/ui__world")),
} satisfies Record<string, React.LazyExoticComponent<(props: UiProps) => React.ReactNode>>;

export const uiBootstrapRegistry: Partial<
  Record<UiRegistryKey, React.LazyExoticComponent<(props: UiBootstrapProps) => React.ReactNode>>
> = {
  Jsh: lazy(() => import("@npc-cli/ui__jsh/bootstrap")),
};

export type UiRegistryKey = keyof typeof uiRegistry;

export const uiRegistryKeys = Object.keys(uiRegistry) as UiRegistryKey[];
