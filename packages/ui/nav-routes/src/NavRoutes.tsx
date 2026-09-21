import { Select } from "@base-ui/react/select";
import type { WorldState } from "@npc-cli/ui__world";
import { queryClientApi } from "@npc-cli/ui__world/query-client";
import { UiContext } from "@npc-cli/ui-sdk/UiContext";
import { cn, useStateRef } from "@npc-cli/util";
import { CaretDownIcon, CheckIcon } from "@phosphor-icons/react";
import { skipToken, useQuery } from "@tanstack/react-query";
import { useContext, useEffect } from "react";
import { NavMap2d } from "./NavMap2d";
import type { NavMapLayer, NavRoutesUiMeta } from "./schema";

/** A 2D top-down editor for nav paths, over a live World — see `docs/nav-routes.md` */
export default function NavRoutes({ meta }: { meta: NavRoutesUiMeta }) {
  const { uiStoreApi } = useContext(UiContext);

  // the World puts its state in the query cache under its key, and takes it out again
  const { data: w } = useQuery<WorldState>(
    { queryKey: [meta.worldKey], queryFn: skipToken },
    queryClientApi.queryClient,
  );

  const state = useStateRef(
    (): State => ({
      /** The npcs there were when the picker was last opened: it need not keep up */
      npcOptions: [],

      onNpcsOpenChange(open) {
        if (open === false) return;
        const npcKeys = Object.keys(w?.n ?? {});
        state.npcOptions = npcKeys;
        // those gone since are dropped
        state.setNpcKeys(meta.npcKeys.filter((npcKey) => npcKeys.includes(npcKey)));
      },
      setNpcKeys(npcKeys) {
        uiStoreApi.setUiMeta(meta.id, (draft) => void ((draft as NavRoutesUiMeta).npcKeys = npcKeys));
      },
      toggleLayer(layer) {
        uiStoreApi.setUiMeta(meta.id, (draft) => {
          const { show } = draft as NavRoutesUiMeta;
          show[layer] = !show[layer];
        });
      },
    }),
    { deps: [w, meta.npcKeys] },
  );

  useEffect(() => {
    if (w === undefined) return;
    // what the map is drawn from changes under it
    const sub = w.events.subscribe({ next: (e) => redrawOn.has(e.key) && state.update() });
    return () => sub.unsubscribe();
  }, [w]);

  if (w === undefined || w.gms.length === 0) {
    return (
      <div className="size-full grid place-items-center bg-slate-950 text-slate-400 text-sm">
        waiting for {meta.worldKey}…
      </div>
    );
  }

  return (
    <div className="size-full flex flex-col bg-slate-950 text-slate-300 text-xs">
      <div className="flex items-center gap-1 px-2 py-1 border-b border-slate-800">
        <span className="text-slate-500 pr-2">
          {meta.worldKey} · {w.mapKey}
        </span>
        {layers.map((layer) => (
          <button
            key={layer}
            type="button"
            className={cn(
              "px-2 py-0.5 rounded border cursor-pointer",
              meta.show[layer] ? "border-slate-500 text-slate-200 bg-slate-800" : "border-slate-800 text-slate-500",
            )}
            onClick={() => state.toggleLayer(layer)}
          >
            {layer}
          </button>
        ))}

        <Select.Root
          multiple
          value={meta.npcKeys}
          onValueChange={state.setNpcKeys}
          onOpenChange={state.onNpcsOpenChange}
        >
          <Select.Trigger className="ml-auto flex items-center gap-1 px-2 py-0.5 rounded border border-slate-800 cursor-pointer hover:bg-slate-800">
            <Select.Value>{(npcKeys: string[]) => (npcKeys.length === 0 ? "npcs" : npcKeys.join(", "))}</Select.Value>
            <CaretDownIcon className="size-3" />
          </Select.Trigger>
          <Select.Portal>
            <Select.Positioner className="z-50" sideOffset={4} align="end" alignItemWithTrigger={false}>
              <Select.Popup className="bg-slate-800 border border-slate-700 rounded shadow-lg py-1 max-h-60 overflow-auto text-xs text-slate-300">
                {state.npcOptions.length === 0 && <div className="px-3 py-1 text-slate-500">no npcs</div>}
                {state.npcOptions.map((npcKey) => (
                  <Select.Item
                    key={npcKey}
                    value={npcKey}
                    className="flex items-center gap-2 px-3 py-1 cursor-pointer data-highlighted:bg-slate-700"
                  >
                    <Select.ItemIndicator className="w-3">
                      <CheckIcon className="size-3" />
                    </Select.ItemIndicator>
                    <Select.ItemText>{npcKey}</Select.ItemText>
                  </Select.Item>
                ))}
              </Select.Popup>
            </Select.Positioner>
          </Select.Portal>
        </Select.Root>
      </div>

      <div className="flex-1 min-h-0">
        <NavMap2d w={w} show={meta.show} npcKeys={meta.npcKeys} />
      </div>
    </div>
  );
}

type State = {
  npcOptions: string[];
  onNpcsOpenChange(open: boolean): void;
  setNpcKeys(npcKeys: string[]): void;
  toggleLayer(layer: NavMapLayer): void;
};

const layers: NavMapLayer[] = ["nav", "labels", "obstacles", "grid"];

/** The events after which the map looks different */
const redrawOn = new Set<string>([
  "map-settled",
  "nav-updated",
  "decor-ready",
  "door-open",
  "door-closed",
  "door-locked",
  "door-unlocked",
]);
