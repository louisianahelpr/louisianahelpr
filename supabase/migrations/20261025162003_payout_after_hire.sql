-- Payout setup moves from sign-up to HIRE (owner decision 2026-10-25, item 9;
-- lead answers 2026-10-25).
--
-- WHY. Stripe rejected 45 of Helpr's 46 live connected accounts as
-- rejected.fraud (GET /v1/accounts, 2026-10-25). Of the 33 linked to a live
-- profile only 3 were ever hired; 22 were created within an hour of sign-up and
-- 24 were created on Oct 21-22 (Louisiana time) by people nobody has hired.
-- The one active account (Yusef's) is the one with real job money. So an
-- account is opened only for someone who has been chosen for a job.
--
-- WHAT THIS MIGRATION DOES
--
-- (1) payout_setup_hire_allowed(member): may this member open (or finish, or
--     reset) a payout account? TRUE only when someone chose them for a job
--     that holds money, or they are already owed or were paid money:
--       - they are the Helpr on a job whose payment is held or later
--         (job_payment_is_funded: escrow, payout_pending, released);
--       - they hold a crew seat on a job whose payment is held or later;
--       - they tapped Accept on an offer that waits on their setup
--         (job_accept_pending: the accept-first flow, switch off) and that
--         job still holds money;
--       - a payout, a cancellation fee (single or crew) or a crew block fee
--         was ever recorded to them (payout_transfers,
--         cancellation_fee_transfers, crew_cancellation_fee_shares,
--         crew_block_fees: written only by the server);
--       - Declutter, Shops or Rentals is on for them (those sections pay a
--         seller or landlord, not a hired Helpr; all three are testers-only
--         today; lead answer 3(i), 2026-10-25).
--     "Funded" is the point: a self-made offer with no money in it never
--     unlocks an account. stripe-connect asks it (service role) before
--     onboard / update_onboarding / reset, for EVERY member (lead answer 2(a):
--     the restrictions ship to everyone, no switch); the App Store review
--     account is exempted there (lead answer 3).
--     payout_setup_hire_allowed_for_me() is the same answer for the caller,
--     so the app hides the setup entry points from someone not hired yet.
--
-- (2) Hidden switch `payout_after_hire`, created TESTERS (lead answer 2(a)).
--     For a member it is on for:
--       - helper_accept_missing() lists NOTHING (payout setup and the ID check
--         both move to after the hire; lead answer 1, owner "ID check + payout
--         setup together at hire"). Every accept path reads that one function
--         (accept_job_offer, respond_to_direct_offer,
--         complete_direct_offer_accept, claim_series_dates,
--         rpc_group_member_confirm, helpr_task_accept,
--         quote_job_funded_hires_quoter, enforce_helper_award_gate and the
--         pending-accept completions; pg_proc read 2026-10-25), so the job goes
--         ahead at once.
--       - The payout still waits for the account, exactly as today:
--         release-payout answers 409 and process-scheduled-payouts
--         `no_connect_account` while there is no account, and readLivePayoutGate
--         holds anything Stripe does not call payable; the job stays
--         payout_pending.
--       - If `identity_check` is on for them too, the ID check now gates the
--         PAYOUT instead of the accept: refuse_payout_claim_while_held refuses
--         the payout_transfers claim (payout_held, 23514) until
--         identity_is_verified. While identity_check is off (prod today) this
--         adds nothing.
--       - claim_payout_setup_reminders() reminds them (in the app and by
--         email, edge function payout-setup-reminders) while payout_setup is
--         also on for them (lead answer 4(a)).
--     For everyone else the accept still waits on setup as it does today.
--
-- (3) connect_account_retirements: the record of a rejected Connect account
--     that stripe-connect replaced with a fresh one for a hired Helpr (lead,
--     2026-10-25: a rejected account must not be a dead end). The old id is
--     kept here (and in payout_transfers) whether or not Stripe let it be
--     deleted, so a balance left on it stays findable. Service role only.
--
-- Replay-safe: ON CONFLICT DO NOTHING (never resets an audience an admin
-- chose), CREATE OR REPLACE restating each function whole from its newest
-- definition (helper_accept_missing 20261023213857,
-- refuse_payout_claim_while_held 20261015022636), CREATE TABLE IF NOT EXISTS,
-- cron.schedule upserts by name and is skipped where pg_cron does not exist.

-- ── (2) the switch ─────────────────────────────────────────────────────────
INSERT INTO public.feature_switches (key, audience, description)
VALUES ('payout_after_hire', 'testers',
        'Payout setup after the hire (owner, 2026-10-25). On = a hired Helpr''s accept goes through at once and payout setup (Stripe''s ID check and bank, one step) comes after: their pay is held until the payout account is ready, the job shows "Finish payout setup to get paid", and reminders go out in the app and by email. Off = the accept waits on payout setup as before. Who may open a payout account at all (only someone hired) does not depend on this switch.')
ON CONFLICT (key) DO NOTHING;

-- ── (1) who may open a payout account ────────────────────────────────────
CREATE OR REPLACE FUNCTION public.payout_setup_hire_allowed(p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT p_user_id IS NOT NULL AND (
       -- the Helpr on a job that holds money
       EXISTS (SELECT 1 FROM public.jobs j
                WHERE j.helper_id = p_user_id
                  AND public.job_payment_is_funded(j.payment_status::text))
       -- a crew seat on a job that holds money
    OR EXISTS (SELECT 1 FROM public.group_job_helpers g
                 JOIN public.jobs j ON j.id = g.job_id
                WHERE g.helper_id = p_user_id
                  AND public.job_payment_is_funded(j.payment_status::text))
       -- an accept that waits on their setup (switch off), on a job that still holds money
    OR EXISTS (SELECT 1 FROM public.job_accept_pending a
                 JOIN public.jobs j ON j.id = a.job_id
                WHERE a.helper_id = p_user_id
                  AND public.job_payment_is_funded(j.payment_status::text))
       -- a cancellation fee owed or paid to them (single or crew), a crew
       -- block fee: server-written money rows, so a poster cannot fake one
       -- (lh-authz-rls #4, lh-money-escrow #2)
    OR EXISTS (SELECT 1 FROM public.cancellation_fee_transfers c WHERE c.helper_id = p_user_id)
    OR EXISTS (SELECT 1 FROM public.crew_cancellation_fee_shares c WHERE c.helper_id = p_user_id)
    OR EXISTS (SELECT 1 FROM public.crew_block_fees c WHERE c.helper_id = p_user_id)
       -- money already recorded to them
    OR EXISTS (SELECT 1 FROM public.payout_transfers t WHERE t.helper_id = p_user_id)
       -- sections that pay a seller or landlord (testers-only today)
    OR public.feature_enabled_for_user('declutter', p_user_id)
    OR public.feature_enabled_for_user('shops', p_user_id)
    OR public.feature_enabled_for_user('rentals', p_user_id)
  );
$fn$;
REVOKE ALL ON FUNCTION public.payout_setup_hire_allowed(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.payout_setup_hire_allowed(uuid) TO service_role;
COMMENT ON FUNCTION public.payout_setup_hire_allowed(uuid) IS
  'May this member open, finish or reset a Stripe payout account? True only when chosen for a job that holds money (Helpr or crew seat), an accept waits on their setup, a payout was recorded to them, or Declutter/Shops/Rentals is on for them (owner 2026-10-25). stripe-connect asks it before onboard/update_onboarding/reset. service_role only.';

CREATE OR REPLACE FUNCTION public.payout_setup_hire_allowed_for_me()
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT COALESCE(public.payout_setup_hire_allowed(auth.uid()), false);
$fn$;
REVOKE ALL ON FUNCTION public.payout_setup_hire_allowed_for_me() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.payout_setup_hire_allowed_for_me() TO authenticated, service_role;
COMMENT ON FUNCTION public.payout_setup_hire_allowed_for_me() IS
  'payout_setup_hire_allowed for the signed-in caller only (no argument, so it answers about nobody else). The app hides the payout setup entry points while it is false.';

-- ── (2) the accept no longer waits on setup while payout_after_hire is on ──
CREATE OR REPLACE FUNCTION public.helper_accept_missing(p_user_id uuid)
RETURNS text[]
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
  SELECT CASE
           WHEN p.user_id IS NULL THEN ARRAY['unknown']
           -- Fixture data stays usable while fixture-shaped AND an enrolled test
           -- account (seed_hidden_for's membership rule).
           WHEN p.is_seed IS TRUE AND p.stripe_account_id IS NULL
                AND EXISTS (SELECT 1 FROM public.test_accounts t WHERE t.user_id = p.user_id) THEN ARRAY[]::text[]
           -- Payout setup and the ID check come AFTER the hire while the
           -- `payout_after_hire` switch is on for this member (owner 2026-10-25):
           -- the accept goes through, the payout waits for the account.
           WHEN public.feature_enabled_for_user('payout_after_hire', p.user_id) THEN ARRAY[]::text[]
           ELSE array_remove(ARRAY[
             CASE WHEN p.stripe_account_id IS NULL OR p.stripe_payouts_enabled IS NOT TRUE THEN 'payout_setup' END,
             -- The ID step only while the `identity_check` switch is on for this member (owner 2026-10-23).
             CASE WHEN public.feature_enabled_for_user('identity_check', p.user_id)
                       AND NOT public.identity_is_verified(p.idv_status, p.stripe_identity_verified) THEN 'stripe_id' END
           ], NULL)
         END
    FROM (SELECT p_user_id AS uid) x
    LEFT JOIN public.profiles p ON p.user_id = x.uid;
$fn$;
-- Grants restated as live (pg_proc.proacl 2026-10-23: postgres + service_role only).
REVOKE ALL ON FUNCTION public.helper_accept_missing(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.helper_accept_missing(uuid) TO service_role;

-- ── (2) the ID check gates the payout instead (only while identity_check is on) ──
CREATE OR REPLACE FUNCTION public.payout_waits_on_identity(p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
  -- identity_check_exempt is TRUE while identity_check is off for the member
  -- (and for a fixture test account), so this is FALSE on prod today.
  SELECT p_user_id IS NOT NULL
     AND public.feature_enabled_for_user('payout_after_hire', p_user_id)
     AND NOT public.identity_check_exempt(p_user_id)
     AND NOT COALESCE((SELECT public.identity_is_verified(p.idv_status, p.stripe_identity_verified)
                         FROM public.profiles p WHERE p.user_id = p_user_id), false);
$fn$;
REVOKE ALL ON FUNCTION public.payout_waits_on_identity(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.payout_waits_on_identity(uuid) TO service_role;

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
  -- Owner 2026-10-25 (payout_after_hire): the ID check comes after the hire,
  -- so while identity_check is on for this Helpr their pay waits for it here
  -- (the accept no longer does). FALSE while identity_check is off.
  IF NEW.helper_id IS NOT NULL
     AND NEW.status = 'pending'
     AND NEW.stripe_transfer_id IS NULL
     AND public.payout_waits_on_identity(NEW.helper_id) THEN
    RAISE EXCEPTION 'payout_held'
      USING ERRCODE = '23514',
            DETAIL = 'This Helpr has not finished the ID check (payout_waits_on_identity). No transfer may be claimed until it is done.';
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

-- ── (2) reminders ledger and claim ───────────────────────────────────────
-- One row per reminder sent to a Helpr: stage 'hired' (right after the hire),
-- 'day1', 'day3', 'day7' (after the 'hired' one), and 'money' once per job
-- whose payout is waiting on them (reminder_key 'money:<job id>').
CREATE TABLE IF NOT EXISTS public.payout_setup_reminders (
  helper_id    uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  reminder_key text NOT NULL,
  stage        text NOT NULL CHECK (stage IN ('hired', 'day1', 'day3', 'day7', 'money')),
  job_id       uuid REFERENCES public.jobs (id) ON DELETE SET NULL,
  claimed_at   timestamptz NOT NULL DEFAULT now(),
  sent_at      timestamptz,
  PRIMARY KEY (helper_id, reminder_key)
);
ALTER TABLE public.payout_setup_reminders ENABLE ROW LEVEL SECURITY;
COMMENT ON TABLE public.payout_setup_reminders IS
  'Payout setup reminders sent to hired Helprs (owner 2026-10-25, switch payout_after_hire). Written only by claim_payout_setup_reminders and the payout-setup-reminders edge function. service_role only; no client policy.';
REVOKE ALL ON TABLE public.payout_setup_reminders FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.payout_setup_reminders TO service_role;

-- Claims at most one reminder per Helpr per run, at most one a day per Helpr,
-- and returns only the rows this call inserted (two overlapping runs can never
-- send the same one). Due only while: payout_after_hire AND payout_setup are on
-- for the Helpr, they are not payout-ready, and they hold a live hire (a job,
-- or crew seat, whose payment is held: escrow or payout_pending). A fixture
-- test account (accept-ready without an account) is never reminded.
CREATE OR REPLACE FUNCTION public.claim_payout_setup_reminders(p_limit integer DEFAULT 100)
RETURNS TABLE (helper_id uuid, reminder_key text, stage text, job_id uuid, job_title text)
LANGUAGE plpgsql
VOLATILE SECURITY DEFINER
SET search_path TO ''
AS $function$
BEGIN
  RETURN QUERY
  WITH hires AS (
    SELECT j.helper_id AS uid, j.id AS jid, j.title AS jtitle, j.payment_status::text AS pay
      FROM public.jobs j
     WHERE j.helper_id IS NOT NULL
       AND j.payment_status::text IN ('escrow', 'payout_pending')
    UNION ALL
    SELECT g.helper_id, j.id, j.title, j.payment_status::text
      FROM public.group_job_helpers g
      JOIN public.jobs j ON j.id = g.job_id
     WHERE j.payment_status::text IN ('escrow', 'payout_pending')
  ),
  helprs AS (
    SELECT DISTINCT h.uid
      FROM hires h
      JOIN public.profiles p ON p.user_id = h.uid
     WHERE (p.stripe_account_id IS NULL OR p.stripe_payouts_enabled IS NOT TRUE)
       AND NOT (p.is_seed IS TRUE AND p.stripe_account_id IS NULL
                AND EXISTS (SELECT 1 FROM public.test_accounts t WHERE t.user_id = p.user_id))
       AND NOT EXISTS (SELECT 1 FROM public.payout_setup_reminders r
                        WHERE r.helper_id = h.uid AND r.claimed_at > now() - interval '20 hours')
       AND public.feature_enabled_for_user('payout_after_hire', h.uid)
       AND public.feature_enabled_for_user('payout_setup', h.uid)
  ),
  due AS (
    SELECT x.uid,
           -- money first: one per job whose payout waits on this Helpr
           (SELECT 'money:' || h.jid::text FROM hires h
             WHERE h.uid = x.uid AND h.pay = 'payout_pending'
               AND NOT EXISTS (SELECT 1 FROM public.payout_setup_reminders r
                                WHERE r.helper_id = x.uid AND r.reminder_key = 'money:' || h.jid::text)
             ORDER BY h.jid LIMIT 1) AS money_key,
           (SELECT r.claimed_at FROM public.payout_setup_reminders r
             WHERE r.helper_id = x.uid AND r.stage = 'hired') AS hired_at,
           (SELECT max(CASE r.stage WHEN 'day1' THEN 1 WHEN 'day3' THEN 2 WHEN 'day7' THEN 3 ELSE 0 END)
              FROM public.payout_setup_reminders r
             WHERE r.helper_id = x.uid AND r.stage IN ('day1', 'day3', 'day7')) AS last_step
      FROM helprs x
  ),
  pick AS (
    SELECT d.uid,
           CASE
             WHEN d.money_key IS NOT NULL THEN d.money_key
             WHEN d.hired_at IS NULL THEN 'hired'
             WHEN d.hired_at <= now() - interval '7 days' AND COALESCE(d.last_step, 0) < 3 THEN 'day7'
             WHEN d.hired_at <= now() - interval '3 days' AND COALESCE(d.last_step, 0) < 2 THEN 'day3'
             WHEN d.hired_at <= now() - interval '1 day'  AND COALESCE(d.last_step, 0) < 1 THEN 'day1'
           END AS rkey
      FROM due d
  ),
  chosen AS (
    SELECT pk.uid, pk.rkey,
           CASE WHEN pk.rkey LIKE 'money:%' THEN 'money' ELSE pk.rkey END AS rstage,
           CASE WHEN pk.rkey LIKE 'money:%' THEN substr(pk.rkey, 7)::uuid
                ELSE (SELECT h.jid FROM hires h WHERE h.uid = pk.uid ORDER BY h.jid LIMIT 1) END AS rjob
      FROM pick pk
     WHERE pk.rkey IS NOT NULL
     ORDER BY pk.uid
     LIMIT GREATEST(COALESCE(p_limit, 100), 0)
  ),
  ins AS (
    INSERT INTO public.payout_setup_reminders (helper_id, reminder_key, stage, job_id)
    SELECT c.uid, c.rkey, c.rstage, c.rjob FROM chosen c
    ON CONFLICT DO NOTHING
    RETURNING public.payout_setup_reminders.helper_id, public.payout_setup_reminders.reminder_key,
              public.payout_setup_reminders.stage, public.payout_setup_reminders.job_id
  )
  SELECT i.helper_id, i.reminder_key, i.stage, i.job_id, j.title
    FROM ins i
    LEFT JOIN public.jobs j ON j.id = i.job_id;
END;
$function$;
REVOKE ALL ON FUNCTION public.claim_payout_setup_reminders(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_payout_setup_reminders(integer) TO service_role;
COMMENT ON FUNCTION public.claim_payout_setup_reminders(integer) IS
  'Payout setup reminders (owner 2026-10-25): claims at most one due reminder per hired, not-yet-payout-ready Helpr (hired, day 1, day 3, day 7, and one per job whose payout waits), at most one a day, while payout_after_hire and payout_setup are on for them; returns only the rows it inserted. service_role only.';

-- ── (3) rejected accounts replaced for a hired Helpr ─────────────────────
CREATE TABLE IF NOT EXISTS public.connect_account_retirements (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  stripe_account_id text NOT NULL,
  replacement_account_id       text NOT NULL,
  reason            text NOT NULL,
  -- 'pending' is written BEFORE the swap (the old id is on record even if the
  -- function dies mid-way; lh-money-escrow #4), then the delete's answer.
  delete_outcome    text NOT NULL CHECK (delete_outcome IN ('pending', 'deleted', 'already_gone', 'delete_refused')),
  delete_error      text,
  created_at        timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.connect_account_retirements ENABLE ROW LEVEL SECURITY;
COMMENT ON TABLE public.connect_account_retirements IS
  'A Stripe Connect account stripe-connect replaced with a fresh one because Stripe rejected it (owner 2026-10-25). The old id stays here (and in payout_transfers) even when Stripe refused the delete, so any balance on it stays findable. service_role only; no client policy.';
REVOKE ALL ON TABLE public.connect_account_retirements FROM PUBLIC, anon, authenticated;
-- Kept: the server may write and then settle a row, never remove one.
REVOKE DELETE, TRUNCATE ON TABLE public.connect_account_retirements FROM service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE public.connect_account_retirements TO service_role;

-- ── schedule + liveness ──────────────────────────────────────────────────
DO $do$
BEGIN
  IF to_regclass('public.cron_work_expectations') IS NOT NULL THEN
    INSERT INTO public.cron_work_expectations (jobname, expected_max_gap, note, work_visibility, work_exempt_reason)
    VALUES ('payout-setup-reminders', interval '2 hours',
            'Owner 2026-10-25: every 15 minutes reminds hired Helprs who have not finished payout setup (right after the hire, day 1, day 3, day 7, and once per job whose payout waits; at most one a day). Behind payout_after_hire and payout_setup.',
            'exempt',
            'No Helpr due, or either switch off, is the healthy state, so a run that sends nothing is not a silent failure. A run that could not claim (PGRST202 included) or could not record what it sent answers 500 through cronResult.')
    ON CONFLICT (jobname) DO UPDATE SET expected_max_gap = EXCLUDED.expected_max_gap, note = EXCLUDED.note,
      work_visibility = EXCLUDED.work_visibility, work_exempt_reason = EXCLUDED.work_exempt_reason;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    PERFORM cron.schedule('payout-setup-reminders', '9-59/15 * * * *', $c$SELECT public.cron_http_tag(q.request_id, 'payout-setup-reminders')
  FROM (
      SELECT net.http_post(timeout_milliseconds := 90000,
        url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'supabase_url' LIMIT 1)
               || '/functions/v1/payout-setup-reminders',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1)
        ),
        body := '{}'::jsonb
      )
) AS q(request_id);$c$);
  END IF;
END
$do$;
