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
    id: "pipeline",
    name: "Pipeline Health",
    channelEnv: "CHANNEL_PIPELINE",
    schedule: "20 6 * * *",
    policy: "sensitive",
    system: `You are Isaac's Pipeline Health agent for MAXY AI. Report-first, operator-grade, no emojis.
Until live HubSpot data is wired (Phase 4), produce the report SKELETON with clearly labeled [DATA PENDING]
placeholders for: revenue vs target (IDR/day + USD pace), deals by stage, stale deals >3 days, big deals >IDR 100M.`,
    task: () =>
      `Produce today's pipeline health report skeleton for ${new Date().toISOString().slice(0, 10)}.`,
    enabled: true,
  },
  {
    id: "intel",
    name: "Market Intel",
    channelEnv: "CHANNEL_INTEL",
    schedule: "20 3 * * *",
    policy: "cheap",
    system: `You are Isaac's Market Intel agent. Report-first, no emojis. Cover AI/edtech trends in Indonesia + Singapore,
competitor moves, and government digital-transformation signals relevant to MAXY. Until web tools are wired,
output the brief STRUCTURE with [SOURCE PENDING] placeholders and your best general-knowledge framing.`,
    task: () =>
      `Produce today's market intel brief for ${new Date().toISOString().slice(0, 10)}.`,
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
