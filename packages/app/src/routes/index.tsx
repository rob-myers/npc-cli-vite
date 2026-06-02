import { useThemeName } from "@npc-cli/theme";
import { uiRegistry } from "@npc-cli/ui-registry";
import { getFallbackLayoutApi, type LayoutApi, UiContext } from "@npc-cli/ui-sdk/UiContext";
import { uiStore, uiStoreApi } from "@npc-cli/ui-sdk/ui.store";
import { useBeforeUnloadOrVisibilityChange } from "@npc-cli/util";
import { createFileRoute } from "@tanstack/react-router";
import "allotment/dist/style.css";
import { motion } from "motion/react";
import { useRef } from "react";
import { useStore } from "zustand";
import { PaneTree } from "../components/PaneTree";
import { PaneTreeWrapper } from "../components/PaneTreeWrapper";
import {
  closePane,
  ensureLeafUis,
  findLeafByUiId,
  findPanePosition,
  initNextId,
  persistPanesToUi,
  splitPane,
  swapPane,
  toggleOrientation,
} from "../components/pane-service";
import { UiPortalContainer } from "../components/UiPortalContainer";

export const Route = createFileRoute("/")({
  component: Index,
});

function Index() {
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
      splitPane(uiId: string, vertical: boolean) {
        const leaf = findLeafByUiId(uiStore.getState().persistedPanes.root, uiId);
        if (leaf) splitPane(leaf.id, vertical);
      },
      closePane(uiId: string) {
        const leaf = findLeafByUiId(uiStore.getState().persistedPanes.root, uiId);
        if (leaf) closePane(leaf.id);
      },
      swapPane(uiId: string, direction: -1 | 1) {
        const leaf = findLeafByUiId(uiStore.getState().persistedPanes.root, uiId);
        if (leaf) swapPane(leaf.id, direction);
      },
      toggleOrientation(uiId: string) {
        const leaf = findLeafByUiId(uiStore.getState().persistedPanes.root, uiId);
        if (leaf) toggleOrientation(leaf.id);
      },
      getPanePosition(uiId: string) {
        const root = uiStore.getState().persistedPanes.root;
        const leaf = findLeafByUiId(root, uiId);
        return leaf ? findPanePosition(root, leaf.id) : null;
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

  useBeforeUnloadOrVisibilityChange(() => persistPanesToUi());

  return (
    <UiContext.Provider value={{ ...contextValue, theme }}>
      <PaneTreeWrapper overrideContextMenuRef={overrideContextMenuRef}>
        <motion.div
          className="h-full"
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
