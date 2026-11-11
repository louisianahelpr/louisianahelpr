-- F300 (audit 11-10), owner 2026-11-11 morning pop-up: "unpaid jobs stay hidden everywhere; auto-delete unpaid
-- drafts after 24 h (server sweep)."
--
-- Pressing "Continue to payment" creates the job row before Stripe opens. Backing out of Stripe leaves a job that was
-- never paid for: hidden from every feed and from the poster's own lists (activityFilters jobIsUnfundedDraft,
-- NEVER_PAID_STATUSES in src/lib/neverPaidStatuses.ts: 'unpaid', 'abandoned', 'failed'), but kept forever. This sweep
-- deletes such a job once it has sat 24 hours, hourly at :38.
--
-- Deleted ONLY when every one of these holds (conservative on purpose: a row that fails any test is left alone):
--   * payment_status is one of NEVER_PAID_STATUSES (the same set the client hides);
--   * no Stripe payment intent was ever attached (stripe_payment_intent_id IS NULL), so no card was charged, held or
--     even attempted for it; a declined ('failed') attempt keeps its row for the money records;
--   * last touched more than 24 hours ago (updated_at, which is never earlier than created_at): a job checkout expires
--     50 to 60 minutes after it opens (create-payment checkoutExpiresAt, Q770), so no checkout can still complete;
--   * no live Stripe checkout session is stamped on it (stripe_session_id IS NULL, or payment_status 'abandoned',
--     the repo's "no live checkout" test, 20260903055308): the checkout.session.expired webhook clears the session id
--     on an unpaid/failed job, so a job still carrying one is a checkout that may have been PAID with its webhook not
--     landed yet. detect_stuck_payments pages on that shape (and its stuck_payment_checks row cascades with the job),
--     so the sweep must leave it for ops (lh-money-escrow review, 11-11);
--   * nobody was hired or offered it, it is not a repeating job or one visit of one (is_recurring, parent_job_id),
--     no application, no card hold and no gift card row points at it (a gift reserved for the job's shortfall is a
--     foreign key without cascade: excluding it here, not skipping it per row, keeps those rows from filling the
--     500-row batch run after run).
-- Each row is deleted on its own; a row a foreign key still protects is skipped (counted), never forced.
--
-- Replay-safe: CREATE OR REPLACE, cron.schedule by name, ON CONFLICT. Grants by role name (service_role only).
-- Proof: src/test/pglite/sweepUnpaidJobDrafts.pglite.mjs.

CREATE OR REPLACE FUNCTION public.sweep_unpaid_job_drafts(p_now timestamptz DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_now timestamptz := COALESCE(p_now, now());
  v_id uuid;
  v_deleted integer := 0;
  v_skipped integer := 0;
BEGIN
  FOR v_id IN
    SELECT j.id
      FROM public.jobs j
     WHERE j.payment_status IN ('unpaid', 'abandoned', 'failed')
       AND j.stripe_payment_intent_id IS NULL
       AND (j.stripe_session_id IS NULL OR j.payment_status = 'abandoned')
       AND j.updated_at < v_now - interval '24 hours'
       AND j.created_at < v_now - interval '24 hours'
       AND j.helper_id IS NULL
       AND j.offered_to_helper_id IS NULL
       AND j.parent_job_id IS NULL
       AND j.is_recurring IS NOT TRUE
       AND NOT EXISTS (SELECT 1 FROM public.jobs c WHERE c.parent_job_id = j.id)
       AND NOT EXISTS (SELECT 1 FROM public.applications a WHERE a.job_id = j.id)
       AND NOT EXISTS (SELECT 1 FROM public.job_card_holds h WHERE h.job_id = j.id)
       AND NOT EXISTS (SELECT 1 FROM public.gift_cards g WHERE g.job_id = j.id)
     ORDER BY j.created_at
     LIMIT 500
  LOOP
    BEGIN
      -- Re-check at delete time: a payment or a new checkout that landed since the SELECT keeps the row.
      DELETE FROM public.jobs j
       WHERE j.id = v_id
         AND j.payment_status IN ('unpaid', 'abandoned', 'failed')
         AND j.stripe_payment_intent_id IS NULL
         AND (j.stripe_session_id IS NULL OR j.payment_status = 'abandoned');
      IF FOUND THEN v_deleted := v_deleted + 1; END IF;
    EXCEPTION WHEN foreign_key_violation OR restrict_violation THEN
      v_skipped := v_skipped + 1;
    END;
  END LOOP;
  RETURN jsonb_build_object('deleted', v_deleted, 'skipped', v_skipped);
END
$fn$;

COMMENT ON FUNCTION public.sweep_unpaid_job_drafts(timestamptz) IS
  'F300 (owner 2026-11-11): deletes never-paid jobs (unpaid/abandoned/failed, no payment intent, no live checkout session, no gift card, nobody hired, not repeating) untouched for 24 hours. Cron unpaid-job-draft-sweep, hourly at :38.';

REVOKE ALL ON FUNCTION public.sweep_unpaid_job_drafts(timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sweep_unpaid_job_drafts(timestamptz) TO service_role;

-- The cron: hourly at :38.
DO $do$
BEGIN
  IF to_regclass('public.cron_work_expectations') IS NOT NULL THEN
    INSERT INTO public.cron_work_expectations (jobname, expected_max_gap, note, work_visibility, work_exempt_reason)
    VALUES ('unpaid-job-draft-sweep', interval '3 hours',
            'F300: hourly at :38, deletes never-paid jobs (no payment intent, nobody hired, not repeating) untouched for 24 hours.',
            'exempt', 'Most runs find no unpaid job old enough: nothing to delete is the healthy state.')
    ON CONFLICT (jobname) DO UPDATE SET expected_max_gap = EXCLUDED.expected_max_gap, note = EXCLUDED.note,
      work_visibility = EXCLUDED.work_visibility, work_exempt_reason = EXCLUDED.work_exempt_reason;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    PERFORM cron.schedule('unpaid-job-draft-sweep', '38 * * * *',
      $c$SELECT public.cron_record_work('unpaid-job-draft-sweep', to_jsonb(public.sweep_unpaid_job_drafts()));$c$);
  END IF;
END
$do$;
