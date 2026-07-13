import type { ProfileKey } from "@npc-cli/cli/jsh/profiles";
import Jsh from "@npc-cli/ui__jsh";
import MapEdit from "@npc-cli/ui__map-edit";
import Tabs from "@npc-cli/ui__tabs";
import World from "@npc-cli/ui__world";
import { isTouchDevice } from "@npc-cli/util/legacy/dom";

/**
 * We also provide `toUi` for panes.
 */
export function getDefaultTabs() {
  const uid = () => `ui-${crypto.randomUUID()}`;

  const ttyKey = "tty-0";
  const worldKey = "world-0";
  const profileKey: ProfileKey = "world_profile_v0";

  const jshMeta = Jsh.schema.decode({
    id: uid(),
    title: ttyKey,
    uiKey: "Jsh",
    sessionKey: ttyKey,
    env: {
      PROFILE_KEY: profileKey,
      CACHE_SHORTCUTS: {
        w: "WORLD_KEY",
      },
      WORLD_KEY: worldKey,
    },
  });

  const worldMeta = World.schema.decode({ id: uid(), title: worldKey, uiKey: "World", worldKey });

  const mapEditMeta = MapEdit.schema.decode({
    id: uid(),
    title: "map-edit-0",
    uiKey: "MapEdit",
  });

  if (isTouchDevice()) {
    // only one Tabs on mobile
    const tabsMeta = Tabs.schema.decode({
      id: uid(),
      title: "tabs-0",
      uiKey: "Tabs",
      items: [worldMeta.id, jshMeta.id, mapEditMeta.id],
      currentTabId: worldMeta.id,
    });
    worldMeta.parentId = tabsMeta.id;
    jshMeta.parentId = tabsMeta.id;
    mapEditMeta.parentId = tabsMeta.id;
    return {
      tabs: [tabsMeta],
      toUi: Object.fromEntries([jshMeta, worldMeta, mapEditMeta, tabsMeta].map((meta) => [meta.id, meta])),
    };
  } else {
    const tabs0Meta = Tabs.schema.decode({
      id: uid(),
      title: "tabs-0",
      uiKey: "Tabs",
      items: [worldMeta.id],
      currentTabId: worldMeta.id,
    });
    worldMeta.parentId = tabs0Meta.id;

    const tabs1Meta = Tabs.schema.decode({
      id: uid(),
      title: "tabs-1",
      uiKey: "Tabs",
      items: [jshMeta.id, mapEditMeta.id],
      currentTabId: jshMeta.id,
    });
    jshMeta.parentId = tabs0Meta.id;
    mapEditMeta.parentId = tabs0Meta.id;

    return {
      tabs: [tabs0Meta, tabs1Meta],
      toUi: Object.fromEntries([jshMeta, worldMeta, mapEditMeta, tabs0Meta, tabs1Meta].map((meta) => [meta.id, meta])),
    };
  }
}
