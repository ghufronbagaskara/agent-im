CREATE TABLE IF NOT EXISTS conversations (
  id           BIGSERIAL PRIMARY KEY,
  channel_id   TEXT NOT NULL,
  role         TEXT NOT NULL,          -- 'user' or 'assistant'
  content      TEXT NOT NULL,
  created_at   TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_conv_channel ON conversations(channel_id, created_at);