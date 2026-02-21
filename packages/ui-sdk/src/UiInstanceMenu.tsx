import { type UiInstanceMeta, uiClassName, uiStoreApi } from "@npc-cli/ui-sdk";
import { BasicPopover, cn } from "@npc-cli/util";
import { LayoutIcon, PlayCircleIcon, XIcon } from "@phosphor-icons/react";

export function UiInstanceMenu({ className, meta }: { className?: string; meta: UiInstanceMeta }) {
  return (
    <div className={cn(className, "flex gap-1 p-1 rounded text-on-background bg-background/80")}>
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

      <button type="button" data-item-id={meta.id} className="cursor-move">
        <LayoutIcon data-icon-type="layout" weight="duotone" className="size-5" />
      </button>

      <BasicPopover
        side="right"
        sideOffset={4}
        triggerClassName={cn(uiClassName, "cursor-pointer")}
        trigger={<XIcon data-icon-type="remove" weight="duotone" className="grayscale size-5" />}
      >
        <button
          type="button"
          className={"cursor-pointer"}
          onPointerDown={(e) => {
            e.stopPropagation();
            const itemId = e.currentTarget.dataset.itemId as string;
            uiStoreApi.removeItem(itemId);
          }}
          data-item-id={meta.id}
        >
          confirm
        </button>
      </BasicPopover>
    </div>
  );
}
