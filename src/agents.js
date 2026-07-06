import { hubspotPipelineSummary } from "./tools/hubspot.js";
import { getKnowledge } from "./tools/knowledge.js";
import { callTool, hasMcpServer } from "./mcp.js";
import { googleNews } from "./tools/news.js";

const MARKET_QUERY =
  "AI Indonesia OR edtech Indonesia OR AI Singapore OR pelatihan AI";
const COMPETITOR_QUERY =
  "Ruangguru OR RevoU OR Dicoding OR HarukaEdu OR edtech Indonesia";
const TENDER_QUERY =
  "grant Indonesia digital transformation OR tender pelatihan digital OR AI grant Indonesia";

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

async function loadVoiceGuide(db) {
  return (
    (await getKnowledge(db, "voice")) ||
    "(no voice.md yet - write in a clear founder tone)"
  );
}

function buildVoiceSystem(base) {
  return async ({ db }) => {
    const voice = await loadVoiceGuide(db);
    return `${base}\n\nVOICE GUIDE:\n${voice}`;
  };
}

async function firstHeadline(query, fallback) {
  const news = await googleNews(query, 1);
  return news[0]?.title || fallback;
}

async function headlineBlock(query, limit = 5) {
  const news = await googleNews(query, limit);
  if (!news.length) return "";
  return news.map((item) => `- ${item.title}`).join("\n");
}

async function firecrawlScrape(url) {
  if (!hasMcpServer("firecrawl") || !process.env.MCP_TOOL_FIRECRAWL_SCRAPE) {
    return "";
  }

  try {
    return await callTool("firecrawl", process.env.MCP_TOOL_FIRECRAWL_SCRAPE, {
      url,
      formats: ["markdown"],
    });
  } catch (error) {
    console.error("[mcp:firecrawl]", error.message);
    return "";
  }
}

export const AGENTS = [
  {
    id: "heartbeat",
    name: "Heartbeat (test)",
    channelEnv: "CHANNEL_HEARTBEAT",
    schedule: "*/2 * * * *",
    policy: "cheap",
    system:
      "You are a terse status agent. Output one line confirming you are alive with the current time.",
    task: () => `Give a one-line heartbeat for ${new Date().toISOString()}.`,
    enabled: true,
  },
  {
    id: "tender",
    name: "Tender & Grant Scout",
    channelEnv: "CHANNEL_TENDERS",
    schedule: "0 3 * * *",
    policy: "cheap",
    system:
      "You are Isaac's Tender & Grant Scout. Report-first, no emojis. Surface grants, tenders, and public-sector programs relevant to MAXY's AI training and digital transformation work.",
    task: async () => {
      const scraped = process.env.TENDER_SOURCE_URL
        ? await firecrawlScrape(process.env.TENDER_SOURCE_URL)
        : "";
      if (scraped) {
        return `New tender listings (raw):\n${scraped}\n\nExtract tenders relevant to MAXY (AI/digital training, edtech). List title, agency, deadline, value.`;
      }

      const headlines = await headlineBlock(TENDER_QUERY, 8);
      return headlines
        ? `Signals for ${todayIso()}:\n${headlines}\n\nWrite today's tender and grant scout brief.`
        : `No tender headlines fetched for ${todayIso()}. Produce the scout brief with [SOURCE PENDING] and the search framing you would use.`;
    },
    enabled: true,
  },
  {
    id: "intel",
    name: "Market Intel",
    channelEnv: "CHANNEL_INTEL",
    schedule: "20 3 * * *",
    policy: "cheap",
    system:
      "You are Isaac's Market Intel agent. Report-first, no emojis. Synthesize the provided headlines into a tight brief: what matters for MAXY (AI/edtech Indonesia + Singapore, competitors, government digital-transformation), and 1-2 content angles Isaac could post. Ignore irrelevant or duplicate headlines.",
    task: async () => {
      const headlines = await headlineBlock(MARKET_QUERY, 10);
      return headlines
        ? `Headlines for ${todayIso()}:\n${headlines}\n\nWrite the market intel brief.`
        : `No headlines fetched for ${todayIso()}. Produce a brief noting the fetch gap and general framing.`;
    },
    enabled: true,
  },
  {
    id: "competitor-study",
    name: "Competitor Study",
    channelEnv: "CHANNEL_COMPETITORS",
    schedule: "40 3 * * *",
    policy: "cheap",
    system:
      "You are Isaac's Competitor Study agent. Report-first, no emojis. Distill competitor moves into what MAXY should watch, copy, counter, or ignore.",
    task: async () => {
      const headlines = await headlineBlock(COMPETITOR_QUERY, 8);
      return headlines
        ? `Competitor signals for ${todayIso()}:\n${headlines}\n\nWrite today's competitor study.`
        : `No competitor headlines fetched for ${todayIso()}. Produce the study with [SOURCE PENDING] and the competitor watchlist framing.`;
    },
    enabled: true,
  },
  {
    id: "scout",
    name: "Lead Scout",
    channelEnv: "CHANNEL_SCOUT",
    schedule: "0 4 * * *",
    policy: "sensitive",
    system:
      "You are Isaac's Lead Scout. Report-first, operator-grade, no emojis. Prioritize enterprise and university leads that fit MAXY's AI upskilling offer.",
    task: async () =>
      `Produce today's lead scout brief for ${todayIso()}. Since no live lead source is wired yet, output a prospecting plan with ICP, trigger signals, and clearly labeled [DATA PENDING] placeholders for specific accounts.`,
    enabled: true,
  },
  {
    id: "nurture",
    name: "Signal & Nurture",
    channelEnv: "CHANNEL_NURTURE",
    schedule: "20 4 * * *",
    policy: "sensitive",
    system:
      "You are Isaac's Signal & Nurture agent. Report-first, no emojis. Convert dormant leads into concrete next actions without sounding robotic or pushy.",
    task: async () =>
      `Produce today's nurture queue for ${todayIso()}. No CRM follow-up feed is wired yet, so return a structure with follow-up priorities, copy prompts, and [DATA PENDING] placeholders.`,
    enabled: true,
  },
  {
    id: "meeting-prep",
    name: "Meeting Prep",
    channelEnv: "CHANNEL_MEETING_PREP",
    schedule: "40 4 * * *",
    policy: "sensitive",
    system:
      "You are Isaac's Meeting Prep agent. Report-first, no emojis. Prepare the minimum useful brief before Isaac walks into a meeting.",
    task: async () =>
      `Produce today's meeting prep brief for ${todayIso()}. Calendar is not wired yet, so output the prep template with [CALENDAR PENDING], the questions Isaac should ask, and the decisions he should force.`,
    enabled: true,
  },
  {
    id: "planner",
    name: "Personal Daily Planner",
    channelEnv: "CHANNEL_PLANNER",
    schedule: "50 4 * * *",
    policy: "sensitive",
    system:
      "You are Isaac's Personal Daily Planner. Report-first, operator-grade, no emojis. Turn ambiguity into a sharp daily operating plan.",
    task: async () =>
      `Produce Isaac's planner for ${todayIso()}. Since calendar and task tools are not wired yet, return a CEO day plan skeleton with top three outcomes, delegation prompts, and [DATA PENDING] placeholders.`,
    enabled: true,
  },
  {
    id: "content-strategist",
    name: "Content Strategist",
    channelEnv: "CHANNEL_CONTENT",
    schedule: "0 5 * * *",
    policy: "cheap",
    system: buildVoiceSystem(
      "You are Isaac's Content Strategist. Draft in his voice. No emojis on B2B. Turn current market signals into specific content angles Isaac can actually post today.",
    ),
    task: async ({ db }) => {
      const voice = await loadVoiceGuide(db);
      const headlines = await headlineBlock(MARKET_QUERY, 6);
      return `VOICE GUIDE:\n${voice}\n\nSignals for ${todayIso()}:\n${headlines || "- No live headlines fetched"}\n\nProduce 3-5 content angles for LinkedIn, short-form video, and community posts.`;
    },
    enabled: true,
  },
  {
    id: "copywriter",
    name: "LinkedIn Copywriter",
    channelEnv: "CHANNEL_COPY",
    schedule: "20 5 * * *",
    policy: "standard",
    system: buildVoiceSystem(
      "You are Isaac's LinkedIn copywriter. Write in his voice using the voice guide. No emojis on B2B. Humble, not braggy. Draft only.",
    ),
    task: async ({ db }) => {
      const voice = await loadVoiceGuide(db);
      const topic = await firstHeadline(
        MARKET_QUERY,
        "AI upskilling in Indonesia",
      );
      return `VOICE GUIDE:\n${voice}\n\nDraft one LinkedIn post about: ${topic}. Return only the post ready to copy.`;
    },
    enabled: true,
  },
  {
    id: "newsletter",
    name: "Newsletter Writer",
    channelEnv: "CHANNEL_NEWSLETTER",
    schedule: "40 5 * * *",
    policy: "standard",
    system: buildVoiceSystem(
      "You are Isaac's newsletter writer. Write in his voice, clear and grounded. No filler, no hype words, no emojis.",
    ),
    task: async ({ db }) => {
      const voice = await loadVoiceGuide(db);
      const headlines = await headlineBlock(MARKET_QUERY, 5);
      return `VOICE GUIDE:\n${voice}\n\nReference signals:\n${headlines || "- No live headlines fetched"}\n\nDraft a concise newsletter outline with subject line, intro, 3 sections, and CTA.`;
    },
    enabled: true,
  },
  {
    id: "shortform",
    name: "Short-form Writer",
    channelEnv: "CHANNEL_SHORTFORM",
    schedule: "0 6 * * *",
    policy: "standard",
    system: buildVoiceSystem(
      "You are Isaac's short-form writer. Write in his voice for TikTok and Instagram. Keep it punchy, clear, and useful, not cringey.",
    ),
    task: async ({ db }) => {
      const voice = await loadVoiceGuide(db);
      const topic = await firstHeadline(
        MARKET_QUERY,
        "why AI literacy now matters for teams",
      );
      return `VOICE GUIDE:\n${voice}\n\nWrite one 45-second short-form script about: ${topic}. Include hook, body, and CTA.`;
    },
    enabled: true,
  },
  {
    id: "reels-scriptwriter",
    name: "Reels Scriptwriter",
    channelEnv: "CHANNEL_REELS",
    schedule: "5 6 * * *",
    policy: "standard",
    system: buildVoiceSystem(
      "You are Isaac's Reels scriptwriter. Write in his voice with strong opening hooks, but stay useful and non-cheesy.",
    ),
    task: async ({ db }) => {
      const voice = await loadVoiceGuide(db);
      const topic = await firstHeadline(
        MARKET_QUERY,
        "how companies should upskill for AI adoption",
      );
      return `VOICE GUIDE:\n${voice}\n\nDraft 3 reel hooks and 1 full reel script about: ${topic}.`;
    },
    enabled: true,
  },
  {
    id: "carousel-studio",
    name: "Carousel Studio",
    channelEnv: "CHANNEL_CAROUSEL",
    schedule: "10 6 * * *",
    policy: "standard",
    system: buildVoiceSystem(
      "You are Isaac's carousel writer. Write in his voice. The output should be practical, structured, and easy to design into slides.",
    ),
    task: async ({ db }) => {
      const voice = await loadVoiceGuide(db);
      const topic = await firstHeadline(
        MARKET_QUERY,
        "AI transformation mistakes leaders keep repeating",
      );
      return `VOICE GUIDE:\n${voice}\n\nDraft a 7-slide carousel outline about: ${topic}. Include slide title and supporting copy per slide.`;
    },
    enabled: true,
  },
  {
    id: "pipeline",
    name: "Pipeline Health",
    channelEnv: "CHANNEL_PIPELINE",
    schedule: "20 6 * * *",
    policy: "sensitive",
    system:
      "You are Isaac's Pipeline Health agent for MAXY AI. Report-first, operator-grade, no emojis. Given live pipeline data, report: revenue/pipeline value vs the IDR 30M/day target framing, deals by stage, stale deals, and big deals >IDR 100M that Isaac should personally touch. Be concise and specific.",
    task: async () => {
      const data = await hubspotPipelineSummary();
      return data
        ? `Live HubSpot pipeline for ${todayIso()}:\n${data}\n\nWrite the pipeline health report.`
        : `No HubSpot token set. Produce the report skeleton for ${todayIso()} with clearly labeled [DATA PENDING] placeholders.`;
    },
    enabled: true,
  },
  {
    id: "graphic-designer",
    name: "Graphic Designer",
    channelEnv: "CHANNEL_GRAPHICS",
    schedule: "25 6 * * *",
    policy: "cheap",
    system:
      "You are Isaac's Graphic Designer agent. Output a creative brief that a designer can execute fast. No generic AI aesthetics.",
    task: async () => {
      const topic = await firstHeadline(
        MARKET_QUERY,
        "AI upskilling for Indonesian teams",
      );
      return `Create today's graphic design brief around: ${topic}. Output format: objective, visual direction, copy blocks, image ideas, and brand-risk checks.`;
    },
    enabled: true,
  },
  {
    id: "video-clipper",
    name: "Video Clipper",
    channelEnv: "CHANNEL_CLIPPER",
    schedule: "30 6 * * *",
    policy: "cheap",
    system:
      "You are Isaac's Video Clipper agent. Output clipping instructions, hook moments, captions, and packaging guidance.",
    task: async () => {
      const topic = await firstHeadline(
        MARKET_QUERY,
        "AI adoption signals founders should talk about",
      );
      return `No source video is wired yet. Build today's clipping brief around: ${topic}. Include [SOURCE PENDING], clip selection criteria, hook timestamps to look for, and caption angle.`;
    },
    enabled: true,
  },
  {
    id: "faceless-builder",
    name: "Faceless Builder",
    channelEnv: "CHANNEL_FACELESS",
    schedule: "35 6 * * *",
    policy: "cheap",
    system:
      "You are Isaac's Faceless Builder. Turn one idea into a faceless video execution brief with narration, visual beats, and CTA.",
    task: async () => {
      const topic = await firstHeadline(
        MARKET_QUERY,
        "AI literacy for non-technical teams",
      );
      return `Draft today's faceless video concept about: ${topic}. Include title, scene-by-scene beat list, narration, and CTA.`;
    },
    enabled: true,
  },
  {
    id: "post-scorer",
    name: "Post Scorer",
    channelEnv: "CHANNEL_POST_SCORE",
    schedule: "40 6 * * *",
    policy: "standard",
    system: buildVoiceSystem(
      "You are Isaac's Post Scorer. Judge whether a draft feels like Isaac, whether it is useful, and whether it is strong enough to publish.",
    ),
    task: async ({ db }) => {
      const voice = await loadVoiceGuide(db);
      return `VOICE GUIDE:\n${voice}\n\nProduce today's scoring rubric Isaac can use to judge a LinkedIn or short-form draft before posting. Include pass/fail criteria and common failure modes.`;
    },
    enabled: true,
  },
  {
    id: "ai-ceo-circle",
    name: "AI CEO Circle Curator",
    channelEnv: "CHANNEL_AI_CEO",
    schedule: "50 6 * * *",
    policy: "cheap",
    system:
      "You are Isaac's AI CEO Circle curator. Build a concise curation note for senior operators and founders. No fluff.",
    task: async () => {
      const headlines = await headlineBlock(MARKET_QUERY, 5);
      return headlines
        ? `Signals for today's CEO Circle curation:\n${headlines}\n\nCurate the 3-5 most useful items and explain why they matter.`
        : `No headlines fetched for ${todayIso()}. Produce the AI CEO Circle note with [SOURCE PENDING] and the themes worth watching.`;
    },
    enabled: true,
  },
  {
    id: "outreach",
    name: "Outreach Writer",
    channelEnv: "CHANNEL_OUTREACH",
    schedule: "0 7 * * *",
    policy: "sensitive",
    system:
      "You are Isaac's Outreach Writer. Draft direct, respectful outreach that sounds founder-led, not spammy.",
    task: async ({ db }) => {
      const voice = await loadVoiceGuide(db);
      return `VOICE GUIDE:\n${voice}\n\nProduce today's outreach writing brief for MAXY. Since no live lead feed is wired yet, output 3 founder-led outreach templates with [LEAD PENDING] placeholders and notes on when to use each one.`;
    },
    enabled: true,
  },
];

export const AGENTS_BY_ID = Object.fromEntries(
  AGENTS.map((agent) => [agent.id, agent]),
);

export function buildChannelMap() {
  const map = {};

  for (const agent of AGENTS) {
    const channelId = process.env[agent.channelEnv];
    if (channelId) {
      map[channelId] = agent;
    }
  }

  return map;
}
