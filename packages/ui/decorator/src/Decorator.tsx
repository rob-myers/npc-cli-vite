import type { WorldState } from "@npc-cli/ui__world";
import { useWorld } from "@npc-cli/ui__world/use-world";
import { Editor } from "./Editor";
import type { DecoratorUiMeta } from "./schema";

import "./decorator.css";

/** A 2D top-down map of a live World, to place dynamic decor on — see `docs/decorator.md` */
export default function Decorator({ meta }: { meta: DecoratorUiMeta }) {
  const w = useWorld(meta.worldKey);
  return (
    <div className="decorator size-full relative bg-zinc-950">
      {w === undefined ? (
        <div className="size-full grid place-items-center text-zinc-400 text-sm">waiting for {meta.worldKey}…</div>
      ) : (
        // keyed by the state OBJECT: a World remade by HMR is a new one, and the editor starts over on it
        <Editor key={epochOf(w)} w={w} meta={meta} />
      )}
    </div>
  );
}

const epochs = new WeakMap<WorldState, number>();
let nextEpoch = 0;
function epochOf(w: WorldState) {
  const epoch = epochs.get(w) ?? nextEpoch++;
  epochs.set(w, epoch);
  return `${w.key}:${epoch}`;
}
