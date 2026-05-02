import type { UiInstanceMeta } from "@npc-cli/ui-sdk";
import { BasicPopover, cn } from "@npc-cli/util";
import { DotsThreeOutlineVerticalIcon, PlayCircleIcon, XIcon } from "@phosphor-icons/react";
import { useContext } from "react";
import { UiContext } from "./UiContext";

export function UiInstanceMenu({ className, meta }: { className?: string; meta: UiInstanceMeta }) {
  const { uiStoreApi } = useContext(UiContext);

  return (
    <div
      className={cn(
        className,
        "flex items-center gap-1 p-1 rounded text-on-background bg-background/80 border border-on-background/10  *:p-0.5-1 *:py-1",
      )}
    >
      {!Array.isArray((meta as any).items) && (
        <button
          type="button"
          data-item-id={meta.id}
          className="cursor-pointer"
          onClick={() => {
            uiStoreApi.setUiMeta(meta.id, (draft) => (draft.disabled = !draft.disabled));
          }}
        >
          <PlayCircleIcon
            data-icon-type="play"
            weight="duotone"
            className={cn("size-5", meta.disabled ? "text-gray-500" : "text-green-700")}
          />
        </button>
      )}

      <UiInstancePopover meta={meta} />
    </div>
  );
}

function UiInstancePopover({ meta }: { meta: UiInstanceMeta }) {
  const { uiStore, uiStoreApi } = useContext(UiContext);
  const tabsInstances = uiStoreApi.getTabsInstances(meta.parentId);

  return (
    <BasicPopover
      side="bottom"
      sideOffset={4}
      triggerClassName="cursor-pointer"
      className="flex flex-col gap-0 p-0 bg-slate-800 text-slate-200"
      arrowClassName="fill-slate-800"
      trigger={
        <DotsThreeOutlineVerticalIcon data-icon-type="menu" weight="duotone" className="size-5">
          <title>{meta.title}</title>
        </DotsThreeOutlineVerticalIcon>
      }
    >
      <div className="flex p-1 border-b border-slate-700 gap-1">
        {meta.uiKey === "Tabs" && Array.isArray(meta.items) && meta.items.length > 1 ? (
          <BasicPopover
            triggerClassName="bg-slate-700 hover:bg-slate-600 rounded p-1"
            trigger={<XIcon weight="bold" className="size-4" />}
            side="right"
            sideOffset={4}
          >
            <button
              type="button"
              className="cursor-pointer"
              onPointerDown={(e) => {
                e.stopPropagation();
                uiStoreApi.removeItem(meta.id);
              }}
            >
              confirm
            </button>
          </BasicPopover>
        ) : (
          <button
            type="button"
            className="cursor-pointer bg-slate-700 hover:bg-slate-600 rounded p-1"
            onPointerDown={(e) => {
              e.stopPropagation();
              uiStoreApi.removeItem(meta.id);
            }}
          >
            <XIcon weight="bold" className="size-4" />
          </button>
        )}
      </div>
      {meta.uiKey !== "Tabs" &&
        tabsInstances.length > 0 &&
        tabsInstances.map((tabs) => (
          <button
            key={tabs.id}
            type="button"
            className="cursor-pointer text-sm py-1 px-2 hover:bg-slate-700"
            onPointerDown={(e) => {
              e.stopPropagation();
              uiStore.setState((draft) => {
                const tabsMeta = draft.byId[tabs.id]?.meta as UiInstanceMeta & {
                  items: string[];
                  currentTabId?: string;
                };
                const item = draft.byId[meta.id];
                if (!tabsMeta || !item) return;
                item.meta.parentId = tabs.id;
                item.meta.disabled = tabsMeta.disabled;
                tabsMeta.items.push(meta.id);
                tabsMeta.currentTabId = meta.id;
              });
            }}
          >
            {tabs.title}
          </button>
        ))}
    </BasicPopover>
  );
}
