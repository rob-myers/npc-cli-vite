import { UiContext, type UiContextValue, uiStoreApi } from "@npc-cli/ui-sdk";
import { createFileRoute } from "@tanstack/react-router";

import "react-grid-layout/css/styles.css";
import "react-resizable/css/styles.css";
import { useThemeName } from "@npc-cli/theme";
import { uiRegistry } from "@npc-cli/ui-registry";
import { useMemo, useRef } from "react";
import { useStore } from "zustand";
import { layoutStore } from "../components/layout.store";
import { type GridApi, UiGrid } from "../components/UiGrid";
import { UiPortalContainer } from "../components/UiPortalContainer";

export const Route = createFileRoute("/")({
  component: Index,
});

function Index() {
  const theme = useThemeName();
  const gridRef = useRef<GridApi>(null);
  const uiLayout = useStore(layoutStore, ({ uiLayout }) => uiLayout);

  // bootstrap ui store
  useMemo(() => {
    const { uiLayout, ready } = layoutStore.getState();
    !ready && uiStoreApi.addUis({ metas: Object.values(uiLayout.toUi), overwrite: false });
  }, []);

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
