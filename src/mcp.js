import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

import { MCP_SERVERS } from "./mcp.config.js";

const clients = {};

export async function initMcp() {
  for (const server of MCP_SERVERS) {
    try {
      if (server.transport === "http" && !server.url) {
        console.warn(`[mcp:${server.name}] no url, skipping`);
        continue;
      }

      if (
        server.transport === "stdio" &&
        server.env &&
        Object.values(server.env).some((value) => !value)
      ) {
        console.warn(`[mcp:${server.name}] missing env, skipping`);
        continue;
      }

      const client = new Client(
        { name: "hermes", version: "1.0.0" },
        { capabilities: {} },
      );
      const transport =
        server.transport === "http"
          ? new StreamableHTTPClientTransport(new URL(server.url))
          : new StdioClientTransport({
              command: server.command,
              args: server.args,
              env: { ...process.env, ...(server.env || {}) },
            });

      await client.connect(transport);
      clients[server.name] = { client, meta: server };
      console.log(`[mcp:${server.name}] connected (${server.transport})`);
    } catch (error) {
      console.error(`[mcp:${server.name}] connect failed:`, error.message);
    }
  }
}

export function hasMcpServer(server) {
  return !!clients[server];
}

export async function listTools(server) {
  const connection = clients[server];
  if (!connection) {
    throw new Error(`MCP server not connected: ${server}`);
  }

  const { tools } = await connection.client.listTools();
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
  }));
}

export async function callTool(server, name, args = {}) {
  const connection = clients[server];
  if (!connection) {
    throw new Error(`MCP server not connected: ${server}`);
  }

  const response = await connection.client.callTool({
    name,
    arguments: args,
  });

  return (response.content || [])
    .map((block) =>
      block.type === "text" ? block.text : JSON.stringify(block),
    )
    .join("\n");
}

export function isSensitiveServer(server) {
  return !!clients[server]?.meta?.sensitive;
}
