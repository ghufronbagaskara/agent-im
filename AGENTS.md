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
2. **Autonomous agent fleet** — ~22 cron-scheduled "agents", each posting a report to its own Discord channel (market intel, pipeline health, content drafts, meeting prep, etc.), and each also answering follow-up replies in its channel. One agent (`orchestrator`) can trigger other agents on demand (delegation).

Not yet public/multi-tenant — single user (Isaac), single Discord server, single Postgres DB.

## Entry point & request flow

- `src/index.js` — Discord client bootstrap. Wires `messageCreate` / `interactionCreate` handlers, starts MCP, scheduler, webhook server on `clientReady`.
  - Commands (message prefix, case-insensitive): `!notes`, `!voice`, `!learn`, `!run <agentId>`, `!mcptools <server>`.
  - If message channel is in `channelMap` (built from each agent's `channelEnv`) → routes to that agent's reply flow (`runner.js:runAgentReply`). Otherwise falls to generic assistant flow (`generateReply` with `policy: "standard"`, history from `conversations` table, plus top-k hits from the RAG knowledge base prepended as context).

## Core modules (src/)

| File | Responsibility |
|---|---|
| `index.js` | Discord client, command routing, generic chat flow. `!learn [label:] <text>` (or .txt attachment) ingests text into the RAG knowledge base via `tools/knowledge.js:ingestKnowledge`. |
| `agents.js` | **Registry of every scheduled agent** — id, channel env var, cron schedule, system prompt, task builder, policy tier, optional `onReply(reply, {db, queue})` side-effect hook. `AGENTS_BY_ID`, `buildChannelMap()`. |
| `runner.js` | Executes one agent run (`runAgent(client, db, agentId, {queue})`, called by scheduler/`!run`) and one agent reply (`runAgentReply`, called from message handler). Loads/saves per-agent conversation history + RAG memory context (`tools/knowledge.js`). After a run, calls the agent's `onReply` hook if defined (this is how `orchestrator` delegates to other agents). |
| `llm.js` | Multi-provider LLM router: **Anthropic / Gemini / Groq**, chosen per `policy` (`sensitive` → Anthropic only, never falls back to free tiers; `cheap` → Gemini → Groq only, **never spills to paid Anthropic**; `standard` → full anthropic→gemini→groq chain). `generateReply(messages, {system, policy})`. |
| `mcp.js` | Generic MCP client manager — connect/list/call tools against servers defined in `mcp.config.js`. Non-fatal: a server that fails to connect is just skipped (`hasMcpServer` guards every call site). |
| `mcp.config.js` | Declares MCP servers: `gworkspace` (Google Workspace, http, sensitive), `hubspot` (http, sensitive), `firecrawl` (stdio via npx, not sensitive). |
| `scheduler.js` | BullMQ queue `"agents"` + worker (concurrency 1). Registers one repeatable job per enabled agent that has a `schedule` and a configured channel. Passes the queue into `runAgent` so agents can delegate. Timezone `Asia/Jakarta` by default. |
| `webhook.js` | HTTP server (`WEBHOOK_PORT`, default 3010). `POST /fathom?token=WEBHOOK_SECRET` → ingests a meeting transcript → `meetingNotes.js:createMeetingNote`. Disabled entirely if `WEBHOOK_SECRET` or `CHANNEL_MEETINGS` missing. |
| `meetingNotes.js` | Meeting-notes pipeline: transcript → structured summary (Anthropic-only, `policy: "sensitive"`) → posted with Approve/Reject buttons → on approve: pushes to Notion (if configured), adds Calendar action items, generates a client-safe PDF (CEO Notes section stripped) and un-links the temp file. |
| `ops.js` | `reportError(context, err)` — logs to console and forwards to `CHANNEL_OPS` if configured. Called from every catch block app-wide. |
| `tools/calendar.js` | `addActionItems(items)` — creates Calendar events, prefers `gworkspace` MCP tool, falls back to direct `googleapis` service-account auth. |
| `tools/hubspot.js` | `hubspotPipelineSummary()` — deal summary (count/value/by-stage/stale/big deals), prefers `hubspot` MCP tool, falls back to direct HubSpot REST call. |
| `tools/knowledge.js` | `getKnowledge(db, key)` — flat KV read from `org_knowledge` (`voice` key). **RAG memory/knowledge base**: `embedText(text)` (Gemini embeddings), `ingestKnowledge(db, source, text)` (chunks + embeds + stores into `knowledge_chunks`), `queryKnowledge(db, query, limit)` (nearest-neighbor lookup via pgvector `<->`). This is the self-hosted replacement for the old Zep/MCP "memory" server (Zep Community Edition is discontinued and needed an OpenAI key we don't have) — used both as agent-to-agent memory (`runner.js` auto-ingests every agent reply under `source='agent:<id>'`) and as manual document RAG (`!learn` ingests under `source='manual:<label>'`). |
| `tools/news.js` | `googleNews(query, limit)` — scrapes Google News RSS, no API key needed. Feeds most cron agents' prompts (also doubles as the mention-proxy for `social-monitor`, since no Twitter/Reddit API is wired). |
| `tools/pdf.js` | `meetingNotesPdf(note, outPath)` — renders client-safe PDF via `pdfkit`. |

## Data model (Postgres, see `db/init.sql` + `db/migrations/`)

- `conversations(id, agent_id, channel_id, role, content, created_at)` — chat history, scoped per agent+channel. `agent_id='default'` = generic assistant.
- `meeting_notes(id, channel_id, meeting_date, status[pending|approved|rejected], summary_md, created_by, created_at, approved_at)`.
- `org_knowledge(key, value, updated_at)` — flat KV store. Only `voice` (style guide from `!voice` training) is written today.
- `knowledge_chunks(id, source, chunk, embedding vector(768), created_at)` — RAG store (pgvector extension). No ANN index yet (sequential scan is fine at current scale) — add `ivfflat`/`hnsw` if this grows large.

## LLM policy tiers (`llm.js`)

- `sensitive` — Anthropic only, **hard-fails** rather than falling back to a free-tier provider (meeting notes, pipeline, scout, nurture, meeting-prep, planner, outreach, copywriter... check `agents.js` per-agent `policy`).
- `standard` — anthropic → gemini → groq.
- `cheap` — gemini → groq. **Anthropic is deliberately excluded from this tier** — cheap/cron agents must stay on free providers only, and will fail rather than spend on Anthropic if both are down.
- Order overridable via env: `LLM_PROVIDER_ORDER`, `SENSITIVE_PROVIDER_ORDER`, `CHEAP_PROVIDER_ORDER`.

## MCP servers (optional, `mcp.config.js`)

All MCP calls are best-effort: missing URL/env → server skipped at `initMcp()`, and every call site checks `hasMcpServer()` first with a direct-API or no-op fallback. So the bot runs fine with zero MCP servers configured — MCP is a pure enhancement layer.

- `gworkspace` (http) — Google Calendar/Workspace actions.
- `hubspot` (http) — CRM deals.
- `firecrawl` (stdio, `npx firecrawl-mcp`) — web scraping, used by the `tender` agent if `TENDER_SOURCE_URL` set.
- (No `memory` MCP server anymore — replaced by the self-hosted pgvector RAG store, see `tools/knowledge.js` above.)

## Delegation pattern (multi-agent)

`agents.js` entries can define `onReply: async (reply, { db, queue }) => {...}`, invoked by `runner.js:runAgent` right after a cron/`!run` execution. The `orchestrator` agent uses this: it reads the last day of agent reports from `conversations`, asks the LLM which agent id(s) (if any) should re-run right now, parses a JSON array out of the reply, and enqueues those via `queue.add("run", {agentId}, {jobId: "delegate:<id>:<ts>"})`. Use this pattern for any future "agent manages agent" behavior instead of adding new cross-agent plumbing.

## Adding / changing things (update this file when you do any of these)

- **New scheduled agent** → add an entry to the `AGENTS` array in `agents.js` (id, channelEnv, schedule, policy, system, task, optional onReply) + add its `CHANNEL_*` var to `.env.example`. Update the agent list above only if it changes the architecture (new tool dependency, new MCP server, etc.) — the full live list of agents is `agents.js` itself, don't duplicate every row here.
- **New tool/integration** → add file under `tools/`, wire into the relevant agent's `task()` in `agents.js`, add row to the table above.
- **New MCP server** → add to `mcp.config.js`, add its `MCP_*_URL` / `MCP_TOOL_*` env vars to `.env.example`, add row to the MCP section above.
- **New Discord command** → add branch in `index.js`'s `messageCreate` handler, document it in the "Entry point" section above.
- **Schema change** → new file in `db/migrations/` **and** merge the same DDL into `db/init.sql` (init.sql is the current-state source of truth mounted for fresh installs; migrations/ are the incremental history), update the Data model section above.
- **New LLM provider** → add to `PROVIDERS` map + order envs in `llm.js`, update the policy section above.
- **New agent-to-agent behavior** → use the `onReply` delegation hook (see above) rather than inventing a new cross-agent mechanism.

## Deploy shape

`Dockerfile` (node:20-alpine, `npm start`) + `docker-compose.yaml`: `hermes-bot` + `hermes-postgres` (image `pgvector/pgvector:pg16` — needed for the RAG knowledge base) + `hermes-redis` always on; `gworkspace-mcp`, `hubspot-mcp` are behind the `mcp` compose profile (opt-in). Webhook port `3010` exposed for Fathom meeting-transcript ingestion.
