import { Menu } from "@base-ui/react/menu";
import { themeApi, useThemeName } from "@npc-cli/theme";
import { useStateRef } from "@npc-cli/util";
import { ArrowsInIcon, GearIcon, MoonIcon, SunIcon } from "@phosphor-icons/react";
import { motion, useMotionValue } from "motion/react";
import { useEffect, useState } from "react";

const storageKey = "allotment-menu-y";
const minY = 120;

export function GlobalMenu() {
  const y = useMotionValue(Math.max(minY, getStoredY()));
  const vpOffset = useVisualViewportOffset();
  const theme = useThemeName();

  const menu = useStateRef(() => ({
    y,
    dragged: false,
    menuOpen: false,
    vpOffset,
    theme,

    onDragStart() {
      menu.dragged = true;
    },
    onDragEnd() {
      localStorage.setItem(storageKey, String(menu.y.get()));
    },
    onMenuOpenChange(open: boolean) {
      if (menu.dragged) {
        menu.dragged = false;
        return;
      }
      if (!open) {
        menu.menuOpen = false;
        menu.update();
      }
    },
  }));

  menu.vpOffset = vpOffset;
  menu.theme = theme;

  return (
    <motion.div
      className="fixed text-white bg-gray-800 p-2 z-9999 touch-none flex flex-col gap-1"
      style={{
        y: menu.y,
        left: menu.vpOffset.x + (window.visualViewport?.width ?? window.innerWidth) - 36,
        top: menu.vpOffset.y,
      }}
      drag="y"
      dragMomentum={false}
      dragConstraints={{ top: minY, bottom: window.innerHeight - minY }}
      onDragStart={menu.onDragStart}
      onDragEnd={menu.onDragEnd}
    >
      <Menu.Root open={menu.menuOpen} onOpenChange={menu.onMenuOpenChange}>
        <Menu.Trigger
          className="cursor-pointer"
          render={<span />}
          onPointerUp={() => {
            if (!menu.dragged) {
              menu.menuOpen = !menu.menuOpen;
              menu.update();
            }
            menu.dragged = false;
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
                {menu.theme === "dark" ? <SunIcon className="size-4" /> : <MoonIcon className="size-4" />}
                {menu.theme === "dark" ? "Light" : "Dark"}
              </Menu.Item>
            </Menu.Popup>
          </Menu.Positioner>
        </Menu.Portal>
      </Menu.Root>

      {menu.vpOffset.zoomed && (
        <button type="button" className="cursor-pointer" onClick={() => location.reload()}>
          <ArrowsInIcon className="size-5" />
        </button>
      )}
    </motion.div>
  );
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

function getStoredY() {
  try {
    const raw = localStorage.getItem(storageKey);
    return raw ? Number(raw) : 0;
  } catch {
    return 0;
  }
}
