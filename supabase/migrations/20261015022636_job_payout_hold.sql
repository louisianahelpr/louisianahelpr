-- A payout hold on ONE JOB (docs/OPEN.md Q1491; lh-money-escrow review of
-- Q1417, finding #2).
--
-- A gift-card difference payment whose gift was spent elsewhere (or revoked,
-- or lost a re-claim race) pages "job underfunded", but stripe-webhook still
-- puts the job in escrow, and nothing stopped the payout paths: the Helpr
-- could be paid the full budget from the platform balance before anyone
-- reconciled. Payout holds were per HELPR only (public.payout_holds), and such
-- a job usually has no Helpr yet when the difference is paid.
--
-- Now:
--   * public.job_payout_holds: one row = this job's payout may not be claimed.
--     Server-only (RLS on, no policies, no client grants).
--   * refuse_payout_claim_while_held (BEFORE INSERT ON payout_transfers, the
--     claim every payout path takes before a Stripe transfer) refuses a claim
--     on a held job with the same 'payout_held' refusal the Helpr hold and the
--     ban review use, so every path already answers it as a hold. Restated
--     from its LIVE definition (= 20261006030849; md5(prosrc) read 2026-10-12, re-read 2026-10-15:
--     a7b0c1958994ef1e9b426a72fc434092, still the newest definition on main) with only the job-hold check added.
--   * stripe-webhook places the hold in the "job underfunded" branch.
--   * admin_release_job_payout_hold(job) clears it (an admin, or the SQL
--     editor: no admin screen lists job holds yet), audited, once the job is
--     reconciled. Quick Release, the dispute split and release-payout also ask
--     checkJobPayoutHold (_shared/payoutHold.ts) before their transfer: the
--     first two transfer before writing a ledger row, so the claim trigger
--     cannot stop them.

CREATE TABLE IF NOT EXISTS public.job_payout_holds (
  job_id   uuid PRIMARY KEY REFERENCES public.jobs(id) ON DELETE CASCADE,
  reason   text NOT NULL,
  held_at  timestamptz NOT NULL DEFAULT now(),
  -- NULL: placed by the system (stripe-webhook).
  held_by  uuid
);
ALTER TABLE public.job_payout_holds ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.job_payout_holds FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.job_payout_holds TO service_role;

CREATE OR REPLACE FUNCTION public.refuse_payout_claim_while_held()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_customer uuid;
  v_helper   uuid;
BEGIN
  IF NEW.helper_id IS NOT NULL
     AND NEW.status = 'pending'
     AND NEW.stripe_transfer_id IS NULL
     AND EXISTS (SELECT 1 FROM public.payout_holds h WHERE h.helper_id = NEW.helper_id) THEN
    RAISE EXCEPTION 'payout_held'
      USING ERRCODE = '23514',
            DETAIL = 'This Helpr''s payouts are on hold (public.payout_holds). No transfer may be claimed until an admin releases the hold.';
  END IF;
  -- Q1324: a job whose POSTER or Helpr is under an open ban settlement review
  -- moves no money until an admin decides (the Helpr also has a payout hold;
  -- the poster's counterparty does not, so the job is checked here). The
  -- claim's own recipient too: on a crew job jobs.helper_id is NULL and the
  -- member paid is NEW.helper_id (lh-money-escrow F4, 2026-10-06).
  IF NEW.status = 'pending' AND NEW.stripe_transfer_id IS NULL THEN
    -- FOR KEY SHARE: the parties read are the ones the claim is for, and a
    -- concurrent settlement cannot swap them out from under it.
    SELECT j.customer_id, j.helper_id INTO v_customer, v_helper
      FROM public.jobs j
     WHERE j.id = NEW.job_id
       FOR KEY SHARE;
    IF EXISTS (SELECT 1 FROM public.ban_settlement_queue q
                WHERE q.review_state = 'open' AND q.user_id IN (v_customer, v_helper, NEW.helper_id)) THEN
      RAISE EXCEPTION 'payout_held'
        USING ERRCODE = '23514',
              DETAIL = 'An account on this job is under a ban settlement review (public.ban_settlement_queue). No transfer may be claimed until an admin confirms or lifts it.';
    END IF;
    -- Q1491: a job held on its own (a gift-card difference payment whose gift
    -- was not there any more) pays nobody until an admin reconciles it.
    IF EXISTS (SELECT 1 FROM public.job_payout_holds jh WHERE jh.job_id = NEW.job_id) THEN
      RAISE EXCEPTION 'payout_held'
        USING ERRCODE = '23514',
              DETAIL = 'This job''s payout is on hold (public.job_payout_holds). No transfer may be claimed until an admin releases it.';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.refuse_payout_claim_while_held() FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.admin_release_job_payout_hold(p_job_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_uid    uuid := auth.uid();
  v_reason text;
  v_found  boolean;
BEGIN
  -- An admin, or a server context: the SQL editor (postgres) is how ops
  -- releases a hold today, since no admin screen lists job holds yet
  -- (lh-money-escrow review: an admin-only check refused the SQL editor,
  -- leaving an unaudited DELETE as the only way out).
  IF NOT (public.is_server_context()
          OR (v_uid IS NOT NULL AND COALESCE(public.has_role(v_uid, 'admin'::public.app_role), false))) THEN
    RAISE EXCEPTION 'admin_only' USING ERRCODE = '42501';
  END IF;
  DELETE FROM public.job_payout_holds h WHERE h.job_id = p_job_id
  RETURNING h.reason INTO v_reason;
  v_found := FOUND;
  -- Audited only when a hold was actually cleared.
  IF v_found THEN
    INSERT INTO public.admin_audit_log (admin_id, action, target_id, target_type, details)
    VALUES (v_uid, 'job_payout_hold_released', p_job_id::text, 'job',
            jsonb_build_object('reason', v_reason,
                               'released_by', CASE WHEN v_uid IS NULL THEN 'server (SQL editor or service role)' ELSE 'admin' END));
  END IF;
  RETURN v_found;
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_release_job_payout_hold(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_release_job_payout_hold(uuid) TO authenticated, service_role;
