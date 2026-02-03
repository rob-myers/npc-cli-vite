import { UiContext, type UiContextValue, uiStore, uiStoreApi } from "@npc-cli/ui-sdk";
import { createFileRoute } from "@tanstack/react-router";

import "react-grid-layout/css/styles.css";
import "react-resizable/css/styles.css";
import { useThemeName } from "@npc-cli/theme";
import { uiRegistry } from "@npc-cli/ui-registry";
import { useMemo, useRef } from "react";
import { useBeforeunload } from "react-beforeunload";
import { useStore } from "zustand";
import { demoLayout, layoutStore } from "../components/layout.store";
import { type GridApi, UiGrid } from "../components/UiGrid";
import { UiPortalContainer } from "../components/UiPortalContainer";

export const Route = createFileRoute("/")({
  component: Index,
});

function Index() {
  const theme = useThemeName();
  const gridRef = useRef<GridApi>(null);
  const uiLayout = useStore(layoutStore, ({ uiLayout }) => uiLayout ?? demoLayout);

  useMemo(() => {
    if (!layoutStore.getState().ready) {
      uiStoreApi.addUis(...Object.values(uiLayout.toUi));
    }
  }, [uiRegistry]);

  // persist layout
  useBeforeunload(() => {
    layoutStore.setState({
      uiLayout: gridRef.current?.getUiLayout(),
      itemToRect: gridRef.current?.getItemToRect(),
    });
  });

  const layoutApi = useMemo(
    (): UiContextValue["layoutApi"] => ({
      addItem(opts) {
        gridRef.current?.addItem(opts);
      },
      getUiGridRect(id) {
        return gridRef.current?.getUiGridRect(id) ?? null;
      },
      overrideContextMenu(opts) {
        gridRef.current?.overrideContextMenu(opts);
      },
      resetLayout() {
        gridRef.current?.resetLayout();
      },
    }),
    [],
  );

  return (
    <UiContext.Provider value={{ layoutApi, theme, uiRegistry, uiStore, uiStoreApi }}>
      <UiGrid ref={gridRef} uiLayout={uiLayout} />
      <UiPortalContainer />
    </UiContext.Provider>
  );
}
