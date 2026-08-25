-- Last-chance review nudge (owner, 2026-08-24 quick-win round): with the
-- confirm window tightened to 24h, the poster now gets exactly two touches —
-- the mid-window reminder (12–24h edge cron) and THIS one at ~2 hours before
-- auto-release, when acting still matters. Same 5-minute pg_cron sweep
-- pattern as start/day-of reminders; sent-at column is the idempotency guard.

ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS release_last_chance_notif_sent_at timestamptz;

CREATE OR REPLACE FUNCTION public.sweep_release_last_chance()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  rec RECORD;
  total_pushed integer := 0;
BEGIN
  FOR rec IN
    SELECT j.id, j.title, j.customer_id
      FROM public.jobs j
     WHERE j.release_last_chance_notif_sent_at IS NULL
       AND j.status = 'in_progress'
       AND j.payment_status = 'escrow'
       AND j.poster_completed_at IS NULL
       AND j.revision_requested_at IS NULL
       AND j.helper_completed_at IS NOT NULL
       -- inside the final 2 hours of the 24h window
       AND j.helper_completed_at <= NOW() - INTERVAL '22 hours'
       AND j.helper_completed_at >  NOW() - INTERVAL '24 hours'
     ORDER BY j.helper_completed_at
     LIMIT 100
  LOOP
    BEGIN
      INSERT INTO public.notifications (user_id, type, title, message, link, read)
      VALUES (
        rec.customer_id,
        'warning',
        'Last chance to review',
        format('"%s" auto-releases payment in about 2 hours. Approve it, or request a revision now if something''s wrong.', rec.title),
        '/my-posts',
        false
      );
      UPDATE public.jobs SET release_last_chance_notif_sent_at = NOW() WHERE id = rec.id;
      total_pushed := total_pushed + 1;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'sweep_release_last_chance: job % failed: %', rec.id, SQLERRM;
    END;
  END LOOP;
  RETURN total_pushed;
END;
$$;

REVOKE ALL ON FUNCTION public.sweep_release_last_chance() FROM PUBLIC, anon, authenticated;

DO $$
BEGIN
  PERFORM cron.unschedule('sweep-release-last-chance');
EXCEPTION WHEN OTHERS THEN
  NULL;
END;
$$;

SELECT cron.schedule(
  'sweep-release-last-chance',
  '*/5 * * * *',
  $$SELECT public.sweep_release_last_chance()$$
);
