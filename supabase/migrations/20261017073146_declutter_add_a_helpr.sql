-- Declutter "Add a Helpr" (owner 2026-10-16; spec docs/specs/declutter-add-a-helpr.md,
-- approved earlier as row 72 "Sold it? Get help" of docs/specs/declutter-auctions.md).
--
-- A buyer who paid for a Declutter item can, in one tap, book a Helpr to put it
-- together, hang it on the wall or set it up at their place. NO new money path:
-- the tap opens Post a Job pre-filled (category assembly or handyman), the buyer
-- confirms and pays through the normal job checkout, and the job is an ordinary
-- Helpr job (escrow, fees, payouts, disputes all unchanged). The only new thing
-- is the LINK between the Declutter order and that job, written right after the
-- post is created (before payment, like link_str_turnover_job, 20261007145950).
--
--   declutter_order_jobs          the link: one row per job, many jobs per order.
--                                 `purpose` says why the job exists ('setup'
--                                 here; Helpr delivery can add its own value).
--                                 No client privilege: read and written only
--                                 through the two functions below.
--   declutter_setup_helpr(order)  the buyer's pre-fill: item titles, booked
--                                 pickup time, and the jobs already linked.
--   declutter_link_setup_job(order, job)
--                                 the buyer links their own open job to their
--                                 own paid order.
--
-- Both are behind Declutter's own switch 'declutter' (like every Declutter RPC,
-- e.g. helpr_set_vehicle, 20261017055505) AND the hidden switch
-- 'declutter_add_helpr' (created 'testers'): either one off refuses
-- (feature_disabled). The link also refuses a banned caller
-- (account_restricted, the is_caller_banned() class check Q281).
-- The offer stands while the order is paid and for 30 days after the handover.
-- Replay-safe: IF NOT EXISTS / CREATE OR REPLACE / ON CONFLICT; grants restated.

INSERT INTO public.feature_switches (key, audience, description)
VALUES ('declutter_add_helpr', 'testers',
        'Declutter "Add a Helpr": after buying, one tap books a Helpr to assemble, wall-mount or set up the item (a normal Helpr job linked to the order)')
ON CONFLICT (key) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.declutter_order_jobs (
  job_id uuid PRIMARY KEY REFERENCES public.jobs(id) ON DELETE CASCADE,
  -- SET NULL, not CASCADE: a seller who deletes their account cascades their
  -- orders away, and the A10 marker below must outlive that, or the sweep
  -- would price a seller-fault cancel by the normal rules (lh-silent-failure
  -- review of c57d948d0 #1). A link with no order offers and links nothing.
  order_id uuid REFERENCES public.declutter_orders(id) ON DELETE SET NULL,
  purpose text NOT NULL CHECK (purpose IN ('setup')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS declutter_order_jobs_order ON public.declutter_order_jobs (order_id);

ALTER TABLE public.declutter_order_jobs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.declutter_order_jobs FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.declutter_order_jobs TO service_role;

COMMENT ON TABLE public.declutter_order_jobs IS
  'A Helpr job booked for a Declutter order (purpose setup = assemble / wall-mount / set up at the buyer''s place). '
  'The job is a normal job paid through the job checkout; this row only links it. Written by declutter_link_setup_job.';

DO $do$
BEGIN
  IF to_regprocedure('public.attach_unconfirmed_email_gate()') IS NOT NULL THEN
    PERFORM public.attach_unconfirmed_email_gate();
  END IF;
END
$do$;

-- The buyer's pre-fill for Post a Job, and what is already booked.
CREATE OR REPLACE FUNCTION public.declutter_setup_helpr(p_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  o public.declutter_orders;
BEGIN
  PERFORM public.require_feature('declutter');
  PERFORM public.require_feature('declutter_add_helpr');
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO o FROM public.declutter_orders
   WHERE id = p_order_id AND buyer_id = v_uid;
  -- A seller who can no longer sell (banned, suspended, 3 strikes, ...:
  -- declutter_seller_out) leaves an order that is about to be refunded:
  -- nothing is offered on it (lh-money-escrow review of 4f45a073f #2).
  IF NOT FOUND OR o.status NOT IN ('paid', 'handed_over')
     OR (o.status = 'handed_over' AND COALESCE(o.handed_over_at, o.paid_at, '-infinity'::timestamptz) < now() - interval '30 days')
     OR public.declutter_seller_out(o.seller_id) THEN
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'P0002';
  END IF;
  RETURN jsonb_build_object(
    'order_id', o.id,
    'status', o.status,
    'handover', o.handover,
    'items', COALESCE((
      SELECT jsonb_agg(i.title ORDER BY c.created_at, i.id)
        FROM public.declutter_cart_items c
        JOIN public.declutter_items i ON i.id = c.item_id
       WHERE c.order_id = o.id AND c.buyer_id = v_uid), '[]'::jsonb),
    'pickup_at', (SELECT b.slot_start FROM public.declutter_bookings b WHERE b.order_id = o.id),
    'jobs', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'job_id', j.id, 'title', j.title, 'category', j.category::text,
               'status', j.status, 'payment_status', j.payment_status)
             ORDER BY l.created_at, j.id)
        FROM public.declutter_order_jobs l
        JOIN public.jobs j ON j.id = l.job_id
       WHERE l.order_id = o.id AND j.customer_id = v_uid), '[]'::jsonb));
END;
$fn$;

REVOKE ALL ON FUNCTION public.declutter_setup_helpr(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_setup_helpr(uuid) TO authenticated, service_role;

-- Link the buyer's own just-posted job to their own paid order. True = linked
-- (or already linked to this order); false = not the caller's paid order, or
-- the job is already linked to another order, or the seller can no longer
-- sell. A job already linked to this order answers true first, whatever its
-- state. A job that is not the caller's own open job RAISES 'not your open
-- job' (42501). A job that is not in a never-paid state (anything but
-- unpaid / abandoned / failed) RAISES
-- 'job_already_funded' (lh-money-escrow review of a98e0049d6): the only caller,
-- useJobSubmit, links right after the job row is created and BEFORE checkout,
-- so a funded job never comes from this flow; refusing it keeps the link to
-- "the job just posted from this order" and stops a buyer pinning an older,
-- already-paid job onto the order card as if it were booked for this item.
-- The link moves no money either way. Any category links: the
-- pre-fill picks assembly or handyman, but a buyer who re-picks the category on
-- Post a Job still gets the link (lh-silent-failure review #1: a category gate
-- lost the link silently and hid the "already booked" warning).
CREATE OR REPLACE FUNCTION public.declutter_link_setup_job(p_order_id uuid, p_job_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_cur uuid;
  v_payment text;
BEGIN
  PERFORM public.require_feature('declutter');
  PERFORM public.require_feature('declutter_add_helpr');
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  -- Already done: the caller's own job, already linked to the caller's own
  -- order. Answered yes BEFORE the job-state checks, because Post a Job links
  -- again before every retry of a payment hand-off whose answer was lost, and
  -- by then the job may be funded (a gift card settles inside the job checkout)
  -- (lh-money-escrow review of 4f45a073f #4, the haul-away rule). Changes
  -- nothing. '=' only: a NULL id never matches.
  IF EXISTS (SELECT 1 FROM public.declutter_order_jobs l
               JOIN public.jobs j ON j.id = l.job_id AND j.customer_id = v_uid
               JOIN public.declutter_orders o ON o.id = l.order_id AND o.buyer_id = v_uid
              WHERE l.job_id = p_job_id AND l.order_id = p_order_id
                FOR SHARE) THEN
    RETURN true;
  END IF;
  -- FOR SHARE: the ownership reads decide the write (race-class rule).
  SELECT j.payment_status INTO v_payment FROM public.jobs j
   WHERE j.id = p_job_id AND j.customer_id = v_uid AND j.status = 'open'
   FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not your open job' USING ERRCODE = '42501';
  END IF;
  -- An ALLOWLIST of never-paid states (lh-money-escrow review of 4f45a073f
  -- #3): anything else (escrow, payout_pending, released, refunded,
  -- cancelling, chargeback, an unknown value) is refused.
  IF COALESCE(v_payment, 'unpaid') NOT IN ('unpaid', 'abandoned', 'failed') THEN
    RAISE EXCEPTION 'job_already_funded' USING ERRCODE = '55000';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.declutter_orders o
                  WHERE o.id = p_order_id AND o.buyer_id = v_uid
                    AND (o.status = 'paid'
                         OR (o.status = 'handed_over' AND COALESCE(o.handed_over_at, o.paid_at, '-infinity'::timestamptz) >= now() - interval '30 days'))
                    -- A seller who can no longer sell: no new link (review #2).
                    AND NOT public.declutter_seller_out(o.seller_id)
                  FOR SHARE) THEN
    RETURN false;
  END IF;
  INSERT INTO public.declutter_order_jobs (job_id, order_id, purpose)
  VALUES (p_job_id, p_order_id, 'setup')
  ON CONFLICT (job_id) DO NOTHING;
  SELECT l.order_id INTO v_cur FROM public.declutter_order_jobs l WHERE l.job_id = p_job_id;
  RETURN v_cur = p_order_id;
END;
$fn$;

REVOKE ALL ON FUNCTION public.declutter_link_setup_job(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_link_setup_job(uuid, uuid) TO authenticated, service_role;

-- A10 (owner rule, 2026-10-17; spec row A10): a Declutter refund that is the
-- SELLER's fault (fee policy full_seller_pays_fee: seller_backed_out,
-- seller_out, seller_no_show, not_as_described) cancels the buyer's linked
-- Helpr setup job with NO cancellation fee and NO strike (it is not the
-- buyer's fault), the job is refunded IN FULL with its card fee
-- (void-cancelled-payments, which reads seller_fault_refund_id), and the card
-- fee Stripe kept on the job's charge becomes the seller's Declutter fee debt
-- (declutter_setup_job_fee_debt, called by that sweep once the refund is out).
-- LEAD DECISION, same day: a first job's one-time $2 account setup fee is NOT
-- refunded (owner's 10-13 rule: never refunded once onboarding is done).
ALTER TABLE public.declutter_order_jobs
  ADD COLUMN IF NOT EXISTS seller_fault_refund_id uuid REFERENCES public.declutter_refunds(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS seller_fault_at timestamptz,
  ADD COLUMN IF NOT EXISTS seller_fee_billed_cents integer CHECK (seller_fee_billed_cents >= 0);

COMMENT ON COLUMN public.declutter_order_jobs.seller_fault_refund_id IS
  'Set when a seller-fault Declutter refund (fee_policy full_seller_pays_fee) cancelled this setup job: '
  'void-cancelled-payments then charges no cancellation fee and returns the card fee, which the seller owes.';
COMMENT ON COLUMN public.declutter_order_jobs.seller_fee_billed_cents IS
  'The job''s card fee added to the seller''s Declutter fee debt (NULL = not billed yet; 0 = nothing to bill). Written once.';

-- The trigger: cancel each linked setup job that is still live. NEVER BLOCKS
-- THE REFUND WRITE: each job's work runs in its own sub-block (one failing job
-- never undoes another's cancel; lh-authz-rls review of c57d948d0 #5), a
-- failure is recorded (log_cron_defect: error_logs, the ops feed) and that job
-- is left as it was for an admin (the haul-away trigger's shape, 20261017070827
-- section 6). lock_timeout 1s: a wait on a job lock fails as a caught 55P03,
-- never as the session's statement timeout, which WHEN OTHERS cannot catch.
-- Left alone: a job that is over (completed, cancelled, disputed), one the
-- Helpr already marked done (the buyer approves or disputes it, as
-- poster_cancel_job rules), and a crew job (its fee ledger is per member:
-- logged for an admin to settle by hand).
-- A seller NO-SHOW is the one seller-fault reason the BUYER asserts alone
-- (declutter_report_no_show needs only the booked time + 15 minutes; no
-- rebuttal), so it is never a free late cancel (lh-authz-rls review of
-- c57d948d0 #1, HIGH): on 'seller_no_show' a job whose Helpr is COMMITTED
-- (hired and confirmed: the case poster_cancel_job would charge a fee and
-- strike) is logged for an admin to decide and left under the normal job
-- rules; an uncommitted one (no fee under the normal rules either) is
-- cancelled. The reasons the buyer cannot assert (seller_backed_out,
-- seller_out, not_as_described: an admin's decision) cancel any live job.
-- The cancel itself is poster_cancel_job's write (app.sanctioned_cancel,
-- restored to what it was afterwards, review #3), with cancelled_by NULL, fee
-- 0, not late, and no apply_cancellation_violation_consequence: no strike.
CREATE OR REPLACE FUNCTION public.declutter_apply_seller_fault(p_refund_id uuid, p_include_committed boolean DEFAULT false)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
SET lock_timeout TO '1s'
AS $fn$
DECLARE
  rf public.declutter_refunds;
  r record;
  j record;
  v_n integer := 0;
  v_src text;
  v_prev text := COALESCE(current_setting('app.sanctioned_cancel', true), 'off');
  -- The words for what the seller did (review #7): one phrase, every notice.
  v_why text;
BEGIN
  SELECT * INTO rf FROM public.declutter_refunds x WHERE x.id = p_refund_id;
  IF NOT FOUND OR rf.fee_policy IS DISTINCT FROM 'full_seller_pays_fee' THEN
    RAISE EXCEPTION 'not_seller_fault' USING ERRCODE = 'P0002';
  END IF;
  v_src := 'declutter_apply_seller_fault' || CASE WHEN rf.is_seed THEN '-seed' ELSE '' END;
  IF rf.order_id IS NULL THEN
    -- The order is gone (an account deletion): its links can no longer be
    -- found from the refund; say so instead of answering 0 (lh-silent-failure
    -- re-review of 24b71630a R2).
    RAISE EXCEPTION 'order_gone' USING ERRCODE = 'P0002',
      HINT = 'The refund''s order was deleted: settle its setup jobs by hand.';
  END IF;
  v_why := CASE rf.reason
    WHEN 'seller_no_show' THEN 'the seller did not show up for the pickup'
    WHEN 'not_as_described' THEN 'the item was not as described'
    WHEN 'seller_out' THEN 'the seller can no longer sell'
    ELSE 'the seller backed out' END;
  BEGIN
  FOR r IN
    SELECT l.job_id FROM public.declutter_order_jobs l
     WHERE l.order_id = rf.order_id AND l.purpose = 'setup' AND l.seller_fault_refund_id IS NULL
     ORDER BY l.job_id
  LOOP
    BEGIN
      SELECT jb.id, jb.title, jb.status::text AS status, jb.helper_id, jb.customer_id, jb.helper_completed_at,
             COALESCE(jb.is_group_job, false) AS crew,
             (jb.helper_id IS NOT NULL AND jb.helper_confirmed_at IS NOT NULL) AS committed
             , COALESCE(jb.payment_status::text, 'unpaid') AS pay
        INTO j FROM public.jobs jb WHERE jb.id = r.job_id FOR UPDATE;
      IF NOT FOUND OR j.status IN ('cancelled', 'completed') THEN
        CONTINUE;
      END IF;
      IF j.status NOT IN ('open', 'accepted', 'in_progress', 'revision_requested')
         OR j.helper_completed_at IS NOT NULL THEN
        -- Done, disputed or awaiting approval for an item the seller failed to
        -- deliver: worth a look, never a silent skip (review #6).
        PERFORM public.log_cron_defect(v_src, r.job_id::text,
          format('setup job %s (%s%s) of seller-fault Declutter refund %s was left as it is: an admin decides', r.job_id, j.status,
                 CASE WHEN j.helper_completed_at IS NOT NULL THEN ', marked done' ELSE '' END, rf.id));
        CONTINUE;
      END IF;
      -- Only a job whose money is at rest (never paid, or held in escrow): one
      -- mid-cancel ('cancelling'), in a chargeback or anything else is left
      -- for an admin (lh-money-escrow review of c57d948d0 #7).
      IF j.pay NOT IN ('unpaid', 'abandoned', 'failed', 'escrow') THEN
        PERFORM public.log_cron_defect(v_src, r.job_id::text,
          format('setup job %s (payment %s) of seller-fault Declutter refund %s was not cancelled: an admin decides', r.job_id, j.pay, rf.id));
        CONTINUE;
      END IF;
      IF j.crew THEN
        PERFORM public.log_cron_defect(v_src, r.job_id::text,
          format('crew setup job %s of seller-fault Declutter refund %s was not cancelled (a crew''s fee ledger is per member): settle it by hand (no fee, card fee to the seller)', r.job_id, rf.id));
        CONTINUE;
      END IF;
      IF rf.reason = 'seller_no_show' AND j.committed AND NOT p_include_committed THEN
        PERFORM public.log_cron_defect(v_src, r.job_id::text,
          format('setup job %s has a committed Helpr and its Declutter order was refunded on the buyer''s seller-no-show report (refund %s): not cancelled; normal job rules apply unless an admin runs declutter_admin_apply_seller_fault(%s, true)', r.job_id, rf.id, rf.id));
        -- The buyer is told it is still booked and being looked at (re-review note).
        PERFORM public.declutter_notify(j.customer_id, 'info', 'Your Helpr job is still booked',
          format('Your Declutter order was refunded, but "%s" still has a Helpr booked. We are reviewing it; until then the normal job rules apply.', COALESCE(j.title, 'your setup job')),
          '/jobs?job=' || r.job_id::text);
        CONTINUE;
      END IF;
      PERFORM set_config('app.sanctioned_cancel', 'on', true);
      PERFORM set_config('app.declutter_seller_fault_cancel', 'on', true);
      UPDATE public.jobs
         SET status = 'cancelled',
             cancelled_by = NULL,
             cancelled_at = now(),
             cancellation_reason = format('On the Declutter order this job was booked for, %s, so it was cancelled with no fee.', v_why),
             late_cancellation = false,
             cancellation_fee = 0,
             cancellation_fee_status = NULL
       WHERE id = r.job_id;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'setup_job_not_cancelled' USING ERRCODE = '55000';
      END IF;
      PERFORM set_config('app.declutter_seller_fault_cancel', 'off', true);
      PERFORM set_config('app.sanctioned_cancel', v_prev, true);
      UPDATE public.declutter_order_jobs
         SET seller_fault_refund_id = rf.id, seller_fault_at = now()
       WHERE job_id = r.job_id AND seller_fault_refund_id IS NULL;
      v_n := v_n + 1;
      PERFORM public.declutter_notify(j.customer_id, 'info', 'Setup job cancelled, no fee',
        format('On your Declutter order, %s, so "%s" was cancelled. There is no cancellation fee, and anything you paid for it comes back in full (the one-time account setup fee excepted).', v_why, COALESCE(j.title, 'your setup job')),
        '/jobs?job=' || r.job_id::text);
      PERFORM public.declutter_notify(j.helper_id, 'warning', 'Job cancelled',
        format('"%s" was cancelled: on the Declutter order it was booked for, %s. It was not the poster''s choice, so no cancellation fee applies.', COALESCE(j.title, 'A job'), v_why),
        '/jobs?job=' || r.job_id::text);
    EXCEPTION WHEN OTHERS THEN
      -- The refund must land: record why this setup job was not cancelled.
      PERFORM public.log_cron_defect(v_src, r.job_id::text,
        format('could not cancel setup job %s of seller-fault Declutter refund %s: %s (%s); retry with declutter_admin_apply_seller_fault(%s)', r.job_id, rf.id, SQLERRM, SQLSTATE, rf.id));
    END;
  END LOOP;
  EXCEPTION WHEN OTHERS THEN
    -- Even the list of linked jobs could not be read: the refund still lands.
    PERFORM public.log_cron_defect(v_src, rf.id::text,
      format('could not read the setup jobs of seller-fault Declutter refund %s: %s (%s)', rf.id, SQLERRM, SQLSTATE));
  END;
  RETURN v_n;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_apply_seller_fault(uuid, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_apply_seller_fault(uuid, boolean) TO service_role;

CREATE OR REPLACE FUNCTION public.declutter_refund_cancels_setup_jobs()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
BEGIN
  BEGIN
    PERFORM public.declutter_apply_seller_fault(NEW.id, false);
  EXCEPTION WHEN OTHERS THEN
    -- The refund must land, whatever happens to its setup jobs.
    PERFORM public.log_cron_defect(
      'declutter_refund_cancels_setup_jobs' || CASE WHEN NEW.is_seed THEN '-seed' ELSE '' END, NEW.id::text,
      format('could not apply seller-fault Declutter refund %s to its setup jobs: %s (%s); retry with declutter_admin_apply_seller_fault(%s)', NEW.id, SQLERRM, SQLSTATE, NEW.id));
  END;
  RETURN NULL;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_refund_cancels_setup_jobs() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_refund_cancels_setup_jobs() TO service_role;

-- The admin's (and the server's) way to apply A10 by hand: after a logged
-- failure (lock timeout, a refused write), or, with p_include_committed, to a
-- committed Helpr's job on a buyer-reported no-show once an admin has checked
-- it (lh-money-escrow review of c57d948d0 #2). Idempotent: a job already
-- marked is skipped. A crew job is still left (its fee ledger is per member).
-- Returns how many jobs it cancelled.
CREATE OR REPLACE FUNCTION public.declutter_admin_apply_seller_fault(p_refund_id uuid, p_include_committed boolean DEFAULT false)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_n integer;
BEGIN
  IF NOT (public.is_server_context() OR (v_uid IS NOT NULL AND public.has_role(v_uid, 'admin'::app_role))) THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  IF p_refund_id IS NULL THEN
    RAISE EXCEPTION 'not_seller_fault' USING ERRCODE = 'P0002';
  END IF;
  v_n := public.declutter_apply_seller_fault(p_refund_id, COALESCE(p_include_committed, false));
  IF v_uid IS NOT NULL THEN
    INSERT INTO public.admin_audit_log (admin_id, action, target_type, target_id, details)
    VALUES (v_uid, 'declutter_apply_seller_fault', 'declutter_refund', p_refund_id::text,
            jsonb_build_object('include_committed', COALESCE(p_include_committed, false), 'cancelled', v_n));
  END IF;
  RETURN v_n;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_admin_apply_seller_fault(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_admin_apply_seller_fault(uuid, boolean) TO authenticated, service_role;

-- The Helpr's back-out email (record_backout_notice, restated from its newest
-- definition, 20261008205730, with one early return) is skipped for A10's own
-- cancel: it read the cancel as the poster's ("<name> cancelled"), while the
-- notice above says it was not the poster's choice. Only that write sets the
-- flag, and clears it again right after.
CREATE OR REPLACE FUNCTION public.record_backout_notice()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_kind text;
  v_recipient uuid;
  v_actor uuid;
  v_actor_name text;
  v_link text;
  v_text record;
BEGIN
  IF OLD.is_group_job IS TRUE OR OLD.parent_job_id IS NOT NULL THEN
    RETURN NULL;
  END IF;
  -- A10 (20261017073146): a setup job the Declutter seller's backing out
  -- cancelled is not the poster's cancel; declutter_refund_cancels_setup_jobs
  -- tells the Helpr itself, in the right words (lh-silent-failure review of
  -- c57d948d0 #2: this said "<poster> cancelled").
  IF COALESCE(current_setting('app.declutter_seller_fault_cancel', true), '') = 'on' THEN
    RETURN NULL;
  END IF;

  IF OLD.helper_id IS NOT NULL AND NEW.helper_id IS NULL
     AND OLD.status::text IN ('accepted', 'in_progress') AND NEW.status::text = 'open' THEN
    -- The booked (or offered) Helpr is off the job and it reopened.
    v_recipient := OLD.customer_id;
    v_actor := OLD.helper_id;
    v_kind := CASE
      WHEN COALESCE(current_setting('app.repost_unconfirmed', true), '') = '1' THEN 'helper_unconfirmed'
      WHEN OLD.helper_confirmed_at IS NOT NULL THEN 'helper_cancelled'
      WHEN auth.uid() IS NOT DISTINCT FROM OLD.helper_id THEN 'offer_declined'
      ELSE 'offer_expired' END;
  ELSIF OLD.direct_offer_status = 'pending' AND NEW.direct_offer_status IN ('declined', 'expired')
     AND OLD.offered_to_helper_id IS NOT NULL THEN
    v_recipient := OLD.customer_id;
    v_actor := OLD.offered_to_helper_id;
    v_kind := CASE WHEN NEW.direct_offer_status = 'declined' THEN 'offer_declined' ELSE 'offer_expired' END;
  ELSIF NEW.status::text = 'cancelled' AND OLD.status::text IN ('accepted', 'in_progress')
     AND OLD.helper_id IS NOT NULL AND NEW.cancelled_by IS DISTINCT FROM OLD.helper_id THEN
    v_recipient := OLD.helper_id;
    v_actor := COALESCE(NEW.cancelled_by, OLD.customer_id);
    v_kind := 'poster_cancelled';
  ELSE
    RETURN NULL;
  END IF;

  IF v_recipient IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT NULLIF(split_part(btrim(p.full_name), ' ', 1), '') INTO v_actor_name
    FROM public.profiles p WHERE p.user_id = v_actor;

  INSERT INTO public.backout_notices (job_id, user_id, actor_name, backout_kind)
  VALUES (OLD.id, v_recipient, v_actor_name, v_kind);

  v_link := CASE WHEN v_recipient = OLD.customer_id THEN '/posts?job=' ELSE '/jobs?job=' END || OLD.id::text;
  SELECT * INTO v_text FROM public.backout_notice_text(v_kind, v_actor_name, OLD.title);
  PERFORM public.send_backout_email(v_recipient, OLD.id, v_text.title, v_text.message, v_link);
  RETURN NULL;
END;
$fn$;
REVOKE ALL ON FUNCTION public.record_backout_notice() FROM PUBLIC, anon, authenticated;


DROP TRIGGER IF EXISTS trg_declutter_refund_cancels_setup_jobs ON public.declutter_refunds;
CREATE TRIGGER trg_declutter_refund_cancels_setup_jobs
  AFTER INSERT ON public.declutter_refunds
  FOR EACH ROW
  WHEN (NEW.fee_policy = 'full_seller_pays_fee')
  EXECUTE FUNCTION public.declutter_refund_cancels_setup_jobs();

-- The seller's share: the card fee Stripe kept on a seller-fault-cancelled
-- setup job's charge, added to the seller's debt for that Declutter refund
-- (one debt row per refund, refund_id UNIQUE: created when the refund itself
-- booked no fee, else increased). Billed ONCE per job (seller_fee_billed_cents
-- under FOR UPDATE): a re-run answers 0 and changes nothing. Never more than
-- the job's whole charge. Service role only: void-cancelled-payments calls it
-- after the job's refund succeeded, with actualOrEstimatedFeeCents.
-- RAISES not_seller_fault (P0002) for a job no seller-fault refund cancelled,
-- invalid_fee (22023) for a NULL or negative amount.
CREATE OR REPLACE FUNCTION public.declutter_setup_job_fee_debt(p_job_id uuid, p_card_fee_cents integer)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  l record;
  v_seller uuid;
  v_cap integer;
  v_fee integer;
  v_seed boolean;
BEGIN
  IF p_card_fee_cents IS NULL OR p_card_fee_cents < 0 THEN
    RAISE EXCEPTION 'invalid_fee' USING ERRCODE = '22023';
  END IF;
  SELECT x.job_id, x.seller_fault_refund_id, x.seller_fee_billed_cents INTO l
    FROM public.declutter_order_jobs x WHERE x.job_id = p_job_id FOR UPDATE;
  IF NOT FOUND OR l.seller_fault_refund_id IS NULL THEN
    RAISE EXCEPTION 'not_seller_fault' USING ERRCODE = 'P0002';
  END IF;
  IF l.seller_fee_billed_cents IS NOT NULL THEN
    RETURN 0;
  END IF;
  SELECT ceil((COALESCE(jb.budget, 0) + COALESCE(jb.customer_fee_amount, 0) + COALESCE(jb.sales_tax_amount, 0)
               + COALESCE(jb.urgent_fee, 0) + COALESCE(jb.onboarding_fee_amount, 0)) * 100)::integer
    INTO v_cap FROM public.jobs jb WHERE jb.id = p_job_id FOR SHARE;
  v_fee := least(p_card_fee_cents, COALESCE(v_cap, 0));
  SELECT o.seller_id INTO v_seller
    FROM public.declutter_refunds r JOIN public.declutter_orders o ON o.id = r.order_id
   WHERE r.id = l.seller_fault_refund_id;
  SELECT r.is_seed INTO v_seed FROM public.declutter_refunds r WHERE r.id = l.seller_fault_refund_id;
  IF v_seller IS NULL AND v_fee > 0 THEN
    -- The seller (and their order) is gone: nothing to bill, so the platform
    -- keeps the cost; said out loud, never silent (lh-silent-failure review #8).
    PERFORM public.log_cron_defect('declutter_setup_job_fee_debt' || CASE WHEN v_seed THEN '-seed' ELSE '' END, p_job_id::text,
      format('setup job %s: the seller of seller-fault Declutter refund %s is gone, so its %s-cent card fee could not be billed (the platform absorbs it)',
             p_job_id, l.seller_fault_refund_id, v_fee));
    v_fee := 0;
  END IF;
  IF v_fee > 0 THEN
    INSERT INTO public.declutter_seller_fee_debts AS d (seller_id, refund_id, amount_cents, remaining_cents)
    VALUES (v_seller, l.seller_fault_refund_id, v_fee, v_fee)
    ON CONFLICT (refund_id) DO UPDATE
      SET amount_cents = d.amount_cents + EXCLUDED.amount_cents,
          remaining_cents = d.remaining_cents + EXCLUDED.remaining_cents;
    PERFORM public.declutter_notify(v_seller, 'info', 'Card fee added',
      format('The buyer''s Helpr setup job for a Declutter order refunded on you was refunded in full. Its $%s card fee is added to what you owe; it comes out of your next Declutter payout.',
             to_char(v_fee / 100.0, 'FM999999990.00')),
      '/declutter?view=mine');
  END IF;
  UPDATE public.declutter_order_jobs SET seller_fee_billed_cents = v_fee WHERE job_id = p_job_id;
  RETURN v_fee;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_setup_job_fee_debt(uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_setup_job_fee_debt(uuid, integer) TO service_role;
