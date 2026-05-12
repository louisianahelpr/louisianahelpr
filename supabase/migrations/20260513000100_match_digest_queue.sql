-- Smart match notification batching
--
-- New table: match_digest_queue
--   Holds non-urgent job matches for users who opted into the daily
--   digest mode. The daily-match-digest cron reads + bundles + drains
--   this table once per day; instant-job-match writes into it for
--   helpers whose notification_preferences.match_digest_mode = true.
--
-- New column: notification_preferences.match_digest_mode
--   Boolean. Defaults FALSE so existing users keep their current
--   realtime push behavior. Users opt in via the Notifications tab.

CREATE TABLE IF NOT EXISTS public.match_digest_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  job_id UUID NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT match_digest_queue_user_job_unique UNIQUE (user_id, job_id)
);

CREATE INDEX IF NOT EXISTS idx_match_digest_queue_user_created
  ON public.match_digest_queue (user_id, created_at);

ALTER TABLE public.match_digest_queue ENABLE ROW LEVEL SECURITY;

-- Service-role only — clients never read or write this directly. The
-- match endpoint and digest cron both use service-role tokens.
CREATE POLICY "service_role_only_match_digest_queue"
  ON public.match_digest_queue
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

ALTER TABLE public.notification_preferences
  ADD COLUMN IF NOT EXISTS match_digest_mode BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN public.notification_preferences.match_digest_mode IS
  'When TRUE, non-urgent job matches are batched into a daily digest instead of fired individually. Urgent jobs always fire realtime regardless of this preference.';
