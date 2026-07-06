CREATE TABLE IF NOT EXISTS meeting_notes (
  id            BIGSERIAL PRIMARY KEY,
  channel_id    TEXT NOT NULL,
  meeting_date  TEXT,
  status        TEXT NOT NULL DEFAULT 'pending',
  summary_md    TEXT NOT NULL,
  created_by    TEXT,
  created_at    TIMESTAMPTZ DEFAULT now(),
  approved_at   TIMESTAMPTZ
);
