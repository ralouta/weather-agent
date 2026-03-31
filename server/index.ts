/**
 * server/index.ts
 *
 * Express backend — MCP weather proxy only.
 * All agent orchestration and LLM calls happen in the browser via
 * @arcgis/ai-components (ArcGIS-hosted LLM + LangGraph).
 *
 * Exposed endpoints:
 *   POST /api/mcp/:toolName  – proxy a single tool call to the MCP weather server
 *   GET  /api/health         – liveness check
 */

import express from "express";
import cors from "cors";
import { config } from "dotenv";
import { MCPWeatherClient } from "./mcpWeatherClient.js";

config();

const PORT = parseInt(process.env.SERVER_PORT ?? "3001", 10);
const IS_DEV = process.env.NODE_ENV !== "production";

const app = express();
app.use(express.json());
app.use(
  cors({
    origin: ["http://localhost:5173", "http://127.0.0.1:5173"],
    methods: ["GET", "POST"],
  })
);

// ── MCP client (singleton, connected on first request) ──────────────────────
const mcpClient = new MCPWeatherClient();
let mcpReady = false;

async function ensureMcp() {
  if (!mcpReady) {
    await mcpClient.connect();
    mcpReady = true;
    if (IS_DEV) {
      console.log("[server] MCP weather client connected.");
    }
  }
}

// ── Routes ───────────────────────────────────────────────────────────────────

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", mcp: mcpReady });
});

/**
 * POST /api/mcp/:toolName
 * Body: JSON object of tool arguments (passed directly to the MCP server).
 * Returns: { result: string }
 */
app.post("/api/mcp/:toolName", async (req, res) => {
  const { toolName } = req.params;
  const args = req.body as Record<string, unknown>;

  try {
    await ensureMcp();
    const result = await mcpClient.callTool(toolName, args);
    if (IS_DEV) {
      console.log(`[server] MCP ← ${toolName} (${result.length} chars)`);
    }
    res.json({ result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[server] MCP error (${toolName}):`, message);
    res.status(500).json({ error: message });
  }
});

// ── Startup ──────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`[server] Listening on http://localhost:${PORT}`);
  // Warm up the MCP child process eagerly.
  ensureMcp().catch((err) =>
    console.error("[server] MCP warm-up failed:", err)
  );
});

// Graceful shutdown.
process.on("SIGTERM", async () => {
  await mcpClient.disconnect();
  process.exit(0);
});
process.on("SIGINT", async () => {
  await mcpClient.disconnect();
  process.exit(0);
});
