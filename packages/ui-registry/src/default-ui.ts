import type { ProfileKey } from "@npc-cli/cli/jsh/profiles";
import { isTouchDevice } from "@npc-cli/util/legacy/dom";
import { uiSchemas } from "./ui-schemas";

/**
 * We also provide `toUi` for panes.
 */
export function getDefaultTabs() {
  const uid = () => `ui-${crypto.randomUUID()}`;

  const jobsKey = "jobs-0";
  const profileKey: ProfileKey = "default_profile";
  const ttyKey = "tty-0";
  const worldKey = "world-0";

  const jobsMeta = uiSchemas.Jobs.decode({ id: uid(), title: jobsKey, uiKey: "Jobs" });

  const jshMeta = uiSchemas.Jsh.decode({
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

  const mapEditMeta = uiSchemas.MapEdit.decode({
    id: uid(),
    title: "mapedit-0",
    uiKey: "MapEdit",
  });

  const worldMeta = uiSchemas.World.decode({ id: uid(), title: worldKey, uiKey: "World", worldKey });

  if (isTouchDevice()) {
    // only one Tabs on mobile
    const tabsMeta = uiSchemas.Tabs.decode({
      id: uid(),
      title: "tabs-0",
      uiKey: "Tabs",
      items: [worldMeta.id, jobsMeta.id, jshMeta.id, mapEditMeta.id],
      currentTabId: worldMeta.id,
    });
    worldMeta.parentId = tabsMeta.id;
    jshMeta.parentId = tabsMeta.id;
    jobsMeta.parentId = tabsMeta.id;
    mapEditMeta.parentId = tabsMeta.id;
    return {
      tabs: [tabsMeta],
      toUi: Object.fromEntries([jshMeta, jobsMeta, worldMeta, mapEditMeta, tabsMeta].map((meta) => [meta.id, meta])),
    };
  } else {
    const tabs0Meta = uiSchemas.Tabs.decode({
      id: uid(),
      title: "tabs-0",
      uiKey: "Tabs",
      items: [worldMeta.id],
      currentTabId: worldMeta.id,
    });
    worldMeta.parentId = tabs0Meta.id;

    const tabs1Meta = uiSchemas.Tabs.decode({
      id: uid(),
      title: "tabs-1",
      uiKey: "Tabs",
      items: [jshMeta.id],
      currentTabId: jshMeta.id,
    });
    jshMeta.parentId = tabs1Meta.id;

    const tabs2Meta = uiSchemas.Tabs.decode({
      id: uid(),
      title: "tabs-2",
      uiKey: "Tabs",
      items: [jobsMeta.id, mapEditMeta.id],
      currentTabId: jobsMeta.id,
    });
    jobsMeta.parentId = tabs2Meta.id;
    mapEditMeta.parentId = tabs2Meta.id;

    return {
      tabs: [tabs0Meta, tabs1Meta, tabs2Meta],
      toUi: Object.fromEntries(
        [jshMeta, jobsMeta, worldMeta, mapEditMeta, tabs0Meta, tabs1Meta, tabs2Meta].map((meta) => [meta.id, meta]),
      ),
    };
  }
}
