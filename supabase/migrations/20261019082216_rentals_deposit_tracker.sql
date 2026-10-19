-- HOMES: the security deposit tracker, TRACK ONLY (owner D6, 2026-10-18).
-- The deposit is paid directly to the landlord, never through the app (Stripe
-- does not do escrow; docs/specs/landlord-hub-prep.md). The app keeps the record
-- both sides see and runs Louisiana's return clock (R.S. 9:3251, as amended by
-- Acts 2026, No. 63):
--   * the deposit is returned within ONE MONTH after the tenancy ends;
--   * anything kept needs an ITEMIZED statement (each reason and amount);
--   * the tenant gives a forwarding address.
-- The app never decides a dispute (Q35 (a)): it reminds the landlord, records
-- what was returned and kept and why, and sends the statement to the tenant.
--
--   rental_deposits  one per tenancy: the amount, when the landlord received
--                    it, the tenant's forwarding address (the landlord reads it
--                    only once the tenancy has ended), and the settlement:
--                    returned amount, itemized deductions, when it was sent.
--
--   rentals_set_deposit(tenancy, amount_cents, received_on)   landlord, live tenancy
--   rentals_set_forwarding_address(tenancy, address)          tenant, live or ended
--   rentals_settle_deposit(tenancy, returned_cents, deductions, returned_on)
--                                                             landlord, ended tenancy
--   rentals_deposit(tenancy)                                  either side (read)
--   rentals_deposit_sweep()                                   server: the reminders
--
-- Rules: the 'rentals' switch and rentals_assert_member on every write; the
-- tenancy's own landlord or tenant only; no client writes the table. Replay-safe.
-- Proof: src/test/pglite/homesDepositTracker.pglite.mjs (3x).

-- ---------------------------------------------------------------------------
-- 1. The table.
CREATE TABLE IF NOT EXISTS public.rental_deposits (
  tenancy_id uuid PRIMARY KEY REFERENCES public.rental_tenancies(id) ON DELETE CASCADE,
  amount_cents integer NOT NULL CHECK (amount_cents BETWEEN 100 AND 10000000),
  received_on date NOT NULL,
  forwarding_address text CHECK (forwarding_address IS NULL OR char_length(forwarding_address) BETWEEN 10 AND 300),
  returned_cents integer CHECK (returned_cents IS NULL OR returned_cents >= 0),
  deductions jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(deductions) = 'array'),
  returned_on date,
  settled_at timestamptz,
  reminded_stage smallint NOT NULL DEFAULT 0 CHECK (reminded_stage BETWEEN 0 AND 3),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT rental_deposits_settled CHECK ((settled_at IS NULL) = (returned_cents IS NULL) AND (settled_at IS NULL) = (returned_on IS NULL))
);
ALTER TABLE public.rental_deposits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.rental_deposits FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.rental_deposits TO service_role;
-- No client SELECT: the forwarding address is shown to the landlord only once the tenancy ended, so every
-- read goes through rentals_deposit, which applies that rule.
COMMENT ON TABLE public.rental_deposits IS
  'Homes D6 deposit tracker (20261019082216): track only, paid directly to the landlord. Read through rentals_deposit; written by its RPCs.';

-- ---------------------------------------------------------------------------
-- 2. The landlord records the deposit (amount and the day they received it).
CREATE OR REPLACE FUNCTION public.rentals_set_deposit(p_tenancy_id uuid, p_amount_cents integer, p_received_on date)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid;
  v_t public.rental_tenancies%ROWTYPE;
BEGIN
  PERFORM public.require_feature('rentals');
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  PERFORM public.rentals_assert_member();
  v_uid := (SELECT auth.uid());
  SELECT * INTO v_t FROM public.rental_tenancies WHERE id = p_tenancy_id FOR UPDATE;
  IF NOT FOUND OR v_t.landlord_id IS DISTINCT FROM v_uid OR v_t.status <> 'active' THEN
    RAISE EXCEPTION 'tenancy_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF p_amount_cents IS NULL OR p_amount_cents NOT BETWEEN 100 AND 10000000
     OR p_received_on IS NULL OR p_received_on > current_date OR p_received_on < current_date - 3660 THEN
    RAISE EXCEPTION 'bad_deposit' USING ERRCODE = '22023';
  END IF;
  -- A settled deposit is final.
  IF EXISTS (SELECT 1 FROM public.rental_deposits d WHERE d.tenancy_id = p_tenancy_id AND d.settled_at IS NOT NULL) THEN
    RAISE EXCEPTION 'deposit_settled' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.rental_deposits (tenancy_id, amount_cents, received_on)
  VALUES (p_tenancy_id, p_amount_cents, p_received_on)
  ON CONFLICT (tenancy_id) DO UPDATE SET amount_cents = EXCLUDED.amount_cents, received_on = EXCLUDED.received_on, updated_at = now();
  PERFORM public.rentals_notify(v_t.tenant_id, 'Deposit recorded',
    'Your landlord recorded your security deposit of ' || to_char(p_amount_cents / 100.0, 'FM$999,999,990.00') || '. See it under Homes.', '/rentals', false);
END;
$fn$;
REVOKE ALL ON FUNCTION public.rentals_set_deposit(uuid, integer, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rentals_set_deposit(uuid, integer, date) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. The tenant gives (or changes) the forwarding address the deposit and statement go to.
CREATE OR REPLACE FUNCTION public.rentals_set_forwarding_address(p_tenancy_id uuid, p_address text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid;
  v_t public.rental_tenancies%ROWTYPE;
  v_addr text := btrim(regexp_replace(coalesce(p_address, ''), '\s+', ' ', 'g'));
BEGIN
  PERFORM public.require_feature('rentals');
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  PERFORM public.rentals_assert_member();
  v_uid := (SELECT auth.uid());
  SELECT * INTO v_t FROM public.rental_tenancies WHERE id = p_tenancy_id;
  -- The tenant of a live or ended tenancy (the address matters most after move-out).
  IF NOT FOUND OR v_t.tenant_id IS DISTINCT FROM v_uid OR v_t.status NOT IN ('active', 'ended') THEN
    RAISE EXCEPTION 'tenancy_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF char_length(v_addr) NOT BETWEEN 10 AND 300 THEN
    RAISE EXCEPTION 'bad_address' USING ERRCODE = '22023';
  END IF;
  UPDATE public.rental_deposits SET forwarding_address = v_addr, updated_at = now()
   WHERE tenancy_id = p_tenancy_id AND settled_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'deposit_not_found' USING ERRCODE = 'P0002';
  END IF;
END;
$fn$;
REVOKE ALL ON FUNCTION public.rentals_set_forwarding_address(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rentals_set_forwarding_address(uuid, text) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. The landlord settles it once the tenancy ended: what was returned, and each amount kept with its
--    reason (the itemized statement). Returned + kept = the deposit, exactly. Final; the tenant gets the
--    statement as a notification (and email).
CREATE OR REPLACE FUNCTION public.rentals_settle_deposit(p_tenancy_id uuid, p_returned_cents integer, p_deductions jsonb, p_returned_on date)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid;
  v_t public.rental_tenancies%ROWTYPE;
  v_d public.rental_deposits%ROWTYPE;
  v_items jsonb := '[]'::jsonb;
  v_item jsonb;
  v_reason text;
  v_cents integer;
  v_kept bigint := 0;
  v_lines text := '';
BEGIN
  PERFORM public.require_feature('rentals');
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  PERFORM public.rentals_assert_member();
  v_uid := (SELECT auth.uid());
  SELECT * INTO v_t FROM public.rental_tenancies WHERE id = p_tenancy_id;
  IF NOT FOUND OR v_t.landlord_id IS DISTINCT FROM v_uid OR v_t.status NOT IN ('active', 'ended') THEN
    RAISE EXCEPTION 'tenancy_not_found' USING ERRCODE = 'P0002';
  END IF;
  SELECT * INTO v_d FROM public.rental_deposits WHERE tenancy_id = p_tenancy_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'deposit_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_d.settled_at IS NOT NULL THEN
    RAISE EXCEPTION 'deposit_settled' USING ERRCODE = '22023';
  END IF;
  -- Settled after the tenancy ends (the return clock starts then).
  IF v_t.status <> 'ended' THEN
    RAISE EXCEPTION 'tenancy_not_ended' USING ERRCODE = '22023';
  END IF;
  IF p_deductions IS NULL OR jsonb_typeof(p_deductions) <> 'array' OR jsonb_array_length(p_deductions) > 20 THEN
    RAISE EXCEPTION 'bad_settlement' USING ERRCODE = '22023';
  END IF;
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_deductions) LOOP
    BEGIN
      v_reason := btrim(v_item ->> 'reason');
      v_cents := (v_item ->> 'amount_cents')::integer;
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION 'bad_settlement' USING ERRCODE = '22023';
    END;
    IF jsonb_typeof(v_item) <> 'object' OR v_reason IS NULL OR char_length(v_reason) NOT BETWEEN 3 AND 200
       OR v_cents IS NULL OR v_cents < 1 THEN
      RAISE EXCEPTION 'bad_settlement' USING ERRCODE = '22023';
    END IF;
    v_kept := v_kept + v_cents;
    v_items := v_items || jsonb_build_array(jsonb_build_object('reason', v_reason, 'amount_cents', v_cents));
    v_lines := v_lines || E'\n- ' || v_reason || ': ' || to_char(v_cents / 100.0, 'FM$999,999,990.00');
  END LOOP;
  IF p_returned_cents IS NULL OR p_returned_cents < 0 OR p_returned_cents + v_kept <> v_d.amount_cents
     OR p_returned_on IS NULL OR p_returned_on > current_date OR p_returned_on < v_d.received_on THEN
    RAISE EXCEPTION 'bad_settlement' USING ERRCODE = '22023';
  END IF;
  UPDATE public.rental_deposits
     SET returned_cents = p_returned_cents, deductions = v_items, returned_on = p_returned_on, settled_at = now(), updated_at = now()
   WHERE tenancy_id = p_tenancy_id;
  PERFORM public.rentals_notify(v_t.tenant_id, 'Deposit statement',
    'Your landlord returned ' || to_char(p_returned_cents / 100.0, 'FM$999,999,990.00') || ' of your '
      || to_char(v_d.amount_cents / 100.0, 'FM$999,999,990.00') || ' deposit on ' || to_char(p_returned_on, 'FMMon FMDD, YYYY') || '.'
      || CASE WHEN v_kept > 0 THEN ' Kept, itemized:' || v_lines ELSE ' Nothing was kept.' END,
    '/rentals', true);
END;
$fn$;
REVOKE ALL ON FUNCTION public.rentals_settle_deposit(uuid, integer, jsonb, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rentals_settle_deposit(uuid, integer, jsonb, date) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5. The record both sides see. The return-by date is one month after the tenancy ended. The forwarding
--    address goes to the landlord only once the tenancy has ended (the tenant always sees their own).
CREATE OR REPLACE FUNCTION public.rentals_deposit(p_tenancy_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid;
  v_t public.rental_tenancies%ROWTYPE;
  v_side text;
  v_d public.rental_deposits%ROWTYPE;
  v_due date;
BEGIN
  PERFORM public.require_feature('rentals');
  v_uid := (SELECT auth.uid());
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_t FROM public.rental_tenancies WHERE id = p_tenancy_id;
  v_side := CASE WHEN v_t.landlord_id = v_uid THEN 'landlord' WHEN v_t.tenant_id = v_uid THEN 'tenant' END;
  IF v_side IS NULL OR v_t.status NOT IN ('active', 'ended') THEN
    RAISE EXCEPTION 'tenancy_not_found' USING ERRCODE = 'P0002';
  END IF;
  SELECT * INTO v_d FROM public.rental_deposits WHERE tenancy_id = p_tenancy_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('side', v_side, 'tenancy_status', v_t.status, 'deposit', NULL);
  END IF;
  v_due := CASE WHEN v_t.status = 'ended' AND v_t.ended_at IS NOT NULL
                THEN ((v_t.ended_at AT TIME ZONE 'America/Chicago')::date + interval '1 month')::date END;
  RETURN jsonb_build_object(
    'side', v_side,
    'tenancy_status', v_t.status,
    'deposit', jsonb_build_object(
      'amount_cents', v_d.amount_cents,
      'received_on', v_d.received_on,
      'forwarding_address', CASE WHEN v_side = 'tenant' OR v_t.status = 'ended' THEN v_d.forwarding_address END,
      'has_forwarding_address', v_d.forwarding_address IS NOT NULL,
      'return_by', v_due,
      'returned_cents', v_d.returned_cents,
      'deductions', v_d.deductions,
      'returned_on', v_d.returned_on,
      'settled_at', v_d.settled_at));
END;
$fn$;
REVOKE ALL ON FUNCTION public.rentals_deposit(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rentals_deposit(uuid) TO authenticated, service_role;

-- 5b. Deposits of ENDED tenancies the caller is a side of, still to settle or settled in the last 90 days:
--     the Homes screen lists them after move-out (the live-tenancy cards are gone by then).
CREATE OR REPLACE FUNCTION public.rentals_my_ended_deposits()
RETURNS TABLE (tenancy_id uuid, side text, label text, unit_label text, settled boolean)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid;
BEGIN
  PERFORM public.require_feature('rentals');
  v_uid := (SELECT auth.uid());
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT t.id, CASE WHEN t.landlord_id = v_uid THEN 'landlord' ELSE 'tenant' END, rp.label, u.label, d.settled_at IS NOT NULL
    FROM public.rental_deposits d
    JOIN public.rental_tenancies t ON t.id = d.tenancy_id
    JOIN public.rental_properties rp ON rp.id = t.property_id
    JOIN public.rental_units u ON u.id = t.unit_id
   WHERE t.status = 'ended'
     AND (t.landlord_id = v_uid OR t.tenant_id = v_uid)
     AND (d.settled_at IS NULL OR d.settled_at > now() - interval '90 days')
   ORDER BY t.ended_at DESC;
END;
$fn$;
REVOKE ALL ON FUNCTION public.rentals_my_ended_deposits() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rentals_my_ended_deposits() TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 6. The reminders (server only, daily): to the landlord of an ENDED tenancy whose deposit is not settled,
--    on the day it ended (stage 1), 7 days before the return-by date (stage 2) and on the day after it
--    passed (stage 3), once each. Friendly words; the app never sends a legal notice.
CREATE OR REPLACE FUNCTION public.rentals_deposit_sweep()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v record;
  v_due date;
  v_today date := (now() AT TIME ZONE 'America/Chicago')::date;
  v_stage smallint;
  v_n integer := 0;
BEGIN
  FOR v IN
    SELECT d.tenancy_id, d.amount_cents, d.reminded_stage, t.landlord_id, t.ended_at
      FROM public.rental_deposits d
      JOIN public.rental_tenancies t ON t.id = d.tenancy_id
     WHERE d.settled_at IS NULL AND t.status = 'ended' AND t.ended_at IS NOT NULL AND d.reminded_stage < 3
     FOR UPDATE OF d
  LOOP
    v_due := ((v.ended_at AT TIME ZONE 'America/Chicago')::date + interval '1 month')::date;
    v_stage := CASE WHEN v_today > v_due THEN 3 WHEN v_today >= v_due - 7 THEN 2 ELSE 1 END;
    IF v_stage > v.reminded_stage THEN
      UPDATE public.rental_deposits SET reminded_stage = v_stage, updated_at = now() WHERE tenancy_id = v.tenancy_id;
      PERFORM public.rentals_notify(v.landlord_id,
        CASE v_stage WHEN 3 THEN 'Deposit return is overdue' WHEN 2 THEN 'Deposit return due soon' ELSE 'Return the deposit' END,
        CASE v_stage
          WHEN 3 THEN 'The deposit (' || to_char(v.amount_cents / 100.0, 'FM$999,999,990.00') || ') was due back by ' || to_char(v_due, 'FMMon FMDD') || '. Louisiana law can make a landlord pay more for a late return. Record it under Homes.'
          WHEN 2 THEN 'Return the deposit, with an itemized list of anything you keep, by ' || to_char(v_due, 'FMMon FMDD') || '.'
          ELSE 'The tenancy ended. Louisiana gives you one month, until ' || to_char(v_due, 'FMMon FMDD') || ', to return the deposit with an itemized list of anything you keep.' END,
        '/rentals', v_stage >= 2);
      v_n := v_n + 1;
    END IF;
  END LOOP;
  RETURN jsonb_build_object('reminders', v_n);
END;
$fn$;
REVOKE ALL ON FUNCTION public.rentals_deposit_sweep() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rentals_deposit_sweep() TO service_role;

DO $do$
BEGIN
  IF to_regclass('public.cron_work_expectations') IS NOT NULL THEN
    INSERT INTO public.cron_work_expectations (jobname, expected_max_gap, note, work_visibility, work_exempt_reason)
    VALUES ('rentals-deposit-sweep', interval '26 hours',
            'Homes deposit tracker (D6): daily, reminds the landlord of an ended tenancy to return the deposit (R.S. 9:3251 one-month clock).',
            'exempt',
            'While no tenancy with a recorded deposit has ended, a run that sends nothing is the healthy state.')
    ON CONFLICT (jobname) DO UPDATE SET expected_max_gap = EXCLUDED.expected_max_gap, note = EXCLUDED.note,
      work_visibility = EXCLUDED.work_visibility, work_exempt_reason = EXCLUDED.work_exempt_reason;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    -- 13:12 UTC = 8:12 a.m. Central (CDT), after the rent sweep.
    PERFORM cron.schedule('rentals-deposit-sweep', '12 13 * * *',
      $c$SELECT public.cron_record_work('rentals-deposit-sweep', to_jsonb(public.rentals_deposit_sweep()));$c$);
  END IF;
END
$do$;

-- cronCatchUpPolicy (Q30) reads the NEWEST migration that seeds public.cron_catchup_policy as the whole
-- policy, so this restates every row of 20261018035944 verbatim plus listing-photo-purge, rentals-rent-sweep, rentals-deposit-sweep (never re-run late).
DO $do$
BEGIN
  IF to_regclass('public.cron_catchup_policy') IS NOT NULL THEN
    EXECUTE $pol$
INSERT INTO public.cron_catchup_policy (jobname, catch_up, max_late, reason) VALUES
  ('ops-daily-digest',                true,  interval '20 hours', 'Slack digest of the last 24h of ops alerts; writes only its own delivery receipt. A late digest is the Q30 case itself: 09-22 went 38h with none.'),
  ('sweep-daily-job-digest',          true,  interval '6 hours',  'In-app "New jobs in <parish>" digest; its own NOT EXISTS skips anyone digested in the last 23h, so it cannot double-send. Capped at 6h because a late run shifts the next day''s by that 23h dedupe.'),
  ('push-token-health',               true,  interval '20 hours', 'Monitor (Q82): counts push tokens and writes at most one error_logs row per UTC day. Read-only otherwise.'),
  ('marketing-token-health',          true,  interval '20 hours', 'Monitor: checks the Meta token and that the publish queue drains; reads and alerts only.'),
  ('money-reconciliation',            true,  interval '20 hours', 'STRICTLY READ-ONLY by design (header of supabase/functions/money-reconciliation/index.ts): selects and Stripe paymentIntents.retrieve only. Reports money drift, never moves money.'),
  ('detect-suspicious-user-patterns', true,  interval '20 hours', 'Inserts a fraud_flags row only when no unresolved flag of that type exists for the user; its windows are relative to now(). Re-running is idempotent.'),
  ('sweep-old-email-send-log',        true,  interval '20 hours', 'Age-based TTL delete: a late run deletes exactly what the next run would. Idempotent.'),
  ('sweep-old-notifications',         true,  interval '20 hours', 'Age-based TTL delete of old notifications. Idempotent.'),
  ('sweep-old-error-logs',            true,  interval '20 hours', 'Age-based TTL delete of old error_logs. Idempotent.'),
  ('prune-cron-run-details',          true,  interval '20 hours', 'Deletes cron.job_run_details older than 7 days; the catch-up reads only the latest slot. Idempotent.'),
  ('prune-cron-run-log',              true,  interval '20 hours', 'Age-based prune of cron_run_log. Idempotent.'),
  ('prune-edge-rate-limit-log',       true,  interval '20 hours', 'Age-based prune of the edge rate-limit log. Idempotent.'),
  ('cleanup-notifications',           true,  interval '20 hours', 'Deletes READ notifications older than 30 days (age-based). Idempotent.'),
  ('stalled-completion-reminder',     true,  interval '6 hours',  'User nudge with its own per-job ledger (first_sent_at / second_sent_at / escalated_at, upsert ignoreDuplicates): a stage is never sent twice. 6h cap keeps it inside daytime.'),
  ('review-nag-cron',                 true,  interval '6 hours',  'User nudge with its own dedupe count per user and job inside WINDOW_HOURS, failing closed (unreadable count = already nagged). 6h cap keeps it inside daytime.'),
  ('engagement-automations',          true,  interval '6 hours',  'Lifecycle emails spaced by last_drip_at / last_approval_email_at, which it stamps on send: a late run cannot send a step twice. 6h cap keeps it inside daytime.'),
  ('charge-recurring-visits',         false, interval '1 hour',   'CHARGES CARDS for recurring visits. Money is never auto-rerun: a person checks what the missed day should have charged.'),
  ('expire-subscriptions',            false, interval '1 hour',   'Ends paid entitlements (one-time passes, lapsed tiers). Changes what a paying user has; a person decides.'),
  ('subscription-reconciliation',     false, interval '1 hour',   'REPAIRS tier state from Stripe (its header: "why this one repairs"). An automated entitlement writer is not re-run blind; a person decides.'),
  ('cleanup-abandoned-accounts',      false, interval '1 hour',   'DELETES accounts. Destructive; never re-run automatically.'),
  ('weekly-helper-report',            true,  interval '6 hours',  'Q188: weekly in-app report now skips any helper who already has one from the last 6 days (supabase/functions/weekly-helper-report, tested in src/test/edge/weekly-helper-report.test.ts), so a late run cannot send twice. 6h cap keeps it inside daytime.'),
  ('cleanup-stripe-webhook-events',   true,  interval '20 hours', 'Q167: deletes stripe_webhook_events processed over 30 days ago; the window is relative to now(), so a late run deletes exactly what an on-time one would have.'),
  ('cleanup-observability-tables',    true,  interval '20 hours', 'Q167: deletes analytics_events over 90 days and error_logs over 30; relative windows, idempotent, so a late run is the same prune.'),
  ('prune-retention-tables',          true,  interval '20 hours', 'CJ-003/CS-003: age-based deletes (login_history, notification_logs, profile_views, job_views, rate logs, W-9s over 4 years); every window is relative to now(), so a late run deletes exactly what an on-time one would have.'),
  ('purge-old-seed-data',             true,  interval '20 hours', 'Q65: age-based purge of is_seed test jobs (never money, never a fixture id, never profiles) and seed notifications; the window is relative to now() and every run is bounded and recorded, so a late run is the same purge.'),
  ('unfilled-series-visit-reminders', false, interval '1 hour',   'Tells a poster an empty series visit is TOMORROW (20261012195747). The text is relative to the run''s own day, so a late run past midnight would name the wrong day; its own once-per-visit ledger already stops a double send. Not re-run late.'),
  ('declutter-price-drops',           false, interval '1 hour',   'Declutter evening price drop (20261014210518): once per Louisiana day; a missed evening is simply skipped and the next evening drops 5% as usual. Not re-run late: a late run past midnight would spend the NEXT day''s drop.'),
  ('listing-photo-purge', false, interval '1 hour', 'Homes listing photo purge (20261019071203): deletes taken-down listings'' photos through the Storage API. Deletion is never re-run late; the next daily run deletes whatever is due.'),
  ('rentals-rent-sweep', false, interval '1 hour', 'Homes rent tracker (20261019073106): writes due rent rows, late fees and reminders. Not re-run late: the next daily run writes every missed rent row and fee itself (idempotent, from the first due date); only a missed reminder is skipped.'),
  ('rentals-deposit-sweep', false, interval '1 hour', 'Homes deposit tracker (20261019082216): deposit-return reminders by stage. Not re-run late: the next daily run sends the stage that is due (once each).')
ON CONFLICT (jobname) DO UPDATE
  SET catch_up = EXCLUDED.catch_up, max_late = EXCLUDED.max_late,
      reason = EXCLUDED.reason, updated_at = now();
    $pol$;
  END IF;
END
$do$;
