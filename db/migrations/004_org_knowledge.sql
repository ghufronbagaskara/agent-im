CREATE TABLE IF NOT EXISTS org_knowledge (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL,
  updated_at  TIMESTAMPTZ DEFAULT now()
);
