-- Q1891: cancelling a job retires its pending direct offer, and the expiry
-- sweep only ever expires an offer on a job that is still open.
--
-- WHAT WAS BROKEN (read live 2026-10-17, sec-b):
--   * poster_cancel_job sets status = 'cancelled' and never touches
--     direct_offer_status, and no jobs trigger retires a pending offer on a
--     cancel (zzz_jobs_offer_target_gone_retires_offer covers a deleted
--     target, zzz_jobs_reopen_retires_direct_offer a reopen). Two cancelled
--     jobs held direct_offer_status = 'pending'; get_my_pending_direct_offers
--     (filters on direct_offer_status alone) returned them, so the offered
--     Helpr's /jobs showed "Cancelled by the person who posted it" above a
--     live countdown with Decline and Accept Job, and the badge counted it.
--   * expire_pending_direct_offers had no status filter: at the deadline it
--     marked the cancelled job's offer expired and told the poster their
--     cancelled job "is now open to everyone".
--
-- THE FIX, at the one place every cancel passes through:
--   * zzz_jobs_cancel_retires_direct_offer, a BEFORE UPDATE OF status trigger:
--     the UPDATE that cancels a job also moves a pending offer to
--     'withdrawn'. A trigger, not a line in poster_cancel_job, because seven
--     other writers cancel a job (end_recurring_series,
--     end_recurring_series_by_platform, end_series_for_banned_account,
--     rpc_close_test_mode_dispute, rpc_settle_dispute_without_payment,
--     block_user_and_settle, settle_one_off_jobs_for_banned_account) plus
--     service-role edge functions; a per-function line would have to be
--     remembered by each and by every future one
--     (src/test/cancelRetiresDirectOffer.test.ts inventories them).
--     'withdrawn', not 'expired' or 'declined': record_backout_notice turns
--     pending -> declined/expired into a "your Helpr backed out" notice for
--     the poster, which is false when the poster cancelled. Nothing else reads
--     a value other than 'pending' / 'accepted' / 'declined' / 'expired'.
--     The name sorts after trg_hire_columns_rpc_only, so the client gate
--     never sees this write (same arrangement as the two zzz_ siblings).
--   * expire_pending_direct_offers: live body (20261003214350, md5 matched
--     2026-10-17) plus `AND status = 'open'`. Grants restated as they are live
--     (postgres and service_role only).
--   * Backfill: a cancelled job still holding a pending offer is moved to
--     'withdrawn' the same way, so the sweep's new status filter cannot strand
--     one as 'pending' forever.
--
-- Proof: src/test/pglite/cancelRetiresDirectOffer.pglite.mjs (applied 3x:
-- ALL PASS; NEW_MIGRATION=skip, the state on main: FAILs).

CREATE OR REPLACE FUNCTION public.jobs_cancel_retires_direct_offer()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.status::text = 'cancelled'
     AND OLD.status::text IS DISTINCT FROM 'cancelled'
     AND NEW.direct_offer_status = 'pending' THEN
    NEW.direct_offer_status := 'withdrawn';
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.jobs_cancel_retires_direct_offer() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS zzz_jobs_cancel_retires_direct_offer ON public.jobs;
CREATE TRIGGER zzz_jobs_cancel_retires_direct_offer
  BEFORE UPDATE OF status ON public.jobs
  FOR EACH ROW EXECUTE FUNCTION public.jobs_cancel_retires_direct_offer();

-- Live body + `AND status = 'open'` (Q1891).
CREATE OR REPLACE FUNCTION public.expire_pending_direct_offers()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_count integer;
BEGIN
  WITH expired AS (
    UPDATE public.jobs
       SET direct_offer_status = 'expired'
     WHERE direct_offer_status = 'pending'
       AND direct_offer_expires_at IS NOT NULL
       AND direct_offer_expires_at < now()
       -- Q1891: only an offer on a job still open lapses into "open to
       -- everyone". A cancelled job's offer is retired by the cancel itself.
       AND status::text = 'open'
    RETURNING id, customer_id, title
  ), notified AS (
    INSERT INTO public.notifications (user_id, title, message, type, link)
    SELECT customer_id,
           'Direct offer expired',
           'Your offer for "' || title || '" was not accepted in time. The job is now open to everyone.',
           'job_updates',
           '/posts?job=' || id::text
      FROM expired
     WHERE customer_id IS NOT NULL
    RETURNING 1
  ), told AS (
    -- Q1185 (re-review should-fix C): a Helpr who said yes while their setup
    -- was unfinished hears the offer lapsed, with no strike, as a regular
    -- offer's Helpr does (expire_unanswered_offers). The statement's snapshot
    -- still holds the pending rows trg_jobs_clear_accept_pending removes.
    -- Setup can be done and the accept still not complete (the job's date
    -- passed, a block): the copy says which (final review #3).
    INSERT INTO public.notifications (user_id, title, message, type, link, job_id)
    SELECT p.helper_id,
           'You lost a job offer',
           CASE WHEN public.helper_accept_block_reason(p.helper_id) IS NOT NULL
                THEN 'The direct offer for "' || COALESCE(e.title, 'a job')
                       || '" expired before your payout setup and Stripe ID were done, so it went back to everyone. No strike. Finish both so you can accept the next offer.'
                ELSE 'The direct offer for "' || COALESCE(e.title, 'a job')
                       || '" expired before your accept could be completed, so it went back to everyone. No strike.'
           END,
           'expired',
           '/jobs?job=' || e.id::text,
           e.id
      FROM expired e
      JOIN public.job_accept_pending p ON p.job_id = e.id
    RETURNING 1
  )
  SELECT count(*) INTO v_count FROM expired;

  RETURN v_count;
END;
$function$;

REVOKE ALL ON FUNCTION public.expire_pending_direct_offers() FROM PUBLIC, anon, authenticated;

-- Backfill (replay-safe: a second run finds nothing).
UPDATE public.jobs
   SET direct_offer_status = 'withdrawn'
 WHERE status::text = 'cancelled'
   AND direct_offer_status = 'pending';
