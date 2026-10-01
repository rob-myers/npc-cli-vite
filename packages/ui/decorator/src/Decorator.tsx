import type { WorldState } from "@npc-cli/ui__world";
import { queryClientApi } from "@npc-cli/ui__world/query-client";
import { UiContext } from "@npc-cli/ui-sdk/UiContext";
import { cn } from "@npc-cli/util";
import { BookOpenTextIcon, MapTrifoldIcon } from "@phosphor-icons/react";
import { Allotment, type AllotmentHandle } from "allotment";
import { lazy, Suspense, useCallback, useContext, useEffect, useRef, useSyncExternalStore } from "react";
import { locateZoom } from "./decor-edit";
import { Editor } from "./Editor";
import type { NavMap2dApi } from "./NavMap2d";
import type { DecoratorUiMeta } from "./schema";

const LorePane = lazy(() => import("./lore/LorePane"));

/**
 * Two panes, either of which drags shut: a 2D top-down map of a live World to place dynamic decor
 * on, and the setting's lore — see `docs/decorator.md` and `docs/lore.md`
 */
export default function Decorator({ meta }: { meta: DecoratorUiMeta }) {
  const w = useWorld(meta.worldKey);
  const { uiStoreApi } = useContext(UiContext);
  const map = useRef<NavMap2dApi>(null);
  const allotment = useRef<AllotmentHandle>(null);
  // a meta persisted before there were panes has neither field
  const hidden = meta.hidden === undefined ? "lore" : meta.hidden;
  /** Mounted once first shown, so a map-only Decorator never fetches it */
  const loreSeen = useRef(false);
  loreSeen.current ||= hidden !== "lore";

  const setPanes = (patch: Partial<Pick<DecoratorUiMeta, "hidden" | "split">>) =>
    uiStoreApi.setUiMeta(meta.id, (draft) => void Object.assign(draft as DecoratorUiMeta, patch));

  // allotment re-shows a pane at the sliver it was dragged shut from
  useEffect(() => {
    if (hidden === null) allotment.current?.reset();
  }, [hidden]);

  return (
    // the gutter keeps a shut pane's icon off the open one
    <div className={cn("size-full relative bg-zinc-950", hidden === "map" && "pl-5", hidden === "lore" && "pr-5")}>
      {hidden !== null && (
        <button
          type="button"
          title={`show ${hidden}`}
          className={cn(
            "absolute z-10 top-1/2 -translate-y-1/2 grid place-items-center w-5 h-10 cursor-pointer",
            "border border-zinc-700 bg-zinc-900 text-zinc-400 hover:text-zinc-100",
            hidden === "map" ? "left-0 rounded-r" : "right-0 rounded-l",
          )}
          onClick={() => setPanes({ hidden: null })}
        >
          {hidden === "map" ? <MapTrifoldIcon className="size-3.5" /> : <BookOpenTextIcon className="size-3.5" />}
        </button>
      )}
      <Allotment
        ref={allotment}
        defaultSizes={meta.split}
        snap
        onDragEnd={(split) => setPanes({ split })}
        onVisibleChange={(index, visible) => setPanes({ hidden: visible ? null : index === 0 ? "map" : "lore" })}
      >
        <Allotment.Pane visible={hidden !== "map"} snap minSize={200} preferredSize="50%">
          {w === undefined ? (
            <div className="size-full grid place-items-center text-zinc-400 text-sm">waiting for {meta.worldKey}…</div>
          ) : (
            // keyed by the state OBJECT: a World remade by HMR is a new one, and the editor starts over on it
            <Editor key={epochOf(w)} w={w} meta={meta} map={map} />
          )}
        </Allotment.Pane>
        <Allotment.Pane visible={hidden !== "lore"} snap minSize={240} preferredSize="50%">
          {loreSeen.current && (
            <Suspense fallback={null}>
              <LorePane meta={meta} w={w} onLocate={(x, y) => map.current?.centreOn(x, y, locateZoom)} />
            </Suspense>
          )}
        </Allotment.Pane>
      </Allotment>
    </div>
  );
}

/**
 * The World's state, from the query cache it puts itself in under its key. Read off the cache's
 * own events rather than `useQuery`: the World REMOVES its query on unmount and sets a new one on
 * remount, e.g. over HMR, and an observer of the removed one would wait forever
 */
function useWorld(worldKey: string): WorldState | undefined {
  const subscribe = useCallback((onChange: () => void) => queryClientApi.queryCache.subscribe(onChange), []);
  return useSyncExternalStore(subscribe, () => {
    const w = queryClientApi.get([worldKey]) as WorldState | undefined;
    // `undefined` until it has geomorphs: the same object either side would not re-render
    return w !== undefined && w.gms.length > 0 ? w : undefined;
  });
}

const epochs = new WeakMap<WorldState, number>();
let nextEpoch = 0;
function epochOf(w: WorldState) {
  const epoch = epochs.get(w) ?? nextEpoch++;
  epochs.set(w, epoch);
  return `${w.key}:${epoch}`;
}
