-- Brain OS v4 — Tracking persistence migration
-- Run in Supabase SQL Editor (Database > SQL Editor)

CREATE TABLE IF NOT EXISTS tracking_tasks (
  id         TEXT PRIMARY KEY,
  data       JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE tracking_tasks ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'tracking_tasks' AND policyname = 'service_role_all'
  ) THEN
    EXECUTE 'CREATE POLICY "service_role_all" ON tracking_tasks FOR ALL USING (true)';
  END IF;
END $$;

-- Auto-clean tasks older than 7 days (optional, run manually or via cron)
-- DELETE FROM tracking_tasks WHERE created_at < now() - interval '7 days';