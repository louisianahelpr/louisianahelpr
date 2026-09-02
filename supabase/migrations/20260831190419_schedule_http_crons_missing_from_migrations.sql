-- Declare the 13 HTTP crons that exist in prod but in NO migration.
--
-- ── The gap ─────────────────────────────────────────────────────────────────
--
-- 19 pg_cron jobs invoke an edge function over `net.http_post`. Only six of
-- them are created by a migration (auto-tip-charge 20260811200000,
-- backfill-job-geocode 20260830100444, charge-recurring-visits 20260823170000,
-- expiring-jobs-push 20260506190000, money-reconciliation 20260828230000,
-- payment-confirm-reminder 20260612440000). The other thirteen — every payout,
-- escrow, refund and email cron in the product — were created out-of-band in
-- the SQL editor and appear in exactly one migration,
-- 20260829010000_stagger_http_cron_schedules, which only *alters* schedules and
-- deliberately `CONTINUE`s past any job that does not exist.
--
-- So the sequence of migrations describes a database with NO auto-release-payment,
-- NO void-cancelled-payments, NO process-email-queue and NO auto-expire-jobs.
-- A restore, a branch database, or a fresh project comes up with the money and
-- email automation simply absent — and comes up GREEN, because drift detection
-- diffs schema and `cron.job` is data. Nothing in `db-drift-detect.yml` reads it.
-- The 2026-08-31 cron audit found this by counting: 13 job names appear in the
-- repository only inside the stagger migration's VALUES list (auto-expire-jobs
-- only in its comment header).
--
-- ── The commands below are RECONSTRUCTED, not dumped ────────────────────────
--
-- `cron.job` is not exposed to PostgREST and this workspace has no Supabase
-- management token, so the live command text could not be read. Each command
-- here is rebuilt from three facts that ARE in the repository:
--
--   1. the function name (a directory under supabase/functions/);
--   2. the schedule, from 20260829010000's VALUES list (auto-expire-jobs is not
--      in that list because it did not move; its `0 * * * *` comes from the
--      same migration's minute map, ":00 auto-expire-jobs (hourly)");
--   3. the invocation shape, which is identical across every cron-invoked edge
--      function in this project — `net.http_post` with the URL and bearer read
--      from `vault.decrypted_secrets` under the names `supabase_url` and
--      `service_role_key`. 20260505220500 rewrote every one of these commands
--      from `legacy_service_role_key` to `service_role_key` in a single
--      string replace, which is direct evidence they share one shape;
--      20260828230000 and 20260830100444 are the two committed examples.
--
-- BEFORE MERGING, the owner should verify against the live database:
--   SELECT jobname, schedule, command FROM cron.job ORDER BY jobname;
-- and confirm for each of the 13 names below that (a) the schedule matches and
-- (b) the command is this same http_post shape with no extra body payload,
-- header, or non-default URL. Any job that differs must be corrected HERE
-- rather than left to this migration to overwrite.
--
-- ── Why this is safe to run against the live database ───────────────────────
--
-- The guard below only ever CREATES. If a job of that name already exists it is
-- left completely untouched — no unschedule, no re-schedule, no alter. That is
-- the deliberate inverse of the usual "unschedule then schedule" idiom: on prod
-- these thirteen jobs already exist and are working, and re-typing the command
-- of a working money cron is precisely how a cosmetic migration breaks escrow
-- (20260829010000 says so in its own header, which is why it used
-- `cron.alter_job`). On a fresh or restored database none of them exist, and
-- this file is the thing that brings them back. Both cases are handled by the
-- same guard, and replaying the migration is a no-op.
--
-- NOT INCLUDED, on purpose:
--   * process-scheduled-payouts — 20260618130000 deliberately UNSCHEDULED it as
--     the second, racing writer on the same payout_pending jobs. Re-creating it
--     here would silently re-open that race on every rebuild. It stays absent.
--   * the SQL-only sweeps (sweep-cron-http-failures, sweep-silent-cron-failures,
--     prune-cron-run-log, detect-stuck-payments, …) — those already live in
--     their own migrations.
--
-- REPLAY-SAFETY: pg_cron may not be installed yet on a from-scratch rebuild, so
-- the whole block is skipped in that case rather than erroring. The vault
-- secrets are read at cron RUN time, not here, so a database without them still
-- migrates cleanly.

DO $$
DECLARE
  v_target  record;
  v_created int := 0;
  v_kept    int := 0;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RAISE NOTICE 'pg_cron not installed — skipping HTTP cron declarations';
    RETURN;
  END IF;

  FOR v_target IN
    SELECT * FROM (VALUES
      -- money / escrow
      ('auto-release-payment',           '5,35 * * * *'),
      ('void-cancelled-payments',        '10 * * * *'),
      ('auto-resolve-disputes',          '21 */6 * * *'),
      ('expire-subscriptions',           '9 8 * * *'),
      -- lifecycle
      ('auto-expire-jobs',               '0 * * * *'),
      -- delivery
      ('process-email-queue',            '3-58/5 * * * *'),
      ('saved-helper-availability-push', '41 */6 * * *'),
      ('daily-match-digest',             '12 13 * * *'),
      ('weekly-helper-report',           '19 14 * * 1'),
      ('engagement-automations',         '22 16 * * *'),
      ('review-nag-cron',                '26 16 * * *'),
      -- housekeeping
      ('cleanup-abandoned-accounts',     '11 9 * * *'),
      ('cleanup-notifications',          '16 9 * * *')
    ) AS t(jobname, schedule)
  LOOP
    IF EXISTS (SELECT 1 FROM cron.job j WHERE j.jobname = v_target.jobname) THEN
      -- Already scheduled here. Leave the live command alone — see header.
      v_kept := v_kept + 1;
      CONTINUE;
    END IF;

    PERFORM cron.schedule(
      v_target.jobname,
      v_target.schedule,
      format(
        $cmd$
          SELECT net.http_post(
            url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'supabase_url' LIMIT 1)
                   || '/functions/v1/%s',
            headers := jsonb_build_object(
              'Content-Type', 'application/json',
              'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1)
            ),
            body := '{}'::jsonb
          );
        $cmd$,
        v_target.jobname
      )
    );
    v_created := v_created + 1;
  END LOOP;

  RAISE NOTICE 'HTTP cron declarations: % created, % already present', v_created, v_kept;
END;
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- Reap instant_payouts rows stranded in 'pending'.
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Filed in this migration rather than its own because it is the same class of
-- gap and lands in the same place: a pg_cron entry that has to exist in version
-- control or it does not exist anywhere.
--
-- ── The lock nobody could open ──────────────────────────────────────────────
--
-- `instant-payout/index.ts` INSERTs an `instant_payouts` row at status
-- 'pending', calls Stripe, and then writes the outcome. Both outcome writes
-- were bare `.eq("id", record.id)` updates — the failure one did not even
-- destructure `error` — so a rejected or zero-row write left the row at
-- 'pending'.
--
-- 'pending' is the exact predicate of `instant_payouts_one_pending_per_helper`
-- (20260823010000), the partial unique index that stops a double-tap from
-- minting two payouts. One stranded row therefore blocks EVERY future instant
-- payout for that helper, permanently. There was no sweeper, no timeout, no
-- admin tool and no report: the helper simply finds a paid feature dead, with
-- no way to say why and nobody able to see it from this side.
--
-- The edge function's writes are now guarded (`.select("id")` + a
-- `status='pending'` precondition + an explicit zero-row branch that alerts),
-- which stops NEW strandings. This reaper is the recovery that never existed
-- for the ones that get through anyway — a crashed invocation, an edge-function
-- timeout mid-Stripe-call, a DB blip between the payout and the write.
--
-- ── Why releasing the lock cannot cause a double payout ─────────────────────
--
-- The obvious fear is that reaping re-enables a retry for a payout that
-- actually went out. It cannot pay the same money twice: instant-payout derives
-- its amount from the LIVE Stripe balance
-- (`balance.instant_available`, index.ts:110-112), not from anything stored. If
-- the first payout succeeded, that balance is already reduced, so a retry moves
-- only what genuinely remains. The row's own truth still has to be reconciled
-- by a human, which is why every reap is logged and paged rather than silently
-- healed.
--
-- 30 minutes is far outside any legitimate in-flight window — a Stripe instant
-- payout returns in seconds, and the whole function is bounded by the edge
-- runtime's own timeout.
--
-- REPLAY-SAFETY: `instant_payouts` is created by 20260420161904 and
-- `error_logs` well before that, both earlier than this file. `status` carries
-- no CHECK constraint, so 'failed' is accepted. CREATE OR REPLACE throughout.

CREATE OR REPLACE FUNCTION public.reap_stranded_instant_payouts()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_reaped  int := 0;
  v_helpers text[] := ARRAY[]::text[];
  r         record;
BEGIN
  -- A data-modifying statement cannot be the direct query of a plpgsql FOR
  -- loop, so the UPDATE is wrapped in a CTE and its RETURNING rows selected.
  FOR r IN
    WITH reaped AS (
      UPDATE public.instant_payouts p
         SET status = 'failed',
             -- Never overwrite what the function managed to record: a
             -- `fee_uncollected:` marker is written BEFORE the outcome write
             -- and is the only trace of a fee that stayed with the helper.
             error_message = COALESCE(p.error_message || ' | ', '') ||
               'reaped: stranded at pending for over 30 minutes and the edge function never recorded an outcome. '
               'The Stripe payout may or may not have been sent — check the connected account before assuming either. '
               'Released so the helper is not locked out of instant payouts.',
             updated_at = now()
       WHERE p.status = 'pending'
         AND p.created_at < now() - interval '30 minutes'
      RETURNING p.id, p.helper_id, p.net_amount, p.created_at
    )
    SELECT * FROM reaped
  LOOP
    v_reaped := v_reaped + 1;
    IF NOT (r.helper_id::text = ANY (v_helpers)) THEN
      v_helpers := v_helpers || r.helper_id::text;
    END IF;

    INSERT INTO public.error_logs (severity, message, tags, context)
    VALUES (
      'error',
      format('Instant payout %s was stranded in pending since %s and has been reaped', r.id, r.created_at),
      jsonb_build_object('source', 'instant-payout-reaper', 'area', 'payouts', 'helper', r.helper_id::text),
      jsonb_build_object('instant_payout_id', r.id,
                         'helper_id',         r.helper_id,
                         'net_amount',        r.net_amount,
                         'created_at',        r.created_at,
                         'why', 'A pending row blocks instant_payouts_one_pending_per_helper, locking the helper out of the feature. Verify in Stripe whether the payout actually went out.'));
  END LOOP;

  IF v_reaped > 0 THEN
    BEGIN
      PERFORM net.http_post(
        url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'supabase_url' LIMIT 1)
               || '/functions/v1/slack-ops-alert',
        headers := jsonb_build_object(
          'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1),
          'Content-Type', 'application/json'),
        body := jsonb_build_object(
          'title', format('%s stranded instant payout(s) reaped', v_reaped),
          'message', format(
            'These rows sat at status=pending for over 30 minutes, which blocks every further instant payout for the helper. They have been moved to failed so the helper is not locked out. VERIFY IN STRIPE whether each payout actually went out — the row does not know. Helpers: %s. Detail in error_logs (tags.source = instant-payout-reaper).',
            array_to_string(v_helpers, ', ')),
          'severity', 'error'));
    EXCEPTION WHEN OTHERS THEN
      -- Never let the notifier undo the reap. The error_logs rows above stand.
      NULL;
    END;
  END IF;

  RETURN jsonb_build_object('reaped', v_reaped, 'helpers', to_jsonb(v_helpers));
END;
$fn$;

REVOKE ALL ON FUNCTION public.reap_stranded_instant_payouts() FROM PUBLIC, anon, authenticated;

-- Hourly at :34 — a minute nothing else uses in the map set by 20260829010000
-- (process-email-queue lands on 3,8,…,53,58; auto-release-payment on 5 and 35).
-- SQL-only, so it never produces an http_response of its own to attribute.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RAISE NOTICE 'pg_cron not installed — skipping reap-stranded-instant-payouts schedule';
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'reap-stranded-instant-payouts') THEN
    PERFORM cron.unschedule('reap-stranded-instant-payouts');
  END IF;

  PERFORM cron.schedule(
    'reap-stranded-instant-payouts',
    '34 * * * *',
    $cron$SELECT public.reap_stranded_instant_payouts();$cron$
  );
END;
$$;
