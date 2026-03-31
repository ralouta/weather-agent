/**
 * mcpWeatherClient.ts
 *
 * Thin wrapper around the @modelcontextprotocol/sdk that spawns the
 * @dangahagan/weather-mcp server as a child process and exposes a
 * callTool() helper used by the agent service.
 *
 * The MCP server configuration mirrors exactly what you would place in
 * your MCP client config:
 *   {
 *     "mcpServers": {
 *       "weather": {
 *         "command": "npx",
 *         "args": ["-y", "@dangahagan/weather-mcp@latest"],
 *         "env": { "ENABLED_TOOLS": "full", "CACHE_MAX_SIZE": "2000", "LOG_LEVEL": "1" }
 *       }
 *     }
 *   }
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

// Shape of a single text content block returned by the MCP server.
interface MCPTextContent {
  type: "text";
  text: string;
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

  /** Spawn the weather MCP server process and establish the stdio connection. */
  async connect(): Promise<void> {
    this.transport = new StdioClientTransport({
      command: "npx",
      args: ["-y", "@dangahagan/weather-mcp@latest"],
      env: Object.fromEntries(
        Object.entries(process.env)
          .filter((e): e is [string, string] => e[1] !== undefined)
          .concat([
            ["ENABLED_TOOLS", "full"],
            ["CACHE_MAX_SIZE", "2000"],
            ["LOG_LEVEL", "1"],
          ])
      ),
    });

    await this.client.connect(this.transport);
    this.connected = true;
  }

  /**
   * Invoke a single MCP tool by name.
   * Returns the concatenated text from all content blocks in the response.
   */
  async callTool(
    name: string,
    args: Record<string, unknown>
  ): Promise<string> {
    if (!this.connected) {
      throw new Error("MCP client is not connected – call connect() first.");
    }

    const result = await this.client.callTool({ name, arguments: args });

    // The MCP result.content is an array of typed content blocks.
    const content = result.content as MCPTextContent[];
    return content
      .filter((c) => c.type === "text")
      .map((c) => c.text)
      .join("\n");
  }

  /** Gracefully close the MCP connection and child process. */
  async disconnect(): Promise<void> {
    if (this.connected) {
      await this.client.close();
      this.connected = false;
      this.transport = null;
    }
  }
}
