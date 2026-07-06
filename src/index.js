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
const ANTHROPIC_MODEL =
  process.env.ANTHROPIC_MODEL || process.env.MODEL || "claude-sonnet-5";
const GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions";
const GEMINI_API_URL =
  "https://generativelanguage.googleapis.com/v1beta/models";
const GROQ_MODEL = process.env.GROQ_MODEL || "openai/gpt-oss-20b";
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";
const MAX_OUTPUT_TOKENS = Number(process.env.MAX_OUTPUT_TOKENS || 1024);
const PROVIDER_ORDER = (process.env.LLM_PROVIDER_ORDER || "anthropic,gemini,groq")
  .split(",")
  .map((provider) => provider.trim().toLowerCase())
  .filter(Boolean);
if (PROVIDER_ORDER.length === 0) {
  PROVIDER_ORDER.push("anthropic", "gemini", "groq");
}

const SYSTEM_PROMPT = `You are Isaac Munandar's personal assistant (project Hermes).
You report before he asks and keep replies tight and operator-grade.
No emojis on anything B2B or investor-facing. Draft only — never claim to have sent anything.`;

function parseJson(text) {
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

async function requestJson(url, options) {
  const response = await fetch(url, options);
  const bodyText = await response.text();
  const body = parseJson(bodyText);

  if (!response.ok) {
    const detail =
      body.error?.message || body.message || body.raw || response.statusText;
    throw new Error(`${response.status} ${response.statusText}: ${detail}`);
  }

  return body;
}

function extractGroqText(body) {
  const content = body.choices?.[0]?.message?.content;
  if (typeof content === "string") return content.trim();
  if (Array.isArray(content)) {
    return content
      .map((part) => (typeof part === "string" ? part : part?.text || ""))
      .join("")
      .trim();
  }
  return "";
}

function extractGeminiText(body) {
  return (
    body.candidates?.[0]?.content?.parts
      ?.map((part) => part?.text || "")
      .join("")
      .trim() || ""
  );
}

function extractAnthropicText(body) {
  return (
    body.content
      ?.map((part) => (part.type === "text" ? part.text : ""))
      .join("")
      .trim() || ""
  );
}

function toGeminiContents(messages, inlineSystemPrompt = false) {
  const contents = messages.map((message) => ({
    role: message.role === "assistant" ? "model" : "user",
    parts: [{ text: message.content }],
  }));

  if (inlineSystemPrompt) {
    contents.unshift({
      role: "user",
      parts: [{ text: `System instructions:\n${SYSTEM_PROMPT}` }],
    });
  }

  return contents;
}

async function generateWithAnthropic(messages) {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY is not set");
  }

  const body = await anthropic.messages.create({
    model: ANTHROPIC_MODEL,
    max_tokens: MAX_OUTPUT_TOKENS,
    system: SYSTEM_PROMPT,
    messages,
  });

  const reply = extractAnthropicText(body);
  if (!reply) throw new Error("Anthropic returned no text");
  return reply;
}

async function generateWithGroq(messages) {
  if (!process.env.GROQ_API_KEY) {
    throw new Error("GROQ_API_KEY is not set");
  }

  const body = await requestJson(GROQ_API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: GROQ_MODEL,
      max_completion_tokens: MAX_OUTPUT_TOKENS,
      messages: [{ role: "system", content: SYSTEM_PROMPT }, ...messages],
    }),
  });

  const reply = extractGroqText(body);
  if (!reply) throw new Error("Groq returned no text");
  return reply;
}

async function postGemini(body) {
  const response = await requestJson(
    `${GEMINI_API_URL}/${encodeURIComponent(GEMINI_MODEL)}:generateContent`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": process.env.GEMINI_API_KEY,
      },
      body: JSON.stringify(body),
    },
  );

  const reply = extractGeminiText(response);
  if (!reply) throw new Error("Gemini returned no text");
  return reply;
}

async function generateWithGemini(messages) {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY is not set");
  }

  const baseBody = {
    contents: toGeminiContents(messages),
    generationConfig: {
      maxOutputTokens: MAX_OUTPUT_TOKENS,
    },
  };

  try {
    return await postGemini({
      ...baseBody,
      systemInstruction: {
        parts: [{ text: SYSTEM_PROMPT }],
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!/systemInstruction|Unknown name|Cannot find field/i.test(message)) {
      throw error;
    }

    return await postGemini({
      ...baseBody,
      contents: toGeminiContents(messages, true),
    });
  }
}

async function generateReply(messages) {
  const failures = [];

  for (const provider of PROVIDER_ORDER) {
    try {
      if (provider === "anthropic") {
        return {
          provider,
          reply: await generateWithAnthropic(messages),
        };
      }

      if (provider === "groq") {
        return {
          provider,
          reply: await generateWithGroq(messages),
        };
      }

      if (provider === "gemini") {
        return {
          provider,
          reply: await generateWithGemini(messages),
        };
      }

      failures.push(`${provider}: unsupported provider`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failures.push(`${provider}: ${message}`);
      console.error(`[llm:${provider}]`, error);
    }
  }

  throw new Error(`All LLM providers failed. ${failures.join(" | ")}`);
}

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

    const { provider, reply } = await generateReply(messages);
    console.log(`Reply generated with ${provider}`);

    await save(msg.channelId, "user", msg.content);
    await save(msg.channelId, "assistant", reply);

    // Discord hard-caps messages at 2000 chars
    for (let i = 0; i < reply.length; i += 1900) {
      await msg.reply(reply.slice(i, i + 1900));
    }
  } catch (err) {
    console.error(err);
    await msg.reply("Error talking to the AI provider — check logs.");
  }
});

client.once("ready", () => console.log("Hermes bot online"));
client.login(process.env.DISCORD_TOKEN);
