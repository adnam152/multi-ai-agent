-- Brain OS v3 — Cron Jobs Migration
-- Run in Supabase SQL Editor (Database > SQL Editor)

CREATE TABLE IF NOT EXISTS cron_jobs (
  id TEXT PRIMARY KEY,
  data JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE cron_jobs ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'cron_jobs' AND policyname = 'service_role_all'
  ) THEN
    EXECUTE 'CREATE POLICY "service_role_all" ON cron_jobs FOR ALL USING (true)';
  END IF;
END $$;