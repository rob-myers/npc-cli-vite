import { Menu } from "@base-ui/react/menu";
import { themeApi, useThemeName } from "@npc-cli/theme";
import { type UseStateRef, useStateRef } from "@npc-cli/util";
import { ArrowsInIcon, GearIcon, MoonIcon, ResizeIcon, SunIcon } from "@phosphor-icons/react";
import { motion, useMotionValue } from "motion/react";
import { useEffect, useState } from "react";

const storageKey = "ui-grid-edit-toggle-y";

export function UiGridMenu({ parent }: { parent: UseStateRef<import("./UiGrid").State> }) {
  const y = useMotionValue(Math.max(minY, getStoredY()));
  const vpOffset = useVisualViewportOffset();
  const theme = useThemeName();

  const state = useStateRef(() => ({
    y,
    dragged: false,
    menuOpen: false,
    vpOffset,
    theme,

    onDragStart() {
      state.dragged = true;
    },
    onDragEnd() {
      localStorage.setItem(storageKey, String(state.y.get()));
    },
    onMenuOpenChange(open: boolean) {
      if (state.dragged) {
        state.dragged = false;
        return;
      }
      if (!open) {
        state.menuOpen = false;
        state.update();
      }
    },
    onResizeClick() {
      if (state.dragged) {
        state.dragged = false;
        return;
      }
      parent.set({ resizeMode: !parent.resizeMode });
    },
  }));

  state.vpOffset = vpOffset;
  state.theme = theme;

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && parent.resizeMode) {
        parent.set({ resizeMode: false });
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [parent]);

  return (
    <motion.div
      className="fixed text-white bg-gray-800 p-2 z-9999 touch-none flex flex-col gap-1"
      style={{
        y: state.y,
        left: state.vpOffset.x + (window.visualViewport?.width ?? window.innerWidth) - 36,
        top: state.vpOffset.y,
      }}
      drag="y"
      dragMomentum={false}
      dragConstraints={{ top: minY, bottom: window.innerHeight - minY }}
      onDragStart={state.onDragStart}
      onDragEnd={state.onDragEnd}
    >
      <Menu.Root open={state.menuOpen} onOpenChange={state.onMenuOpenChange}>
        <Menu.Trigger
          className="cursor-pointer"
          render={<span />}
          onPointerUp={() => {
            if (!state.dragged) {
              state.menuOpen = !state.menuOpen;
              state.update();
            }
            state.dragged = false;
          }}
        >
          <GearIcon className="size-5" weight="bold" />
        </Menu.Trigger>

        <Menu.Portal>
          <Menu.Positioner className="z-9999" alignOffset={0} sideOffset={12} side="left" collisionPadding={0}>
            <Menu.Popup className="bg-slate-800 border border-slate-700 rounded-md shadow-lg py-1 min-w-20">
              <Menu.Item
                className="flex items-center gap-2 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-700 cursor-pointer"
                closeOnClick={false}
                onClick={() => themeApi.setOther()}
              >
                {state.theme === "dark" ? <SunIcon className="size-4" /> : <MoonIcon className="size-4" />}
                {state.theme === "dark" ? "Light" : "Dark"}
              </Menu.Item>
            </Menu.Popup>
          </Menu.Positioner>
        </Menu.Portal>
      </Menu.Root>

      <button
        type="button"
        className={`cursor-pointer rounded p-0.5 ${parent.resizeMode ? "bg-blue-600" : "bg-slate-700"}`}
        onClick={state.onResizeClick}
      >
        <ResizeIcon className="size-4" weight={parent.resizeMode ? "bold" : "regular"} />
      </button>

      {state.vpOffset.zoomed && (
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

function getStoredY() {
  try {
    const raw = localStorage.getItem(storageKey);
    return raw ? Number(raw) : 0;
  } catch {
    return 0;
  }
}
