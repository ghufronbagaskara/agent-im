import { AGENTS_BY_ID } from "./agents.js";
import { generateReply } from "./llm.js";
import { callTool, hasMcpServer } from "./mcp.js";

export async function sendChunked(channel, text) {
  for (let i = 0; i < text.length; i += 1900) {
    await channel.send(text.slice(i, i + 1900));
  }
}

async function loadAgentHistory(db, agentId, channelId, limit = 10) {
  const { rows } = await db.query(
    `SELECT role, content FROM conversations
     WHERE agent_id=$1 AND channel_id=$2 ORDER BY created_at DESC LIMIT $3`,
    [agentId, channelId, limit],
  );
  return rows.reverse().map((row) => ({
    role: row.role,
    content: row.content,
  }));
}

async function saveAgent(db, agentId, channelId, role, content) {
  await db.query(
    `INSERT INTO conversations (agent_id, channel_id, role, content) VALUES ($1,$2,$3,$4)`,
    [agentId, channelId, role, content],
  );
}

async function resolveAgentSystem(agent, context) {
  if (typeof agent.system === "function") {
    return await agent.system(context);
  }

  return agent.system;
}

async function loadMemoryContext(agentId) {
  if (!hasMcpServer("memory") || !process.env.MCP_TOOL_MEMORY_SEARCH) {
    return "";
  }

  try {
    return await callTool("memory", process.env.MCP_TOOL_MEMORY_SEARCH, {
      query: agentId,
      limit: 5,
    });
  } catch (error) {
    console.error(`[mcp:memory:search:${agentId}]`, error.message);
    return "";
  }
}

async function saveMemory(agentId, reply) {
  if (!hasMcpServer("memory") || !process.env.MCP_TOOL_MEMORY_ADD) {
    return;
  }

  try {
    await callTool("memory", process.env.MCP_TOOL_MEMORY_ADD, {
      data: reply,
      metadata: { agent: agentId },
    });
  } catch (error) {
    console.error(`[mcp:memory:add:${agentId}]`, error.message);
  }
}

export async function runAgent(client, db, agentId) {
  const agent = AGENTS_BY_ID[agentId];
  if (!agent || !agent.enabled) return;

  const channelId = process.env[agent.channelEnv];
  if (!channelId) {
    console.error(`[agent:${agentId}] no channel configured`);
    return;
  }

  const channel = await client.channels.fetch(channelId);
  if (!channel?.isTextBased()) {
    console.error(`[agent:${agentId}] channel is missing or not text-based`);
    return;
  }

  const userPrompt = await agent.task({ db });
  const system = await resolveAgentSystem(agent, { db, channelId, mode: "run" });
  const memory = await loadMemoryContext(agent.id);
  const content = memory
    ? `CONTEXT FROM MEMORY:\n${memory}\n\nTASK:\n${userPrompt}`
    : userPrompt;
  const { provider, reply } = await generateReply(
    [{ role: "user", content }],
    { system, policy: agent.policy },
  );

  console.log(`[agent:${agentId}] report via ${provider}`);

  await saveAgent(db, agentId, channelId, "user", userPrompt);
  await sendChunked(
    channel,
    `**${agent.name}** — ${new Date().toLocaleString("en-GB", {
      timeZone: process.env.TZ || "Asia/Jakarta",
    })}\n${reply}`,
  );
  await saveAgent(db, agentId, channelId, "assistant", reply);
  await saveMemory(agentId, reply);
}

export async function runAgentReply(client, db, agent, msg) {
  const history = await loadAgentHistory(db, agent.id, msg.channelId);
  const memory = await loadMemoryContext(agent.id);
  const messages = [
    ...history,
    {
      role: "user",
      content: memory
        ? `CONTEXT FROM MEMORY:\n${memory}\n\nUSER MESSAGE:\n${msg.content}`
        : msg.content,
    },
  ];
  const system = await resolveAgentSystem(agent, {
    db,
    channelId: msg.channelId,
    msg,
    mode: "reply",
  });
  const { reply } = await generateReply(messages, {
    system,
    policy: agent.policy,
  });

  await saveAgent(db, agent.id, msg.channelId, "user", msg.content);
  await saveAgent(db, agent.id, msg.channelId, "assistant", reply);

  const channel = await client.channels.fetch(msg.channelId);
  if (!channel?.isTextBased()) {
    throw new Error(`Agent channel ${msg.channelId} is missing or not text-based`);
  }

  await sendChunked(channel, reply);
  await saveMemory(agent.id, reply);
}
