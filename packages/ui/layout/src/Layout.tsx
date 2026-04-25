import { uiClassName } from "@npc-cli/ui-sdk/const";
import { UiContext } from "@npc-cli/ui-sdk/UiContext";
import { BasicPopover, cn, useStateRef } from "@npc-cli/util";
import {
  ArrowCounterClockwiseIcon,
  SquareIcon,
  SquareSplitHorizontalIcon,
  SquareSplitVerticalIcon,
} from "@phosphor-icons/react";
import { useContext } from "react";

export default function Layout() {
  const { layoutApi, uiStore, uiStoreApi } = useContext(UiContext);

  const state = useStateRef(() => ({
    resetLayout() {
      const oldIds = Object.keys(uiStore.getState().byId);
      uiStoreApi.resetLayout();
      for (const id of oldIds) layoutApi.removeLayoutItem(id);
      const tabsMeta = Object.values(uiStore.getState().byId).find(({ meta }) => meta.uiKey === "Tabs")?.meta;
      if (tabsMeta) {
        layoutApi.appendLayoutItems([
          { i: tabsMeta.id, x: 0, y: 0, w: layoutApi.getCols(), h: layoutApi.getViewportRows() },
        ]);
      }
    },
    gatherAndClearTabs(): string[] {
      const { byId } = uiStore.getState();
      const entries = Object.values(byId);

      const leafIds = entries.filter(({ meta }) => meta.uiKey !== "Tabs").map(({ meta }) => meta.id);

      for (const { meta } of entries) {
        if (meta.uiKey === "Tabs") {
          layoutApi.removeLayoutItem(meta.id);
          uiStore.setState((draft) => {
            delete draft.byId[meta.id];
          });
        }
      }

      uiStore.setState((draft) => {
        for (const id of leafIds) {
          if (draft.byId[id]) {
            draft.byId[id].meta.parentId = undefined;
          }
          layoutApi.removeLayoutItem(id);
        }
      });

      return leafIds;
    },
    createTabs(itemIds: string[]): string {
      const tabsId = `ui-${crypto.randomUUID()}`;
      uiStoreApi.addUis({
        metas: [
          {
            id: tabsId,
            title: uiStoreApi.getDefaultTitle("Tabs"),
            uiKey: "Tabs",
            items: itemIds,
            currentTabId: itemIds[0],
          },
        ],
      });
      uiStore.setState((draft) => {
        for (const id of itemIds) {
          draft.byId[id].meta.parentId = tabsId;
          draft.byId[id].meta.disabled = true;
        }
      });
      return tabsId;
    },
    collectIntoTabs() {
      const { byId } = uiStore.getState();
      const entries = Object.values(byId);
      const tabsEntries = entries.filter(({ meta }) => meta.uiKey === "Tabs");
      const leafEntries = entries.filter(({ meta }) => meta.uiKey !== "Tabs");

      if (tabsEntries.length === 1 && leafEntries.every(({ meta }) => meta.parentId === tabsEntries[0].meta.id)) {
        return;
      }

      const leafIds = state.gatherAndClearTabs();
      if (!leafIds.length) return;
      const tabsId = state.createTabs(leafIds);
      layoutApi.appendLayoutItems([{ i: tabsId, x: 0, y: 0, w: layoutApi.getCols(), h: layoutApi.getViewportRows() }]);
    },
    getExistingTabsIds(expectedCount: number): string[] | null {
      const { byId } = uiStore.getState();
      const entries = Object.values(byId);
      const tabsEntries = entries.filter(({ meta }) => meta.uiKey === "Tabs");
      const leafEntries = entries.filter(({ meta }) => meta.uiKey !== "Tabs");

      if (tabsEntries.length !== expectedCount) return null;

      const tabsIds = new Set(tabsEntries.map(({ meta }) => meta.id));
      if (!leafEntries.every(({ meta }) => meta.parentId && tabsIds.has(meta.parentId))) return null;

      return tabsEntries.map(({ meta }) => meta.id);
    },
    splitIntoThreeTabs() {
      const totalCols = layoutApi.getCols();
      const totalRows = layoutApi.getViewportRows();
      const colWidth = Math.floor(totalCols / 3);

      const existing = state.getExistingTabsIds(3);
      if (existing) {
        const sorted = existing
          .map((id) => ({ id, rect: layoutApi.getUiGridRect(id) }))
          .sort((a, b) => (a.rect?.x ?? 0) - (b.rect?.x ?? 0));
        layoutApi.resizeLayoutItems(
          sorted.map(({ id }, i) => ({
            i: id,
            x: colWidth * i,
            y: 0,
            w: i === sorted.length - 1 ? totalCols - colWidth * i : colWidth,
            h: totalRows,
          })),
        );
        return;
      }

      const leafIds = state.gatherAndClearTabs();
      if (!leafIds.length) return;

      const third1 = Math.ceil(leafIds.length / 3);
      const third2 = Math.ceil((leafIds.length * 2) / 3);
      const groups = [leafIds.slice(0, third1), leafIds.slice(third1, third2), leafIds.slice(third2)].filter(
        (g) => g.length > 0,
      );

      groups.forEach((ids, i) => {
        const tabsId = state.createTabs(ids);
        const isLast = i === groups.length - 1;
        layoutApi.appendLayoutItems([
          { i: tabsId, x: colWidth * i, y: 0, w: isLast ? totalCols - colWidth * i : colWidth, h: totalRows },
        ]);
      });
    },
    splitIntoTwoTabs(direction: "horizontal" | "vertical") {
      const totalCols = layoutApi.getCols();
      const totalRows = layoutApi.getViewportRows();

      const existing = state.getExistingTabsIds(2);
      if (existing) {
        const sorted = existing
          .map((id) => ({ id, rect: layoutApi.getUiGridRect(id) }))
          .sort((a, b) =>
            direction === "horizontal"
              ? (a.rect?.x ?? 0) - (b.rect?.x ?? 0)
              : (a.rect?.y ?? 0) - (b.rect?.y ?? 0),
          );
        if (direction === "horizontal") {
          const halfCols = Math.floor(totalCols / 2);
          layoutApi.resizeLayoutItems([
            { i: sorted[0].id, x: 0, y: 0, w: halfCols, h: totalRows },
            { i: sorted[1].id, x: halfCols, y: 0, w: totalCols - halfCols, h: totalRows },
          ]);
        } else {
          const halfRows = Math.floor(totalRows / 2);
          layoutApi.resizeLayoutItems([
            { i: sorted[0].id, x: 0, y: 0, w: totalCols, h: halfRows },
            { i: sorted[1].id, x: 0, y: halfRows, w: totalCols, h: totalRows - halfRows },
          ]);
        }
        return;
      }

      const leafIds = state.gatherAndClearTabs();
      if (!leafIds.length) return;

      const mid = Math.ceil(leafIds.length / 2);
      const tabsAId = state.createTabs(leafIds.slice(0, mid));
      const tabsBId = leafIds.length > mid ? state.createTabs(leafIds.slice(mid)) : null;

      if (direction === "horizontal") {
        const halfCols = Math.floor(totalCols / 2);
        layoutApi.appendLayoutItems([
          { i: tabsAId, x: 0, y: 0, w: tabsBId ? halfCols : totalCols, h: totalRows },
          ...(tabsBId ? [{ i: tabsBId, x: halfCols, y: 0, w: totalCols - halfCols, h: totalRows }] : []),
        ]);
      } else {
        const halfRows = Math.floor(totalRows / 2);
        layoutApi.appendLayoutItems([
          { i: tabsAId, x: 0, y: 0, w: totalCols, h: halfRows },
          ...(tabsBId ? [{ i: tabsBId, x: 0, y: halfRows, w: totalCols, h: totalRows - halfRows }] : []),
        ]);
      }
    },
  }));

  const buttonClassName = cn(
    uiClassName,
    "overflow-auto border rounded cursor-pointer gap-2 px-4 py-2",
    "flex justify-center items-center bg-button-background",
    "text-sm",
  );

  return (
    <div className="flex justify-center items-center h-full overflow-auto gap-4">
      <div className="p-4 flex flex-wrap items-center gap-2 *:px-2 *:flex-1 *:min-w-28 *:h-12">
        <BasicPopover
          triggerClassName={buttonClassName}
          trigger={
            <>
              <ArrowCounterClockwiseIcon size={iconSize} /> reset
            </>
          }
          side="bottom"
        >
          <button type="button" className="cursor-pointer" onPointerDown={state.resetLayout}>
            confirm
          </button>
        </BasicPopover>

        <button type="button" className={buttonClassName} onPointerDown={state.collectIntoTabs}>
          <SquareIcon size={iconSize} /> union
        </button>
        <button type="button" className={buttonClassName} onPointerDown={() => state.splitIntoTwoTabs("vertical")}>
          <SquareSplitVerticalIcon size={iconSize} /> 2 row
        </button>
        <button type="button" className={buttonClassName} onPointerDown={() => state.splitIntoTwoTabs("horizontal")}>
          <SquareSplitHorizontalIcon size={iconSize} /> 2 col
        </button>
        <button type="button" className={buttonClassName} onPointerDown={state.splitIntoThreeTabs}>
          <SquareSplitHorizontalIcon size={iconSize} /> 3 col
        </button>
      </div>
    </div>
  );
}

const iconSize = 18;
