import { uiClassName, uiStoreApi } from "@npc-cli/ui-sdk";
import { cn, useStateRef } from "@npc-cli/util";
import { CheckIcon, ListIcon } from "@phosphor-icons/react";
import { motion, useMotionValue } from "motion/react";
import { useContext, useMemo, useRef } from "react";
import { useMapManifest } from "../hooks/useMapManifest";
import { WorldContext } from "./world-context";

export function WorldContextMenu() {
  const w = useContext(WorldContext);
  const { data: mapManifest } = useMapManifest();
  const mapKeys = mapManifest ? Object.keys(mapManifest.byKey) : [];

  const storedY = useMemo(() => {
    try {
      const raw = localStorage.getItem(storageKey(w.id));
      return raw ? Number(raw) : 0;
    } catch {
      return 0;
    }
  }, []);

  const y = useMotionValue(storedY);
  const dragged = useRef(false);

  const state = useStateRef(() => ({
    open: false,
  }));

  return (
    <motion.div
      className={cn(uiClassName, "absolute top-0 left-0 z-9999 touch-none select-none")}
      style={{ y }}
      drag="y"
      dragMomentum={false}
      onDragStart={() => {
        dragged.current = true;
      }}
      onDragEnd={() => {
        localStorage.setItem(storageKey(w.id), String(y.get()));
      }}
    >
      <button
        type="button"
        className="cursor-pointer bg-gray-800 text-white p-2"
        onClick={() => {
          if (dragged.current) {
            dragged.current = false;
            return;
          }
          state.set({ open: !state.open });
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
