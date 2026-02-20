import { QueryClientProvider } from "@tanstack/react-query";
import { createRouter, RouterProvider } from "@tanstack/react-router";
// https://github.com/facebook/react/issues/29915
// commented out because we want useEffect to always re-run on edit
// import { StrictMode } from "react";
import ReactDOM from "react-dom/client";
import { queryClientApi } from "./query-client";
import { routeTree } from "./routeTree.gen";

const router = createRouter({
  routeTree,
});

// Register the router instance for type safety
declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  // <StrictMode>
  <QueryClientProvider client={queryClientApi.queryClient}>
    <RouterProvider router={router} />
  </QueryClientProvider>,
  // </StrictMode>,
);
