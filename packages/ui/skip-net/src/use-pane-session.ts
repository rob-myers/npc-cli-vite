import type { JshUiMeta } from "@npc-cli/ui__jsh/schema";
import { UiContext } from "@npc-cli/ui-sdk/UiContext";
import { useContext } from "react";
import { useShallow } from "zustand/react/shallow";
import type { SkipNetLeaf } from "./schema";

/** Every tty, and the pane's: its own, else the first whose World is ours, else the first */
export function usePaneSession(leaf: SkipNetLeaf, worldKey: string) {
  const { uiStore } = useContext(UiContext);
  const ttyMetas = uiStore(
    useShallow(({ byId }) =>
      Object.values(byId).flatMap(({ meta }) => (meta.uiKey === "Jsh" ? (meta as JshUiMeta) : [])),
    ),
  );
  const ttyMeta =
    ttyMetas.find((x) => x.sessionKey === leaf.sessionKey) ??
    ttyMetas.find((x) => x.env.WORLD_KEY === worldKey) ??
    ttyMetas[0] ??
    null;
  return { ttyMetas, ttyMeta };
}
