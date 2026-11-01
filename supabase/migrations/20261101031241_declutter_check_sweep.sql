-- LEAD-CHECK-SWEEP (lead 10-31 ~22:00, after the owner's 9:50 PM report; owner rule: "everyday items must never be
-- held just because a check didn't run").
--
-- WHY
--   The automatic photo check runs from the app, right after Post (20261031152545), paced one listing at a time in
--   Sell a bunch (moves.ts publishMany). If the app is closed mid-bunch, or the check tool is busy, no check is ever
--   recorded, and the 15-minute fail-safe (declutter_hold_unchecked_listings) held the listing for an admin only
--   because no check had run: 27 of the owner's bunch listings on 10-31 (lead put them back live by hand).
--
-- WHAT THIS DOES
--   1. declutter_item_private.ai_check_attempts (+ ai_check_last_try_at): how many times the SERVER sweep has tried
--      the check, and when it last tried. Reset to 0 whenever ai_checked_at changes (a check recorded, or an edit
--      that clears a recorded one for a new check), and the clock restarts then, so the app's own check gets 5
--      minutes first. Not reset: an edit to a listing that was never checked (it keeps its count).
--   2. declutter_check_sweep_claim(p_limit): service role only. Claims up to p_limit listings due a check (live,
--      reserved, sold, or sent back by an edit; went live 5+ minutes ago; no check recorded; fewer than 3 tries; last
--      try (or a cleared check) 5+ minutes ago; an admin's approval since it went live stands; never test data: is_seed or a test
--      account's), counts the try BEFORE the check runs (a crashed or timed-out run still counts), and returns the
--      item and its seller from the ROW (the edge never takes a seller id from a request).
--   3. Every 5 minutes, pg_cron -> pg_net posts {"mode":"check_sweep"} to declutter-ai-draft with the vault
--      service key; the function refuses any other caller (verifyCronSecret) and records each verdict through
--      declutter_record_ai_check, as the app's check does.
--   4. declutter_hold_unchecked_listings restated from its NEWEST CREATE (20261031152545): an unchecked listing is
--      held only after 3 failed tries (or when a check FLAGGED it, unchanged); the reserved/sold branch likewise.
--
-- Not changed: declutter_record_ai_check (what a verdict does), publish, the hold's schedule and notices.
-- Grants by role name: REVOKE ... FROM PUBLIC, anon, authenticated. Replay-safe: IF NOT EXISTS, CREATE OR REPLACE,
-- DROP TRIGGER IF EXISTS, cron unschedule first.

-- ---------------------------------------------------------------------------
-- 1. Tries.
ALTER TABLE public.declutter_item_private ADD COLUMN IF NOT EXISTS ai_check_attempts integer NOT NULL DEFAULT 0;
ALTER TABLE public.declutter_item_private ADD COLUMN IF NOT EXISTS ai_check_last_try_at timestamptz;

CREATE OR REPLACE FUNCTION public.declutter_item_private_check_tries_reset()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  -- A check recorded, or an edit cleared the old one: the listing as it is now gets 3 fresh tries, and the clock
  -- restarts, so the app's own check after an edit gets 5 minutes before the sweep tries (review of 716f2b3c5f, 2).
  IF NEW.ai_checked_at IS DISTINCT FROM OLD.ai_checked_at THEN
    NEW.ai_check_attempts := 0;
    NEW.ai_check_last_try_at := now();
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.declutter_item_private_check_tries_reset() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS declutter_item_private_check_tries_reset ON public.declutter_item_private;
CREATE TRIGGER declutter_item_private_check_tries_reset
  BEFORE UPDATE OF ai_checked_at ON public.declutter_item_private
  FOR EACH ROW EXECUTE FUNCTION public.declutter_item_private_check_tries_reset();

-- ---------------------------------------------------------------------------
-- 2. The sweep's claim: which listings to check now, each try counted first.
CREATE OR REPLACE FUNCTION public.declutter_check_sweep_claim(p_limit integer DEFAULT 5)
 RETURNS TABLE (sweep_item_id uuid, sweep_seller_id uuid, sweep_attempt integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT pv.item_id, i.seller_id
      FROM public.declutter_item_private pv
      JOIN public.declutter_items i ON i.id = pv.item_id
     WHERE pv.ai_checked_at IS NULL
       AND pv.ai_check_attempts < 3
       -- 5 minutes since the last try, or since an edit cleared the check (the trigger above restarts the clock).
       -- 4.5, not 5: the cron runs every 5 minutes and a strict 5 would skip every other run on timing jitter.
       AND (pv.ai_check_last_try_at IS NULL OR pv.ai_check_last_try_at < now() - interval '270 seconds')
       -- The app's own check right after Post gets 5 minutes first.
       AND i.live_at IS NOT NULL
       AND i.live_at < now() - interval '5 minutes'
       -- What declutter_record_ai_check will judge: on sale (or reserved/sold before any check landed), or sent back
       -- by an edit; never one an admin approved since it went live.
       AND i.status IN ('live', 'reserved', 'sold', 'pending_review')
       AND (i.admin_approved_at IS NULL OR i.admin_approved_at < i.live_at)
       -- Never test data (owner 10-30: test data never reaches the owner; no model cost on it).
       AND NOT i.is_seed
       AND NOT public.is_test_subject(i.seller_id)
     ORDER BY i.live_at
     LIMIT LEAST(GREATEST(COALESCE(p_limit, 5), 1), 20)
     FOR UPDATE OF pv SKIP LOCKED
  LOOP
    UPDATE public.declutter_item_private
       SET ai_check_attempts = ai_check_attempts + 1, ai_check_last_try_at = now(), updated_at = now()
     WHERE item_id = r.item_id
    RETURNING ai_check_attempts INTO sweep_attempt;
    sweep_item_id := r.item_id;
    sweep_seller_id := r.seller_id;
    RETURN NEXT;
  END LOOP;
END;
$function$;
REVOKE ALL ON FUNCTION public.declutter_check_sweep_claim(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_check_sweep_claim(integer) TO service_role;

-- A try that says nothing about the listing is given back (review of 716f2b3c5f, re-review 1 and 3): our own fault
-- (the run answers 500 and pages instead) or a stale verdict (the seller changed it while it was judged). Only a
-- check that could not run on the listing itself (the tool busy, a photo gone) keeps counting toward the 3.
CREATE OR REPLACE FUNCTION public.declutter_check_sweep_give_back(p_item_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_left integer;
BEGIN
  UPDATE public.declutter_item_private
     SET ai_check_attempts = GREATEST(ai_check_attempts - 1, 0)
   WHERE item_id = p_item_id AND ai_checked_at IS NULL
  RETURNING ai_check_attempts INTO v_left;
  RETURN v_left;
END;
$function$;
REVOKE ALL ON FUNCTION public.declutter_check_sweep_give_back(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_check_sweep_give_back(uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- 3. Fail-safe: held only when a check flagged it, or failed 3 times.
CREATE OR REPLACE FUNCTION public.declutter_hold_unchecked_listings()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_n integer := 0;
  r record;
  v_order uuid;
BEGIN
  FOR r IN
    UPDATE public.declutter_items i
       SET status = 'pending_review', updated_at = now()
     WHERE i.status = 'live'
       AND i.live_at < now() - interval '15 minutes'
       -- Review of 41771724f3 (1): an admin's approval since it went live stands (approval sets no ai_checked_at).
       AND (i.admin_approved_at IS NULL OR i.admin_approved_at < i.live_at)
       -- Never checked; or flagged and back on sale (re-review of e23f131d97): a flag (or the "didn't finish" mark
       -- below) on a reserved or sold listing leaves it up while the sale stands, and if that sale falls through (the
       -- buyer removes it, 20261028221904; a missed checkout, 20261030152217) it is live again. It is held here.
       -- LEAD-CHECK-SWEEP (owner 10-31: "everyday items must never be held just because a check didn't run"): an
       -- unchecked listing is held only once the check has FAILED 3 times (ai_check_attempts, counted by the server
       -- sweep below), never because no check ran yet.
       AND EXISTS (SELECT 1 FROM public.declutter_item_private pv
                    WHERE pv.item_id = i.id
                      AND ((pv.ai_checked_at IS NULL AND pv.ai_check_attempts >= 3) OR pv.ai_flag_reason IS NOT NULL))
    RETURNING i.id, i.seller_id, i.title,
              (SELECT pv.ai_flag_reason FROM public.declutter_item_private pv WHERE pv.item_id = i.id) AS flag
  LOOP
    v_n := v_n + 1;
    IF r.flag IS NULL OR r.flag = 'The automatic check didn''t finish.' THEN
      PERFORM public.declutter_notify(r.seller_id, 'declutter_listings', 'Your listing is waiting for a check',
        format('Our automatic check of "%s" didn''t finish, so someone from Louisiana Helpr will look at it. Buyers can''t see it until then.', r.title),
        '/declutter?tab=selling', NULL);
    ELSE
      PERFORM public.declutter_notify(r.seller_id, 'declutter_listings', 'Your listing is waiting for a check',
        format('Our automatic check flagged "%s" (%s). Someone from Louisiana Helpr will look at it. Buyers can''t see it until then.', r.title, r.flag),
        '/declutter?tab=selling', NULL);
    END IF;
  END LOOP;

  -- Review of 62f90f3368 (3): a buyer reserved or paid for it before any check came back, and none has 15 minutes
  -- after it went live. The sale stands; the seller's payouts wait for an admin (payout_holds, which every payout
  -- path checks) and every admin is alerted, as a late flag on a sold listing does (record_ai_check). The item is
  -- marked judged ("didn't finish") so this runs once per item, and an admin's lift of the hold stays lifted; an
  -- admin approval since it went live stands. Lock order as everywhere in Declutter: items first.
  FOR r IN
    SELECT i.id, i.seller_id, i.title
      FROM public.declutter_items i
     WHERE i.status IN ('reserved', 'sold')
       AND i.live_at < now() - interval '15 minutes'
       AND (i.admin_approved_at IS NULL OR i.admin_approved_at < i.live_at)
       -- LEAD-CHECK-SWEEP: only after 3 failed checks; until then the sweep keeps checking it and the sale stands.
       AND EXISTS (SELECT 1 FROM public.declutter_item_private pv
                    WHERE pv.item_id = i.id AND pv.ai_checked_at IS NULL AND pv.ai_check_attempts >= 3)
     FOR UPDATE OF i SKIP LOCKED
  LOOP
    UPDATE public.declutter_item_private
       SET ai_checked_at = now(), ai_flag_reason = 'The automatic check didn''t finish.', updated_at = now()
     WHERE item_id = r.id AND ai_checked_at IS NULL;
    CONTINUE WHEN NOT FOUND;
    v_n := v_n + 1;
    SELECT c.order_id INTO v_order
      FROM public.declutter_cart_items c
     WHERE c.item_id = r.id AND c.status IN ('in_cart', 'paid')
     ORDER BY c.created_at DESC LIMIT 1;
    INSERT INTO public.payout_holds (helper_id, reason, held_by, held_at)
    VALUES (r.seller_id,
            left(format('Declutter: the automatic check of "%s" didn''t finish before a buyer reserved or bought it (order %s). Lift this hold to pay the seller, or refund the buyer.',
                        r.title, COALESCE(v_order::text, 'none')), 1000),
            NULL, now())
    ON CONFLICT (helper_id) DO NOTHING;
    -- Every admin, never for a test account (owner 2026-10-30).
    IF NOT public.is_test_subject(r.seller_id) THEN
      INSERT INTO public.notifications (user_id, title, message, type, link)
      SELECT ur.user_id,
             'A sold Declutter listing was never checked',
             left(format('The automatic check of "%s" didn''t finish before a buyer reserved or bought it. The seller''s payouts are on hold: look at the listing, then lift the hold to pay them, or refund the buyer.', r.title), 1000),
             'admin_alert',
             '/admin?view=payouts'
        FROM public.user_roles ur
       WHERE ur.role = 'admin';
    END IF;
    PERFORM public.declutter_notify(r.seller_id, 'declutter_listings', 'Your sale is waiting for a check',
      format('Our automatic check of "%s" didn''t finish, so someone from Louisiana Helpr will look at it before you''re paid.', r.title),
      '/declutter?tab=selling', NULL);
  END LOOP;
  RETURN v_n;
END;
$function$;
REVOKE ALL ON FUNCTION public.declutter_hold_unchecked_listings() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_hold_unchecked_listings() TO service_role;

-- ---------------------------------------------------------------------------
-- 4. Every 5 minutes: the server checks what the app didn't.
DO $do$
BEGIN
  IF to_regclass('public.cron_work_expectations') IS NOT NULL THEN
    INSERT INTO public.cron_work_expectations (jobname, expected_max_gap, note, work_visibility, work_exempt_reason)
    VALUES ('declutter-check-sweep', interval '20 minutes',
            'Declutter photo check sweep, every 5 minutes: declutter-ai-draft, mode check_sweep, checks live listings whose check from the app never landed, and after 3 failed tries the fail-safe holds it. LEAD-CHECK-SWEEP.',
            'exempt',
            'While every check from the app lands, a run that checks nothing is the healthy state.')
    ON CONFLICT (jobname) DO UPDATE SET expected_max_gap = EXCLUDED.expected_max_gap, note = EXCLUDED.note,
      work_visibility = EXCLUDED.work_visibility, work_exempt_reason = EXCLUDED.work_exempt_reason;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'declutter-check-sweep') THEN
      PERFORM cron.unschedule('declutter-check-sweep');
    END IF;
    PERFORM cron.schedule('declutter-check-sweep', '1-59/5 * * * *', $c$SELECT public.cron_http_tag(q.request_id, 'declutter-check-sweep')
  FROM (
      SELECT net.http_post(timeout_milliseconds := 120000,
        url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'supabase_url' LIMIT 1)
               || '/functions/v1/declutter-ai-draft',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1)
        ),
        body := '{"mode":"check_sweep"}'::jsonb
      )
) AS q(request_id);$c$);
  END IF;
END
$do$;
