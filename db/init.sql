CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS conversations (
  id           BIGSERIAL PRIMARY KEY,
  agent_id     TEXT NOT NULL DEFAULT 'default',
  channel_id   TEXT NOT NULL,
  role         TEXT NOT NULL,          -- 'user' or 'assistant'
  content      TEXT NOT NULL,
  created_at   TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS meeting_notes (
  id            BIGSERIAL PRIMARY KEY,
  channel_id    TEXT NOT NULL,
  meeting_date  TEXT,
  status        TEXT NOT NULL DEFAULT 'pending', -- pending | approved | rejected
  summary_md    TEXT NOT NULL,
  created_by    TEXT,
  created_at    TIMESTAMPTZ DEFAULT now(),
  approved_at   TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS org_knowledge (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL,
  updated_at  TIMESTAMPTZ DEFAULT now()
);

-- Self-hosted RAG memory: agent reports + manually-ingested docs (!learn),
-- both embedded with Gemini and searched by nearest-neighbor.
-- source = 'agent:<agentId>' for auto-saved agent replies, 'manual:<label>' for !learn ingests.
CREATE TABLE IF NOT EXISTS knowledge_chunks (
  id          BIGSERIAL PRIMARY KEY,
  source      TEXT NOT NULL,
  chunk       TEXT NOT NULL,
  embedding   vector(768),
  created_at  TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_conv_channel ON conversations(channel_id, created_at);
CREATE INDEX IF NOT EXISTS idx_conv_agent
  ON conversations(agent_id, channel_id, created_at);
CREATE INDEX IF NOT EXISTS idx_notes_channel_created
  ON meeting_notes(channel_id, created_at);
CREATE INDEX IF NOT EXISTS idx_knowledge_source ON knowledge_chunks(source);
-- No ANN index yet (ivfflat/hnsw) — sequential scan is fine at this scale.
-- Add one (e.g. `USING ivfflat (embedding vector_l2_ops)`) once the table gets big.
