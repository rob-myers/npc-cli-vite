import mdx from "@mdx-js/rollup";
import { assetHistoryPlugin } from "@npc-cli/scripts/vite-plugin-asset-history";
import { audioDefaultsPlugin } from "@npc-cli/scripts/vite-plugin-audio-defaults";
import { buildIdPlugin } from "@npc-cli/scripts/vite-plugin-build-id";
import { buildSheetHashPlugin } from "@npc-cli/scripts/vite-plugin-build-sheet-hash";
import { devMcpPlugin } from "@npc-cli/scripts/vite-plugin-dev-mcp";
import { mapEditApiPlugin } from "@npc-cli/scripts/vite-plugin-map-edit-api";
import { scenarioPlugin } from "@npc-cli/scripts/vite-plugin-scenario";
import { rehypeFenceMeta, skipNetArticlesPlugin } from "@npc-cli/scripts/vite-plugin-skip-net-articles";
import { spotsPlugin } from "@npc-cli/scripts/vite-plugin-spots";
import { stableEntryPlugin } from "@npc-cli/scripts/vite-plugin-stable-entry";
import { watchAssetsPlugin } from "@npc-cli/scripts/vite-plugin-watch-assets";
import { worldRtcPlugin } from "@npc-cli/scripts/vite-plugin-world-rtc";
import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import basicSsl from "@vitejs/plugin-basic-ssl";
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
    /** Fences stay raw, so SkipNet's own components can highlight and run them. Their meta is passed on */
    mdx({ rehypePlugins: [rehypeFenceMeta] }),
    /** Compiles .mdx too, so an article is a refresh boundary: an edit swaps it in place */
    react(),
    tailwindcss(),
    mapEditApiPlugin(),
    watchAssetsPlugin(),
    spotsPlugin(),
    skipNetArticlesPlugin(),
    scenarioPlugin(),
    audioDefaultsPlugin(),
    worldRtcPlugin(),
    buildIdPlugin(),
    buildSheetHashPlugin(),
    devMcpPlugin(),
    assetHistoryPlugin(),
    stableEntryPlugin(),

    process.env.BUILD_AND_ANALYZE ? analyzer() : undefined,
    // `dev-hotspot`: a phone only has WebGPU on a secure origin, which a LAN address over http is not
    process.env.USE_HTTPS ? basicSsl() : undefined,

    {
      // zod's `export * as locales` is a namespace re-export, so all 47 locales survive
      // tree-shaking even though we only ever use `en`
      name: "trim-zod-locales",
      load(id) {
        if (id.replace(/\\/g, "/").endsWith("/zod/v4/locales/index.js")) {
          return `export { default as en } from "./en.js";`;
        }
      },
    },

    {
      /** Imports each icon from its own module. Through the barrel, every icon is entry-reachable for `stableEntryPlugin` */
      name: "phosphor-per-icon",
      apply: "build",
      transform(code) {
        if (!code.includes('"@phosphor-icons/react"')) return;
        return code.replace(/import\s*\{([^}]*)\}\s*from\s*"@phosphor-icons\/react";?/g, (all, names: string) => {
          const specs = names
            .split(",")
            .map((x) => x.trim())
            .filter(Boolean);
          if (!specs.every((x) => /^\w+Icon(\s+as\s+\w+)?$/.test(x))) return all;
          return specs
            .map(
              (x) =>
                `import { ${x} } from "@phosphor-icons/react/dist/csr/${x.split(/\s/)[0].slice(0, -"Icon".length)}";`,
            )
            .join("\n");
        });
      },
    },

    {
      /** The build rewrites the entry's script tag, dropping its `blocking="render"` */
      name: "render-blocking-entry",
      apply: "build",
      transformIndexHtml: {
        order: "post",
        handler: (html) =>
          html.replace(
            /<script type="module" crossorigin src="([^"]+)">/,
            '<script type="module" crossorigin src="$1" blocking="render">',
          ),
      },
    },

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
