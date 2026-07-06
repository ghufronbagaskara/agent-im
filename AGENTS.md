# AGENTS.md — Hermes (isaac-hermes)

> ⚠️ **MANDATORY: keep this file in sync with the code.**
> Any time you change the app's flow — add an agent, remove an agent, add/remove a tool,
> add/remove an MCP server, change the LLM provider order/policy, change the DB schema,
> change the Discord command surface, or change any file listed below — **update the
> matching section in this file in the same change/commit.** A future agent session reads
> ONLY this file before touching code. If this file is stale, that agent will make wrong
> assumptions and can break production. Do not skip this.

## What this is

Discord bot ("Hermes") acting as a personal + business ops assistant for **Isaac Munandar**,
CEO of **MAXY AI** (AI/edtech, Indonesia). Node.js ESM app. Two jobs in one process:

1. **Reply bot** — answers messages in mapped Discord channels / DMs, using conversation history in Postgres.
2. **Autonomous agent fleet** — ~20 cron-scheduled "agents", each posting a report to its own Discord channel (market intel, pipeline health, content drafts, meeting prep, etc.), and each also answering follow-up replies in its channel.

Not yet public/multi-tenant — single user (Isaac), single Discord server, single Postgres DB.

## Entry point & request flow

- `src/index.js` — Discord client bootstrap. Wires `messageCreate` / `interactionCreate` handlers, starts MCP, scheduler, webhook server on `clientReady`.
  - Commands (message prefix, case-insensitive): `!notes`, `!voice`, `!run <agentId>`, `!mcptools <server>`.
  - If message channel is in `channelMap` (built from each agent's `channelEnv`) → routes to that agent's reply flow (`runner.js:runAgentReply`). Otherwise falls to generic assistant flow (`generateReply` with `policy: "standard"`, history from `conversations` table).

## Core modules (src/)

| File | Responsibility |
|---|---|
| `index.js` | Discord client, command routing, generic chat flow |
| `agents.js` | **Registry of every scheduled agent** — id, channel env var, cron schedule, system prompt, task builder, policy tier. `AGENTS_BY_ID`, `buildChannelMap()`. |
| `runner.js` | Executes one agent run (`runAgent`, called by scheduler/`!run`) and one agent reply (`runAgentReply`, called from message handler). Loads/saves per-agent conversation history + optional MCP "memory" context. |
| `llm.js` | Multi-provider LLM router: **Anthropic / Gemini / Groq**, chosen per `policy` (`sensitive` → Anthropic only, never falls back to free tiers; `cheap` → Gemini/Groq first; `standard` → full chain). `generateReply(messages, {system, policy})`. |
| `mcp.js` | Generic MCP client manager — connect/list/call tools against servers defined in `mcp.config.js`. Non-fatal: a server that fails to connect is just skipped (`hasMcpServer` guards every call site). |
| `mcp.config.js` | Declares MCP servers: `gworkspace` (Google Workspace, http, sensitive), `hubspot` (http, sensitive), `memory` (Zep, http, sensitive), `firecrawl` (stdio via npx, not sensitive). |
| `scheduler.js` | BullMQ queue `"agents"` + worker (concurrency 1). Registers one repeatable job per enabled agent that has a `schedule` and a configured channel. Timezone `Asia/Jakarta` by default. |
| `webhook.js` | HTTP server (`WEBHOOK_PORT`, default 3010). `POST /fathom?token=WEBHOOK_SECRET` → ingests a meeting transcript → `meetingNotes.js:createMeetingNote`. Disabled entirely if `WEBHOOK_SECRET` or `CHANNEL_MEETINGS` missing. |
| `meetingNotes.js` | Meeting-notes pipeline: transcript → structured summary (Anthropic-only, `policy: "sensitive"`) → posted with Approve/Reject buttons → on approve: pushes to Notion (if configured), adds Calendar action items, generates a client-safe PDF (CEO Notes section stripped) and un-links the temp file. |
| `ops.js` | `reportError(context, err)` — logs to console and forwards to `CHANNEL_OPS` if configured. Called from every catch block app-wide. |
| `tools/calendar.js` | `addActionItems(items)` — creates Calendar events, prefers `gworkspace` MCP tool, falls back to direct `googleapis` service-account auth. |
| `tools/hubspot.js` | `hubspotPipelineSummary()` — deal summary (count/value/by-stage/stale/big deals), prefers `hubspot` MCP tool, falls back to direct HubSpot REST call. |
| `tools/knowledge.js` | `getKnowledge(db, key)` — flat key/value read from `org_knowledge` (currently only `voice` key is used). |
| `tools/news.js` | `googleNews(query, limit)` — scrapes Google News RSS, no API key needed. Feeds most cron agents' prompts. |
| `tools/pdf.js` | `meetingNotesPdf(note, outPath)` — renders client-safe PDF via `pdfkit`. |

## Data model (Postgres, see `db/init.sql` + `db/migrations/`)

- `conversations(id, agent_id, channel_id, role, content, created_at)` — chat history, scoped per agent+channel. `agent_id='default'` = generic assistant.
- `meeting_notes(id, channel_id, meeting_date, status[pending|approved|rejected], summary_md, created_by, created_at, approved_at)`.
- `org_knowledge(key, value, updated_at)` — flat KV store. Only `voice` (style guide from `!voice` training) is written today.

## LLM policy tiers (`llm.js`)

- `sensitive` — Anthropic only, **hard-fails** rather than falling back to a free-tier provider (meeting notes, pipeline, scout, nurture, meeting-prep, planner, outreach, copywriter... check `agents.js` per-agent `policy`).
- `standard` — anthropic → gemini → groq.
- `cheap` — gemini → groq → anthropic (used for cron agents where cost matters more than max quality).
- Order overridable via env: `LLM_PROVIDER_ORDER`, `SENSITIVE_PROVIDER_ORDER`, `CHEAP_PROVIDER_ORDER`.

## MCP servers (optional, `mcp.config.js`)

All MCP calls are best-effort: missing URL/env → server skipped at `initMcp()`, and every call site checks `hasMcpServer()` first with a direct-API or no-op fallback. So the bot runs fine with zero MCP servers configured — MCP is a pure enhancement layer.

- `gworkspace` (http) — Google Calendar/Workspace actions.
- `hubspot` (http) — CRM deals.
- `memory` (http, backed by Zep in docker-compose) — cross-run semantic memory, read in `runner.js` (`loadMemoryContext`) and written after every agent run/reply (`saveMemory`). **Currently gated behind `profiles: ["mcp"]` in docker-compose — not started by default.**
- `firecrawl` (stdio, `npx firecrawl-mcp`) — web scraping, used by the `tender` agent if `TENDER_SOURCE_URL` set.

## Adding / changing things (update this file when you do any of these)

- **New scheduled agent** → add an entry to the `AGENTS` array in `agents.js` (id, channelEnv, schedule, policy, system, task) + add its `CHANNEL_*` var to `.env.example`. Update the agent list above only if it changes the architecture (new tool dependency, new MCP server, etc.) — the full live list of agents is `agents.js` itself, don't duplicate 20 rows here.
- **New tool/integration** → add file under `tools/`, wire into the relevant agent's `task()` in `agents.js`, add row to the table above.
- **New MCP server** → add to `mcp.config.js`, add its `MCP_*_URL` / `MCP_TOOL_*` env vars to `.env.example`, add row to the MCP section above.
- **New Discord command** → add branch in `index.js`'s `messageCreate` handler, document it in the "Entry point" section above.
- **Schema change** → new file in `db/migrations/`, update the Data model section above.
- **New LLM provider** → add to `PROVIDERS` map + order envs in `llm.js`, update the policy section above.

## Deploy shape

`Dockerfile` (node:20-alpine, `npm start`) + `docker-compose.yaml`: `hermes-bot` + `hermes-postgres` + `hermes-redis` always on; `gworkspace-mcp`, `hubspot-mcp`, `zep` are behind the `mcp` compose profile (opt-in). Webhook port `3010` exposed for Fathom meeting-transcript ingestion.
