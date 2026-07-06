import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

import { MCP_SERVERS } from "./mcp.config.js";

const clients = {};
const MCP_HTTP_RETRIES = Number(process.env.MCP_HTTP_RETRIES || 10);
const MCP_HTTP_RETRY_DELAY_MS = Number(
  process.env.MCP_HTTP_RETRY_DELAY_MS || 2000,
);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function hasRequiredEnv(server) {
  return !server.requiredEnv?.some((name) => !process.env[name]);
}

async function connectHttpWithRetry(client, server) {
  let lastError = null;

  for (let attempt = 1; attempt <= MCP_HTTP_RETRIES; attempt += 1) {
    try {
      const transport = new StreamableHTTPClientTransport(new URL(server.url));
      await client.connect(transport);
      return;
    } catch (error) {
      lastError = error;
      if (attempt < MCP_HTTP_RETRIES) {
        console.warn(
          `[mcp:${server.name}] connect attempt ${attempt}/${MCP_HTTP_RETRIES} failed: ${error.message}`,
        );
        await sleep(MCP_HTTP_RETRY_DELAY_MS);
      }
    }
  }

  throw lastError;
}

export async function initMcp() {
  for (const server of MCP_SERVERS) {
    try {
      if (server.transport === "http" && !server.url) {
        console.warn(`[mcp:${server.name}] no url, skipping`);
        continue;
      }

      if (!hasRequiredEnv(server)) {
        console.warn(`[mcp:${server.name}] missing required env, skipping`);
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

      if (server.transport === "http") {
        await connectHttpWithRetry(client, server);
      } else {
        const transport = new StdioClientTransport({
          command: server.command,
          args: server.args,
          env: { ...process.env, ...(server.env || {}) },
        });
        await client.connect(transport);
      }

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
