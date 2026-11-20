import { cn, tw } from "@npc-cli/util";
import { Component, type ReactNode, useContext, useRef } from "react";
import { SkipNetContext } from "./context";
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
  const { narrow } = useContext(SkipNetContext);
  return (
    // stacked, a container its item may lay out by, as wide as the panel
    <div className={cn("size-full overflow-auto p-2", narrow && "@container")}>
      {item === undefined ? (
        <div className="text-mac-muted">{`run \`${itemKey}\` in a ${worldKey} session`}</div>
      ) : (
        <ItemBoundary item={item}>
          <div ref={contentRef} className={win && !narrow ? "w-max" : undefined}>
            <item.Component />
          </div>
        </ItemBoundary>
      )}
      {win?.fit && <FitWindow contentRef={contentRef} win={win} maxRows={articleRows} maxCols={itemCols} />}
    </div>
  );
}

/** Shows an item's error in its place, wrapped, with a retry. A new item clears it */
class ItemBoundary extends Component<{ item: JshCli.SkipNetItem; children: ReactNode }, { error: null | Error }> {
  override state = { error: null as null | Error };
  static getDerivedStateFromError(error: unknown) {
    return { error: error instanceof Error ? error : Error(String(error)) };
  }
  override componentDidCatch(error: unknown) {
    console.error(`skip-net item ${this.props.item.key}:`, error);
  }
  override componentDidUpdate(prev: { item: JshCli.SkipNetItem }) {
    if (prev.item !== this.props.item && this.state.error !== null) this.setState({ error: null });
  }
  override render() {
    const { error } = this.state;
    if (error === null) return this.props.children;
    const { key } = this.props.item;
    return (
      <div className={errorClass}>
        <div className="text-red-300">{`${key} failed: ${error.message}`}</div>
        <div className="text-mac-muted">{`after a hot reload, re-run \`${key}\`. Stack in the console`}</div>
        <button type="button" className={retryClass} onClick={() => this.setState({ error: null })}>
          retry
        </button>
      </div>
    );
  }
}

/** Outside the fitted content, so it wraps at the window's width */
const errorClass = tw("flex flex-col items-start gap-1 whitespace-pre-wrap break-words font-mono text-xs");
const retryClass = tw("cursor-pointer border border-mac-edge px-1.5 text-mac-text hover:bg-mac-select/15");
