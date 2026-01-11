import { themeApi, themeStore } from "@npc-cli/theme";
import { createRootRoute, Outlet, useRouterState } from "@tanstack/react-router";
import { TanStackRouterDevtools } from "@tanstack/react-router-devtools";
import { motion } from "motion/react";
import { useStore } from "zustand";
import { layoutStore } from "../components/layout-store";

export const Route = createRootRoute({
  component: RootComponent,
  notFoundComponent: () => <div>Page Not Found</div>,
});

document.documentElement.classList.add(`theme-${themeApi.getName()}`);

themeStore.subscribe(() => {
  document.documentElement.classList.remove(`theme-${themeApi.getOther()}`);
  document.documentElement.classList.add(`theme-${themeApi.getName()}`);
});

function RootComponent() {
  const { resolvedLocation } = useRouterState();
  const { itemToRect, ready } = useStore(layoutStore);

  return (
    <div className="bg-background h-dvh">
      {/* 🚧 clean e.g. abstract */}
      {/* 🚧 handle breakpoint change via (x, y) scale? */}
      {resolvedLocation?.pathname === "/" && (
        <motion.div
          className="fixed pointer-events-none"
          initial={{ opacity: 1 }}
          animate={ready ? { opacity: 0, transition: { duration: 1 } } : undefined}
        >
          {Object.entries(itemToRect).map(([itemId, { x, y, width, height }]) => (
            <div
              key={itemId}
              className="absolute border border-white/30"
              style={{
                width,
                height,
                transform: `translate3d(${x}px, ${y}px, 0)`,
              }}
            ></div>
          ))}
        </motion.div>
      )}

      <Outlet />
      <TanStackRouterDevtools position="bottom-right" />
    </div>
  );
}
