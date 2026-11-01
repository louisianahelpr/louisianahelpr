-- B56-SWEEP-FOLLOWUPS (lead 10-31, the two should-fix items left from the review of LEAD-CHECK-SWEEP, 20261101031241).
--
-- 1. An edit to a listing that was NEVER checked now resets its try count.
--    Before: declutter_item_private_check_tries_reset reset the count only when ai_checked_at CHANGED. An edit clears
--    the check by setting ai_checked_at = NULL (declutter_edit_listing, declutter_update_draft), which on a listing
--    with no check is NULL -> NULL, so the count stayed. A listing the fail-safe had held after 3 failed tries, then
--    edited by its seller, was never tried again: the sweep claims only listings with fewer than 3 tries. And a photo
--    added or removed (declutter_photos_void_ai_check) touched only rows that HAD a check or flag, so no reset either.
--    Now: the trigger fires only when a statement names ai_checked_at in its SET (BEFORE UPDATE OF ai_checked_at), so
--    a NULL there means the statement cleared the check (an edit), and that resets the count and restarts the clock,
--    whether or not a check had landed. declutter_photos_void_ai_check clears every row of the item, checked or not.
--    The writers that name ai_checked_at in a SET, newest definitions: declutter_record_ai_check and the publish
--    (set a time), declutter_hold_unchecked_listings' reserved/sold branch (sets now()), and the edits above (NULL).
--    The sweep's claim and give-back never name it. ai_check_cleared_at records when the check was last cleared.
--
-- 2. An alert to every admin when a listing has been on sale 45+ minutes with no check.
--    The fail-safe holds a listing only after 3 FAILED tries. If the sweep never claims (the cron is off, the vault
--    key is missing, the function never deploys), no try is ever counted, nothing is held and nobody is told. Now
--    declutter_alert_overdue_checks(), every 15 minutes straight from pg_cron (no edge function, so it still runs
--    when the sweep's call is what broke), finds listings on sale (live, reserved, sold) 45+ minutes since they went
--    live AND since their check was last cleared, with no check, and sends ONE notice per run to every admin naming
--    how many and up to three titles. Each listing is alerted once (ai_check_overdue_alerted_at), and again only after
--    a later edit clears its check. Never test data (is_seed, a test account's listing; owner 10-30), never one an
--    admin approved since it went live. An admin who still has an unread one gets no new one (while the sweep stays
--    down that would be one every 15 minutes); with no admin at all nothing is stamped, so nothing is lost.
--
--    The alert closes by hand, like its two siblings (20261031184552): admin_alert_manual_close() restated from that
--    newest definition, verbatim but for the added row (adminQueueAlertsClose, Q355).
--
-- Grants by role name: REVOKE ... FROM PUBLIC, anon, authenticated. Replay-safe: IF NOT EXISTS, CREATE OR REPLACE,
-- DROP TRIGGER IF EXISTS, cron unschedule first.

ALTER TABLE public.declutter_item_private ADD COLUMN IF NOT EXISTS ai_check_cleared_at timestamptz;
ALTER TABLE public.declutter_item_private ADD COLUMN IF NOT EXISTS ai_check_overdue_alerted_at timestamptz;

-- ---------------------------------------------------------------------------
-- 1. An edit resets the tries, checked before or not.
CREATE OR REPLACE FUNCTION public.declutter_item_private_check_tries_reset()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  -- A check recorded, or an edit cleared the check: the listing as it is now gets 3 fresh tries, and the clock
  -- restarts, so the app's own check after an edit gets 5 minutes before the sweep tries (review of 716f2b3c5f, 2).
  -- This trigger runs only for a statement that names ai_checked_at in its SET, so NULL here is an edit clearing the
  -- check, also on a listing that was never checked (NULL -> NULL; b53 review, should-fix 3).
  IF NEW.ai_checked_at IS DISTINCT FROM OLD.ai_checked_at OR NEW.ai_checked_at IS NULL THEN
    NEW.ai_check_attempts := 0;
    NEW.ai_check_last_try_at := now();
  END IF;
  IF NEW.ai_checked_at IS NULL THEN
    NEW.ai_check_cleared_at := now();
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.declutter_item_private_check_tries_reset() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS declutter_item_private_check_tries_reset ON public.declutter_item_private;
CREATE TRIGGER declutter_item_private_check_tries_reset
  BEFORE UPDATE OF ai_checked_at ON public.declutter_item_private
  FOR EACH ROW EXECUTE FUNCTION public.declutter_item_private_check_tries_reset();

-- A photo added or removed voids the check, and on a never-checked listing gives 3 fresh tries (restated from
-- 20261014200728; the only change is that it no longer skips a row with no check or flag).
CREATE OR REPLACE FUNCTION public.declutter_photos_void_ai_check()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
BEGIN
  UPDATE public.declutter_item_private
     SET ai_checked_at = NULL, ai_flag_reason = NULL, updated_at = now()
   WHERE item_id = (CASE WHEN TG_OP = 'DELETE' THEN OLD.item_id ELSE NEW.item_id END);
  RETURN NULL;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_photos_void_ai_check() FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. On sale 45+ minutes with no check: tell every admin, once per listing.
CREATE OR REPLACE FUNCTION public.declutter_alert_overdue_checks()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_n integer := 0;
  v_titles text[] := ARRAY[]::text[];
  r record;
BEGIN
  -- No admin to tell: stamp nothing, so the listings are still alerted once one exists (review of 5fcb074cca).
  IF NOT EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.role = 'admin') THEN
    RETURN 0;
  END IF;
  FOR r IN
    SELECT i.id, i.title
      FROM public.declutter_items i
      JOIN public.declutter_item_private pv ON pv.item_id = i.id
     WHERE i.status IN ('live', 'reserved', 'sold')
       AND pv.ai_checked_at IS NULL
       AND i.live_at IS NOT NULL
       AND i.live_at < now() - interval '45 minutes'
       AND (pv.ai_check_cleared_at IS NULL OR pv.ai_check_cleared_at < now() - interval '45 minutes')
       AND (pv.ai_check_overdue_alerted_at IS NULL
            OR pv.ai_check_overdue_alerted_at < COALESCE(pv.ai_check_cleared_at, '-infinity'::timestamptz))
       AND (i.admin_approved_at IS NULL OR i.admin_approved_at < i.live_at)
       AND NOT i.is_seed
       AND NOT public.is_test_subject(i.seller_id)
     ORDER BY i.live_at
     FOR UPDATE OF pv SKIP LOCKED
  LOOP
    UPDATE public.declutter_item_private SET ai_check_overdue_alerted_at = now() WHERE item_id = r.id;
    v_n := v_n + 1;
    IF cardinality(v_titles) < 3 THEN
      v_titles := v_titles || format('"%s"', left(COALESCE(r.title, 'Untitled'), 60));
    END IF;
  END LOOP;

  IF v_n > 0 THEN
    INSERT INTO public.notifications (user_id, title, message, type, link)
    SELECT ur.user_id,
           'Declutter photo checks are not running',
           left(format('%s listing%s on sale 45+ minutes with no photo check (%s%s). The every-5-minute check sweep (declutter-check-sweep) may be down: look at its cron runs and the declutter-ai-draft logs.',
                       v_n, CASE WHEN v_n = 1 THEN ' has been' ELSE 's have been' END,
                       array_to_string(v_titles, ', '), CASE WHEN v_n > cardinality(v_titles) THEN ', and more' ELSE '' END), 1000),
           'admin_alert',
           '/admin?view=health'
      FROM public.user_roles ur
     WHERE ur.role = 'admin'
       -- One open notice at a time: while the sweep stays down, an admin who has not read the last one gets no
       -- new one every 15 minutes (review of 5fcb074cca: up to 96 a day otherwise).
       AND NOT EXISTS (SELECT 1 FROM public.notifications n
                        WHERE n.user_id = ur.user_id
                          AND n.type = 'admin_alert'
                          AND n.title = 'Declutter photo checks are not running'
                          AND n.read_at IS NULL);
  END IF;
  RETURN v_n;
END;
$function$;
REVOKE ALL ON FUNCTION public.declutter_alert_overdue_checks() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_alert_overdue_checks() TO service_role;

DO $do$
BEGIN
  IF to_regclass('public.cron_work_expectations') IS NOT NULL THEN
    INSERT INTO public.cron_work_expectations (jobname, expected_max_gap, note, work_visibility, work_exempt_reason)
    VALUES ('declutter-check-overdue', interval '45 minutes',
            'Declutter check watchdog, every 15 minutes: tells every admin once per listing when one has been on sale 45+ minutes with no photo check (the sweep, declutter-check-sweep, may be down). B56-SWEEP-FOLLOWUPS.',
            'exempt',
            'While every listing gets its check, a run that alerts nothing is the healthy state.')
    ON CONFLICT (jobname) DO UPDATE SET expected_max_gap = EXCLUDED.expected_max_gap, note = EXCLUDED.note,
      work_visibility = EXCLUDED.work_visibility, work_exempt_reason = EXCLUDED.work_exempt_reason;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'declutter-check-overdue') THEN
      PERFORM cron.unschedule('declutter-check-overdue');
    END IF;
    PERFORM cron.schedule('declutter-check-overdue', '7-59/15 * * * *',
      $c$SELECT public.cron_record_work('declutter-check-overdue', to_jsonb(public.declutter_alert_overdue_checks()));$c$);
  END IF;
END
$do$;

-- ---------------------------------------------------------------------------
-- 3. The alert closes by hand (restated from 20261031184552, one row added).
CREATE OR REPLACE FUNCTION public.admin_alert_manual_close(p_title text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $fn$
  SELECT EXISTS (
    SELECT 1
      FROM (VALUES
        ('cancellation fee transfer failed', 'manual'),
        -- 20261031152545: a sold listing the automatic check flagged, or never finished; the seller's payouts wait.
        ('a sold declutter listing failed its check', 'manual'),
        ('a sold declutter listing was never checked', 'manual'),
        -- 20261101042045: listings on sale 45+ minutes with no check; an admin looks at the sweep and closes it.
        ('declutter photo checks are not running', 'manual')
      ) AS r(prefix, rule)
     WHERE public.ops_alert_normalise(p_title) LIKE r.prefix || '%')
$fn$;

REVOKE ALL ON FUNCTION public.admin_alert_manual_close(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_alert_manual_close(text) TO service_role;
