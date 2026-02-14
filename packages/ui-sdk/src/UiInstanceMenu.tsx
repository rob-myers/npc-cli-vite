import { type UiInstanceMeta, uiStoreApi } from "@npc-cli/ui-sdk";
import { allowReactGridDragClassName, BasicPopover, cn } from "@npc-cli/util";
import { LayoutIcon, PlayCircleIcon, XIcon } from "@phosphor-icons/react";

export function UiInstanceMenu({ className, meta }: { className?: string; meta: UiInstanceMeta }) {
  return (
    <div
      className={cn(
        className,
        "filter backdrop-blur-lg backdrop-brightness-120",
        "flex flex-row-reverse rounded text-on-background bg-background/80",
      )}
    >
      <BasicPopover
        trigger={<XIcon data-icon-type="remove" weight="duotone" className="grayscale size-6" />}
        sideOffset={4}
        side="right"
      >
        <button
          type="button"
          className="cursor-pointer"
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

      <button
        type="button"
        data-item-id={meta.id}
        className={cn(allowReactGridDragClassName, "cursor-move p-1")}
      >
        <LayoutIcon data-icon-type="layout" weight="duotone" className="size-5" />
      </button>

      <button
        type="button"
        data-item-id={meta.id}
        className="p-1 cursor-pointer"
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
    </div>
  );
}
