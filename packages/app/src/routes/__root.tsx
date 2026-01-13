import { themeApi, themeStore } from "@npc-cli/theme";
import { createRootRoute, Outlet, useRouterState } from "@tanstack/react-router";
import { TanStackRouterDevtools } from "@tanstack/react-router-devtools";
import { PreloadGrid } from "../components/PreloadGrid";

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

  return (
    <div className="bg-background h-dvh">
      {resolvedLocation?.pathname === "/" && <PreloadGrid />}
      <Outlet />
      <TanStackRouterDevtools position="bottom-right" />
    </div>
  );
}
