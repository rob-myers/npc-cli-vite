import { ContextMenu } from "@base-ui/react/context-menu";
import { Popover } from "@base-ui/react/popover";
import { type UiRegistryKey, uiRegistry, uiRegistryKeys } from "@npc-cli/ui-registry";
import type { OverrideContextMenuOpts, UiBootstrapProps } from "@npc-cli/ui-sdk";
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

  overrideContextMenuRef.current = state.overrideContextMenu;

  return (
    <>
      <GlobalMenu />
      <ContextMenu.Root open={state.contextMenuOpen} onOpenChange={state.onChangeContextMenu}>
        <ContextMenu.Trigger className="size-full">
          {children}
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
    </>
  );
}

