import { UiContext, uiStore } from "@npc-cli/ui-sdk";
import { createFileRoute } from "@tanstack/react-router";

import "react-grid-layout/css/styles.css";
import "react-resizable/css/styles.css";
import { useThemeName } from "@npc-cli/theme";
import { useMemo, useRef } from "react";
import { useBeforeunload } from "react-beforeunload";
import { useStore } from "zustand";
import { demoLayout, layoutStore } from "../components/layout.store";
import { type GridApi, UiGrid } from "../components/UiGridLayout";

export const Route = createFileRoute("/")({
  component: Index,
});

function Index() {
  const theme = useThemeName();
  const gridRef = useRef<GridApi>(null);
  const uiLayout = useStore(layoutStore, ({ uiLayout }) => uiLayout ?? demoLayout);

  useBeforeunload(() => {
    // persist layout
    layoutStore.setState({
      uiLayout: gridRef.current?.getUiLayout(),
      itemToRect: gridRef.current?.getItemToRect(),
    });
  });

  const layoutApi = useMemo(
    () => ({
      resetLayout() {
        gridRef.current?.resetLayout();
      },
    }),
    [],
  );

  return (
    <UiContext.Provider value={{ layoutApi, theme, uiStore }}>
      <UiGrid ref={gridRef} uiLayout={uiLayout} />
    </UiContext.Provider>
  );
}
