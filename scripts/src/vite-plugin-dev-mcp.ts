import type { Plugin } from "vite";

/** Where Claude Code's `Stop` hook says its turn has ended — see `docs/mcp.md` */
export const devMcpTurnEndPath = "/api/dev-mcp/turn-end";

/** DEV only: passes the end of a Claude turn on to the page, which then takes down "mcp testing" */
export function devMcpPlugin(): Plugin {
  return {
    name: "dev-mcp",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.method !== "POST" || req.url?.split("?")[0] !== devMcpTurnEndPath) return next();
        server.ws.send({ type: "custom", event: "dev-mcp:turn-end" }); // see `dev-mcp-hooks.ts`
        res.end("ok");
      });
    },
  };
}
