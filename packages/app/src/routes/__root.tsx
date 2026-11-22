import { themeApi, themeStore } from "@npc-cli/theme";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { createRootRoute, Outlet } from "@tanstack/react-router";
import { useEffect } from "react";
import { IntroToast } from "../components/IntroToast";
import { NewVersionToast } from "../components/NewVersionToast";
// import { TanStackRouterDevtools } from "@tanstack/react-router-devtools";

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
  useEffect(() => {
    window.addEventListener("dragstart", preventTextDrag, { capture: true });
    return () => window.removeEventListener("dragstart", preventTextDrag, { capture: true });
  }, []);

  return (
    <div className="bg-background h-svh">
      <Outlet />

      <NewVersionToast />
      <IntroToast />

      {/* ordering fixes weird mount animation bug of WorldMenu */}
      <ReactQueryDevtools initialIsOpen={false} buttonPosition="bottom-right" />
      {/* <TanStackRouterDevtools position="bottom-right" /> */}
    </div>
  );
}

/** A drag from within selected text is cancelled and the selection cleared, so a tab drags next time */
function preventTextDrag(e: DragEvent) {
  const selection = getSelection();
  if (selection?.isCollapsed === false && selection.containsNode(e.target as Node, true)) {
    e.preventDefault();
    selection.removeAllRanges();
  }
}
