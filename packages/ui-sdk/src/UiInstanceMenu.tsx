import type { UiInstanceMeta } from "@npc-cli/ui-sdk";
import { CloseOnClickPopover, cn } from "@npc-cli/util";
import {
  ArrowsClockwiseIcon,
  CaretDownIcon,
  CaretLeftIcon,
  CaretRightIcon,
  CaretUpIcon,
  DotsThreeOutlineVerticalIcon,
  PlayCircleIcon,
  SquareHalfBottomIcon,
  SquareHalfIcon,
  TrashIcon,
  XIcon,
} from "@phosphor-icons/react";
import { useContext, useState } from "react";
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
  const { layoutApi, uiStore, uiStoreApi } = useContext(UiContext);
  const tabsInstances = uiStoreApi.getTabsInstances(meta.parentId);

  return (
    <CloseOnClickPopover
      align="center"
      side="bottom"
      sideOffset={4}
      collisionPadding={0}
      positionerClassName="z-[10000]"
      triggerClassName="cursor-pointer"
      className="flex flex-col gap-0 p-0 bg-black text-white"
      arrowClassName="hidden"
      trigger={
        <DotsThreeOutlineVerticalIcon data-icon-type="menu" weight="duotone" className="size-5">
          <title>{meta.title}</title>
        </DotsThreeOutlineVerticalIcon>
      }
    >
      {meta.uiKey === "Tabs" && (
        <div className="flex flex-col border-b border-white/20 py-1">
          <ClosePaneButton disabled={layoutApi.getPaneCount() <= 1} onClose={() => layoutApi.closePane(meta.id)} />
          <button
            type="button"
            className="cursor-pointer text-sm py-1 px-2 hover:bg-white/20"
            onPointerDown={() => layoutApi.splitPane(meta.id, false)}
          >
            <SquareHalfIcon className="size-5" />
          </button>
          <button
            type="button"
            className="cursor-pointer text-sm py-1 px-2 hover:bg-white/20"
            onPointerDown={() => layoutApi.splitPane(meta.id, true)}
          >
            <SquareHalfBottomIcon className="size-5" />
          </button>
        </div>
      )}
      {meta.uiKey === "Tabs" && <SwapButtons metaId={meta.id} layoutApi={layoutApi} />}
      {meta.uiKey !== "Tabs" &&
        tabsInstances.length > 0 &&
        tabsInstances.map((tabs) => (
          <button
            key={tabs.id}
            type="button"
            className="cursor-pointer text-sm py-1 px-2 hover:bg-white/20"
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
    </CloseOnClickPopover>
  );
}

/** The first press arms it in place, the second closes the pane */
function ClosePaneButton({ disabled, onClose }: { disabled: boolean; onClose(): void }) {
  const [armed, setArmed] = useState(false); // reset as the popup unmounts
  return (
    <button
      type="button"
      disabled={disabled}
      title={disabled ? "The only pane" : armed ? "Confirm close" : "Close pane"}
      className={cn(
        "cursor-pointer text-sm py-1 px-2 disabled:cursor-not-allowed disabled:opacity-30",
        armed ? "bg-red-700 hover:bg-red-600" : "enabled:hover:bg-white/20",
      )}
      onPointerDown={(e) => {
        if (armed && !disabled) return onClose();
        e.stopPropagation(); // keep the popup open, to confirm or when disabled
        if (!disabled) setArmed(true);
      }}
    >
      {armed ? <TrashIcon className="size-5" /> : <XIcon className="size-5" />}
    </button>
  );
}

function SwapButtons({ metaId, layoutApi }: { metaId: string; layoutApi: import("./UiContext").LayoutApi }) {
  const pos = layoutApi.getPanePosition(metaId);
  if (!pos) return null;

  const PrevIcon = pos.vertical ? CaretUpIcon : CaretLeftIcon;
  const NextIcon = pos.vertical ? CaretDownIcon : CaretRightIcon;
  const canPrev = pos.index > 0;
  const canNext = pos.index < pos.siblingCount - 1;

  return (
    <div className="flex flex-col border-b border-white/20 py-1 px-2 gap-1">
      {canPrev && (
        <button
          type="button"
          className="cursor-pointer text-sm py-0.5 hover:bg-white/20"
          onPointerDown={() => layoutApi.swapPane(metaId, -1)}
        >
          <PrevIcon className="size-5" />
        </button>
      )}
      {canNext && (
        <button
          type="button"
          className="cursor-pointer text-sm py-0.5 hover:bg-white/20"
          onPointerDown={() => layoutApi.swapPane(metaId, 1)}
        >
          <NextIcon className="size-5" />
        </button>
      )}
      <button
        type="button"
        className="cursor-pointer text-sm py-0.5 hover:bg-white/20"
        onPointerDown={() => layoutApi.toggleOrientation(metaId)}
      >
        <ArrowsClockwiseIcon className="size-5" />
      </button>
    </div>
  );
}
