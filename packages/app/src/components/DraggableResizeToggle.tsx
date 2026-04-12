import { ArrowsInIcon, LockIcon, PenIcon } from "@phosphor-icons/react";
import { motion, useMotionValue } from "motion/react";
import { useEffect, useMemo, useRef, useState } from "react";

const storageKey = "ui-grid-edit-toggle-y";

export function DraggableResizeToggle({
  state,
}: {
  state: { resizeMode: boolean; set: (partial: { resizeMode?: boolean }) => void };
}) {
  const storedY = useMemo(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      return raw ? Number(raw) : 0;
    } catch {
      return 0;
    }
  }, []);

  const y = useMotionValue(Math.max(minY, storedY));
  const dragged = useRef(false);
  const vpOffset = useVisualViewportOffset();

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && state.resizeMode) {
        state.set({ resizeMode: false });
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [state]);

  return (
    <motion.div
      className="cursor-pointer fixed text-white bg-gray-800 p-2 z-9999 touch-none flex flex-col gap-1"
      style={{
        y,
        left: vpOffset.x + (window.visualViewport?.width ?? window.innerWidth) - 36,
        top: vpOffset.y,
      }}
      drag="y"
      dragMomentum={false}
      dragConstraints={{ top: minY, bottom: window.innerHeight - minY }}
      onDragStart={() => {
        dragged.current = true;
      }}
      onDragEnd={() => {
        localStorage.setItem(storageKey, String(y.get()));
      }}
      onPointerUp={() => {
        if (dragged.current) {
          dragged.current = false;
          return;
        }
        state.set({ resizeMode: !state.resizeMode });
      }}
    >
      <button type="button" className="cursor-pointer">
        {state.resizeMode ? <PenIcon className="size-5" /> : <LockIcon className="size-5" />}
      </button>
      {vpOffset.zoomed && (
        <button type="button" className="cursor-pointer" onClick={resetZoom}>
          <ArrowsInIcon className="size-5" />
        </button>
      )}
    </motion.div>
  );
}

function resetZoom() {
  if (confirm("Reset zoom? This will reload the page.")) {
    location.reload();
  }
}

function useVisualViewportOffset() {
  const [offset, setOffset] = useState({ x: 0, y: 0, zoomed: false });

  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const update = () =>
      setOffset({
        x: vv.offsetLeft,
        y: vv.offsetTop,
        zoomed: vv.scale > 1.05,
      });
    vv.addEventListener("scroll", update);
    vv.addEventListener("resize", update);
    return () => {
      vv.removeEventListener("scroll", update);
      vv.removeEventListener("resize", update);
    };
  }, []);

  return offset;
}

const minY = 120;
