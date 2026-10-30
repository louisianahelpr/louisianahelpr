-- 'New member joined' becomes ONE daily summary (owner, 2026-10-30 pop-up, audit
-- E4 M8: all 47 admin alerts in 7 days were this one notice).
--
-- notify_admins_new_member keeps every gate and the once-per-member claim, and
-- stops writing a notification: its claim row in new_member_admin_notices is now
-- the queue. send_new_member_daily_summary (cron, 13:00 UTC) sends each admin
-- ONE notice naming who joined since the last run, and sends nothing on a day
-- nobody joined.
--
-- Test accounts: refused at the claim as before, and checked AGAIN at send time,
-- so an account marked as a test account after it confirmed never appears.
--
-- notify_admins_new_member is restated from 20261030143141 (ready/b102-admin-
-- alerts-skip-test, which this branch stacks on). Its only changes: the
-- notification INSERT and the no_admins branch go, and it returns 'queued'
-- instead of 'sent'.
--
-- Replay-safe: the backfill runs only when the column is first added.

DO $do$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'new_member_admin_notices'
       AND column_name = 'summarized_at'
  ) THEN
    ALTER TABLE public.new_member_admin_notices ADD COLUMN summarized_at timestamptz;
    -- Everyone claimed before today was already announced one by one.
    UPDATE public.new_member_admin_notices SET summarized_at = notified_at;
  END IF;
END
$do$;

CREATE INDEX IF NOT EXISTS new_member_admin_notices_unsummarized_idx
  ON public.new_member_admin_notices (notified_at)
  WHERE summarized_at IS NULL;

CREATE OR REPLACE FUNCTION public.notify_admins_new_member(p_user_id uuid, p_via text DEFAULT 'confirm'::text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
 SET lock_timeout TO '3s'
AS $function$
DECLARE
  v_confirmed timestamptz;
  v_name      text;
  v_location  text;
  v_seed      boolean;
  v_found     boolean := false;
  v_claimed   uuid;
BEGIN
  IF p_user_id IS NULL THEN
    RETURN 'not_confirmed';
  END IF;

  SELECT u.email_confirmed_at INTO v_confirmed FROM auth.users u WHERE u.id = p_user_id;
  -- An abandoned signup never confirms, so it is never announced.
  IF v_confirmed IS NULL THEN
    RETURN 'not_confirmed';
  END IF;

  SELECT NULLIF(btrim(p.full_name), ''), NULLIF(btrim(p.location), ''), coalesce(p.is_seed, false), true
    INTO v_name, v_location, v_seed, v_found
    FROM public.profiles p WHERE p.user_id = p_user_id;
  IF NOT coalesce(v_found, false) THEN
    RETURN 'no_profile';
  END IF;
  -- Owner 2026-10-27 ("test stuff should never be shown"): EVERY test account
  -- (is_seed) is skipped, not only the ones listed in test_accounts. The
  -- nightly journeys' throwaway "SEED Journey ..." accounts are is_seed but
  -- not in test_accounts, and each one reached every admin's bell.
  -- 2026-10-30 (owner, again): an unmarked throwaway too, such as a
  -- mailinator audit sign-up nobody flagged is_seed (public.is_test_subject).
  IF v_seed OR public.is_test_subject(p_user_id) THEN
    RETURN 'seed';
  END IF;
  -- A provider takeover whose wipe FAILED (zz_wipe_on_provider_takeover
  -- catches its own error) still holds the pre-verification squatter's name
  -- and city. Announce nothing and make no claim; the wipe sweep surfaces the
  -- failure, and the real owner's complete-signup announces once it is fixed.
  IF EXISTS (
       SELECT 1 FROM public.pre_verification_wipes w
        WHERE w.user_id = p_user_id AND w.error LIKE 'wipe failed:%'
          AND NOT EXISTS (SELECT 1 FROM public.pre_verification_wipes ok
                           WHERE ok.user_id = p_user_id AND ok.error IS NULL
                             AND ok.wiped_at > w.wiped_at)) THEN
    RETURN 'wipe_failed';
  END IF;
  -- Wait for a name: complete-signup calls again once the profile has one.
  IF v_name IS NULL THEN
    RETURN 'no_name';
  END IF;

  -- Announced already by the one-by-one notice this replaces: claim it as
  -- summarized, send nothing.
  -- Scoped to admin recipients so it rides the user_id indexes instead of
  -- scanning notifications inside GoTrue's confirm UPDATE.
  IF EXISTS (SELECT 1 FROM public.notifications x
              WHERE x.user_id IN (SELECT r.user_id FROM public.user_roles r WHERE r.role = 'admin')
                AND x.title = 'New member joined'
                AND x.link = '/admin?view=people&user=' || p_user_id::text) THEN
    INSERT INTO public.new_member_admin_notices (user_id, via, summarized_at)
    VALUES (p_user_id, 'earlier-notice', now())
    ON CONFLICT (user_id) DO NOTHING;
    RETURN 'already_sent';
  END IF;

  -- The exactly-once claim, and the daily summary's queue.
  INSERT INTO public.new_member_admin_notices (user_id, via)
  VALUES (p_user_id, coalesce(p_via, 'confirm'))
  ON CONFLICT (user_id) DO NOTHING
  RETURNING user_id INTO v_claimed;
  IF v_claimed IS NULL THEN
    RETURN 'already_sent';
  END IF;
  RETURN 'queued';
END;
$function$;

REVOKE ALL ON FUNCTION public.notify_admins_new_member(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.notify_admins_new_member(uuid, text) TO service_role;

CREATE OR REPLACE FUNCTION public.send_new_member_daily_summary()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_ids     uuid[];
  v_skipped integer;
  v_count   integer;
  v_names   text;
  v_sent    integer;
BEGIN
  -- Marked a test account after confirming, or deleted since: never named, and
  -- never read again. The lock keeps two overlapping runs from sending twice.
  WITH pending AS (
    SELECT n.user_id FROM public.new_member_admin_notices n
     WHERE n.summarized_at IS NULL
     FOR UPDATE OF n
  ), skipped AS (
    UPDATE public.new_member_admin_notices n
       SET summarized_at = now()
      FROM pending
     WHERE n.user_id = pending.user_id
       AND (public.is_test_subject(n.user_id)
            OR NOT EXISTS (SELECT 1 FROM public.profiles p
                            WHERE p.user_id = n.user_id
                              AND NOT coalesce(p.is_seed, false)
                              AND p.anonymized_at IS NULL))
    RETURNING 1
  )
  SELECT count(*) INTO v_skipped FROM skipped;

  SELECT array_agg(x.user_id) INTO v_ids
    FROM (SELECT n.user_id FROM public.new_member_admin_notices n
           WHERE n.summarized_at IS NULL
           ORDER BY n.notified_at, n.user_id
           FOR UPDATE OF n) x;
  v_count := coalesce(array_length(v_ids, 1), 0);
  IF v_count = 0 THEN
    RETURN jsonb_build_object('members', 0, 'skipped', v_skipped, 'sent', 0);
  END IF;

  SELECT string_agg(
           coalesce(NULLIF(btrim(p.full_name), ''), 'A new member')
             || coalesce(' from ' || NULLIF(btrim(p.location), ''), ''),
           ', ' ORDER BY t.ord)
    INTO v_names
    FROM unnest(v_ids[1:5]) WITH ORDINALITY AS t(user_id, ord)
    JOIN public.profiles p ON p.user_id = t.user_id;

  INSERT INTO public.notifications (user_id, title, message, type, link)
  SELECT ur.user_id,
         'New member summary',
         v_count || CASE WHEN v_count = 1 THEN ' new member joined: ' ELSE ' new members joined: ' END
           || v_names
           || CASE WHEN v_count > 5 THEN ' and ' || (v_count - 5) || ' more.' ELSE '.' END,
         'admin_alert',
         '/admin?view=people'
    FROM (SELECT DISTINCT r.user_id FROM public.user_roles r WHERE r.role = 'admin') ur;
  GET DIAGNOSTICS v_sent = ROW_COUNT;
  -- Nobody to tell: keep them queued for the next run.
  IF v_sent = 0 THEN
    RETURN jsonb_build_object('members', v_count, 'skipped', v_skipped, 'sent', 0);
  END IF;

  UPDATE public.new_member_admin_notices
     SET summarized_at = now()
   WHERE user_id = ANY (v_ids);
  RETURN jsonb_build_object('members', v_count, 'skipped', v_skipped, 'sent', v_sent);
END;
$function$;

REVOKE ALL ON FUNCTION public.send_new_member_daily_summary() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.send_new_member_daily_summary() TO service_role;

DO $do$
BEGIN
  IF to_regclass('public.cron_work_expectations') IS NOT NULL THEN
    INSERT INTO public.cron_work_expectations (jobname, expected_max_gap, note, work_visibility, work_exempt_reason)
    VALUES ('new-member-daily-summary', interval '26 hours',
            'One daily admin notice naming who joined since the last run (owner 2026-10-30), at 13:00 UTC.',
            'exempt',
            'A day nobody joined changes nothing, which is the healthy state.')
    ON CONFLICT (jobname) DO UPDATE SET expected_max_gap = EXCLUDED.expected_max_gap, note = EXCLUDED.note,
      work_visibility = EXCLUDED.work_visibility, work_exempt_reason = EXCLUDED.work_exempt_reason;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    PERFORM cron.schedule('new-member-daily-summary', '0 13 * * *',
      $c$SELECT public.cron_record_work('new-member-daily-summary', to_jsonb(public.send_new_member_daily_summary()));$c$);
  END IF;
END
$do$;
