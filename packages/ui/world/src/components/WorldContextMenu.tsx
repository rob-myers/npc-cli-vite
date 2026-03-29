import { uiClassName } from "@npc-cli/ui-sdk/const";
import { UiContext } from "@npc-cli/ui-sdk/UiContext";
import { cn, Spinner, useStateRef } from "@npc-cli/util";
import { tryLocalStorageGetParsed, tryLocalStorageSet } from "@npc-cli/util/legacy/generic";
import { ListIcon } from "@phosphor-icons/react";
import { AnimatePresence, motion, useMotionValue } from "motion/react";
import { useContext } from "react";
import { useMapManifest } from "../hooks/useMapManifest";
import { WorldContext } from "./world-context";

export function WorldContextMenu() {
  const { uiStoreApi } = useContext(UiContext);

  const w = useContext(WorldContext);
  const { data: mapManifest } = useMapManifest();
  const mapKeys = mapManifest ? Object.keys(mapManifest.byKey) : [];

  const state = useStateRef(() => ({
    open: false,
    dragged: false,
    y: tryLocalStorageGetParsed(storageKey(w.id)) ?? 0,
    onDragStart() {
      state.dragged = true;
    },
    onDragEnd() {
      tryLocalStorageSet(storageKey(w.id), String(y.get()));
    },
    onToggle() {
      if (state.dragged) state.dragged = false;
      else state.set({ open: !state.open });
    },
    onSelect(key: string) {
      uiStoreApi.setUiMeta(w.id, (draft) => {
        draft.mapKey = key;
      });
      setTimeout(() => state.set({ open: false }), 0);
    },
  }));

  const y = useMotionValue(state.y);

  return (
    <motion.div
      className={cn(uiClassName, "absolute top-0 left-0 z-9999 touch-none select-none")}
      style={{ y }}
      drag="y"
      dragMomentum={false}
      onDragStart={state.onDragStart}
      onDragEnd={state.onDragEnd}
    >
      <button type="button" className="cursor-pointer bg-gray-800 text-white p-2 flex items-center gap-2" onClick={state.onToggle}>
        <ListIcon className="size-5" weight="bold" />
        {w.assetsPending && <Spinner className="size-4" />}
      </button>

      <AnimatePresence>
        {state.open && (
          <motion.div className="flex flex-col bg-gray-800 text-white mt-0.5 rounded-b-md min-w-32" {...fadeAnimation}>
            {mapKeys.map((key) => (
              <button
                key={key}
                type="button"
                className={cn(
                  "flex items-center gap-2 px-3 py-1.5 text-left text-sm cursor-pointer",
                  "hover:bg-white/20 not-last:border-b border-white/20",
                  key === w.mapKey && "text-green-400",
                )}
                onClick={() => state.onSelect(key)}
              >
                <span>{key}</span>
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

const storageKey = (id: string) => `world-context-menu-y-${id}`;

const fadeAnimation = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  exit: { opacity: 0 },
  transition: { duration: 0.2 },
} as const;
