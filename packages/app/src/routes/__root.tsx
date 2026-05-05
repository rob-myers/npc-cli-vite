import { themeApi, themeStore } from "@npc-cli/theme";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { createRootRoute, Outlet } from "@tanstack/react-router";
import { TanStackRouterDevtools } from "@tanstack/react-router-devtools";

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
  return (
    <div className="bg-background h-svh">
      <Outlet />

      {/* ordering fixes weird mount animation bug of WorldMenu */}
      <ReactQueryDevtools initialIsOpen={false} buttonPosition="bottom-left" />
      <TanStackRouterDevtools position="bottom-right" />
    </div>
  );
}
