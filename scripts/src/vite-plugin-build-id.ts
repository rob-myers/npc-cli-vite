import type { Plugin } from "vite";

/** Where `<NewVersionToast>` looks for the deployed build's id */
export const versionJsonPath = "/version.json";

/**
 * Gives the app a per-build `__BUILD_ID__` and serves the same id at `/version.json`,
 * so a long-lived tab can notice it is running superseded code.
 */
export function buildIdPlugin(): Plugin {
  const buildId = Date.now().toString(36);
  const source = `${JSON.stringify({ id: buildId })}\n`;

  return {
    name: "build-id",

    config() {
      return { define: { __BUILD_ID__: JSON.stringify(buildId) } };
    },

    generateBundle() {
      this.emitFile({ type: "asset", fileName: versionJsonPath.slice(1), source });
    },

    // dev has no dist, yet the toast must stay testable
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url?.split("?")[0] !== versionJsonPath) return next();
        res.setHeader("Content-Type", "application/json");
        res.setHeader("Cache-Control", "no-store");
        res.end(source);
      });
    },
  };
}
