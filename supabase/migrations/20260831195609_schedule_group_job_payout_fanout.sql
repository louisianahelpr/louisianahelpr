-- Restore the ONLY payout path that can pay a multi-helper (group) job.
--
-- ── The hole ────────────────────────────────────────────────────────────────
--
-- Group jobs hold ONE escrow for the whole budget and split it N ways at
-- completion (20260804122000_accept_group_application, header). Two functions
-- can move that money:
--
--   * `release-payout` — a single linear payout for ONE helper. It REFUSES a
--     multi-helper roster outright rather than pay 1 of N
--     (release-payout/index.ts:160-209: `if (job.is_group_job &&
--     (job.helpers_needed ?? 1) > 1)` → HTTP 409 plus a critical Slack page).
--     That refusal is correct and must stay.
--
--   * `process-scheduled-payouts` — the fan-out path. It flattens each job to
--     one (job, helper) pair per `group_job_helpers` row
--     (process-scheduled-payouts/index.ts:119-146), writes a ledger row and a
--     Stripe transfer per helper, and — crucially — holds the job in
--     `payout_pending` until every roster slot is settled before flipping it to
--     `released` (index.ts:559-575).
--
-- 20260618130000_unschedule_legacy_payout_cron UNSCHEDULED the second one, on
-- the grounds that it raced `release-payout` on the same `payout_pending` jobs
-- "with no shared idempotency guard". Correct at the time. But nothing took
-- over its group-job duty, so from that migration onward a multi-helper job had
-- NO automatic payout path at all:
--
--   auto-release-payment Phase 1  → job goes to payment_status='payout_pending'
--   auto-release-payment Phase 2  → invokes release-payout
--   release-payout                → 409, refuses every group job, forever
--
-- The helpers on that roster are never paid and the escrow sits on the platform
-- balance. `process-scheduled-payouts` is invoked from nowhere else in the
-- repository — not from an admin action, not from another edge function, not
-- from a script (verified 2026-08-31: every hit is a comment or a unit test).
-- `cron_run_log` has ZERO rows for it over the whole retained window.
--
-- ── Why re-scheduling is safe NOW when it was not in June ───────────────────
--
-- The race 20260618130000 named is closed. 20260831190418 added the claiming
-- write and its partial unique index:
--
--   CREATE UNIQUE INDEX payout_transfers_one_live_per_job_helper
--     ON public.payout_transfers (job_id, helper_id)
--     WHERE status IN ('pending', 'paid', 'reversed');
--
-- and BOTH functions now route every transfer through `_shared/payoutClaim.ts`
-- (`release-payout/index.ts:584`, `process-scheduled-payouts/index.ts:406`).
-- The ledger row is INSERTed with status='pending' BEFORE Stripe is called, so
-- exactly one concurrent claimant wins and every other one gets 23505 and
-- stands down without ever reaching `stripe.transfers.create`. The two writers
-- can no longer double-pay a helper — which is the entire reason the second one
-- was retired.
--
-- ── Schedule choice ─────────────────────────────────────────────────────────
--
-- Hourly at :20. 20260829010000_stagger_http_cron_schedules assigns :00
-- (auto-expire-jobs), :05/:35 (auto-release-payment), :07 (auto-tip-charge),
-- :10 (void-cancelled-payments), :17 (backfill-job-geocode), :34
-- (reap-stranded-instant-payouts) and every minute ≡ 3 (mod 5) to
-- process-email-queue. :20 collides with none of them, and sits 15 minutes from
-- the nearest auto-release-payment run — far outside payoutClaim's 2-minute
-- OPEN_CLAIM_INFLIGHT_MS window, so in practice the two never even contend.
--
-- Single-helper jobs are settled by auto-release-payment's Phase 2 minutes
-- earlier and leave `payout_pending` before this sweep looks, so this cron's
-- normal working set is exactly the group jobs the other path refuses. When it
-- does overlap, the claim decides; it cannot pay twice.
--
-- ── Blast radius today ──────────────────────────────────────────────────────
--
-- Verified read-only against production 2026-08-31: 2 group jobs exist, both
-- `is_seed = true` (one cancelled, one open with a null payment intent), and
-- `group_job_helpers` has ZERO rows, ever. `payout_transfers` holds exactly one
-- row in its entire history and it is a single-helper job. So no live money is
-- waiting on this and no back-payment is triggered by turning it on — this
-- closes the hole BEFORE the first real group job lands, which is the only good
-- time to do it. The function's own `is_seed = false` filter
-- (process-scheduled-payouts/index.ts:82) keeps the two fixtures out of the
-- sweep.
--
-- ── Still required, in the functions themselves (patch spec, not this file) ──
--
-- auto-release-payment Phase 2 will keep handing group jobs to release-payout
-- every 30 minutes and collecting 409s, each one a CRITICAL Slack page, until
-- its 5-attempt give-up fires. Its `dueQuery2` needs to exclude
-- `is_group_job = true AND helpers_needed > 1` so the two paths own disjoint
-- sets. That change belongs to whoever owns those files.
--
-- REPLAY-SAFETY: pg_cron may not be installed on a from-scratch rebuild, so the
-- block returns early in that case. `cron.unschedule` throws when the job is
-- absent, so it is guarded on existence rather than swallowed. Vault secrets are
-- read at cron RUN time, not here, so a database without them still migrates.
-- The command shape is byte-identical to the one 20260831190419 uses for every
-- other HTTP cron.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RAISE NOTICE 'pg_cron not installed — skipping process-scheduled-payouts schedule';
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'process-scheduled-payouts') THEN
    PERFORM cron.unschedule('process-scheduled-payouts');
  END IF;

  PERFORM cron.schedule(
    'process-scheduled-payouts',
    '20 * * * *',
    $cron$
      SELECT net.http_post(
        url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'supabase_url' LIMIT 1)
               || '/functions/v1/process-scheduled-payouts',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1)
        ),
        body := '{}'::jsonb
      );
    $cron$
  );
END $$;
