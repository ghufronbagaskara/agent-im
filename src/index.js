import { Client, GatewayIntentBits, Partials } from "discord.js";
import pg from "pg";

import { AGENTS_BY_ID, buildChannelMap } from "./agents.js";
import { generateReply } from "./llm.js";
import { initMcp, listTools } from "./mcp.js";
import { handleNotesButton, handleNotesCommand } from "./meetingNotes.js";
import { initOps, reportError } from "./ops.js";
import { runAgentReply } from "./runner.js";
import { startScheduler } from "./scheduler.js";
import { startWebhook } from "./webhook.js";

const db = new pg.Pool({
  host: process.env.PGHOST,
  user: process.env.PGUSER,
  password: process.env.POSTGRES_PASSWORD,
  database: process.env.PGDATABASE,
});

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
  ],
  partials: [Partials.Channel],
});

let channelMap = {};
let agentQueue = null;

async function loadAttachmentText(msg) {
  const attachment = msg.attachments.first();
  if (!attachment || !/\.txt$/i.test(attachment.name || "")) return "";
  return await (await fetch(attachment.url)).text();
}

async function handleVoiceCommand(msg) {
  let samples = msg.content.slice("!voice".length).trim();
  if (!samples) {
    samples = await loadAttachmentText(msg);
  }

  if (samples.length < 200) {
    await msg.reply(
      "Paste 15-30 of your posts after !voice, or attach a .txt.",
    );
    return;
  }

  const { reply: voiceMd } = await generateReply(
    [
      {
        role: "user",
        content:
          "These are Isaac Munandar's real posts. Produce a voice.md capturing: tone, sentence rhythm, vocabulary, hooks he uses, structures, and things he never does (no bragging, humble). Be specific and usable as a style guide.\n\n" +
          samples,
      },
    ],
    {
      system: "You are a writing-voice analyst. Output only the voice.md content.",
      policy: "sensitive",
    },
  );

  await db.query(
    `INSERT INTO org_knowledge (key, value) VALUES ('voice', $1)
     ON CONFLICT (key) DO UPDATE SET value=$1, updated_at=now()`,
    [voiceMd],
  );
  await msg.reply("voice.md updated. Content agents will now write in your voice.");
}

async function loadHistory(channelId, limit = 20) {
  const { rows } = await db.query(
    `SELECT role, content FROM conversations
     WHERE agent_id = 'default' AND channel_id = $1
     ORDER BY created_at DESC LIMIT $2`,
    [channelId, limit],
  );
  return rows.reverse().map((row) => ({ role: row.role, content: row.content }));
}

async function save(channelId, role, content) {
  await db.query(
    `INSERT INTO conversations (agent_id, channel_id, role, content)
     VALUES ('default',$1,$2,$3)`,
    [channelId, role, content],
  );
}

client.on("messageCreate", async (msg) => {
  if (msg.author.bot) return;
  if (!msg.content?.trim()) return;

  if (msg.content.trim().toLowerCase().startsWith("!notes")) {
    try {
      await handleNotesCommand(msg, db);
    } catch (err) {
      await reportError("command:notes", err);
      await msg.reply("Notes error — check logs.");
    }
    return;
  }

  if (msg.content.trim().toLowerCase().startsWith("!voice")) {
    try {
      await handleVoiceCommand(msg);
    } catch (err) {
      await reportError("command:voice", err);
      await msg.reply("Voice training error — check logs.");
    }
    return;
  }

  if (msg.content.trim().toLowerCase().startsWith("!run ")) {
    const id = msg.content.trim().split(/\s+/)[1];
    if (!agentQueue) {
      await msg.reply("Scheduler is not ready yet.");
      return;
    }

    if (AGENTS_BY_ID[id]) {
      if (!process.env[AGENTS_BY_ID[id].channelEnv]) {
        await msg.reply(`Agent channel is not configured for: ${id}`);
        return;
      }

      await agentQueue.add("run", { agentId: id });
      await msg.react("✅");
    } else {
      await msg.reply(`Unknown agent: ${id}`);
    }
    return;
  }

  if (msg.content.trim().toLowerCase().startsWith("!mcptools ")) {
    const server = msg.content.trim().split(/\s+/)[1];
    try {
      const tools = await listTools(server);
      const body = tools
        .map(
          (tool) =>
            `${tool.name} - ${(tool.description || "").replace(/\s+/g, " ").slice(0, 100)}`,
        )
        .join("\n")
        .slice(0, 1900);
      await msg.reply(`\`\`\`\n${body}\n\`\`\``);
    } catch (error) {
      await msg.reply(`Error: ${error.message}`);
    }
    return;
  }

  const agent = channelMap[msg.channelId];
  if (agent) {
    try {
      await msg.channel.sendTyping();
      await runAgentReply(client, db, agent, msg);
    } catch (err) {
      await reportError(`agent:${agent.id}:reply`, err);
      await msg.reply("Agent error — check logs.");
    }
    return;
  }

  try {
    await msg.channel.sendTyping();
    const history = await loadHistory(msg.channelId);
    const messages = [...history, { role: "user", content: msg.content }];
    const { provider, reply } = await generateReply(messages, {
      policy: "standard",
    });

    console.log(`Reply generated with ${provider}`);

    await save(msg.channelId, "user", msg.content);
    await save(msg.channelId, "assistant", reply);

    for (let i = 0; i < reply.length; i += 1900) {
      await msg.reply(reply.slice(i, i + 1900));
    }
  } catch (err) {
    await reportError("chat:generic", err);
    await msg.reply("Error talking to the AI provider — check logs.");
  }
});

client.on("interactionCreate", async (interaction) => {
  if (!interaction.isButton()) return;
  if (!interaction.customId.startsWith("notes:")) return;

  try {
    await handleNotesButton(interaction, db);
  } catch (err) {
    await reportError("interaction:notes", err);
  }
});

client.once("clientReady", async () => {
  console.log("Hermes bot online");
  initOps(client);
  await initMcp();
  channelMap = buildChannelMap();
  agentQueue = startScheduler(client, db);
  startWebhook(client, db);
});

process.on("unhandledRejection", (error) => {
  void reportError("unhandledRejection", error);
});

process.on("uncaughtException", (error) => {
  void reportError("uncaughtException", error);
});

client.login(process.env.DISCORD_TOKEN);
