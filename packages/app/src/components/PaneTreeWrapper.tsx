import { ContextMenu } from "@base-ui/react/context-menu";
import { Popover } from "@base-ui/react/popover";
import { type UiRegistryKey, uiRegistry, uiRegistryKeys } from "@npc-cli/ui-registry";
import type { OverrideContextMenuOpts, UiBootstrapProps, UiInstanceMeta } from "@npc-cli/ui-sdk";
import type { LayoutApi } from "@npc-cli/ui-sdk/UiContext";
import { uiStoreApi } from "@npc-cli/ui-sdk/ui.store";
import { useStateRef } from "@npc-cli/util";
import { GlobalMenu } from "./GlobalMenu";

export function PaneTreeWrapper({
  children,
  overrideContextMenuRef,
}: {
  children: React.ReactNode;
  overrideContextMenuRef: React.MutableRefObject<LayoutApi["overrideContextMenu"] | null>;
}) {
  const state = useStateRef(() => ({
    contextMenuOpen: false,
    contextMenuPopoverHandle: Popover.createHandle(),
    contextMenuPopoverUi: null as null | {
      uiKey: UiRegistryKey;
      ui: (props: UiBootstrapProps) => React.ReactNode;
    },
    overrideContextMenuOpts: null as null | OverrideContextMenuOpts,
    /** Whether a ui's bootstrap form is open beside the menu */
    popoverOpen: false,

    overrideContextMenu(opts: OverrideContextMenuOpts) {
      state.set({ contextMenuOpen: true, overrideContextMenuOpts: opts });
    },
    onChangeContextMenu(open: boolean, details: { reason: string }) {
      // the open popover decides, as a press in its own portalled popups is outside the menu
      if (!open && details.reason === "outside-press" && state.popoverOpen) return;
      if (!open) {
        state.set({ overrideContextMenuOpts: null });
        state.contextMenuPopoverHandle.close();
      }
      state.set({ contextMenuOpen: open });
    },
    /** A press outside both the popover and the menu closes the menu too */
    onChangePopover(open: boolean, details: { reason: string; event?: Event }) {
      state.popoverOpen = open;
      const target = details.event?.target;
      const inMenu = target instanceof Element && target.closest("[data-context-menu-div]") !== null;
      if (!open && details.reason === "outside-press" && !inMenu) state.closeContextMenu();
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
          },
        });
        // a key, e.g. Space, reaches the item but not its trigger
        const byKey = "key" in e || e.detail === 0;
        if (byKey) state.contextMenuPopoverHandle.open(bootstrapTriggerId(uiRegistryKey));
      } else {
        const itemId = `ui-${crypto.randomUUID()}`;
        state.overrideContextMenuOpts?.addItem({
          uiMeta: {
            id: itemId,
            title: uiStoreApi.getDefaultTitle(uiRegistryKey),
            uiKey: uiRegistryKey,
          },
        });
      }
    },
    closeContextMenu() {
      state.set({ contextMenuPopoverUi: null, contextMenuOpen: false });
      state.contextMenuPopoverHandle.close();
    },
  }));

  overrideContextMenuRef.current = state.overrideContextMenu;

  return (
    <>
      <GlobalMenu />
      <ContextMenu.Root open={state.contextMenuOpen} onOpenChange={state.onChangeContextMenu}>
        {children}

        <ContextMenu.Portal>
          <ContextMenu.Positioner className="z-10" anchor={state.overrideContextMenuOpts?.refObject ?? undefined}>
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
                      id={bootstrapTriggerId(uiRegistryKey)}
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

      <Popover.Root handle={state.contextMenuPopoverHandle} onOpenChange={state.onChangePopover}>
        <Popover.Portal>
          <Popover.Positioner side="right" sideOffset={8} className="z-20">
            <Popover.Popup className="outline-0">
              {state.contextMenuPopoverUi && (
                <state.contextMenuPopoverUi.ui
                  addInstance={(partialUiMeta) => {
                    if (!state.contextMenuPopoverUi) {
                      return;
                    }
                    const uiMeta: UiInstanceMeta = {
                      title: uiStoreApi.getDefaultTitle(state.contextMenuPopoverUi.uiKey),
                      ...partialUiMeta,
                      id: `ui-${crypto.randomUUID()}`,
                      uiKey: state.contextMenuPopoverUi.uiKey,
                    };
                    state.overrideContextMenuOpts?.addItem?.({ uiMeta });
                    state.closeContextMenu();
                  }}
                />
              )}
            </Popover.Popup>
          </Popover.Positioner>
        </Popover.Portal>
      </Popover.Root>
    </>
  );
}

/** Its Popover.Trigger's id, so a key can open the popover by handle */
const bootstrapTriggerId = (uiRegistryKey: UiRegistryKey) => `bootstrap-trigger-${uiRegistryKey}`;
