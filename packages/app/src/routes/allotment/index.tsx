import { ContextMenu } from "@base-ui/react/context-menu";
import { Popover } from "@base-ui/react/popover";
import { type UiRegistryKey, uiRegistry, uiRegistryKeys } from "@npc-cli/ui-registry";
import { useThemeName } from "@npc-cli/theme";
import type { OverrideContextMenuOpts, UiBootstrapProps } from "@npc-cli/ui-sdk";
import { getFallbackLayoutApi, UiContext } from "@npc-cli/ui-sdk/UiContext";
import { uiStore, uiStoreApi } from "@npc-cli/ui-sdk/ui.store";
import { useStateRef } from "@npc-cli/util";
import { createFileRoute } from "@tanstack/react-router";
import "allotment/dist/style.css";
import { motion } from "motion/react";
import { useRef } from "react";
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

  const state = useStateRef(() => ({
    contextMenuOpen: false,
    contextMenuPopoverHandle: Popover.createHandle(),
    contextMenuPopoverUi: null as null | {
      point: { x: number; y: number };
      uiKey: UiRegistryKey;
      ui: (props: UiBootstrapProps) => React.ReactNode;
    },
    overrideContextMenuOpts: null as null | OverrideContextMenuOpts,

    overrideContextMenu(opts: OverrideContextMenuOpts) {
      state.set({ contextMenuOpen: true, overrideContextMenuOpts: opts });
    },
    onChangeContextMenu(open: boolean) {
      if (!open) {
        state.set({ overrideContextMenuOpts: null });
        state.contextMenuPopoverHandle.close();
      }
      state.set({ contextMenuOpen: open });
    },
    onContextMenuItem(e: React.MouseEvent<HTMLElement> | React.KeyboardEvent<HTMLElement>) {
      const uiDiv = e.currentTarget.closest("[data-ui-registry-key]");
      if (!uiDiv) return;
      const uiRegistryKey = (uiDiv as HTMLElement).dataset.uiRegistryKey as UiRegistryKey;
      const def = uiRegistry[uiRegistryKey];

      if (def.bootstrap) {
        state.set({
          contextMenuPopoverUi: {
            uiKey: uiRegistryKey,
            ui: def.bootstrap,
            point: { x: 0, y: 0 },
          },
        });
      } else {
        const itemId = `ui-${crypto.randomUUID()}`;
        const uiMeta = {
          id: itemId,
          title: uiStoreApi.getDefaultTitle(uiRegistryKey),
          uiKey: uiRegistryKey,
        };
        if (state.overrideContextMenuOpts?.addItem) {
          state.overrideContextMenuOpts.addItem({ uiMeta });
        }
      }
    },
    closeContextMenu() {
      state.set({ contextMenuPopoverUi: null, contextMenuOpen: false });
      state.contextMenuPopoverHandle.close();
    },
  }));

  const contextValue = useRef({
    layoutApi: {
      ...getFallbackLayoutApi(),
      overrideContextMenu: state.overrideContextMenu,
    },
    theme,
    uiRegistry,
    uiStore,
    uiStoreApi,
  }).current;

  const initialized = useRef(false);
  if (ready && !initialized.current) {
    initialized.current = true;
    ensureLeafUis(root);
  }

  return (
    <UiContext.Provider value={{ ...contextValue, theme }}>
      <ContextMenu.Root open={state.contextMenuOpen} onOpenChange={state.onChangeContextMenu}>
        <ContextMenu.Trigger className="size-full">
          <div className="flex flex-col h-screen bg-background">
            <motion.div
              className="flex-1"
              initial={{ opacity: 0 }}
              animate={{ opacity: ready ? 1 : 0 }}
              transition={{ duration: 0.3 }}
            >
              {ready && <PaneTree node={root} />}
            </motion.div>
          </div>
        </ContextMenu.Trigger>

        <ContextMenu.Portal>
          <ContextMenu.Positioner
            className="z-99999"
            anchor={state.overrideContextMenuOpts?.refObject ?? undefined}
          >
            <ContextMenu.Popup
              className="flex flex-col rounded-md bg-black/80 text-white outline-black"
              data-context-menu-div
            >
              {uiRegistryKeys.map((uiRegistryKey) => (
                <ContextMenu.Item
                  key={uiRegistryKey}
                  data-ui-registry-key={uiRegistryKey}
                  className="hover:bg-white/20 first:rounded-t-md last:rounded-b-md not-last:border-b border-white/20 outline-black text-left tracking-widest"
                  closeOnClick={!uiRegistry[uiRegistryKey].bootstrap}
                  onClick={state.onContextMenuItem}
                >
                  {uiRegistry[uiRegistryKey].bootstrap ? (
                    <Popover.Trigger
                      className="w-full px-4 py-1.5 text-left cursor-pointer"
                      handle={state.contextMenuPopoverHandle}
                      tabIndex={-1}
                    >
                      {uiRegistryKey}
                    </Popover.Trigger>
                  ) : (
                    <div className="w-full px-4 py-1.5 text-left cursor-pointer">{uiRegistryKey}</div>
                  )}
                </ContextMenu.Item>
              ))}
            </ContextMenu.Popup>
          </ContextMenu.Positioner>
        </ContextMenu.Portal>
      </ContextMenu.Root>

      <Popover.Root handle={state.contextMenuPopoverHandle}>
        <Popover.Portal>
          <Popover.Positioner side="right" sideOffset={8}>
            <Popover.Popup className="outline-0">
              {state.contextMenuPopoverUi && (
                <state.contextMenuPopoverUi.ui
                  addInstance={(partialUiMeta) => {
                    if (!state.contextMenuPopoverUi) return;
                    const itemId = `ui-${crypto.randomUUID()}`;
                    const uiMeta = {
                      title: uiStoreApi.getDefaultTitle(state.contextMenuPopoverUi.uiKey),
                      ...partialUiMeta,
                      id: itemId,
                      uiKey: state.contextMenuPopoverUi.uiKey,
                    };
                    if (state.overrideContextMenuOpts?.addItem) {
                      state.overrideContextMenuOpts.addItem({ uiMeta });
                    }
                    state.closeContextMenu();
                  }}
                />
              )}
            </Popover.Popup>
          </Popover.Positioner>
        </Popover.Portal>
      </Popover.Root>

      <UiPortalContainer />
    </UiContext.Provider>
  );
}
