import { themeApi, themeStore } from "@npc-cli/theme";
import { tryLocalStorageGetParsed } from "@npc-cli/util/legacy/generic";
import { createRootRoute, Outlet } from "@tanstack/react-router";
import { TanStackRouterDevtools } from "@tanstack/react-router-devtools";
import { motion } from "motion/react";
import { useStateRef } from "../../../util/src/hooks/use-state-ref";
import type { UiLayout } from "../components/ResponsiveGridLayout";

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
  const state = useStateRef(
    (): {
      persisted: {
        uiLayout: UiLayout;
        itemIdToClientRect: Record<string, { x: number; y: number; width: number; height: number }>;
      } | null;
    } => ({
      persisted: tryLocalStorageGetParsed("ui-layout"),
    }),
  );

  return (
    <div className="bg-background h-dvh">
      {/* 🚧 clean */}
      {/* 🚧 fade onload responsive grid layout */}
      {/* 🚧 handle breakpoint change via (x, y) scale? */}
      <motion.div
        className="fixed"
        initial={{ opacity: 1 }}
        animate={{ opacity: 0, transition: { duration: 2 } }}
      >
        {Object.entries(state.persisted?.itemIdToClientRect ?? {}).map(
          ([itemId, { x, y, width, height }]) => (
            <div
              key={itemId}
              className="absolute border border-white/30"
              style={{
                width,
                height,
                transform: `translate3d(${x}px, ${y}px, 0)`,
              }}
            ></div>
          ),
        )}
      </motion.div>
      <Outlet />
      <TanStackRouterDevtools position="bottom-right" />
    </div>
  );
}
