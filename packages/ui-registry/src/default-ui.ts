import Jsh from "@npc-cli/ui__jsh";
import Layout from "@npc-cli/ui__layout";
import World from "@npc-cli/ui__world";
import type { UiInstanceMeta } from "@npc-cli/ui-sdk";

export function getDefaultUiMetas(): UiInstanceMeta[] {
  const uid = () => `ui-${crypto.randomUUID()}`;

  const ttyKey = "tty-0";
  const worldKey = "world-0";

  const layoutMeta = Layout.schema.decode({ id: uid(), title: "layout-0", uiKey: "Layout" });
  const jshMeta = Jsh.schema.decode({
    id: uid(),
    title: ttyKey,
    uiKey: "Jsh",
    sessionKey: ttyKey,
    env: {
      WORLD_KEY: worldKey,
      CACHE_SHORTCUTS: {
        w: "WORLD_KEY",
      },
    },
  });
  const worldMeta = World.schema.decode({ id: uid(), title: worldKey, uiKey: "World", worldKey });

  const tabsMeta: UiInstanceMeta = {
    id: uid(),
    title: "tabs-0",
    uiKey: "Tabs",
    items: [layoutMeta.id, worldMeta.id, jshMeta.id],
    currentTabId: layoutMeta.id,
  };

  layoutMeta.parentId = tabsMeta.id;
  jshMeta.parentId = tabsMeta.id;
  worldMeta.parentId = tabsMeta.id;

  return [tabsMeta, layoutMeta, jshMeta, worldMeta];
}
