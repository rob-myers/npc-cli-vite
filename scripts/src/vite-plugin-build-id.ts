import type { Plugin } from "vite";

/** Where `<NewVersionToast>` looks for the deployed build's id */
export const versionJsonPath = "/version.json";
/** `<meta name>` carrying the running build's id */
export const buildIdMetaName = "build-id";

/**
 * Serves a per-build id at `/version.json`, and tags `index.html` with the same one,
 * so a long-lived tab can notice it is running superseded code.
 *
 * The id goes in the html rather than a `define`, which would inline it into a hashed
 * chunk and so rename every chunk it reaches on each build.
 */
export function buildIdPlugin(): Plugin {
  const buildId = Date.now().toString(36);
  const source = `${JSON.stringify({ id: buildId })}\n`;

  return {
    name: "build-id",

    transformIndexHtml() {
      return [{ tag: "meta", attrs: { name: buildIdMetaName, content: buildId }, injectTo: "head" }];
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
