CREATE EXTENSION IF NOT EXISTS vector;

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

CREATE INDEX IF NOT EXISTS idx_knowledge_source ON knowledge_chunks(source);
-- No ANN index yet (ivfflat/hnsw) — sequential scan is fine at this scale.
-- Add one (e.g. `USING ivfflat (embedding vector_l2_ops)`) once the table gets big.
