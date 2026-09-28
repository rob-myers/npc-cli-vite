import type { Plugin } from "vite";

/** Where `<NewVersionToast>` looks for the deployed build's id */
export const versionJsonPath = "/version.json";
/** `<meta name>`s carrying the running build's id and when it was built */
export const buildIdMetaName = "build-id";
export const buildAtMetaName = "build-at";

/**
 * Serves a per-build id at `/version.json`, and tags `index.html` with the same one,
 * so a long-lived tab can notice it is running superseded code.
 *
 * The id goes in the html rather than a `define`, which would inline it into a hashed
 * chunk and so rename every chunk it reaches on each build.
 */
export function buildIdPlugin(): Plugin {
  const now = Date.now();
  const buildId = now.toString(36);
  const buildAt = new Date(now).toISOString();
  const source = `${JSON.stringify({ id: buildId, at: buildAt })}\n`;

  return {
    name: "build-id",

    transformIndexHtml() {
      return [
        { tag: "meta", attrs: { name: buildIdMetaName, content: buildId }, injectTo: "head" },
        { tag: "meta", attrs: { name: buildAtMetaName, content: buildAt }, injectTo: "head" },
      ];
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
