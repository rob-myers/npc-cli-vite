import { Menu } from "@base-ui/react/menu";
import { themeApi, useThemeName } from "@npc-cli/theme";
import { ArrowsInIcon, GearIcon, MoonIcon, PenIcon, SunIcon } from "@phosphor-icons/react";
import { motion, useMotionValue } from "motion/react";
import { useEffect, useMemo, useRef, useState } from "react";

const storageKey = "ui-grid-edit-toggle-y";

export function DraggableUiGridMenu({
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
  const theme = useThemeName();

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
      className="fixed text-white bg-gray-800 p-2 z-9999 touch-none flex flex-col gap-1"
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
    >
      <Menu.Root
        onOpenChange={(open) => {
          if (open && dragged.current) {
            dragged.current = false;
          }
        }}
      >
        <Menu.Trigger
          className="cursor-pointer"
          onPointerUp={() => {
            if (dragged.current) {
              dragged.current = false;
            }
          }}
        >
          <GearIcon className="size-5" weight="bold" />
        </Menu.Trigger>

        <Menu.Portal>
          <Menu.Positioner className="z-9999" sideOffset={4} side="left" align="center">
            <Menu.Popup className="bg-slate-800 border border-slate-700 rounded-md shadow-lg py-1 min-w-20">
              <Menu.Item
                className="flex items-center gap-2 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-700 cursor-pointer"
                closeOnClick={false}
                onClick={() => state.set({ resizeMode: !state.resizeMode })}
              >
                <PenIcon className="size-4" />
                Resize
              </Menu.Item>

              <div className="my-1 border-t border-slate-700" />

              <Menu.Item
                className="flex items-center gap-2 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-700 cursor-pointer"
                closeOnClick={false}
                onClick={() => themeApi.setOther()}
              >
                {theme === "dark" ? <SunIcon className="size-4" /> : <MoonIcon className="size-4" />}
                {theme === "dark" ? "Light" : "Dark"}
              </Menu.Item>
            </Menu.Popup>
          </Menu.Positioner>
        </Menu.Portal>
      </Menu.Root>

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
