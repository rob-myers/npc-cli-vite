import { useContext } from "react";
import { SkipNetContext } from "../context";
import { ItemPane } from "../ItemPane";

/** A World item within an article, e.g. `<Item itemKey="sidestep" />` */
export function Item({ itemKey }: { itemKey: string }) {
  const state = useContext(SkipNetContext);
  return (
    <div className="not-prose my-3 rounded border border-zinc-800 bg-gray-650">
      <ItemPane item={state.items.find((x) => x.key === itemKey)} itemKey={itemKey} worldKey={state.meta.worldKey} />
    </div>
  );
}
