import { uiClassName, uiStoreApi } from "@npc-cli/ui-sdk";
import { cn, useStateRef } from "@npc-cli/util";
import { tryLocalStorageGetParsed, tryLocalStorageSet } from "@npc-cli/util/legacy/generic";
import { CheckIcon, ListIcon } from "@phosphor-icons/react";
import { motion, useMotionValue } from "motion/react";
import { useContext } from "react";
import { useMapManifest } from "../hooks/useMapManifest";
import { WorldContext } from "./world-context";

export function WorldContextMenu() {
  const w = useContext(WorldContext);
  const { data: mapManifest } = useMapManifest();
  const mapKeys = mapManifest ? Object.keys(mapManifest.byKey) : [];

  const state = useStateRef(() => ({
    open: false,
    storedY: tryLocalStorageGetParsed(storageKey(w.id)) ?? 0,
    dragged: false,
  }));

  const y = useMotionValue(state.storedY);

  return (
    <motion.div
      className={cn(uiClassName, "absolute top-0 left-0 z-9999 touch-none select-none")}
      style={{ y }}
      drag="y"
      dragMomentum={false}
      onDragStart={() => {
        state.dragged = true;
      }}
      onDragEnd={() => {
        tryLocalStorageSet(storageKey(w.id), String(y.get()));
      }}
    >
      <button
        type="button"
        className="cursor-pointer bg-gray-800 text-white p-2"
        onClick={() => {
          if (state.dragged) {
            state.dragged = false;
          } else {
            state.set({ open: !state.open });
          }
        }}
      >
        <ListIcon className="size-5" weight="bold" />
      </button>

      {state.open && (
        <div className="flex flex-col bg-gray-800 text-white mt-0.5 rounded-b-md min-w-32">
          {mapKeys.map((key) => (
            <button
              key={key}
              type="button"
              className={cn(
                "flex items-center gap-2 px-3 py-1.5 text-left text-sm cursor-pointer",
                "hover:bg-white/20 not-last:border-b border-white/20",
                key === w.mapKey && "text-green-400",
              )}
              onClick={() => {
                uiStoreApi.setUiMeta(w.id, (draft) => {
                  draft.mapKey = key;
                });
                state.set({ open: false });
              }}
            >
              {key === w.mapKey && <CheckIcon className="size-4" weight="bold" />}
              <span>{key}</span>
            </button>
          ))}
        </div>
      )}
    </motion.div>
  );
}

const storageKey = (id: string) => `world-context-menu-y-${id}`;
