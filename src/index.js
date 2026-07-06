import { Client, GatewayIntentBits, Partials } from "discord.js";
import pg from "pg";

import { generateReply } from "./llm.js";
import { handleNotesButton, handleNotesCommand } from "./meetingNotes.js";

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

async function loadHistory(channelId, limit = 20) {
  const { rows } = await db.query(
    `SELECT role, content FROM conversations
     WHERE channel_id = $1 ORDER BY created_at DESC LIMIT $2`,
    [channelId, limit],
  );
  return rows.reverse().map((row) => ({ role: row.role, content: row.content }));
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

  if (msg.content.trim().toLowerCase().startsWith("!notes")) {
    try {
      await handleNotesCommand(msg, db);
    } catch (err) {
      console.error(err);
      await msg.reply("Notes error — check logs.");
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
    console.error(err);
    await msg.reply("Error talking to the AI provider — check logs.");
  }
});

client.on("interactionCreate", async (interaction) => {
  if (!interaction.isButton()) return;
  if (!interaction.customId.startsWith("notes:")) return;

  try {
    await handleNotesButton(interaction, db);
  } catch (err) {
    console.error(err);
  }
});

client.once("clientReady", () => console.log("Hermes bot online"));
client.login(process.env.DISCORD_TOKEN);
