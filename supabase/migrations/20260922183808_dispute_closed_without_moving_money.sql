-- A dispute can be 'executed' having moved nothing, and nothing notices.
--
-- ── What one enum value is being asked to mean ─────────────────────────────
-- `disputes.execution_status = 'executed'` is written by TWO different paths
-- that mean opposite things about money:
--
--   execute-dispute-split   really moved it. Records what moved:
--                           execution_transfer_id / execution_refund_id, and
--                           execution_helper_cents / execution_refund_cents.
--   auto-resolve-disputes   closed the record only. `closeDisputeRecord()`
--                           passes `_helper_cents: null, _transfer_id: null`
--                           on purpose — its own comment says a fabricated $0
--                           "would be a claim about money that is simply
--                           false". The transfer is meant to happen later.
--
-- Nothing distinguishes them, and after the second one BOTH automatic doors
-- are shut, by different rules:
--
--   process-scheduled-payouts  `.is("disputed_at", null)` (index.ts:82,
--                              "defense-in-depth: never pay out disputed
--                              jobs") — excluded, `disputed_at` is set.
--   claim_dispute_settlement   gates on `execution_status IS DISTINCT FROM
--                              'executed'` — excluded, it IS 'executed'.
--
-- The manual door stays open: `release-payout` uses `_shared/unsettledDispute
-- .ts`, whose blocker fires on `.or("execution_status.is.null,execution_status
-- .neq.executed")`, so an 'executed' dispute passes and an admin can release
-- it by hand. That is why this is a SILENT DEPENDENCE ON A HUMAN rather than a
-- permanent strand — and exactly why it needs a detector. Nobody is told.
--
-- ── Measured live, 2026-09-22, and NARROWER than "transfer_id IS NULL" ──────
-- Both 'executed' disputes on prod have a NULL execution_transfer_id, and only
-- one of them is owed anything:
--
--   28c4943d  split {helper:0, poster:1}  refund re_3UH3JZKp2H4b7tEC14591UJd
--             execution_refund_cents 2689, payment_status 'refunded'
--             -> SETTLED. A poster-100% decision moves money by REFUND, not by
--                Connect transfer, so a NULL transfer id is correct here.
--
--   9756a585  split {helper:1, poster:0}  transfer NULL, refund NULL,
--             helper_cents NULL, refund_cents NULL, error NULL
--             job e6979a12 'payout_pending' since 2026-09-17
--             -> OWED. Closed on 2026-09-16 by auto-resolve-disputes having
--                moved nothing, and the Helpr is owed 100%.
--
-- So the discriminator is NOT the transfer id. It is that EVERY money field is
-- empty: no transfer, no refund, no cents either way, and no error to explain
-- it. A dispute that moved money always records HOW. One that recorded nothing
-- did nothing. Keying on the transfer id alone would page on every
-- poster-100% refund forever — a false alarm on the most ordinary outcome
-- there is, which is how a detector gets muted and stops being read.
--
-- `execution_error` is checked too: a row that FAILED is already a different,
-- visible state with its own message, and re-reporting it here would just
-- duplicate it under a wrong name.
--
-- ── Severity, and why it is not one level ──────────────────────────────────
-- Graded on the JOB, not the dispute: real money owed to a real person pages;
-- a seeded fixture in the same state is a correctness signal for the daily
-- digest. Same split, and the same reason, as the auth/transactional DLQ
-- grading in 20260922155258.
--
--   is_seed = false  -> 'fatal'  -> pages #ops-alerts via trg_error_logs_slack
--   is_seed = true   -> 'error'  -> send_ops_daily_digest(), 14:40 UTC
--
-- Two `tags.source` values, not one: the Slack trigger suppresses a post when
-- another row with the SAME source was written in the last 10 minutes, so
-- sharing a source would let a seed row silence a real page written by the
-- same sweep. (The bug 20260922155258 records and avoids.)
--
-- No `net.http_post` of its own — the fatal row pages through the trigger, and
-- a direct post beside it would double-post one condition.
--
-- ── Deduped on IDENTITY, so it reports once and never nags ─────────────────
-- 20260914183932 records what a looping alert costs: 616 rows in three days.
-- An hourly sweep that wrote a row whenever the condition held would do the
-- same more slowly — 9756a585 alone would produce 24 rows a day forever.
--
-- So the memory is the SET OF DISPUTE IDS already reported, not a clock. A
-- dispute is reported the first hour it qualifies and never again; a NEW one
-- is always reported, because its id has never been recorded. A time window
-- would have to choose between re-paging forever and going quiet on a real new
-- strand. This has to do neither. Same shape as `sweep_cron_blackouts`
-- (dedupes on `context.gap_start`) and `sweep_email_dlqs` (on the DLQ's
-- highest pgmq msg_id).
--
-- DETECTION ONLY. This settles nothing and pays nobody: releasing 9756a585 is
-- an admin decision about real-shaped money, and a sweep that moved funds on
-- its own would be a far worse thing to have written than the gap it closes.
--
-- Replay-safe: CREATE OR REPLACE, every table reference guarded by
-- `to_regclass`, cron unschedule-then-schedule, expectation row an upsert.

CREATE OR REPLACE FUNCTION public.sweep_disputes_closed_without_payment()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_reported int   := 0;
  v_seen     jsonb := '[]'::jsonb;
  r          record;
BEGIN
  -- A from-scratch replay (PGlite, a fresh branch) may not have these yet.
  -- Nothing to look at is not a defect to report.
  IF to_regclass('public.disputes') IS NULL
     OR to_regclass('public.jobs') IS NULL
     OR to_regclass('public.error_logs') IS NULL THEN
    RETURN jsonb_build_object('reported', 0, 'skipped', 'tables not present');
  END IF;

  FOR r IN
    SELECT d.id                AS dispute_id,
           d.job_id            AS job_id,
           d.payout_split      AS payout_split,
           d.decided_at        AS decided_at,
           j.payment_status    AS payment_status,
           j.status            AS job_status,
           COALESCE(j.is_seed, false) AS is_seed
      FROM public.disputes d
      JOIN public.jobs j ON j.id = d.job_id
     WHERE d.execution_status = 'executed'
       -- Moved nothing, by any route, and said nothing about why.
       AND d.execution_transfer_id IS NULL
       AND d.execution_refund_id   IS NULL
       AND COALESCE(d.execution_helper_cents, 0) = 0
       AND COALESCE(d.execution_refund_cents, 0) = 0
       AND d.execution_error IS NULL
       -- The funds are still held. A job already refunded or paid out is
       -- settled by some other path and is not owed anything here.
       AND j.payment_status IN ('escrow', 'payout_pending')
       -- Never reported before. The dedupe.
       AND NOT EXISTS (
             SELECT 1
               FROM public.error_logs e
              WHERE e.tags ->> 'area' = 'dispute-unsettled'
                AND e.context ->> 'dispute_id' = d.id::text)
     ORDER BY d.decided_at NULLS LAST
  LOOP
    INSERT INTO public.error_logs (severity, message, tags, context)
    VALUES (
      CASE WHEN r.is_seed THEN 'error' ELSE 'fatal' END,
      format('Dispute %s on job %s is marked executed but moved no money: no transfer, no refund, no cents, no error. The job has been %s since %s UTC and neither process-scheduled-payouts (excluded by disputed_at) nor claim_dispute_settlement (excluded by execution_status) will ever pay it. Split %s. Only a manual release-payout can settle it.',
             left(r.dispute_id::text, 8),
             left(r.job_id::text, 8),
             r.payment_status,
             to_char(r.decided_at AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI'),
             COALESCE(r.payout_split::text, 'unrecorded')),
      jsonb_build_object('source', CASE WHEN r.is_seed
                                        THEN 'dispute-unsettled-seed'
                                        ELSE 'dispute-unsettled' END,
                         'area', 'dispute-unsettled'),
      jsonb_build_object('dispute_id',     r.dispute_id,
                         'job_id',         r.job_id,
                         'payout_split',   r.payout_split,
                         'payment_status', r.payment_status,
                         'job_status',     r.job_status,
                         'decided_at',     r.decided_at,
                         'is_seed',        r.is_seed));

    v_reported := v_reported + 1;
    v_seen := v_seen || jsonb_build_object('dispute_id', r.dispute_id,
                                           'job_id',     r.job_id,
                                           'is_seed',    r.is_seed,
                                           'severity',   CASE WHEN r.is_seed
                                                              THEN 'error' ELSE 'fatal' END);
  END LOOP;

  RETURN jsonb_build_object('reported', v_reported, 'disputes', v_seen);
END;
$fn$;

REVOKE ALL ON FUNCTION public.sweep_disputes_closed_without_payment()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sweep_disputes_closed_without_payment()
  TO service_role;

COMMENT ON FUNCTION public.sweep_disputes_closed_without_payment() IS
  'Reports a dispute stamped execution_status=''executed'' that recorded no transfer, no refund, no cents and no error while its job still holds funds — the state auto-resolve-disputes leaves behind, in which both automatic payout doors are shut and only a manual release-payout can settle it. Non-seed jobs write a fatal error_logs row (pages via trg_error_logs_slack); seed jobs write an error row for the daily digest. Deduped on the dispute id, so each is reported exactly once. Detection only: it moves no money.';

-- ── Scheduled ──────────────────────────────────────────────────────────────
-- Hourly at :43. A stranded payout is not urgent to the minute — what matters
-- is that somebody is told at all, today rather than in fifteen days. :43 is
-- free in cron.job and sits well clear of the two jobs whose output it reads:
-- auto-resolve-disputes (:21, every 6h) and process-scheduled-payouts (:20).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RAISE NOTICE 'pg_cron not installed — skipping sweep-disputes-unsettled';
    RETURN;
  END IF;
  PERFORM cron.unschedule('sweep-disputes-unsettled')
    WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'sweep-disputes-unsettled');
  PERFORM cron.schedule('sweep-disputes-unsettled', '43 * * * *',
    $cron$SELECT public.sweep_disputes_closed_without_payment();$cron$);
END;
$$;

-- The watcher gets watched, house rule from 20260901030926: interval plus real
-- slack, so one missed firing never pages and several consecutive ones do.
DO $$
BEGIN
  IF to_regclass('public.cron_work_expectations') IS NULL THEN
    RETURN;
  END IF;
  INSERT INTO public.cron_work_expectations (jobname, expected_max_gap)
  VALUES ('sweep-disputes-unsettled', interval '4 hours')
  ON CONFLICT (jobname) DO UPDATE SET expected_max_gap = EXCLUDED.expected_max_gap;
END;
$$;
