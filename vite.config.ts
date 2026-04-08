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


function arcgisAssetsDevPlugin(): Plugin {
  const MIME_TYPES: Record<string, string> = {
    ".json": "application/json; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".wasm": "application/wasm",
    ".png": "image/png",
    ".svg": "image/svg+xml",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".css": "text/css; charset=utf-8",
    ".ttf": "font/ttf",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
    ".pbf": "application/x-protobuf",
  };

  return {
    name: "arcgis-assets-dev",
    apply: "serve",
    configureServer(server) {
      const root = server.config.root;
      const coreDir = path.resolve(root, "node_modules/@arcgis/core/assets");
      const mapDir = path.resolve(root, "node_modules/@arcgis/map-components/dist/cdn/assets");
      const aiDir = path.resolve(root, "node_modules/@arcgis/ai-components/dist/cdn/assets");

      // Mount under /assets — connect strips the prefix, so req.url is the sub-path
      server.middlewares.use("/assets", (req, res, next) => {
        const urlPath = decodeURIComponent((req.url ?? "/").split("?")[0]);
        const candidates = [
          path.join(coreDir, urlPath),
          path.join(mapDir, urlPath),
          path.join(aiDir, urlPath),
        ];

        for (const candidate of candidates) {
          const normalised = path.normalize(candidate);
          const safe =
            normalised.startsWith(coreDir + path.sep) ||
            normalised.startsWith(mapDir + path.sep) ||
            normalised.startsWith(aiDir + path.sep);
          if (!safe) continue;

          try {
            const stat = fs.statSync(normalised);
            if (stat.isFile()) {
              const ext = path.extname(normalised).toLowerCase();
              res.setHeader("Content-Type", MIME_TYPES[ext] ?? "application/octet-stream");
              res.setHeader("Cache-Control", "no-cache");
              fs.createReadStream(normalised).pipe(res);
              return;
            }
          } catch {
            // file doesn't exist — try next candidate
          }
        }
        next();
      });
    },
  };
}
export default defineConfig({
  envPrefix: ["ARCGIS_", "PORTAL_"],
  plugins: [
    settingsFilePlugin(),
    arcgisAssetsDevPlugin(),
    // Copy ArcGIS SDK assets to the public dist folder so the SDK can find
    // worker scripts, fonts, images, etc. at runtime.
    viteStaticCopy({
      targets: [
        {
          src: "node_modules/@arcgis/core/assets",
          dest: ".",
        },
        {
          src: "node_modules/@arcgis/map-components/dist/cdn/assets",
          dest: "assets",
        },
        {
          src: "node_modules/@arcgis/ai-components/dist/cdn/assets",
          dest: "assets",
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
