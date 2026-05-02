import { useThemeName } from "@npc-cli/theme";
import { uiRegistry } from "@npc-cli/ui-registry";
import { getFallbackLayoutApi, type LayoutApi, UiContext } from "@npc-cli/ui-sdk/UiContext";
import { uiStore, uiStoreApi } from "@npc-cli/ui-sdk/ui.store";
import { createFileRoute } from "@tanstack/react-router";
import "allotment/dist/style.css";
import { motion } from "motion/react";
import { useRef } from "react";
import { useBeforeunload } from "react-beforeunload";
import { useStore } from "zustand";
import { UiPortalContainer } from "../../components/UiPortalContainer";
import { PaneTree } from "./PaneTree";
import { PaneTreeWrapper } from "./PaneTreeWrapper";
import { ensureLeafUis, initNextId, persistPanesToUi } from "./pane-service";

export const Route = createFileRoute("/allotment/")({
  component: AllotmentDemo,
});

function AllotmentDemo() {
  const theme = useThemeName();
  const ready = useStore(uiStore, (s) => s.ready);
  const root = useStore(uiStore, (s) => s.persistedPanes.root);

  initNextId(root);

  const overrideContextMenuRef = useRef<LayoutApi["overrideContextMenu"] | null>(null);

  const contextValue = useRef({
    layoutApi: {
      ...getFallbackLayoutApi(),
      overrideContextMenu(...args: Parameters<LayoutApi["overrideContextMenu"]>) {
        overrideContextMenuRef.current?.(...args);
      },
    },
    theme,
    uiRegistry,
    uiStore,
    uiStoreApi,
  }).current;

  const initialized = useRef(false);
  if (ready && !initialized.current) {
    initialized.current = true;
    const { toUi } = uiStore.getState().persistedPanes;
    uiStoreApi.addUis({ metas: Object.values(toUi) });
    ensureLeafUis(root);
  }

  useBeforeunload(() => persistPanesToUi());

  return (
    <UiContext.Provider value={{ ...contextValue, theme }}>
      <PaneTreeWrapper overrideContextMenuRef={overrideContextMenuRef}>
        <motion.div
          className="h-screen"
          initial={{ opacity: 0 }}
          animate={{ opacity: ready ? 1 : 0 }}
          transition={{ duration: 0.3 }}
        >
          {ready && <PaneTree node={root} />}
        </motion.div>
      </PaneTreeWrapper>
      <UiPortalContainer />
    </UiContext.Provider>
  );
}
