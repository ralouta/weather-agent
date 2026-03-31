import fs from "node:fs";
import path from "node:path";
import type { Plugin, ResolvedConfig } from "vite";
import { defineConfig } from "vite";
import { viteStaticCopy } from "vite-plugin-static-copy";

const SETTINGS_FILE = "settings.json";
const SETTINGS_EXAMPLE_FILE = "settings.example.json";

function resolveSettingsSource(root: string): string | null {
  const settingsPath = path.join(root, SETTINGS_FILE);
  if (fs.existsSync(settingsPath)) {
    return settingsPath;
  }

  const examplePath = path.join(root, SETTINGS_EXAMPLE_FILE);
  if (fs.existsSync(examplePath)) {
    return examplePath;
  }

  return null;
}

function settingsFilePlugin(): Plugin {
  let config: ResolvedConfig;

  return {
    name: "settings-file-fallback",
    configResolved(resolvedConfig) {
      config = resolvedConfig;
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const requestPath = (req.url ?? "").split("?")[0];
        if (requestPath !== `/${SETTINGS_FILE}`) {
          next();
          return;
        }

        const sourcePath = resolveSettingsSource(server.config.root);
        if (!sourcePath) {
          next();
          return;
        }

        res.setHeader("Content-Type", "application/json; charset=utf-8");
        res.end(fs.readFileSync(sourcePath, "utf8"));
      });
    },
    writeBundle() {
      const sourcePath = resolveSettingsSource(config.root);
      if (!sourcePath) {
        return;
      }

      const outDir = path.resolve(config.root, config.build.outDir);
      fs.mkdirSync(outDir, { recursive: true });
      fs.copyFileSync(sourcePath, path.join(outDir, SETTINGS_FILE));
    },
  };
}

export default defineConfig({
  envPrefix: ["ARCGIS_", "PORTAL_"],
  plugins: [
    settingsFilePlugin(),
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
