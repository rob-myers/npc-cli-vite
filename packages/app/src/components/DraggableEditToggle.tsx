import { LockIcon, PenIcon } from "@phosphor-icons/react";
import { motion, useMotionValue } from "motion/react";
import { useMemo, useRef } from "react";

const storageKey = "ui-grid-edit-toggle-y";

export function DraggableEditToggle({ state }: { state: { editMode: boolean; set: (partial: { editMode?: boolean }) => void } }) {
  const storedY = useMemo(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      return raw ? Number(raw) : 0;
    } catch {
      return 0;
    }
  }, []);

  const y = useMotionValue(storedY);
  const dragged = useRef(false);

  return (
    <motion.div
      className="cursor-pointer fixed top-0 right-0 text-white bg-gray-800 p-2 z-9999 touch-none"
      style={{ y }}
      drag="y"
      dragMomentum={false}
      onDragStart={() => {
        dragged.current = true;
      }}
      onDragEnd={() => {
        localStorage.setItem(storageKey, String(y.get()));
      }}
      onClick={() => {
        if (dragged.current) {
          dragged.current = false;
          return;
        }
        state.set({ editMode: !state.editMode });
      }}
    >
      {state.editMode ? <PenIcon className="size-5" /> : <LockIcon className="size-5" />}
    </motion.div>
  );
}
