import { Client, GatewayIntentBits, Partials } from "discord.js";
import Anthropic from "@anthropic-ai/sdk";
import pg from "pg";

const db = new pg.Pool({
  host: process.env.PGHOST,
  user: process.env.PGUSER,
  password: process.env.POSTGRES_PASSWORD,
  database: process.env.PGDATABASE,
});

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const MODEL = process.env.MODEL || "claude-sonnet-5";

const SYSTEM_PROMPT = `You are Isaac Munandar's personal assistant (project Hermes).
You report before he asks and keep replies tight and operator-grade.
No emojis on anything B2B or investor-facing. Draft only — never claim to have sent anything.`;

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
  ],
  partials: [Partials.Channel],
});

async function loadHistory(channelId, limit = 20) {
  const { rows } = await db.query(
    `SELECT role, content FROM conversations
     WHERE channel_id = $1 ORDER BY created_at DESC LIMIT $2`,
    [channelId, limit],
  );
  return rows.reverse().map((r) => ({ role: r.role, content: r.content }));
}

async function save(channelId, role, content) {
  await db.query(
    `INSERT INTO conversations (channel_id, role, content) VALUES ($1,$2,$3)`,
    [channelId, role, content],
  );
}

client.on("messageCreate", async (msg) => {
  if (msg.author.bot) return;
  if (!msg.content?.trim()) return;

  try {
    await msg.channel.sendTyping();
    const history = await loadHistory(msg.channelId);
    const messages = [...history, { role: "user", content: msg.content }];

    const resp = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      messages,
    });

    const reply =
      resp.content
        .map((b) => (b.type === "text" ? b.text : ""))
        .join("")
        .trim() || "(no response)";

    await save(msg.channelId, "user", msg.content);
    await save(msg.channelId, "assistant", reply);

    // Discord hard-caps messages at 2000 chars
    for (let i = 0; i < reply.length; i += 1900) {
      await msg.reply(reply.slice(i, i + 1900));
    }
  } catch (err) {
    console.error(err);
    await msg.reply("Error talking to Claude — check logs.");
  }
});

client.once("ready", () => console.log("Hermes bot online"));
client.login(process.env.DISCORD_TOKEN);
