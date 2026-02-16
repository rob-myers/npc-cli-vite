import mdx from "@mdx-js/rollup";
import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import basicSsl from "@vitejs/plugin-basic-ssl";
import react from "@vitejs/plugin-react-swc";
import { defineConfig } from "vite";
import { analyzer } from "vite-bundle-analyzer";

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    tanstackRouter({
      target: "react",
      autoCodeSplitting: true,
      routesDirectory: "src/routes",
    }),
    mdx(),
    react(),
    tailwindcss(),
    // pnpm dev-hotspot needs https for crypto
    process.env.USE_HTTPS ? basicSsl() : undefined,
    analyzer(),

    // On close/reopen laptop in Chrome we do not want HMR to break
    {
      name: "patch-vite-client",
      transform(code, id) {
        if (id.includes("@vite/client") || id.endsWith("client.mjs")) {
          // Replace specific code or append logic
          return code.replace(
            '			if (payload.event === "vite:ws:disconnect") {',
            '			if (payload.event === "vite:ws:disconnect") {\nconsole.log("[vite] 💔 vite:ws:disconnect reconnecting...");\ntransport.connect(createHMRHandler(handleMessage));return;',
          );
        }
      },
    },
  ],
});
