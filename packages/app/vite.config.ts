import mdx from "@mdx-js/rollup";
import { mapEditApiPlugin } from "@npc-cli/scripts/vite-plugin-map-edit-api";
import { watchAssetsPlugin } from "@npc-cli/scripts/vite-plugin-watch-assets";
import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react-swc";
import { defineConfig } from "vite";
import { analyzer } from "vite-bundle-analyzer";

// https://vite.dev/config/
export default defineConfig({
  define: {
    // poly2tri.js?v=7a093b1e:1295 Uncaught ReferenceError: global is not defined
    global: "globalThis",
  },
  plugins: [
    tanstackRouter({
      target: "react",
      autoCodeSplitting: true,
      routesDirectory: "src/routes",
    }),
    mdx(),
    react(),
    tailwindcss(),
    mapEditApiPlugin(),
    watchAssetsPlugin(),

    process.env.BUILD_AND_ANALYZE ? analyzer() : undefined,

    {
      name: "patch-vite-client",
      transform(code, id) {
        if (id.includes("@vite/client") || id.endsWith("client.mjs")) {
          return code
            .replace(
              // On close/reopen laptop in Chrome we do not want HMR to break
              '			if (payload.event === "vite:ws:disconnect") {',
              '			if (payload.event === "vite:ws:disconnect") {\nconsole.log("[vite] 💔 vite:ws:disconnect reconnecting...");\ntransport.connect(createHMRHandler(handleMessage));return;',
            )
            .replace(
              // Fix console error in webworker probably due to our HMR implementation
              '				const el = Array.from(document.querySelectorAll("link")).find((e) => !outdatedLinkTags.has(e) && cleanUrl(e.href).includes(searchUrl));',
              '				const el = typeof document !== "undefined" ? Array.from(document.querySelectorAll("link")).find((e) => !outdatedLinkTags.has(e) && cleanUrl(e.href).includes(searchUrl)) : undefined;',
            );
        }
      },
    },
  ],
});
