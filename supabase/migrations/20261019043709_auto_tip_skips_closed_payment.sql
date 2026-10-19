-- An automatic tip is never charged on a job whose payment was taken back.
--
-- THE GAP. auto_tip_candidates() (20260925154606) offered every job with
-- status = 'completed' for 14 days, and auto-tip-charge charges the poster's
-- card off-session for each candidate. But a completed job's status never
-- changes when its money goes back:
--   * a card chargeback on a released job (stripe-webhook
--     chargeDisputeCreated) moves payment_status to 'chargeback' and leaves
--     status = 'completed';
--   * a full refund made in the Stripe Dashboard (charge.refunded) moves it to
--     'refunded', status unchanged;
--   * a decided dispute settled without payment moves it to 'cancelled'
--     ("Closed, no payment", Q337), status unchanged;
--   * a card inquiry or an internal dispute marks dispute_status /
--     has_active_dispute, status unchanged.
-- Each of those stayed a chargeable candidate, so a poster who had just charged
-- back or been refunded could be charged a tip by the next hourly tick (a tip held by
-- a payout hold or a ban review waits inside the window, so this is not only a
-- same-hour race). Measured on prod 2026-10-19 ~04:30Z: tips holds 0 rows and
-- no completed job is in any of those states (completed: payout_pending 17,
-- released 2; one completed job carries dispute_status 'auto_resolved'), so
-- nothing was charged wrongly; the gap was latent.
--
-- THE RULE: auto_tip_job_state(job) answers 'chargeable', 'held' or 'closed'
-- (one CASE, written out INLINE as the tip_state column of both arms of
-- auto_tip_candidates and in auto_tip_job_state, the edge function's re-check;
-- the guard src/test/cronJobNotificationsCheckJobStatus.test.ts holds the
-- three copies equal; lead re-review of wip/reds-1019-9, 2026-10-19):
--   'closed'  the money for the work went back, or never stayed:
--             * status is not 'completed', or
--             * the payment is not held or paid out: job_payment_is_funded()
--               (escrow / payout_pending / released; refunded, chargeback,
--               cancelled, cancelling, failed, abandoned and unpaid all fail
--               it, and so does any value added later), or
--             * a payment_refunds row for the job (by job_id, OR by its
--               PaymentIntent: a Dashboard partial refund can be written with
--               no job_id) other than the corrections that are not money for
--               THIS work: 'duplicate_onboarding_fee' and 'duplicate_funding'
--               (a second payment returned) and 'crew_unfilled_refund' (the
--               unbought slots of a crew). This is the check a payment_status
--               read cannot make: a FULL refund from the Stripe Dashboard on a
--               'released' job leaves payment_status 'released'
--               (stripe-webhook chargeRefunded never overwrites 'released'; it
--               pages ops and writes the payment_refunds row). A partial
--               refund (an admin's refund, a dispute split) closes it too.
--   'held'    a LIVE dispute: has_active_dispute, or dispute_status open /
--             escalated / stripe_chargeback / reversal_hold / dispute_lost. A
--             SETTLED dispute (resolved, auto_resolved, withdrawn, ...) does
--             not hold the tip.
--   'chargeable' otherwise.
-- auto-tip-charge acts on the state (it never skips silently):
--   'closed'  records a 'failed' auto tips row (which ends the candidacy) and
--             tells the poster; nothing is charged;
--   'held'    stays a candidate, like a payout hold, and on the window's last
--             day is recorded and the poster told;
--   'chargeable' is claimed, and asked AGAIN (auto_tip_job_state, uncached)
--             after every other read, right before the card is charged; any
--             other answer releases the claim and charges nothing.
--
-- auto_tip_candidates is restated from 20260925154606 verbatim except for the
-- tip_state column in each arm; a new OUT column cannot be added by CREATE OR
-- REPLACE, so it is dropped first (DROP ... IF EXISTS: replay-safe). Grants as
-- before (REVOKE FROM PUBLIC, anon, authenticated; service_role through the
-- default ACL); auto_tip_job_state is service_role only. job_payment_is_funded
-- exists since 20260907060556, payment_refunds since 20260704120000.

CREATE OR REPLACE FUNCTION public.auto_tip_job_state(p_job_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE((
    SELECT CASE
      WHEN j.status <> 'completed'::job_status
        OR NOT public.job_payment_is_funded(j.payment_status)
        OR EXISTS (
          SELECT 1 FROM public.payment_refunds r
           WHERE (r.job_id = j.id
                  OR (j.stripe_payment_intent_id IS NOT NULL AND r.stripe_payment_intent_id = j.stripe_payment_intent_id))
             AND r.source NOT IN ('duplicate_onboarding_fee', 'duplicate_funding', 'crew_unfilled_refund')
        )
        THEN 'closed'
      WHEN j.has_active_dispute IS TRUE
        OR COALESCE(j.dispute_status, '') IN ('open', 'escalated', 'stripe_chargeback', 'reversal_hold', 'dispute_lost')
        THEN 'held'
      ELSE 'chargeable'
    END
      FROM public.jobs j
     WHERE j.id = p_job_id
  ), 'closed');
$$;

REVOKE ALL ON FUNCTION public.auto_tip_job_state(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.auto_tip_job_state(uuid) TO service_role;

DROP FUNCTION IF EXISTS public.auto_tip_candidates(integer);

CREATE OR REPLACE FUNCTION public.auto_tip_candidates(_since_hours integer DEFAULT 336)
RETURNS TABLE (
  job_id uuid,
  customer_id uuid,
  helper_id uuid,
  budget numeric,
  tip_amount numeric,
  tip_state text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT j.id, j.customer_id, j.helper_id, j.budget,
         public.resolve_auto_tip(j.customer_id, j.budget),
         CASE
      WHEN j.status <> 'completed'::job_status
        OR NOT public.job_payment_is_funded(j.payment_status)
        OR EXISTS (
          SELECT 1 FROM public.payment_refunds r
           WHERE (r.job_id = j.id
                  OR (j.stripe_payment_intent_id IS NOT NULL AND r.stripe_payment_intent_id = j.stripe_payment_intent_id))
             AND r.source NOT IN ('duplicate_onboarding_fee', 'duplicate_funding', 'crew_unfilled_refund')
        )
        THEN 'closed'
      WHEN j.has_active_dispute IS TRUE
        OR COALESCE(j.dispute_status, '') IN ('open', 'escalated', 'stripe_chargeback', 'reversal_hold', 'dispute_lost')
        THEN 'held'
      ELSE 'chargeable'
    END
  FROM public.jobs j
  JOIN public.profiles p ON p.user_id = j.customer_id
  WHERE j.status = 'completed'::job_status
    AND j.helper_id IS NOT NULL
    AND p.auto_tip_mode <> 'off'
    AND p.auto_tip_enabled_at IS NOT NULL
    AND j.completed_at >= p.auto_tip_enabled_at
    AND j.completed_at > now() - make_interval(hours => _since_hours)
    AND public.resolve_auto_tip(j.customer_id, j.budget) > 0
    AND NOT EXISTS (
      SELECT 1 FROM public.tips t
      WHERE t.job_id = j.id AND t.source = 'auto'
    )
  UNION ALL
  -- A crew (Q407): one candidate per hired member, their slot's part of the tip.
  SELECT j.id, j.customer_id, g.helper_id,
         round(COALESCE(g.share_cents, 0) / 100.0, 2),
         round(public.crew_slot_share_cents(
           round(public.resolve_auto_tip(j.customer_id, j.budget) * 100)::bigint,
           GREATEST(COALESCE(j.helpers_needed, 1), 1),
           COALESCE(g.slot_no, 0)) / 100.0, 2),
         CASE
      WHEN j.status <> 'completed'::job_status
        OR NOT public.job_payment_is_funded(j.payment_status)
        OR EXISTS (
          SELECT 1 FROM public.payment_refunds r
           WHERE (r.job_id = j.id
                  OR (j.stripe_payment_intent_id IS NOT NULL AND r.stripe_payment_intent_id = j.stripe_payment_intent_id))
             AND r.source NOT IN ('duplicate_onboarding_fee', 'duplicate_funding', 'crew_unfilled_refund')
        )
        THEN 'closed'
      WHEN j.has_active_dispute IS TRUE
        OR COALESCE(j.dispute_status, '') IN ('open', 'escalated', 'stripe_chargeback', 'reversal_hold', 'dispute_lost')
        THEN 'held'
      ELSE 'chargeable'
    END
  FROM public.jobs j
  JOIN public.profiles p ON p.user_id = j.customer_id
  JOIN public.group_job_helpers g ON g.job_id = j.id AND g.helper_id IS NOT NULL
  WHERE j.status = 'completed'::job_status
    AND j.is_group_job IS TRUE
    AND p.auto_tip_mode <> 'off'
    AND p.auto_tip_enabled_at IS NOT NULL
    AND j.completed_at >= p.auto_tip_enabled_at
    AND j.completed_at > now() - make_interval(hours => _since_hours)
    AND public.resolve_auto_tip(j.customer_id, j.budget) > 0
    AND NOT EXISTS (
      SELECT 1 FROM public.tips t
      WHERE t.job_id = j.id AND t.helper_id = g.helper_id AND t.source = 'auto'
    );
$$;

REVOKE ALL ON FUNCTION public.auto_tip_candidates(integer) FROM PUBLIC, anon, authenticated;
