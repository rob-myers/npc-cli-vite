import type { UiRegistry } from "@npc-cli/ui-registry";
import type { UiInstanceMeta } from "./schema";

type WorldUiMeta = React.ComponentProps<UiRegistry["World"]["ui"]>["meta"];

export function isWorldUiMeta(meta: UiInstanceMeta): meta is WorldUiMeta {
  return meta?.uiKey === "World";
}
