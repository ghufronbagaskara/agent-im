import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const ANTHROPIC_MODEL =
  process.env.ANTHROPIC_MODEL || process.env.MODEL || "claude-sonnet-5";
const GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions";
const GEMINI_API_URL =
  "https://generativelanguage.googleapis.com/v1beta/models";
const GROQ_MODEL = process.env.GROQ_MODEL || "openai/gpt-oss-20b";
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";
const MAX_OUTPUT_TOKENS = Number(process.env.MAX_OUTPUT_TOKENS || 1024);

export const DEFAULT_SYSTEM = `You are Isaac Munandar's personal assistant (project Hermes).
You report before he asks and keep replies tight and operator-grade.
No emojis on anything B2B or investor-facing. Draft only — never claim to have sent anything.`;

function parseProviderOrder(value, fallback) {
  const providers = value
    .split(",")
    .map((provider) => provider.trim().toLowerCase())
    .filter(Boolean);

  return providers.length > 0 ? providers : fallback;
}

// Full chain for non-sensitive work (resilient).
const STANDARD_ORDER = parseProviderOrder(
  process.env.LLM_PROVIDER_ORDER || "anthropic,gemini,groq",
  ["anthropic", "gemini", "groq"],
);
// Sensitive work NEVER falls back to training-tier free providers.
const SENSITIVE_ORDER = parseProviderOrder(
  process.env.SENSITIVE_PROVIDER_ORDER || "anthropic",
  ["anthropic"],
).filter((provider) => provider === "anthropic");
const CHEAP_ORDER = parseProviderOrder(
  process.env.CHEAP_PROVIDER_ORDER || "gemini,groq,anthropic",
  ["gemini", "groq", "anthropic"],
);

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

const extractGroqText = (b) => {
  const c = b.choices?.[0]?.message?.content;
  if (typeof c === "string") return c.trim();
  if (Array.isArray(c))
    return c
      .map((p) => (typeof p === "string" ? p : p?.text || ""))
      .join("")
      .trim();
  return "";
};
const extractGeminiText = (b) =>
  b.candidates?.[0]?.content?.parts
    ?.map((p) => p?.text || "")
    .join("")
    .trim() || "";
const extractAnthropicText = (b) =>
  b.content
    ?.map((p) => (p.type === "text" ? p.text : ""))
    .join("")
    .trim() || "";

function toGeminiContents(messages, system, inline = false) {
  const contents = messages.map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content }],
  }));
  if (inline)
    contents.unshift({
      role: "user",
      parts: [{ text: `System instructions:\n${system}` }],
    });
  return contents;
}

async function withAnthropic(messages, system) {
  if (!process.env.ANTHROPIC_API_KEY)
    throw new Error("ANTHROPIC_API_KEY is not set");
  const body = await anthropic.messages.create({
    model: ANTHROPIC_MODEL,
    max_tokens: MAX_OUTPUT_TOKENS,
    system,
    messages,
  });
  const reply = extractAnthropicText(body);
  if (!reply) throw new Error("Anthropic returned no text");
  return reply;
}

async function withGroq(messages, system) {
  if (!process.env.GROQ_API_KEY) throw new Error("GROQ_API_KEY is not set");
  const body = await requestJson(GROQ_API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: GROQ_MODEL,
      max_completion_tokens: MAX_OUTPUT_TOKENS,
      messages: [{ role: "system", content: system }, ...messages],
    }),
  });
  const reply = extractGroqText(body);
  if (!reply) throw new Error("Groq returned no text");
  return reply;
}

async function postGemini(bodyObj) {
  const response = await requestJson(
    `${GEMINI_API_URL}/${encodeURIComponent(GEMINI_MODEL)}:generateContent`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": process.env.GEMINI_API_KEY,
      },
      body: JSON.stringify(bodyObj),
    },
  );
  const reply = extractGeminiText(response);
  if (!reply) throw new Error("Gemini returned no text");
  return reply;
}

async function withGemini(messages, system) {
  if (!process.env.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY is not set");
  const base = {
    contents: toGeminiContents(messages, system),
    generationConfig: { maxOutputTokens: MAX_OUTPUT_TOKENS },
  };
  try {
    return await postGemini({
      ...base,
      systemInstruction: { parts: [{ text: system }] },
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    if (!/systemInstruction|Unknown name|Cannot find field/i.test(msg))
      throw error;
    return await postGemini({
      ...base,
      contents: toGeminiContents(messages, system, true),
    });
  }
}

const PROVIDERS = {
  anthropic: withAnthropic,
  groq: withGroq,
  gemini: withGemini,
};

export async function generateReply(
  messages,
  { system = DEFAULT_SYSTEM, policy = "standard" } = {},
) {
  const order =
    policy === "sensitive"
      ? SENSITIVE_ORDER
      : policy === "cheap"
        ? CHEAP_ORDER
        : STANDARD_ORDER;
  const failures = [];
  for (const provider of order) {
    const fn = PROVIDERS[provider];
    if (!fn) {
      failures.push(`${provider}: unsupported`);
      continue;
    }
    try {
      return { provider, reply: await fn(messages, system) };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      failures.push(`${provider}: ${msg}`);
      console.error(`[llm:${provider}]`, error);
    }
  }
  // For sensitive policy this throws instead of leaking to a free tier. That is intentional.
  throw new Error(
    `LLM providers failed (policy=${policy}). ${failures.join(" | ")}`,
  );
}
