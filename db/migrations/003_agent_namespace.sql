ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS agent_id TEXT NOT NULL DEFAULT 'default';

CREATE INDEX IF NOT EXISTS idx_conv_agent
  ON conversations(agent_id, channel_id, created_at);
