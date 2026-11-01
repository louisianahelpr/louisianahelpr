-- CMP-4 instant book: the captured-but-not-hired case is refunded in full,
-- automatically, exactly once (lead 2026-11-01, money re-review of
-- 20261101071621:224-244).
--
-- The defect: instant_book_captured_not_hired ended the booking and left the
-- job OPEN with payment_status 'escrow' (still listed). Another Helpr could be
-- hired on that captured money, or the poster's cancel_escrow could refund it
-- while ops refunded it by hand from the page: a double refund.
--
-- Now, in the same locked transaction that ends the booking:
--   * the job is CLOSED FOR REVIEW: status 'cancelled' (off the listing, no
--     apply, no hire, no offer) and payment_status 'cancelling' (the same
--     refund claim cancel_escrow takes; job_payment_is_listed is false, so
--     direct_accept_block_reason answers job_not_funded);
--   * the claim's holder row (job_refund_claims) names 'instant_book_refund'.
--     cancel_escrow re-enters a 'cancelling' job only under its OWN holder
--     row, admin_refund_general claims only from 'escrow', and
--     void-cancelled-payments selects only 'escrow': no other path can refund
--     this money. The edge (supabase/functions/_shared/instantBookRefund.ts,
--     called by card-hold-sweep and by create-payment capture_hold) refunds it
--     in full under one Stripe idempotency key, and then
--     instant_book_refund_finished closes the claim exactly once.
--   * The full refund is OUR mistake (the hold model charges only at a hire,
--     Q2399), so it goes back card fee included: the owner's own-mistake rule
--     (2026-10-14, _shared/refundAmount.ts header).
--
-- Only money the HOLD captured is refunded here: the job_card_holds row must
-- read 'captured' with the same PaymentIntent the job carries. A job paid at
-- post never enters this state.
--
-- PGlite proof: src/test/pglite/instantBookCapturedRefund.pglite.mjs.
-- REPLAY-SAFE: CREATE OR REPLACE, DROP ... IF EXISTS before each ADD.

ALTER TABLE public.job_refund_claims DROP CONSTRAINT IF EXISTS job_refund_claims_claimed_by_check;
ALTER TABLE public.job_refund_claims ADD CONSTRAINT job_refund_claims_claimed_by_check
  CHECK (claimed_by IN ('cancel_escrow', 'admin_refund_general', 'instant_book_refund'));

-- ─── Charged, and the hire was refused in the moment between ───────────────
-- instant_book_captured_not_hired, newest definition
-- 20261101071621_instant_book_decline_race.sql, verbatim except the review
-- state (the job closed, the refund claim) and the poster's words.
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
  v_captured boolean;
BEGIN
  SELECT j.customer_id, j.title, j.offered_to_helper_id, j.instant_booked_at, j.direct_offer_status, j.status::text AS status,
         j.helper_id, j.payment_status, j.stripe_payment_intent_id
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

    -- The money the hold captured for this booking, with nobody hired.
    SELECT EXISTS (
      SELECT 1 FROM public.job_card_holds h
       WHERE h.job_id = p_job_id AND h.state = 'captured'
         AND h.payment_intent_id IS NOT DISTINCT FROM v_job.stripe_payment_intent_id
    ) INTO v_captured;
    v_captured := v_captured AND v_job.payment_status = 'escrow' AND v_job.helper_id IS NULL
                  AND v_job.stripe_payment_intent_id IS NOT NULL;
    IF v_captured THEN
      -- Closed for review, and the refund claim taken, in this one locked
      -- write: nobody can be hired on this money, and only the instant-book
      -- refund can return it.
      UPDATE public.jobs
         SET status = 'cancelled',
             cancelled_at = COALESCE(cancelled_at, now()),
             payment_status = 'cancelling'
       WHERE id = p_job_id AND payment_status = 'escrow' AND helper_id IS NULL;
      INSERT INTO public.job_refund_claims (job_id, claimed_by, actor_user_id, claimed_at)
      VALUES (p_job_id, 'instant_book_refund', NULL, now())
      ON CONFLICT (job_id) DO UPDATE
        SET claimed_by = 'instant_book_refund', actor_user_id = NULL, claimed_at = now();
    END IF;

    SELECT NULLIF(split_part(COALESCE(public.member_display_name(full_name, NULL), ''), ' ', 1), '') INTO v_first
      FROM public.profiles WHERE user_id = p_helper;
    INSERT INTO public.notifications (user_id, title, message, type, link, job_id) VALUES
      (p_helper, 'Your booking ended',
       'Your booking for "' || v_job.title || '" didn''t go through, so you aren''t booked. Nothing is owed and no strike.',
       'job_updates', '/jobs?job=' || p_job_id::text, p_job_id);
    IF v_job.customer_id IS NOT NULL THEN
      INSERT INTO public.notifications (user_id, title, message, type, link, job_id) VALUES
        (v_job.customer_id, CASE WHEN v_captured THEN 'Your payment is being refunded' ELSE 'Your payment is being returned' END,
         'We charged your card for "' || v_job.title || '", but ' || COALESCE(v_first, 'your Helpr')
           || '''s booking couldn''t be finished. '
           || CASE WHEN v_captured
                   THEN 'We closed the job and are refunding your payment in full. You''ll get a notice when the refund is sent.'
                   ELSE 'Your payment is being returned to you, and you''ll hear from us within a day.' END,
         'financial_alerts', '/posts?job=' || p_job_id::text, p_job_id);
    END IF;
  END IF;
  RETURN true;
END;
$fn$;
REVOKE ALL ON FUNCTION public.instant_book_captured_not_hired(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.instant_book_captured_not_hired(uuid, uuid) TO service_role;

-- ─── The refund went out: the claim closes, exactly once ───────────────────
-- service_role only (the edge's instantBookRefund.ts, after Stripe answered
-- the refund). True only the first time: the holder row is the once-marker.
-- The charge.refunded webhook may already have written 'refunded' (it closes
-- 'cancelling'); both orders end the same.
CREATE OR REPLACE FUNCTION public.instant_book_refund_finished(p_job_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_pay text;
  v_gone int;
BEGIN
  SELECT j.payment_status INTO v_pay FROM public.jobs j WHERE j.id = p_job_id FOR UPDATE;
  IF NOT FOUND OR v_pay NOT IN ('cancelling', 'refunded') THEN
    RETURN false;
  END IF;
  DELETE FROM public.job_refund_claims WHERE job_id = p_job_id AND claimed_by = 'instant_book_refund';
  GET DIAGNOSTICS v_gone = ROW_COUNT;
  IF v_gone = 0 THEN
    RETURN false;
  END IF;
  UPDATE public.jobs SET payment_status = 'refunded' WHERE id = p_job_id AND payment_status = 'cancelling';
  RETURN true;
END;
$fn$;
REVOKE ALL ON FUNCTION public.instant_book_refund_finished(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.instant_book_refund_finished(uuid) TO service_role;
