import type { UiInstanceMeta } from "@npc-cli/ui-sdk";
import { allowReactGridDragClassName, BasicPopover, cn } from "@npc-cli/util";
import { DotsThreeOutlineVerticalIcon, LayoutIcon, PlayCircleIcon } from "@phosphor-icons/react";
import { uiClassName } from "./const";

export function UiInstanceMenu({
  className,
  meta,
  uiStoreApi,
}: {
  className?: string;
  meta: UiInstanceMeta;
  uiStoreApi: typeof import("@npc-cli/ui-sdk/ui.store").uiStoreApi;
}) {
  return (
    <div
      className={cn(
        className,
        "flex gap-1 p-1 rounded text-on-background bg-background/80 border border-on-background/10  *:p-0.5-1 *:py-1",
      )}
    >
      <button
        type="button"
        data-item-id={meta.id}
        className={cn(uiClassName, "cursor-pointer")}
        onClick={() => {
          // toggle item disabled and sync sub-uis
          uiStoreApi.setUiMeta(meta.id, (draft) => (draft.disabled = !draft.disabled));
          uiStoreApi.getSubUis(meta.id)?.forEach(({ meta: subMeta }) => {
            uiStoreApi.setUiMeta(subMeta.id, (draft) => (draft.disabled = !draft.disabled));
          });
        }}
      >
        <PlayCircleIcon
          data-icon-type="play"
          weight="duotone"
          className={cn("size-5", meta.disabled ? "text-gray-500" : "text-green-700")}
        />
      </button>

      <button type="button" data-item-id={meta.id} className={cn(allowReactGridDragClassName, "cursor-move")}>
        <LayoutIcon data-icon-type="layout" weight="duotone" className="size-5" />
      </button>

      <BasicPopover
        side="right"
        sideOffset={4}
        triggerClassName={cn(uiClassName, "cursor-pointer")}
        className="flex flex-col gap-0 p-0"
        trigger={<DotsThreeOutlineVerticalIcon data-icon-type="menu" weight="duotone" className="size-5" />}
      >
        <div className="text-xs font-semibold text-black/50 border-b border-black/20 pb-1 p-2 ">{meta.title}</div>
        <button
          type="button"
          className="cursor-pointer text-sm text-left py-0.5 rounded hover:bg-white/20"
          onPointerDown={(e) => {
            e.stopPropagation();
            const itemId = e.currentTarget.dataset.itemId as string;
            uiStoreApi.removeItem(itemId);
          }}
          data-item-id={meta.id}
        >
          close
        </button>
      </BasicPopover>
    </div>
  );
}
