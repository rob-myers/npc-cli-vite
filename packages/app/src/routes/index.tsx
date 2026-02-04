import { UiContext, type UiContextValue, uiStore, uiStoreApi } from "@npc-cli/ui-sdk";
import { createFileRoute } from "@tanstack/react-router";

import "react-grid-layout/css/styles.css";
import "react-resizable/css/styles.css";
import { useThemeName } from "@npc-cli/theme";
import { uiRegistry } from "@npc-cli/ui-registry";
import { deepClone } from "@npc-cli/util/legacy/generic";
import { useMemo, useRef, useState } from "react";
import { type GridApi, UiGrid } from "../components/UiGrid";
import { UiPortalContainer } from "../components/UiPortalContainer";

export const Route = createFileRoute("/")({
  component: Index,
});

function Index() {
  const theme = useThemeName();
  const gridRef = useRef<GridApi>(null);

  const [uiLayout] = useState(() => {
    // clone avoids immer freeze
    const persistedLayout = deepClone(uiStore.getState().persistedLayout);
    uiStoreApi.addUis({ metas: Object.values(persistedLayout.toUi), overwrite: false });
    return persistedLayout;
  });

  const layoutApi = useMemo(
    (): UiContextValue["layoutApi"] => ({
      overrideContextMenu(opts) {
        gridRef.current?.overrideContextMenu(opts);
      },
    }),
    [],
  );

  return (
    <UiContext.Provider value={{ layoutApi, theme, uiRegistry }}>
      <UiGrid ref={gridRef} uiLayout={uiLayout} />
      <UiPortalContainer />
    </UiContext.Provider>
  );
}
