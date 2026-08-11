-- Auto-tip: the charge side.
--
-- The preference and resolver already exist (20260811180000 / 190000) but
-- nothing read them, so no tip could ever be charged. This adds what the
-- charge path needs to be recorded safely.
--
-- Manual tips go through Stripe Checkout and land a `stripe_session_id`.
-- An automatic tip has nobody to redirect, so it is an off-session
-- PaymentIntent instead — a different identifier, hence a new column rather
-- than overloading the session one with something that isn't a session.

ALTER TABLE public.tips
  ADD COLUMN IF NOT EXISTS stripe_payment_intent_id text,
  -- 'manual' | 'auto'. Defaulted to manual so every existing row keeps its
  -- true meaning without a backfill.
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'manual',
  -- Set when we WANTED to auto-tip but couldn't charge (no saved card, or the
  -- card declined). Drives the "confirm your tip" nudge, and stops the sweeper
  -- retrying a hopeless charge on every tick.
  ADD COLUMN IF NOT EXISTS auto_prompt_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS failure_reason text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'tips_source_valid' AND conrelid = 'public.tips'::regclass
  ) THEN
    ALTER TABLE public.tips
      ADD CONSTRAINT tips_source_valid CHECK (source IN ('manual', 'auto'));
  END IF;
END
$$;

-- AT MOST ONE automatic tip per job, ever.
--
-- This is the safety property that matters most here. The sweeper runs on a
-- timer over recently-completed jobs, so without a database-level guarantee a
-- slow Stripe call, an overlapping tick, or a retry could charge someone
-- twice for the same job. A UNIQUE index makes the second insert fail rather
-- than relying on the sweeper's own bookkeeping being perfect.
--
-- Partial on source='auto' so it never constrains manual tips — a poster may
-- deliberately tip the same helper twice for one job, and that stays legal.
CREATE UNIQUE INDEX IF NOT EXISTS tips_one_auto_per_job
  ON public.tips (job_id)
  WHERE source = 'auto';

-- Candidate lookup for the sweeper: jobs completed recently whose poster has
-- auto-tip on and which have no automatic tip row yet.
--
-- A function rather than a view so the time window is a parameter and the
-- money path can't accidentally widen it by editing a view definition.
-- SECURITY DEFINER because it reads across posters' profiles; not granted to
-- anon or authenticated.
CREATE OR REPLACE FUNCTION public.auto_tip_candidates(_since_hours integer DEFAULT 24)
RETURNS TABLE (
  job_id uuid,
  customer_id uuid,
  helper_id uuid,
  budget numeric,
  tip_amount numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT j.id, j.customer_id, j.helper_id, j.budget,
         public.resolve_auto_tip(j.customer_id, j.budget)
  FROM public.jobs j
  JOIN public.profiles p ON p.user_id = j.customer_id
  WHERE j.status = 'completed'::job_status
    AND j.helper_id IS NOT NULL
    AND p.auto_tip_mode <> 'off'
    AND j.updated_at > now() - make_interval(hours => _since_hours)
    AND public.resolve_auto_tip(j.customer_id, j.budget) > 0
    AND NOT EXISTS (
      SELECT 1 FROM public.tips t
      WHERE t.job_id = j.id AND t.source = 'auto'
    );
$$;

REVOKE ALL ON FUNCTION public.auto_tip_candidates(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.auto_tip_candidates(integer) FROM anon;
REVOKE ALL ON FUNCTION public.auto_tip_candidates(integer) FROM authenticated;


-- ── Schedule ────────────────────────────────────────────────────────
-- Hourly. A tip is not time-critical — arriving within the hour after a job
-- is finished is indistinguishable from instant to the helper — and an hourly
-- tick keeps the cost of a money-moving sweeper modest (~720/month).
--
-- Reads the service key from vault at call time, exactly like the other
-- cron-invoked functions. Writing the key into the command literal is what
-- caused the May 401 storm when the key rotated (see 20260505220500).
--
-- Guarded on pg_cron and on the vault secrets existing, so a from-scratch
-- rebuild (where neither is configured) skips scheduling instead of aborting
-- the whole migration run.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron')
     AND EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_net')
     AND EXISTS (SELECT 1 FROM vault.decrypted_secrets WHERE name = 'service_role_key')
  THEN
    PERFORM cron.unschedule('auto-tip-charge')
      WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'auto-tip-charge');
    PERFORM cron.schedule(
      'auto-tip-charge',
      '7 * * * *',
      $cron$
      SELECT net.http_post(
        url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'supabase_url')
               || '/functions/v1/auto-tip-charge',
        headers := jsonb_build_object(
          'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key'),
          'Content-Type', 'application/json'
        ),
        body := '{}'::jsonb
      );
      $cron$
    );
  END IF;
END
$$;
