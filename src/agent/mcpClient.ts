const MCP_API_BASE_PATH = "/api/mcp";
const MCP_REQUEST_TIMEOUT_MS = 20000;

export async function callMcpTool(
  toolName: string,
  args: Record<string, unknown>
): Promise<string> {
  const abortController = new AbortController();
  const timeoutId = window.setTimeout(() => abortController.abort(), MCP_REQUEST_TIMEOUT_MS);

  try {
    const res = await fetch(`${MCP_API_BASE_PATH}/${toolName}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(args),
      signal: abortController.signal,
    });

    if (!res.ok) {
      const { error } = (await res.json().catch(() => ({ error: res.statusText }))) as {
        error: string;
      };
      throw new Error(`MCP tool '${toolName}' failed: ${error}`);
    }

    const { result } = (await res.json()) as { result: string };
    return result;
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error(`MCP tool '${toolName}' timed out after ${MCP_REQUEST_TIMEOUT_MS} ms.`);
    }

    throw error;
  } finally {
    window.clearTimeout(timeoutId);
  }
}
