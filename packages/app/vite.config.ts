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
  ],
  build: {
    rolldownOptions: {
      output: {
        advancedChunks: {
          groups: [
            { name: "three", test: /three/ },
            { name: "uis", test: /\/packages\/(ui|ui-registry|ui-sdk)\// },
            { name: "xterm", test: /xterm/ },
          ],
        },
      },
    },
  },
});
