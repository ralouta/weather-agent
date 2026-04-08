/**
 * server/index.ts
 *
 * Express backend — MCP weather proxy only.
 */

import express from "express";
import cors from "cors";
import { config } from "dotenv";
import { MCPWeatherClient } from "./mcpWeatherClient.js";

config();

const PORT = parseInt(process.env.SERVER_PORT ?? "3001", 10);
const IS_DEV = process.env.NODE_ENV !== "production";
const MCP_ALLOWED_TOOLS = new Set([
  "search_location",
  "get_current_conditions",
  "get_forecast",
]);

function getAllowedOrigins(): string[] {
  const configuredOrigins = process.env.CLIENT_ORIGINS?.split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

  if (configuredOrigins?.length) {
    return configuredOrigins;
  }

  return [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://localhost:4173",
    "http://127.0.0.1:4173",
  ];
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validateToolArgs(toolName: string, value: unknown): Record<string, unknown> {
  if (!isPlainObject(value)) {
    throw new Error("Request body must be a JSON object.");
  }

  const args = value;

  switch (toolName) {
    case "search_location":
      if (typeof args.query !== "string" || !args.query.trim()) {
        throw new Error("search_location requires a non-empty string query.");
      }
      if (args.limit != null && typeof args.limit !== "number") {
        throw new Error("search_location limit must be a number when provided.");
      }
      break;
    case "get_current_conditions":
    case "get_forecast":
      if (typeof args.latitude !== "number" || typeof args.longitude !== "number") {
        throw new Error(`${toolName} requires numeric latitude and longitude.`);
      }
      break;
    default:
      throw new Error(`Unsupported MCP tool: ${toolName}`);
  }

  return args;
}

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "16kb" }));
app.use(
  cors({
    origin: getAllowedOrigins(),
    methods: ["GET", "POST"],
  })
);

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

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", mcp: mcpReady });
});

app.post("/api/mcp/:toolName", async (req, res) => {
  const { toolName } = req.params;

  try {
    if (!MCP_ALLOWED_TOOLS.has(toolName)) {
      res.status(404).json({ error: `Unknown MCP tool '${toolName}'.` });
      return;
    }

    const args = validateToolArgs(toolName, req.body);
    await ensureMcp();
    const result = await mcpClient.callTool(toolName, args);

    if (IS_DEV) {
      console.log(`[server] MCP ← ${toolName} (${result.length} chars)`);
    }

    res.json({ result });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[server] MCP error (${toolName}):`, message);
    const statusCode =
      message.startsWith("Request body") ||
      message.startsWith("search_location") ||
      message.includes("requires")
        ? 400
        : 500;
    res.status(statusCode).json({ error: message });
  }
});

app.listen(PORT, () => {
  console.log(`[server] Listening on http://localhost:${PORT}`);
  ensureMcp().catch((error) =>
    console.error("[server] MCP warm-up failed:", error)
  );
});

process.on("SIGTERM", async () => {
  await mcpClient.disconnect();
  process.exit(0);
});
process.on("SIGINT", async () => {
  await mcpClient.disconnect();
  process.exit(0);
});
