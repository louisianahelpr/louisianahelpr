-- "Stuck payment — webhook may be failing" pages only when Stripe says the
-- checkout TOOK the money (owner report, 2026-10-09).
--
-- WHAT WAS WRONG. detect_stuck_payments (pg_cron, every 15 minutes) paged for
-- every real job that had a Checkout Session, was still payment_status
-- 'unpaid', and was 10 minutes to 24 hours old. It never asked Stripe. A
-- poster who opened checkout and walked away looks exactly like that, so the
-- owner was paged at 12:15:00Z on 2026-10-09: "Job "Grass cutting" (bcf08d0b)
-- by Ben Lombas was checkout-started 00:10:23 ago but webhook never settled
-- it". Measured read-only in live Stripe the same day: that session
-- (cs_live_b1zHlX4z…) was status 'open' and payment_status 'unpaid' with no
-- PaymentIntent at all, and is now 'expired'/'unpaid'. He never paid; the job
-- he did pay (1e16c281, cs_live_b1Dqmjkck…: 'complete'/'paid') settled to
-- escrow normally. Nothing was stuck.
--
-- WHAT A STUCK PAYMENT IS. The money moved and our side did not settle it:
-- Stripe reports the Checkout Session status 'complete' with payment_status
-- 'paid' (or 'no_payment_required': complete and nothing left to collect)
-- while the job is still 'unpaid'. An 'open' session is a person still on, or
-- gone from, the checkout page; 'expired' can never be paid; 'complete' +
-- 'unpaid' is an async method (bank debit, bank transfer) still settling.
-- None of those is a failed webhook.
--
-- THE FIX. SQL cannot ask Stripe, so the edge function stuck-payment-check
-- (cron, 3 minutes before each detector run) reads every candidate's session
-- from Stripe (read-only: checkout.sessions.retrieve) and records Stripe's
-- answer in stuck_payment_stripe_checks. detect_stuck_payments then:
--   * money_moved          -> alerts exactly as before (same title, link,
--                             per-poster daily dedupe, error_logs source), with
--                             Stripe's evidence in the message and context;
--   * not moved, and Stripe answered within 45 minutes (or the session is
--     'expired' / gone, which can never be paid) -> 'not_paid': counted as
--                             handled, no alert;
--   * no answer for this session, or a stale one -> 'awaiting_stripe': NOT a
--     handled disposition, so cron_work_expectations' found-vs-done rule files
--     detect-stuck-payments after two such runs, AND each such job older than
--     40 minutes (the checker has had two runs) is filed on its own through
--     log_cron_defect, so it is not hidden behind other jobs answered
--     not_paid in the same run. A dead or misconfigured checker therefore
--     still pages (and so does its own cronResult 500 via
--     sweep_cron_http_failures); it can never silently hide a real one. The
--     checker records "no money" only from Stripe's own answer: a 404 or any
--     other read error (a wrong or rotated key 404s every live session) is a
--     defect with no answer, never "missing".
-- The seed/E2E branch takes the same gate: a seed checkout nobody paid is not
-- a stuck payment either (nightly journeys open checkouts and never pay).
--
-- LAYERS READ (2026-10-09): detect_stuck_payments live prosrc
-- md5 2828bff6f0ddc9fb15d2401b00a0f1d5 = 20261007043834's body, restated below
-- with the gate added; cron.job 'detect-stuck-payments' */15 SQL;
-- cron_work_expectations 'detect-stuck-payments' (candidates: found vs
-- alerted/already_alerted/seed_logged/seed_already_logged) gains 'not_paid';
-- admin_alert_close_rule maps the title to 'stuck-payment' (unchanged);
-- void-cancelled-payments Part B abandons expired unpaid sessions (unchanged).
-- NOT changed: ops_alert_condition('detect_stuck_payments') still closes the
-- ledger item only when no real unpaid-with-session job is in the window, a
-- superset of the new predicate (an item can stay open longer, never close
-- early) — docs/OPEN.md Q1585.
--
-- Guard: src/test/stuckPaymentNeedsStripeProof.test.ts (static, with
-- registered mutations) and src/test/edge/stuck-payment-check.test.ts (the
-- edge function, both cases). Behaviour proven in PGlite:
-- src/test/pglite/stuckPaymentNeedsStripeProof.pglite.mjs (applied 3x).
--
-- Replay-safe: CREATE TABLE IF NOT EXISTS; CREATE OR REPLACE with unchanged
-- signature; the expectation rows are upserted; cron.schedule upserts by name;
-- each guarded where pg_cron / the registry table do not exist. Grants restated
-- (service_role only, as live: {postgres=X, service_role=X}).

-- ── 1. Stripe's answer per job (server-only) ────────────────────────────────
CREATE TABLE IF NOT EXISTS public.stuck_payment_stripe_checks (
  job_id            uuid PRIMARY KEY REFERENCES public.jobs (id) ON DELETE CASCADE,
  -- The session the answer is about; a re-minted checkout gets a new one, and
  -- the detector only trusts an answer for the job's CURRENT session.
  stripe_session_id text NOT NULL,
  session_status    text NOT NULL,   -- open | complete | expired | missing
  payment_status    text NOT NULL,   -- paid | unpaid | no_payment_required | missing
  money_moved       boolean NOT NULL,
  payment_intent_id text,
  checked_at        timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.stuck_payment_stripe_checks ENABLE ROW LEVEL SECURITY;
-- Q807: every new public table carries the unconfirmed-email gate (server-only here).
DO $do$
BEGIN
  IF to_regprocedure('public.attach_unconfirmed_email_gate()') IS NOT NULL THEN
    PERFORM public.attach_unconfirmed_email_gate();
  END IF;
END
$do$;
REVOKE ALL ON TABLE public.stuck_payment_stripe_checks FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.stuck_payment_stripe_checks TO service_role;

-- ── 2. The detector, gated on Stripe's answer ───────────────────────────────
CREATE OR REPLACE FUNCTION public.detect_stuck_payments()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  rec RECORD;
  flagged integer := 0;
  user_label text;
  v_found               integer := 0;
  v_alerted             integer := 0;
  v_already_alerted     integer := 0;
  v_seed_logged         integer := 0;
  v_seed_already_logged integer := 0;
  v_not_paid            integer := 0;
  v_awaiting_stripe     integer := 0;
  v_failed              integer := 0;
BEGIN
  FOR rec IN
    SELECT j.id, j.title, j.customer_id, j.stripe_session_id, j.created_at, j.updated_at,
           -- A seed job, or a job a TEST account posted (is_seed AND a
           -- test_accounts row; is_seed alone also marks real people who
           -- signed up with a fixture inbox, and their live money must page).
           coalesce(j.is_seed, false)
             OR (coalesce(sp.is_seed, false)
                 AND EXISTS (SELECT 1 FROM public.test_accounts t WHERE t.user_id = j.customer_id)) AS seed,
           -- Stripe's answer for THIS session (stuck-payment-check).
           c.money_moved, c.session_status, c.payment_status AS stripe_payment_status,
           c.payment_intent_id, c.checked_at
    FROM public.jobs j
    LEFT JOIN public.profiles sp ON sp.user_id = j.customer_id
    LEFT JOIN public.stuck_payment_stripe_checks c
           ON c.job_id = j.id AND c.stripe_session_id = j.stripe_session_id
    WHERE j.stripe_session_id IS NOT NULL
      AND j.payment_status = 'unpaid'
      AND j.created_at < NOW() - INTERVAL '10 minutes'
      AND j.created_at > NOW() - INTERVAL '24 hours'
      -- A job cancelled with its checkout still open is unwound by
      -- void-cancelled-payments (hourly, :10): it expires the session and
      -- marks the job 'abandoned'. Give it two runs before this counts.
      AND NOT (j.status = 'cancelled'
               AND coalesce(j.cancelled_at, j.updated_at) > NOW() - INTERVAL '2 hours')
    -- Most candidates are checkouts nobody finished; a job Stripe says was
    -- PAID (then one with no answer yet) must never sit behind 50 of them.
    ORDER BY (c.money_moved IS TRUE) DESC, (c.checked_at IS NULL) DESC, j.created_at
    LIMIT 50
  LOOP
    v_found := v_found + 1;
    BEGIN
      -- Stuck means Stripe TOOK the money and the job is still unpaid. A
      -- checkout the person did not finish is not stuck (2026-10-09).
      IF rec.money_moved IS NOT TRUE THEN
        IF rec.checked_at IS NOT NULL
           AND (rec.checked_at > NOW() - INTERVAL '45 minutes'
                OR rec.session_status IN ('expired', 'missing')) THEN
          v_not_paid := v_not_paid + 1;
        ELSE
          -- No current answer from Stripe: deliberately not a handled
          -- disposition (see the header).
          v_awaiting_stripe := v_awaiting_stripe + 1;
          -- And filed per job once the checker has had two runs to answer,
          -- so one unanswered job is never hidden behind other jobs that
          -- were answered not_paid in the same run.
          -- From the job's last update, not its creation: "Finish paying"
          -- re-mints the checkout on an older job (updating the row), and the
          -- checker needs its two runs on the NEW session too.
          IF greatest(rec.created_at, coalesce(rec.updated_at, rec.created_at)) < NOW() - INTERVAL '40 minutes' THEN
            PERFORM public.log_cron_defect(
              CASE WHEN rec.seed THEN 'detect_stuck_payments-seed' ELSE 'detect_stuck_payments' END,
              rec.id::text,
              format('no current Stripe answer for checkout %s from stuck-payment-check; cannot tell whether it took the money', rec.stripe_session_id),
              jsonb_build_object('job_id', rec.id, 'seed', rec.seed, 'stripe_session_id', rec.stripe_session_id,
                                 'answered_session_checked_at', rec.checked_at));
          END IF;
        END IF;
        CONTINUE;
      END IF;

      IF rec.seed THEN
        -- Seed/E2E job: one digest row per job per day, no admin notification,
        -- no page. error_log_is_seed() keeps it out of Slack and the ledger.
        IF EXISTS (
          SELECT 1 FROM public.error_logs e
           WHERE jsonb_typeof(e.tags) = 'object'
             AND coalesce(e.tags ->> 'origin', '') <> 'client'
             AND e.tags ->> 'source' = 'detect_stuck_payments-seed'
             AND e.tags ->> 'job_id' = rec.id::text
             AND e.created_at > NOW() - INTERVAL '24 hours') THEN
          v_seed_already_logged := v_seed_already_logged + 1;
          CONTINUE;
        END IF;
        INSERT INTO public.error_logs (severity, message, url, tags, context)
        VALUES (
          'info',
          'Stuck payment on a seed/E2E job — paid in Stripe, never settled',
          format('/admin?view=jobs&job=%s', rec.id),
          jsonb_build_object('source', 'detect_stuck_payments-seed', 'seed', true, 'job_id', rec.id::text),
          jsonb_build_object('job_id', rec.id, 'stripe_session_id', rec.stripe_session_id,
                             'customer_id', rec.customer_id, 'created_at', rec.created_at,
                             'stripe_session_status', rec.session_status,
                             'stripe_payment_status', rec.stripe_payment_status,
                             'stripe_payment_intent', rec.payment_intent_id,
                             'stripe_checked_at', rec.checked_at));
        flagged := flagged + 1;
        v_seed_logged := v_seed_logged + 1;
        CONTINUE;
      END IF;

      -- Real job: admin notification and a critical-source error_logs row
      -- that pages, deduped per JOB per day (per poster hid a second stuck
      -- job by the same poster entirely).
      IF EXISTS (
        SELECT 1 FROM public.error_logs e
         WHERE jsonb_typeof(e.tags) = 'object'
           AND coalesce(e.tags ->> 'origin', '') <> 'client'
           AND e.tags ->> 'source' = 'detect_stuck_payments'
           AND e.tags ->> 'job_id' = rec.id::text
           AND e.message = 'Stuck payment detected — webhook noop'
           AND e.created_at > NOW() - INTERVAL '24 hours') THEN
        v_already_alerted := v_already_alerted + 1;
        CONTINUE;
      END IF;

      SELECT COALESCE(NULLIF(full_name, ''), email, 'A user')
      INTO user_label
      FROM public.profiles
      WHERE user_id = rec.customer_id;

      INSERT INTO public.notifications (user_id, type, title, message, link, read)
      SELECT
        ur.user_id,
        'system_alert',
        'Stuck payment — webhook may be failing',
        format('Job "%s" (%s) by %s was PAID in Stripe (checkout %s/%s) but our webhook never settled it (posted %s ago). Investigate stripe-webhook logs.',
               rec.title,
               substring(rec.id::text, 1, 8),
               COALESCE(user_label, 'unknown'),
               rec.session_status,
               rec.stripe_payment_status,
               date_trunc('minute', age(NOW(), rec.created_at))),
        format('/admin?view=people&user=%s', rec.customer_id),
        false
      FROM public.user_roles ur
      WHERE ur.role = 'admin';

      INSERT INTO public.error_logs (severity, message, url, tags, context)
      VALUES (
        'error',
        'Stuck payment detected — webhook noop',
        format('/admin?view=jobs&job=%s', rec.id),
        jsonb_build_object('source', 'detect_stuck_payments', 'job_id', rec.id::text),
        jsonb_build_object(
          'job_id', rec.id,
          'stripe_session_id', rec.stripe_session_id,
          'customer_id', rec.customer_id,
          'created_at', rec.created_at,
          'stripe_session_status', rec.session_status,
          'stripe_payment_status', rec.stripe_payment_status,
          'stripe_payment_intent', rec.payment_intent_id,
          'stripe_checked_at', rec.checked_at
        )
      );

      flagged := flagged + 1;
      v_alerted := v_alerted + 1;
    EXCEPTION WHEN OTHERS THEN
      v_failed := v_failed + 1;
      -- Filed per row: a job that could not be alerted used to reach RAISE
      -- NOTICE only. A seed job's failure goes to the '-seed' source, which
      -- error_log_is_seed keeps out of Slack and the ledger.
      PERFORM public.log_cron_defect(
        CASE WHEN rec.seed THEN 'detect_stuck_payments-seed' ELSE 'detect_stuck_payments' END,
        rec.id::text, SQLERRM,
        jsonb_build_object('job_id', rec.id, 'seed', rec.seed));
      RAISE NOTICE 'detect_stuck_payments: job % failed: %', rec.id, SQLERRM;
    END;
  END LOOP;
  RETURN jsonb_build_object('found', v_found, 'flagged', flagged,
                            'alerted', v_alerted, 'already_alerted', v_already_alerted,
                            'seed_logged', v_seed_logged, 'seed_already_logged', v_seed_already_logged,
                            'not_paid', v_not_paid, 'awaiting_stripe', v_awaiting_stripe,
                            'failed', v_failed);
END;
$function$;

REVOKE ALL ON FUNCTION public.detect_stuck_payments() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.detect_stuck_payments() TO service_role;

-- ── 3. Registries and the checker's schedule ────────────────────────────────
DO $do$
BEGIN
  IF to_regclass('public.cron_work_expectations') IS NOT NULL THEN
    -- 'not_paid' (Stripe says the checkout took no money) is handled work;
    -- 'awaiting_stripe' is deliberately NOT, so a dead checker still files.
    INSERT INTO public.cron_work_expectations (jobname, candidate_key, disposition_keys, min_streak, note)
    VALUES
      ('detect-stuck-payments', 'found', ARRAY['alerted', 'already_alerted', 'seed_logged', 'seed_already_logged', 'not_paid'], 2,
       'Checkouts never settled by the Stripe webhook, found vs handled: alerted (Stripe says paid), already alerted today, a seed job logged, or not_paid (Stripe says the checkout took no money). found>0 with none of those twice running means every candidate raised inside the loop OR had no current answer from stuck-payment-check (awaiting_stripe). A partial failure is filed per row through log_cron_defect.')
    ON CONFLICT (jobname) DO UPDATE
      SET candidate_key    = EXCLUDED.candidate_key,
          disposition_keys = EXCLUDED.disposition_keys,
          min_streak       = EXCLUDED.min_streak,
          note             = EXCLUDED.note;

    INSERT INTO public.cron_work_expectations (jobname, expected_max_gap, note, work_visibility, work_exempt_reason)
    VALUES ('stuck-payment-check', interval '40 minutes',
            'Every 15 minutes (3 minutes before detect-stuck-payments), reads each unpaid job''s Checkout Session from Stripe (read-only) and records whether it took the money, in stuck_payment_stripe_checks.',
            'exempt',
            'No unpaid checkout in the window is the healthy state. A Stripe or database read that fails answers 500 through cronResult, and detect-stuck-payments counts a candidate it has no answer for as unhandled.')
    ON CONFLICT (jobname) DO UPDATE SET expected_max_gap = EXCLUDED.expected_max_gap, note = EXCLUDED.note,
      work_visibility = EXCLUDED.work_visibility, work_exempt_reason = EXCLUDED.work_exempt_reason;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    PERFORM cron.schedule('stuck-payment-check', '12-59/15 * * * *', $c$SELECT public.cron_http_tag(q.request_id, 'stuck-payment-check')
  FROM (
      SELECT net.http_post(timeout_milliseconds := 90000,
        url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'supabase_url' LIMIT 1)
               || '/functions/v1/stuck-payment-check',
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
