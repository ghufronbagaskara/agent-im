export const MCP_SERVERS = [
  {
    name: "gworkspace",
    transport: "http",
    url: process.env.MCP_GWORKSPACE_URL,
    sensitive: true,
  },
  {
    name: "hubspot",
    transport: "http",
    url: process.env.MCP_HUBSPOT_URL,
    sensitive: true,
  },
  {
    name: "firecrawl",
    transport: "stdio",
    command: "npx",
    args: ["-y", "firecrawl-mcp"],
    env: { FIRECRAWL_API_KEY: process.env.FIRECRAWL_API_KEY },
    sensitive: false,
  },
];
