import { Component, type ReactNode, useRef } from "react";
import { FitWindow } from "./desktop/FitWindow";
import { articleRows, itemCols } from "./desktop/windows";
import type { SkipNetWindow } from "./schema";

/** One mounted item, else how to mount it. In a window being fitted, fits it to the item */
export function ItemPane(props: {
  item?: JshCli.SkipNetItem;
  itemKey?: string;
  worldKey: string;
  win?: SkipNetWindow;
}) {
  const { item, itemKey, win, worldKey } = props;
  const contentRef = useRef<HTMLDivElement>(null);
  return (
    <div className="size-full overflow-auto p-2">
      {item === undefined ? (
        <div className="text-mac-muted">{`run \`${itemKey}\` in a ${worldKey} session`}</div>
      ) : (
        <div ref={contentRef} className={win ? "w-max" : undefined}>
          <ItemBoundary item={item}>
            <item.Component />
          </ItemBoundary>
        </div>
      )}
      {win?.fit && <FitWindow contentRef={contentRef} win={win} maxRows={articleRows} maxCols={itemCols} />}
    </div>
  );
}

/** Shows an item's error in its place. A new item clears it */
class ItemBoundary extends Component<{ item: JshCli.SkipNetItem; children: ReactNode }, { error: null | Error }> {
  override state = { error: null as null | Error };
  static getDerivedStateFromError(error: unknown) {
    return { error: error instanceof Error ? error : Error(String(error)) };
  }
  override componentDidUpdate(prev: { item: JshCli.SkipNetItem }) {
    if (prev.item !== this.props.item && this.state.error !== null) this.setState({ error: null });
  }
  override render() {
    const { error } = this.state;
    return error === null ? this.props.children : <div className="text-red-300">{error.message}</div>;
  }
}
