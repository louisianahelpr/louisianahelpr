-- CMP-4, slices 2 and 3: the poster books instantly, and the Helpr's 2-hour
-- decline window (owner 2026-10-29; lead 2026-11-01, design A).
--
-- THE MONEY MODEL (lead 2026-11-01, design A). A posted job's card is HELD
-- (card_hold_at_post is on for everyone), never charged at post.
--   * Book now (rpc_instant_book): the job is handed to the Helpr as a direct
--     offer that is already a yes from the poster, stamped instant_booked_at
--     and instant_decline_until = now() + 2 h. NO money moves: the card stays
--     held, exactly as for any direct offer.
--   * The Helpr confirms early: the ordinary direct-offer accept
--     (create-payment capture_hold -> respond_to_direct_offer), which captures
--     the hold under its one claim and idempotency key, then hires.
--   * The Helpr can't make it (rpc_instant_book_decline, inside the window or
--     until the capture): no money moves, the card stays held, the job is open
--     again, the poster hears "<First> can't make it. Your card was not
--     charged." The Helpr is never offered this job again.
--   * The 2 hours pass: card-hold-sweep (every 10 min) captures the hold with
--     the SAME captureCardHold the Helpr's accept uses (one claim row, one key
--     per attempt: two runs never charge twice), then completes the hire with
--     complete_direct_offer_accept. A capture Stripe refuses: the job comes off
--     the listing as any failed hold does (the poster is asked to pay again),
--     and instant_book_payment_failed withdraws the booking and tells both
--     sides. Never "booked but unpaid".
--
-- WHO WRITES THE COLUMNS. instant_booked_at and instant_decline_until are
-- server-only: a member's own UPDATE (RLS lets a poster edit their job) can
-- neither set nor clear them, nor move a live booking to another Helpr
-- (trigger jobs_instant_book_server_only). When the offer leaves 'pending' by
-- any path (an accept, a generic decline, a cancel), the window closes itself.
--
-- On for everyone, no feature switch (owner rule "ship on for everyone").
-- PGlite proof: src/test/pglite/instantBookBooking.pglite.mjs.
--
-- REPLAY-SAFE: ADD COLUMN IF NOT EXISTS, CREATE TABLE IF NOT EXISTS, CREATE OR
-- REPLACE, DROP TRIGGER IF EXISTS before CREATE TRIGGER.

ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS instant_booked_at timestamptz;
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS instant_decline_until timestamptz;
COMMENT ON COLUMN public.jobs.instant_decline_until IS
  'CMP-4: while set (and the direct offer is pending), the job is instantly booked to offered_to_helper_id, who may decline until this time; card-hold-sweep captures the hold after it. Server-written only.';

-- Who said they can't make a job: never offered it again. Server-only.
CREATE TABLE IF NOT EXISTS public.instant_book_declines (
  job_id      uuid NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  helper_id   uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  reason      text NOT NULL DEFAULT 'declined' CHECK (reason IN ('declined', 'payment_failed')),
  declined_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (job_id, helper_id)
);
ALTER TABLE public.instant_book_declines ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.instant_book_declines FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.instant_book_declines TO service_role;

-- ─── The columns are the server's ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.jobs_instant_book_server_only()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $fn$
BEGIN
  -- current_user is the role running the statement: a member's own PostgREST
  -- write runs as authenticated; a SECURITY DEFINER path runs as its owner.
  IF current_user IN ('authenticated', 'anon') THEN
    IF TG_OP = 'INSERT' THEN
      IF NEW.instant_booked_at IS NOT NULL OR NEW.instant_decline_until IS NOT NULL THEN
        RAISE EXCEPTION 'instant_book_server_only' USING ERRCODE = '42501';
      END IF;
    ELSIF NEW.instant_booked_at IS DISTINCT FROM OLD.instant_booked_at
       OR NEW.instant_decline_until IS DISTINCT FROM OLD.instant_decline_until
       OR (OLD.instant_decline_until IS NOT NULL
           AND (NEW.offered_to_helper_id IS DISTINCT FROM OLD.offered_to_helper_id
                OR NEW.direct_offer_status IS DISTINCT FROM OLD.direct_offer_status)) THEN
      RAISE EXCEPTION 'instant_book_server_only' USING ERRCODE = '42501';
    END IF;
  END IF;
  -- The window is only ever open on a live, pending offer.
  IF NEW.instant_decline_until IS NOT NULL
     AND (NEW.offered_to_helper_id IS NULL OR NEW.direct_offer_status IS DISTINCT FROM 'pending'
          OR NEW.status::text IS DISTINCT FROM 'open') THEN
    NEW.instant_decline_until := NULL;
  END IF;
  RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION public.jobs_instant_book_server_only() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS jobs_instant_book_server_only ON public.jobs;
CREATE TRIGGER jobs_instant_book_server_only
  BEFORE INSERT OR UPDATE ON public.jobs
  FOR EACH ROW EXECUTE FUNCTION public.jobs_instant_book_server_only();

-- ─── Who qualifies: restated from 20261101063725_instant_book_floors.sql (newest) except the CMP-4 slice 2 lines ─
-- Why p_helper can't be instant-booked on p_job_id (NULL = they can). Server
-- only: its answer would tell a caller whether a price clears a floor.
CREATE OR REPLACE FUNCTION public.instant_book_block_reason(p_job_id uuid, p_helper uuid)
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
 SET "TimeZone" TO 'America/Chicago'
AS $fn$
DECLARE
  v_job record;
  v_profile record;
  v_floor integer;
BEGIN
  SELECT j.status::text AS status, j.helper_id, j.customer_id, j.offered_to_helper_id, j.direct_offer_status,
         j.parent_job_id, COALESCE(j.is_group_job, false) AS is_group_job, j.is_seed, j.category, j.budget,
         j.date_needed, j.start_time, j.expires_at, j.payment_status, COALESCE(j.credential_tier, 0) AS credential_tier
    INTO v_job
    FROM public.jobs j
   WHERE j.id = p_job_id;
  IF NOT FOUND THEN
    RETURN 'job_not_found';
  END IF;
  IF v_job.status IS DISTINCT FROM 'open' OR v_job.helper_id IS NOT NULL
     OR (v_job.offered_to_helper_id IS NOT NULL AND v_job.direct_offer_status = 'pending')
     OR v_job.parent_job_id IS NOT NULL OR v_job.is_group_job THEN
    RETURN 'job_not_open';
  END IF;
  IF NOT public.job_payment_is_listed(v_job.payment_status::text) THEN
    RETURN 'job_not_funded';
  END IF;
  IF v_job.date_needed IS NULL THEN
    RETURN 'job_has_no_date';
  END IF;
  IF public.job_offer_cutoff(v_job.date_needed, v_job.start_time) <= now()
     OR (v_job.expires_at IS NOT NULL AND v_job.expires_at <= now()) THEN
    RETURN 'job_date_has_passed';
  END IF;

  IF p_helper IS NULL OR p_helper = v_job.customer_id THEN
    RETURN 'not_eligible';
  END IF;
  -- Test and real never mix: a real job only to real Helprs, a test job only to test accounts.
  IF COALESCE(v_job.is_seed, false) THEN
    IF NOT EXISTS (SELECT 1 FROM public.test_accounts t WHERE t.user_id = p_helper) THEN
      RETURN 'not_eligible';
    END IF;
  ELSIF EXISTS (SELECT 1 FROM public.test_accounts t WHERE t.user_id = p_helper) THEN
    RETURN 'not_eligible';
  END IF;

  -- CMP-4 slice 2: a Helpr who said they can't make this job is not offered it again.
  -- (A generic decline of the booking leaves offered_to_helper_id with 'declined'.)
  IF EXISTS (SELECT 1 FROM public.instant_book_declines d WHERE d.job_id = p_job_id AND d.helper_id = p_helper)
     OR (v_job.offered_to_helper_id = p_helper AND v_job.direct_offer_status = 'declined') THEN
    RETURN 'not_eligible';
  END IF;

  SELECT f.floor_cents INTO v_floor
    FROM public.instant_book_floors f
   WHERE f.helper_id = p_helper AND f.category = v_job.category;
  IF v_floor IS NULL OR round(v_job.budget * 100) < v_floor THEN
    RETURN 'not_eligible';
  END IF;

  IF public.are_users_blocked(p_helper, v_job.customer_id) THEN
    RETURN 'not_eligible';
  END IF;
  SELECT p.ban_status, p.auto_suspended_until INTO v_profile FROM public.profiles p WHERE p.user_id = p_helper;
  IF NOT FOUND THEN
    RETURN 'not_eligible';
  END IF;
  IF v_profile.ban_status IN ('banned', 'temp_banned', 'permanently_banned')
     AND (v_profile.ban_status <> 'temp_banned' OR v_profile.auto_suspended_until IS NULL
          OR v_profile.auto_suspended_until > now()) THEN
    RETURN 'not_eligible';
  END IF;
  IF public.is_helper_shadowbanned(p_helper) THEN
    RETURN 'not_eligible';
  END IF;
  IF v_job.credential_tier > 0
     AND COALESCE(public.get_user_credential_tier(p_helper), 0) < v_job.credential_tier THEN
    RETURN 'not_eligible';
  END IF;
  IF public.helper_accept_block_reason(p_helper) IS NOT NULL THEN
    RETURN 'not_eligible';
  END IF;
  IF public.instant_book_real_jobs_done(p_helper) < 3 THEN
    RETURN 'not_eligible';
  END IF;
  IF NOT public.instant_book_helper_free_on(p_helper, v_job.date_needed) THEN
    RETURN 'not_eligible';
  END IF;
  RETURN NULL;
END;
$fn$;

REVOKE ALL ON FUNCTION public.instant_book_block_reason(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.instant_book_block_reason(uuid, uuid) TO service_role;

-- ─── Book now ───────────────────────────────────────────────────────────────
-- The poster books p_helper on their own job at its own price. Moves no money.
-- Any reason the Helpr can't be booked answers one code, never which check
-- failed (that would tell the poster whether a price clears a floor).
CREATE OR REPLACE FUNCTION public.rpc_instant_book(p_job_id uuid, p_helper_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
 SET "TimeZone" TO 'America/Chicago'
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  v_job record;
  v_reason text;
  v_until timestamptz := now() + interval '2 hours';
  v_poster_name text;
  v_helper_name text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  -- Lock the job: serializes against an apply/hire, a cancel, another booking.
  SELECT j.id, j.customer_id, j.title, j.budget, j.date_needed INTO v_job
    FROM public.jobs j WHERE j.id = p_job_id FOR UPDATE;
  IF NOT FOUND OR v_job.customer_id IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  v_reason := public.instant_book_block_reason(p_job_id, p_helper_id);
  IF v_reason IS NOT NULL THEN
    RAISE EXCEPTION 'instant_book_unavailable' USING ERRCODE = '22023',
      DETAIL = CASE WHEN v_reason = 'not_eligible' THEN 'helpr' ELSE v_reason END;
  END IF;

  UPDATE public.jobs
     SET offered_to_helper_id = p_helper_id,
         direct_offer_status = 'pending',
         direct_offer_expires_at = NULL,
         instant_booked_at = now(),
         instant_decline_until = v_until
   WHERE id = p_job_id;

  SELECT public.member_display_name(full_name, 'A neighbor') INTO v_poster_name FROM public.profiles WHERE user_id = v_uid;
  SELECT public.member_display_name(full_name, 'Your Helpr') INTO v_helper_name FROM public.profiles WHERE user_id = p_helper_id;
  INSERT INTO public.notifications (user_id, title, message, type, link, job_id) VALUES
    (p_helper_id, 'You''re booked',
     v_poster_name || ' booked you for "' || v_job.title || '" on ' || to_char(v_job.date_needed, 'FMMon FMDD')
       || ' for $' || replace(to_char(v_job.budget, 'FM999999990.00'), '.00', '') || '. Can''t make it? Decline by ' || to_char(v_until, 'FMHH12:MI AM')
       || ' and nothing is charged.',
     'new_offers', '/jobs?job=' || p_job_id::text, p_job_id),
    (v_uid, 'Booked',
     v_helper_name || ' is booked for "' || v_job.title || '". They have until ' || to_char(v_until, 'FMHH12:MI AM')
       || ' to say if they can''t make it. Your card is charged after that.',
     'job_updates', '/posts?job=' || p_job_id::text, p_job_id);

  RETURN jsonb_build_object('action', 'booked', 'decline_until', v_until);
END;
$fn$;
REVOKE ALL ON FUNCTION public.rpc_instant_book(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rpc_instant_book(uuid, uuid) TO authenticated;

-- ─── The Helpr can't make it ────────────────────────────────────────────────
-- Until the hold is captured (the window, plus the sweep's next run). No money
-- moves: the card stays held and the job is open again for everyone else.
CREATE OR REPLACE FUNCTION public.rpc_instant_book_decline(p_job_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  v_job record;
  v_first text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  SELECT j.customer_id, j.title, j.offered_to_helper_id, j.direct_offer_status, j.instant_decline_until, j.status::text AS status,
         j.payment_status
    INTO v_job
    FROM public.jobs j WHERE j.id = p_job_id FOR UPDATE;
  IF NOT FOUND OR v_job.offered_to_helper_id IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'not_your_offer' USING ERRCODE = '42501';
  END IF;
  -- instant_decline_until is NULL once the hire completed (the trigger closes it).
  IF v_job.instant_decline_until IS NULL OR v_job.direct_offer_status IS DISTINCT FROM 'pending' OR v_job.status <> 'open' THEN
    RAISE EXCEPTION 'booking_not_pending' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.instant_book_declines (job_id, helper_id, reason) VALUES (p_job_id, v_uid, 'declined')
  ON CONFLICT (job_id, helper_id) DO NOTHING;
  -- The offer is cleared, not marked 'declined': the generic "declined your
  -- offer" banner and email (record_backout_notice) would say the wrong thing.
  UPDATE public.jobs
     SET offered_to_helper_id = NULL,
         direct_offer_status = NULL,
         direct_offer_expires_at = NULL,
         instant_decline_until = NULL
   WHERE id = p_job_id;
  DELETE FROM public.job_accept_pending WHERE job_id = p_job_id AND helper_id = v_uid;

  SELECT NULLIF(split_part(COALESCE(public.member_display_name(full_name, NULL), ''), ' ', 1), '') INTO v_first
    FROM public.profiles WHERE user_id = v_uid;
  IF v_job.customer_id IS NOT NULL THEN
    INSERT INTO public.notifications (user_id, title, message, type, link, job_id) VALUES
      (v_job.customer_id, COALESCE(v_first, 'Your Helpr') || ' can''t make it',
       COALESCE(v_first, 'Your Helpr') || ' can''t make it. '
         || CASE WHEN v_job.payment_status = 'held' THEN 'Your card was not charged. '
                 ELSE 'Your payment stays with the job. ' END
         || 'Your job is open again for other Helprs.',
       'job_updates', '/posts?job=' || p_job_id::text, p_job_id);
  END IF;
  RETURN jsonb_build_object('action', 'declined');
END;
$fn$;
REVOKE ALL ON FUNCTION public.rpc_instant_book_decline(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rpc_instant_book_decline(uuid) TO authenticated;

-- ─── The capture failed: the booking ends, both sides are told ─────────────
-- card-hold-sweep only (service_role), after captureCardHold answered
-- "poster_must_pay": the job is already off the listing (payment_status
-- 'failed') and the poster asked to pay again by the hold code.
CREATE OR REPLACE FUNCTION public.instant_book_payment_failed(p_job_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_job record;
  v_first text;
BEGIN
  SELECT j.customer_id, j.title, j.offered_to_helper_id, j.instant_booked_at, j.direct_offer_status, j.status::text AS status
    INTO v_job
    FROM public.jobs j WHERE j.id = p_job_id FOR UPDATE;
  -- Only a live instant booking (already ended = false: a second run is a no-op).
  IF NOT FOUND OR v_job.instant_booked_at IS NULL OR v_job.offered_to_helper_id IS NULL
     OR v_job.direct_offer_status IS DISTINCT FROM 'pending' OR v_job.status <> 'open' THEN
    RETURN false;
  END IF;
  INSERT INTO public.instant_book_declines (job_id, helper_id, reason) VALUES (p_job_id, v_job.offered_to_helper_id, 'payment_failed')
  ON CONFLICT (job_id, helper_id) DO NOTHING;
  UPDATE public.jobs
     SET offered_to_helper_id = NULL,
         direct_offer_status = NULL,
         direct_offer_expires_at = NULL,
         instant_decline_until = NULL
   WHERE id = p_job_id;
  DELETE FROM public.job_accept_pending WHERE job_id = p_job_id;

  SELECT NULLIF(split_part(COALESCE(public.member_display_name(full_name, NULL), ''), ' ', 1), '') INTO v_first
    FROM public.profiles WHERE user_id = v_job.offered_to_helper_id;
  INSERT INTO public.notifications (user_id, title, message, type, link, job_id) VALUES
    (v_job.offered_to_helper_id, 'Booking didn''t go through',
     'The poster''s payment for "' || v_job.title || '" didn''t go through, so you aren''t booked. Nothing is owed and no strike.',
     'job_updates', '/jobs?job=' || p_job_id::text, p_job_id);
  IF v_job.customer_id IS NOT NULL THEN
    INSERT INTO public.notifications (user_id, title, message, type, link, job_id) VALUES
      (v_job.customer_id, 'Your booking didn''t go through',
       'Your card didn''t go through, so ' || COALESCE(v_first, 'your Helpr') || ' isn''t booked for "' || v_job.title
         || '". Nothing was charged. Update your payment to open the job again.',
       'job_updates', '/posts?job=' || p_job_id::text, p_job_id);
  END IF;
  RETURN true;
END;
$fn$;
REVOKE ALL ON FUNCTION public.instant_book_payment_failed(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.instant_book_payment_failed(uuid) TO service_role;

-- ─── The Helpr's own live booking, for the "You're booked" card ────────────
CREATE OR REPLACE FUNCTION public.rpc_my_instant_bookings()
 RETURNS TABLE(job_id uuid, title text, date_needed date, budget numeric, decline_until timestamptz)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT j.id, j.title, j.date_needed, j.budget, j.instant_decline_until
    FROM public.jobs j
   WHERE auth.uid() IS NOT NULL
     AND j.offered_to_helper_id = auth.uid()
     AND j.direct_offer_status = 'pending'
     AND j.instant_decline_until IS NOT NULL
     AND j.status::text = 'open'
   ORDER BY j.instant_decline_until;
$fn$;
REVOKE ALL ON FUNCTION public.rpc_my_instant_bookings() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rpc_my_instant_bookings() TO authenticated;

-- ─── The direct-offer notice skips an instant booking ──────────────────────
-- notify_helper_on_direct_offer, newest definition 20261027185146_card_hold_at_post.sql
-- verbatim except the CMP-4 lines.
CREATE OR REPLACE FUNCTION public.notify_helper_on_direct_offer()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_poster_name text;
BEGIN
  IF NEW.offered_to_helper_id IS NOT NULL
     AND NEW.direct_offer_status = 'pending'
     -- No notice for a job whose money has not arrived (owner, 2026-10-17).
     AND public.job_payment_is_listed(NEW.payment_status)
     -- Only a live job's offer is news (review #4: not a pending_approval or
     -- cancelled row).
     AND NEW.status::text = 'open'
     -- Money that arrives after the job's start cutoff cannot be answered in
     -- time: no notice about an offer nobody can accept (review #3).
     AND (NEW.date_needed IS NULL
          OR public.job_offer_cutoff(NEW.date_needed, NEW.start_time) > now())
     AND (
       TG_OP = 'INSERT'
       -- The money just arrived for the FIRST time: the notice that waited
       -- for it goes out now. "Never paid" is the set a job leaves only when
       -- money arrives (NULL, unpaid, abandoned, failed), NOT "anything not
       -- funded": escrow -> cancelling -> escrow (cancel_escrow putting a
       -- cancel claim back) is the same money, already announced (review #2).
       OR OLD.payment_status IS NULL
       OR OLD.payment_status IN ('unpaid', 'abandoned', 'failed')
       -- A funded job's offer moved to a different Helpr.
       OR OLD.offered_to_helper_id IS DISTINCT FROM NEW.offered_to_helper_id
     )
     -- CMP-4: an instant booking is not an offer to answer. rpc_instant_book
     -- tells the Helpr "You're booked" in its own words.
     AND NEW.instant_decline_until IS NULL
     -- A job booked from an agreed quote, offered to its quoter: paying hires
     -- them (quote_job_funded_hires_quoter), which sends the one notice.
     AND NOT public.quote_job_offered_to_quoter(NEW.id, NEW.offered_to_helper_id)
  THEN
    SELECT public.member_display_name(full_name, 'Someone') INTO v_poster_name
      FROM public.profiles WHERE user_id = NEW.customer_id;

    INSERT INTO public.notifications (user_id, title, message, type, link, job_id)
    VALUES (
      NEW.offered_to_helper_id,
      'You got a direct job offer!',
      v_poster_name || ' offered you a job: "' || NEW.title || '" for $' || NEW.budget,
      'new_offers',
      '/jobs?job=' || NEW.id::text,
      NEW.id
    );
  END IF;
  RETURN NEW;
END;
$function$;
