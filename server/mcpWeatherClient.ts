/**
 * mcpWeatherClient.ts
 */

import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

interface MCPTextContent {
  type: "text";
  text: string;
}

const ENABLED_TOOLS = "search_location,get_current_conditions,get_forecast";

function getWeatherMcpCommand(): string {
  const binName = process.platform === "win32" ? "weather-mcp.cmd" : "weather-mcp";
  return path.resolve(process.cwd(), "node_modules", ".bin", binName);
}

export class MCPWeatherClient {
  private client: Client;
  private connected = false;
  private transport: StdioClientTransport | null = null;

  constructor() {
    this.client = new Client(
      { name: "weather-agent-3d", version: "1.0.0" },
      { capabilities: {} }
    );
  }

  async connect(): Promise<void> {
    if (this.connected) {
      return;
    }

    this.transport = new StdioClientTransport({
      command: getWeatherMcpCommand(),
      env: Object.fromEntries(
        Object.entries(process.env)
          .filter((entry): entry is [string, string] => entry[1] !== undefined)
          .concat([
            ["ENABLED_TOOLS", ENABLED_TOOLS],
            ["CACHE_MAX_SIZE", "2000"],
            ["LOG_LEVEL", "1"],
          ])
      ),
    });

    await this.client.connect(this.transport);
    this.connected = true;
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<string> {
    if (!this.connected) {
      throw new Error("MCP client is not connected – call connect() first.");
    }

    if (!name.trim()) {
      throw new Error("MCP tool name is required.");
    }

    const result = await this.client.callTool({ name, arguments: args });
    const content = result.content as MCPTextContent[];

    return content
      .filter((item) => item.type === "text")
      .map((item) => item.text)
      .join("\n");
  }

  async disconnect(): Promise<void> {
    if (this.connected) {
      await this.client.close();
      this.connected = false;
      this.transport = null;
    }
  }
}
