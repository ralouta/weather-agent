import { defineConfig } from "vite";
import { viteStaticCopy } from "vite-plugin-static-copy";

export default defineConfig({
  envPrefix: ["ARCGIS_", "PORTAL_"],
  plugins: [
    // Copy ArcGIS SDK assets to the public dist folder so the SDK can find
    // worker scripts, fonts, images, etc. at runtime.
    viteStaticCopy({
      targets: [
        {
          src: "node_modules/@arcgis/core/assets",
          dest: ".",
        },
      ],
    }),
  ],
  build: {
    chunkSizeWarningLimit: 13000,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) {
            return undefined;
          }

          if (id.includes("@arcgis/map-components")) {
            return "arcgis-map-components";
          }

          if (id.includes("@arcgis/ai-components")) {
            return "arcgis-ai-components";
          }

          if (id.includes("@langchain/langgraph")) {
            return "langgraph";
          }

          if (id.includes("@langchain/core")) {
            return "langchain-core";
          }

          if (id.includes("zod")) {
            return "zod";
          }

          if (id.includes("@esri/calcite-components")) {
            return "calcite";
          }

          if (id.includes("tz-lookup")) {
            return "timezone";
          }

          return undefined;
        },
      },
    },
  },
  server: {
    port: 5173,
    // Proxy /api requests to the Express backend during development.
    // The backend handles MCP weather tool calls and LLM orchestration.
    proxy: {
      "/api": {
        target: "http://localhost:3001",
        changeOrigin: true,
      },
    },
  },
});
