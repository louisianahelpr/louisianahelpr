-- CMP-4 money review fix (lead 2026-11-01): the Helpr's decline and the
-- sweep's capture can no longer both win.
--
-- THE RACE (money review of 20261101065105, FAIL): rpc_instant_book_decline
-- checked only that the window was set, the offer pending and the job open.
-- At the 2-hour mark card-hold-sweep claims the hold while the Helpr declines:
-- the decline still read 'held' and told the poster "Your card was not
-- charged", Stripe then captured, complete_direct_offer_accept refused (the
-- offer was gone) and the job no longer matched the sweep. The poster was
-- charged, nobody was hired, and the poster had been told something false.
--
-- NOW:
--   (a) rpc_instant_book_decline locks the hold row (job_card_holds, after the
--       job row: the order the sweep's capture and the cancel take) and
--       refuses ('decline_window_closed') unless now() is inside the window
--       AND either the card is only held (payment_status 'held', hold
--       'authorized' or 'scheduled': no capture has claimed it) OR the job was
--       paid at post (no hold row at all, payment_status 'escrow': nothing is
--       captured for the booking, so no capture can race the decline). A
--       capture's claim ('capturing') or its result ('captured') refuses the
--       decline. The capture side (_shared/cardHold.ts captureCardHold
--       offerTo) gives its claim back, charging nothing, when the offer is
--       no longer pending to that Helpr after the claim.
--   (b) instant_book_end_if_unhireable: before any capture, the sweep runs
--       the SAME checks complete_direct_offer_accept runs
--       (direct_accept_block_reason: job open, offer pending to this Helpr,
--       block, ban, date, funding; helper_accept_block_reason: payout setup
--       and ID). Any failure ends the booking with no money moved and tells
--       both sides the truth ("Your card was not charged").
--   (c) instant_book_captured_not_hired: the true race left (a hire refused
--       in the moment between a capture and the hire). The booking ends, ops
--       is paged ONCE per job (the function answers true only the first time;
--       the sweep pages only on true), and the poster is told plainly that
--       their payment is being returned and they will hear within a day.
--   (d) instant_book_payment_failed no longer doubles the hold code's own
--       "Your payment didn't go through" notice: the poster's line is sent
--       only when the hold's once-marker (job_card_holds.notified_state) says
--       the poster has not been told 'failed', and it then sets that marker
--       so card-hold-sweep's re-send does not repeat it either.
--   (e) respond_to_direct_offer's decline of an instant booking is the
--       instant-book decline (lead 2026-11-01 item 1): same refusals, same
--       "can't make it ... not charged" words, no generic "declined your
--       offer" banner or email.
--   (f) A poster's cancel (or any close) during the window tells the booked
--       Helpr (lead 2026-11-01 item 2): poster_cancel_job only tells a HIRED
--       Helpr, and create-payment's cancel_escrow tells nobody.
--
-- PGlite proof: src/test/pglite/instantBookDeclineRace.pglite.mjs.
-- REPLAY-SAFE: CREATE OR REPLACE, DROP ... IF EXISTS before each ADD/CREATE.

ALTER TABLE public.instant_book_declines DROP CONSTRAINT IF EXISTS instant_book_declines_reason_check;
ALTER TABLE public.instant_book_declines ADD CONSTRAINT instant_book_declines_reason_check
  CHECK (reason IN ('declined', 'payment_failed', 'not_hireable', 'captured_not_hired'));

-- ─── (a) The Helpr can't make it ────────────────────────────────────────────
-- rpc_instant_book_decline, newest definition 20261101065105_instant_book_booking.sql
-- verbatim except the race lines.
CREATE OR REPLACE FUNCTION public.rpc_instant_book_decline(p_job_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  v_job record;
  v_hold record;
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
  -- Race fix (a): the hold is locked, after the job, as a capture's claim
  -- writes it. A claim committed first is seen here ('capturing'); a claim
  -- after this commit finds the offer gone and gives itself back.
  SELECT h.state INTO v_hold FROM public.job_card_holds h WHERE h.job_id = p_job_id FOR UPDATE;
  IF now() >= v_job.instant_decline_until
     OR NOT (
       (v_job.payment_status = 'held' AND FOUND AND v_hold.state IN ('authorized', 'scheduled'))
       -- Paid at post: no hold, so nothing is captured for the booking.
       OR (v_job.payment_status = 'escrow' AND NOT FOUND)
     ) THEN
    RAISE EXCEPTION 'decline_window_closed' USING ERRCODE = '22023';
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

-- ─── (b) Before any capture: can this Helpr still be hired? ────────────────
-- card-hold-sweep only. The checks complete_direct_offer_accept runs, under
-- the job lock. True = the booking ended here (nothing captured, both told).
CREATE OR REPLACE FUNCTION public.instant_book_end_if_unhireable(p_job_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_job record;
  v_hold record;
  v_reason text;
  v_first text;
BEGIN
  SELECT j.customer_id, j.title, j.offered_to_helper_id, j.instant_booked_at, j.instant_decline_until,
         j.direct_offer_status, j.status::text AS status, j.payment_status
    INTO v_job
    FROM public.jobs j WHERE j.id = p_job_id FOR UPDATE;
  IF NOT FOUND OR v_job.instant_booked_at IS NULL OR v_job.instant_decline_until IS NULL OR v_job.offered_to_helper_id IS NULL
     OR v_job.direct_offer_status IS DISTINCT FROM 'pending' OR v_job.status <> 'open' THEN
    RETURN false;
  END IF;
  -- Only BEFORE a capture: a card still only held (hold 'authorized' or
  -- 'scheduled'), or a job paid at post (no hold row). A hold being captured
  -- or captured is the capture-then-hire path (instant_book_captured_not_hired),
  -- never "Your card was not charged".
  SELECT h.state INTO v_hold FROM public.job_card_holds h WHERE h.job_id = p_job_id FOR UPDATE;
  IF NOT ((v_job.payment_status = 'held' AND FOUND AND v_hold.state IN ('authorized', 'scheduled'))
          OR (v_job.payment_status = 'escrow' AND NOT FOUND)) THEN
    RETURN false;
  END IF;
  v_reason := COALESCE(public.direct_accept_block_reason(p_job_id, v_job.offered_to_helper_id),
                       public.helper_accept_block_reason(v_job.offered_to_helper_id));
  IF v_reason IS NULL THEN
    RETURN false;
  END IF;

  INSERT INTO public.instant_book_declines (job_id, helper_id, reason) VALUES (p_job_id, v_job.offered_to_helper_id, 'not_hireable')
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
  -- Never which check failed (a Helpr's ID or payout setup is theirs).
  INSERT INTO public.notifications (user_id, title, message, type, link, job_id) VALUES
    (v_job.offered_to_helper_id, 'Your booking ended',
     'Your booking for "' || v_job.title || '" ended before it was confirmed, so you aren''t booked. Nothing is owed and no strike.',
     'job_updates', '/jobs?job=' || p_job_id::text, p_job_id);
  IF v_job.customer_id IS NOT NULL THEN
    INSERT INTO public.notifications (user_id, title, message, type, link, job_id) VALUES
      (v_job.customer_id, 'Your booking ended',
       COALESCE(v_first, 'Your Helpr') || ' can''t be booked for "' || v_job.title || '" right now, so the booking ended.'
         || CASE WHEN v_job.payment_status = 'held' THEN ' Your card was not charged.' ELSE ' Your payment stays with the job.' END
         || CASE WHEN v_reason IN ('job_date_has_passed', 'job_expired', 'job_not_funded') THEN ''
                 ELSE ' Your job is open again for other Helprs.' END,
       'job_updates', '/posts?job=' || p_job_id::text, p_job_id);
  END IF;
  RETURN true;
END;
$fn$;
REVOKE ALL ON FUNCTION public.instant_book_end_if_unhireable(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.instant_book_end_if_unhireable(uuid) TO service_role;

-- ─── (c) Charged, and the hire was refused in the moment between ───────────
-- card-hold-sweep only. True only the FIRST time for a job (the declines row
-- is the once-marker): the sweep pages ops on true, so one alert per job.
CREATE OR REPLACE FUNCTION public.instant_book_captured_not_hired(p_job_id uuid, p_helper uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_job record;
  v_first text;
  v_marked int;
BEGIN
  SELECT j.customer_id, j.title, j.offered_to_helper_id, j.instant_booked_at, j.direct_offer_status, j.status::text AS status
    INTO v_job
    FROM public.jobs j WHERE j.id = p_job_id FOR UPDATE;
  IF NOT FOUND OR v_job.instant_booked_at IS NULL OR p_helper IS NULL THEN
    RETURN false;
  END IF;
  INSERT INTO public.instant_book_declines (job_id, helper_id, reason) VALUES (p_job_id, p_helper, 'captured_not_hired')
  ON CONFLICT (job_id, helper_id) DO NOTHING;
  GET DIAGNOSTICS v_marked = ROW_COUNT;
  IF v_marked = 0 THEN
    RETURN false;
  END IF;
  -- Only a booking still live is ended and told here; a job a cancel closed
  -- meanwhile is settled by its own cancel path.
  IF v_job.offered_to_helper_id IS NOT DISTINCT FROM p_helper AND v_job.direct_offer_status = 'pending' AND v_job.status = 'open' THEN
    UPDATE public.jobs
       SET offered_to_helper_id = NULL,
           direct_offer_status = NULL,
           direct_offer_expires_at = NULL,
           instant_decline_until = NULL
     WHERE id = p_job_id;
    DELETE FROM public.job_accept_pending WHERE job_id = p_job_id;
    SELECT NULLIF(split_part(COALESCE(public.member_display_name(full_name, NULL), ''), ' ', 1), '') INTO v_first
      FROM public.profiles WHERE user_id = p_helper;
    INSERT INTO public.notifications (user_id, title, message, type, link, job_id) VALUES
      (p_helper, 'Your booking ended',
       'Your booking for "' || v_job.title || '" didn''t go through, so you aren''t booked. Nothing is owed and no strike.',
       'job_updates', '/jobs?job=' || p_job_id::text, p_job_id);
    IF v_job.customer_id IS NOT NULL THEN
      INSERT INTO public.notifications (user_id, title, message, type, link, job_id) VALUES
        (v_job.customer_id, 'Your payment is being returned',
         'We charged your card for "' || v_job.title || '", but ' || COALESCE(v_first, 'your Helpr')
           || '''s booking couldn''t be finished. Your payment is being returned to you, and you''ll hear from us within a day.',
         'financial_alerts', '/posts?job=' || p_job_id::text, p_job_id);
    END IF;
  END IF;
  RETURN true;
END;
$fn$;
REVOKE ALL ON FUNCTION public.instant_book_captured_not_hired(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.instant_book_captured_not_hired(uuid, uuid) TO service_role;

-- ─── (d) The capture failed: one notice to the poster, not two ─────────────
-- instant_book_payment_failed, newest definition 20261101065105_instant_book_booking.sql
-- verbatim except the dedupe lines.
CREATE OR REPLACE FUNCTION public.instant_book_payment_failed(p_job_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_job record;
  v_first text;
  v_told boolean;
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
     'The payment for "' || v_job.title || '" didn''t go through, so you aren''t booked. Nothing is owed and no strike.',
     'job_updates', '/jobs?job=' || p_job_id::text, p_job_id);
  -- Race fix (d): the hold code (failHold -> notifyPosterOnce) already tells
  -- the poster "Your payment didn't go through ... Open the job to pay
  -- again" and marks notified_state 'failed'. Only an untold poster hears it
  -- here, and the marker is then set so the sweep's re-send does not repeat it.
  SELECT h.notified_state = 'failed' INTO v_told FROM public.job_card_holds h WHERE h.job_id = p_job_id FOR UPDATE;
  IF v_job.customer_id IS NOT NULL AND v_told IS NOT TRUE THEN
    INSERT INTO public.notifications (user_id, title, message, type, link, job_id) VALUES
      (v_job.customer_id, 'Your booking didn''t go through',
       'Your card didn''t go through, so ' || COALESCE(v_first, 'your Helpr') || ' isn''t booked for "' || v_job.title
         || '". Nothing was charged. Update your payment to open the job again.',
       'job_updates', '/posts?job=' || p_job_id::text, p_job_id);
    UPDATE public.job_card_holds SET notified_state = 'failed' WHERE job_id = p_job_id;
  END IF;
  RETURN true;
END;
$fn$;
REVOKE ALL ON FUNCTION public.instant_book_payment_failed(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.instant_book_payment_failed(uuid) TO service_role;

-- ─── (f) A cancel during the window tells the booked Helpr ─────────────────
CREATE OR REPLACE FUNCTION public.instant_book_tell_helpr_on_close()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $fn$
BEGIN
  IF OLD.instant_decline_until IS NOT NULL AND OLD.offered_to_helper_id IS NOT NULL
     AND OLD.direct_offer_status = 'pending' AND OLD.status::text = 'open'
     -- A booking only ever stands on a listed job (rpc_instant_book): the gate
     -- every offer notice carries (directOfferWaitsForFunding).
     AND public.job_payment_is_listed(OLD.payment_status)
     AND NEW.status::text = 'cancelled' THEN
    INSERT INTO public.notifications (user_id, title, message, type, link, job_id) VALUES
      (OLD.offered_to_helper_id, 'Booking cancelled',
       '"' || OLD.title || '" was cancelled by the person who posted it, so you aren''t booked. Nothing is owed and no strike.',
       'job_updates', '/jobs?job=' || OLD.id::text, OLD.id);
  END IF;
  RETURN NULL;
END;
$fn$;
REVOKE ALL ON FUNCTION public.instant_book_tell_helpr_on_close() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS instant_book_tell_helpr_on_close ON public.jobs;
CREATE TRIGGER instant_book_tell_helpr_on_close
  AFTER UPDATE OF status ON public.jobs
  FOR EACH ROW EXECUTE FUNCTION public.instant_book_tell_helpr_on_close();

-- ─── (e) The generic decline of a booking is the instant-book decline ──────
-- respond_to_direct_offer, newest definition 20261027185146_card_hold_at_post.sql
-- verbatim except the CMP-4 lines.
CREATE OR REPLACE FUNCTION public.respond_to_direct_offer(p_job_id uuid, p_accept boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_offered_to uuid;
  v_offer_status text;
  v_job_status text;
  v_expires_at timestamptz;
  v_customer uuid;
  v_now timestamptz := now();
  v_reason text;
  v_block text;
  v_done jsonb;
  v_pay text;
BEGIN
  -- Q1185: profile before job, the lock order of accept_job_offer and of the
  -- profiles trigger that completes pending accepts, so a Stripe status write
  -- landing mid-accept is either read fresh here or sees the pending row.
  PERFORM 1 FROM public.profiles WHERE user_id = auth.uid() FOR SHARE;

  -- Lock the job. Serializes against a concurrent poster cancel/reassign and
  -- against the expire_pending_direct_offers sweep.
  SELECT offered_to_helper_id, direct_offer_status, status, direct_offer_expires_at, customer_id, payment_status
    INTO v_offered_to, v_offer_status, v_job_status, v_expires_at, v_customer, v_pay
  FROM public.jobs
  WHERE id = p_job_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'job_not_found';
  END IF;

  -- Authorize on the OFFER, not on job ownership: the caller must be the
  -- helper this job was handed to.
  IF v_offered_to IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'not_your_offer';
  END IF;

  IF v_offer_status IS DISTINCT FROM 'pending' THEN
    RAISE EXCEPTION 'offer_not_pending';
  END IF;

  IF v_job_status IS DISTINCT FROM 'open' THEN
    RAISE EXCEPTION 'job_not_open';
  END IF;

  IF v_expires_at IS NOT NULL AND v_expires_at < v_now THEN
    RAISE EXCEPTION 'offer_expired';
  END IF;

  IF p_accept THEN
    -- Q345: no hire across a block, in either direction. The applications
    -- trigger (C10) would refuse the INSERT below anyway; naming it here gives
    -- the caller a code this RPC owns, and copy for it. Accept branch only:
    -- declining an offer across a block is still allowed.
    IF public.are_users_blocked(auth.uid(), v_customer) THEN
      RAISE EXCEPTION 'applicant_blocked' USING ERRCODE = '42501';
    END IF;

    -- Q1185 (re-review must-fix A, should-fix B): everything the deferred
    -- completion will check is checked now, so nobody is told "thanks" for an
    -- accept that can never complete.
    IF public.is_caller_banned() THEN
      RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
    END IF;
    v_block := public.direct_accept_block_reason(p_job_id, auth.uid());
    IF v_block = 'credential_tier_required' THEN
      RAISE EXCEPTION 'credential_tier_required' USING ERRCODE = '42501';
    ELSIF v_block = 'job_date_has_passed' THEN
      RAISE EXCEPTION 'job_date_has_passed' USING ERRCODE = '42501';
    ELSIF v_block = 'job_expired' THEN
      RAISE EXCEPTION 'job_expired' USING ERRCODE = '42501';
    ELSIF v_block = 'job_not_funded' THEN
      RAISE EXCEPTION 'job_not_funded' USING ERRCODE = '42501';
    ELSIF v_block = 'account_restricted' THEN
      RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
    ELSIF v_block IS NOT NULL THEN
      RAISE EXCEPTION 'offer_not_active';
    END IF;

    -- Q1185 (owner, 2026-10-03: "Same as a regular offer"): the accept needs
    -- payout setup and Stripe ID, as accept_job_offer's does. Unready, the
    -- direct offer stays exactly as it is (open, pending, on its own clock,
    -- the poster told nothing) and the yes is remembered in job_accept_pending;
    -- trg_profiles_complete_pending_accepts completes it once both are done.
    v_reason := public.helper_accept_block_reason(auth.uid());
    IF v_reason = 'helper_unknown' THEN
      RAISE EXCEPTION 'helper_unknown';
    END IF;
    IF v_reason IS NOT NULL THEN
      INSERT INTO public.job_accept_pending (job_id, helper_id)
      VALUES (p_job_id, auth.uid())
      ON CONFLICT (job_id) DO UPDATE
        SET helper_id = EXCLUDED.helper_id, requested_at = now()
        WHERE public.job_accept_pending.helper_id IS DISTINCT FROM EXCLUDED.helper_id;
      RETURN jsonb_build_object('action', 'pending_setup',
                                'missing', to_jsonb(public.helper_accept_missing(auth.uid())));
    END IF;

    -- Q2399: a ready Helpr on a held card: create-payment capture_hold charges
    -- the card first (the job moves to escrow), then this accept is retried.
    -- Read under the row lock taken above.
    IF v_pay = 'held' THEN
      RAISE EXCEPTION 'payment_not_captured' USING ERRCODE = '42501';
    END IF;

    -- Ready: the accept completes now, through the one completion both doors
    -- share (the poster is told "<name> accepted your offer"). NULL means it
    -- did not (the offer moved on between the check and the write): an error,
    -- never an answer the app shows as "Job accepted" (final review #4).
    v_done := public.complete_direct_offer_accept(p_job_id, auth.uid());
    IF v_done IS NULL THEN
      RAISE EXCEPTION 'offer_not_active';
    END IF;
    RETURN v_done;
  END IF;

  -- CMP-4 (20261101071621): declining an instant booking IS the instant-book
  -- decline: its refusals (the window, a capture in flight) and its words
  -- ("can't make it ... not charged"), never the generic "declined your offer".
  IF EXISTS (SELECT 1 FROM public.jobs WHERE id = p_job_id AND instant_decline_until IS NOT NULL) THEN
    RETURN public.rpc_instant_book_decline(p_job_id);
  END IF;

  -- Decline: the offer closes, the job reopens to everyone. `offered_to_helper_id`
  -- is retained so the poster's own card can say who declined
  -- (activityStateLabel reads direct_offer_status = 'declined').
  UPDATE public.jobs
     SET direct_offer_status = 'declined',
         direct_offer_expires_at = NULL
   WHERE id = p_job_id;

  INSERT INTO public.notifications (user_id, title, message, type, link, job_id)
  SELECT customer_id,
         'Offer declined',
         -- Q2131: only a funded job is "open to everyone again".
         CASE WHEN public.job_payment_is_listed(payment_status) THEN
           'Your direct offer for "' || title || '" was declined. The job is open to everyone again.'
         ELSE
           'Your direct offer for "' || title || '" was declined.'
         END,
         'job_updates',
         '/posts?job=' || id::text,
         id
    FROM public.jobs
   WHERE id = p_job_id;

  RETURN jsonb_build_object('action', 'declined');
END;
$function$;
REVOKE ALL ON FUNCTION public.respond_to_direct_offer(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.respond_to_direct_offer(uuid, boolean) TO authenticated;
