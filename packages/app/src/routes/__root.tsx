import { createRootRoute, Outlet } from "@tanstack/react-router";
import { TanStackRouterDevtools } from "@tanstack/react-router-devtools";

export const Route = createRootRoute({
  component: RootComponent,
  notFoundComponent: () => <div>Page Not Found</div>,
});

// 🚧
function RootComponent() {
  return (
    <div className="flex flex-col items-center gap-4 w-screen">
      <h1>My App</h1>
      <Outlet /> {/* This is where child routes will render */}
      <TanStackRouterDevtools position="bottom-right" />
    </div>
  );
}
