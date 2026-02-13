import { useThemeName } from "@npc-cli/theme";
import { uiRegistry } from "@npc-cli/ui-registry";
import { getFallbackLayoutApi, UiContext, uiStore, uiStoreApi } from "@npc-cli/ui-sdk";
import { deepClone } from "@npc-cli/util/legacy/generic";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";

import { UiGrid } from "../components/UiGrid";
import { UiPortalContainer } from "../components/UiPortalContainer";

import "react-grid-layout/css/styles.css";
import "react-resizable/css/styles.css";

export const Route = createFileRoute("/")({
  component: Index,
});

function Index() {
  const theme = useThemeName();

  const [persistedLayout] = useState(() => {
    // clone avoids immer freeze
    const persistedLayout = deepClone(uiStore.getState().persistedLayout);
    uiStoreApi.addUis({ metas: Object.values(persistedLayout.toUi), overwrite: false });
    return persistedLayout; // has ui layout info
  });

  const [contextValue, setContextValue] = useState(() => ({
    layoutApi: getFallbackLayoutApi(),
    theme,
    uiRegistry,
  }));

  return (
    <UiContext.Provider value={{ ...contextValue, theme }}>
      <UiGrid
        extendContextValue={(layoutApi) => setContextValue((prev) => ({ ...prev, layoutApi }))}
        persistedLayout={persistedLayout}
      />
      <UiPortalContainer />
    </UiContext.Provider>
  );
}
