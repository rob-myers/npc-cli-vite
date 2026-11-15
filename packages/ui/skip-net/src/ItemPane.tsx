import { Component, type ReactNode } from "react";

/** One mounted item, else how to mount it */
export function ItemPane(props: { item?: JshCli.SkipNetItem; itemKey?: string; worldKey: string }) {
  const { item, itemKey, worldKey } = props;
  if (item === undefined) {
    return <div className="p-2 text-zinc-500">{`run \`${itemKey}\` in a ${worldKey} session`}</div>;
  }
  return (
    <div className="size-full overflow-auto p-2">
      <ItemBoundary item={item}>
        <item.Component />
      </ItemBoundary>
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
