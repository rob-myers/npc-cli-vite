import type { Plugin } from "vite";

/** Where Claude Code's `Stop` hook says its turn has ended — see `docs/mcp.md` */
export const devMcpTurnEndPath = "/api/dev-mcp/turn-end";
/** Where Claude Code's `PreCompact` hook says it is compacting */
export const devMcpCompactPath = "/api/dev-mcp/compact";

/** The HMR event each path sends to the page (`dev-mcp-hooks.ts`) */
const eventOfPath: Record<string, string> = {
  [devMcpTurnEndPath]: "dev-mcp:turn-end",
  [devMcpCompactPath]: "dev-mcp:compact",
};

/** DEV only: passes Claude Code's hooks on to the page, which shows them in "mcp testing" */
export function devMcpPlugin(): Plugin {
  return {
    name: "dev-mcp",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const event = eventOfPath[req.url?.split("?")[0] ?? ""];
        if (req.method !== "POST" || event === undefined) return next();
        server.ws.send({ type: "custom", event });
        res.end("ok");
      });
    },
  };
}
