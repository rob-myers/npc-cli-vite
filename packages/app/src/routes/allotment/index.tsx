import { useThemeName } from "@npc-cli/theme";
import { uiRegistry } from "@npc-cli/ui-registry";
import { getFallbackLayoutApi, UiContext } from "@npc-cli/ui-sdk/UiContext";
import { uiStore, uiStoreApi } from "@npc-cli/ui-sdk/ui.store";
import { createFileRoute } from "@tanstack/react-router";
import "allotment/dist/style.css";
import { motion } from "motion/react";
import { useRef, useState } from "react";
import { useStore } from "zustand";
import { UiPortalContainer } from "../../components/UiPortalContainer";
import { PaneTree } from "./PaneTree";
import { ensureLeafUis, initNextId } from "./pane-service";

export const Route = createFileRoute("/allotment/")({
  component: AllotmentDemo,
});

function AllotmentDemo() {
  const theme = useThemeName();
  const ready = useStore(uiStore, (s) => s.ready);
  const root = useStore(uiStore, (s) => s.persistedPanes);

  initNextId(root);

  const [contextValue] = useState(() => ({
    layoutApi: getFallbackLayoutApi(),
    theme,
    uiRegistry,
    uiStore,
    uiStoreApi,
  }));

  const initialized = useRef(false);
  if (ready && !initialized.current) {
    initialized.current = true;
    ensureLeafUis(root);
  }

  return (
    <UiContext.Provider value={{ ...contextValue, theme }}>
      <div className="flex flex-col h-screen bg-slate-950">
        <motion.div
          className="flex-1"
          initial={{ opacity: 0 }}
          animate={{ opacity: ready ? 1 : 0 }}
          transition={{ duration: 0.3 }}
        >
          {ready && <PaneTree node={root} />}
        </motion.div>
      </div>
      <UiPortalContainer />
    </UiContext.Provider>
  );
}
