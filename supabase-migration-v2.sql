-- Brain OS v2 — Additional Migrations
-- Run in Supabase SQL Editor (Database > SQL Editor)

-- Group Chat Sessions
CREATE TABLE IF NOT EXISTS group_chat_sessions (
  id TEXT PRIMARY KEY,
  data JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE group_chat_sessions ENABLE ROW LEVEL SECURITY;

-- Drop policy first if exists to avoid error on re-run
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
    AND tablename = 'group_chat_sessions'
    AND policyname = 'service_role_all'
  ) THEN
    EXECUTE 'CREATE POLICY "service_role_all" ON group_chat_sessions FOR ALL USING (true)';
  END IF;
END $$;

-- Note: Logs table is no longer written to (in-memory only in v2)
-- You can keep the table for historical data or drop it:
-- DROP TABLE IF EXISTS logs;