import { createRootRoute, Outlet } from "@tanstack/react-router";
import { TanStackRouterDevtools } from "@tanstack/react-router-devtools";
import { themeApi, themeStore } from "../stores/theme.store";

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
    <div className="bg-background">
      {/* <h1 className="text-3xl">My App</h1> */}
      <Outlet /> {/* This is where child routes will render */}
      <TanStackRouterDevtools position="bottom-right" />
    </div>
  );
}
