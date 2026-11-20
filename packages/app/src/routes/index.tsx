import { useThemeName } from "@npc-cli/theme";
import { PausedPill } from "@npc-cli/ui__jsh-prelude/paused-pill";
import { WorldPausedPillContext } from "@npc-cli/ui__world/paused-pill";
import { uiRegistry } from "@npc-cli/ui-registry";
import { flushUisLoaded } from "@npc-cli/ui-sdk/analytics";
import { getFallbackLayoutApi, type LayoutApi, UiContext } from "@npc-cli/ui-sdk/UiContext";
import { uiStore, uiStoreApi } from "@npc-cli/ui-sdk/ui.store";
import { useBeforeUnloadOrVisibilityChange } from "@npc-cli/util";
import { createFileRoute } from "@tanstack/react-router";
import "allotment/dist/style.css";
import { useEffect, useRef } from "react";
import { useStore } from "zustand";
import { PaneTree } from "../components/PaneTree";
import { PaneTreeWrapper } from "../components/PaneTreeWrapper";
import {
  closePane,
  countPanes,
  deferHiddenPaneUis,
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
  /** In the entry, so the first render (holding the first paint) needn't wait on a chunk */
  codeSplitGroupings: [],
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
      getPaneCount() {
        return countPanes(uiStore.getState().persistedPanes.root);
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
    deferHiddenPaneUis(root);
  }

  useBeforeUnloadOrVisibilityChange(() => persistPanesToUi());

  // a visit shorter than the batch's debounce would otherwise report nothing at all; umami posts
  // with `keepalive`, so a flush on the way out still arrives
  useEffect(() => {
    const onHide = () => void (document.visibilityState === "hidden" && flushUisLoaded());
    window.addEventListener("beforeunload", flushUisLoaded);
    document.addEventListener("visibilitychange", onHide);
    return () => {
      window.removeEventListener("beforeunload", flushUisLoaded);
      document.removeEventListener("visibilitychange", onHide);
    };
  }, []);

  return (
    <UiContext.Provider value={{ ...contextValue, theme }}>
      <WorldPausedPillContext.Provider value={PausedPill}>
        <PaneTreeWrapper overrideContextMenuRef={overrideContextMenuRef}>
          <div className="h-full">{ready && <PaneTree node={root} />}</div>
        </PaneTreeWrapper>
        <UiPortalContainer />
      </WorldPausedPillContext.Provider>
    </UiContext.Provider>
  );
}
