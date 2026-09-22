-- 25 of 26 HTTP crons gave up after 5s — less than an edge function's cold start.
--
-- ── WHAT THIS IS AND IS NOT ────────────────────────────────────────────────
-- THIS DOES NOT FIX LOST WORK, BECAUSE NO WORK WAS LOST. Measured first, and
-- it changed what the fix should be:
--
--   `net.http_post` is ASYNCHRONOUS. `timeout_milliseconds` is how long the
--   pg_net background worker WAITS FOR THE RESPONSE. It does not cancel the
--   request and it cannot stop the edge function, which has already been
--   invoked and runs to completion either way.
--
-- Proof that the work happens: `process-email-queue` logged 23 "Cron HTTP
-- timeout" rows in 7 days, and all four of its queues are EMPTY right now —
-- q_transactional_emails, q_auth_emails, and both DLQs, depth 0. A drainer
-- that was really failing one run in four would show a backlog. It shows none.
--
-- (An earlier reading of mine was wrong and is corrected here: I classified
-- these as "DNS failures" by matching any message containing "DNS time",
-- which also matches `DNS time: 0`. Of 185 cron-http rows in 7 days, 82 are
-- genuinely DNS-slow and 103 are the caller timing out while DNS was fast.)
--
-- ── WHAT IT DOES FIX: WE NEVER LEARN THE ANSWER ────────────────────────────
-- pg_net records the OUTCOME when the response arrives. Give up at 5s and the
-- row says "timeout" whatever actually happened, so:
--
--   * a slow SUCCESS and a slow 500 are indistinguishable — and slow failures
--     are exactly the ones worth seeing. `marketing-publish returned 500` was
--     only ever visible because it answered inside 5 seconds;
--   * 103 rows/week of false alarm sit in error_logs, and as of today every
--     severity posts to Slack, so noise here is no longer free;
--   * `sweep_cron_http_failures` grades a job on those rows, so its verdict is
--     built on a measurement that cannot tell success from failure.
--
-- 5000ms was never chosen — it is pg_net's DEFAULT, and 25 of 26 jobs simply
-- never passed the argument. A Deno cold start alone can be 2-5s before the
-- function body has run a line.
--
-- 30s is the new wait: comfortably past cold start plus real work, and well
-- inside the edge runtime's own limit, so the response is collected and the
-- recorded outcome is the TRUE one.
--
-- ── SAFETY OF THE REWRITE ──────────────────────────────────────────────────
-- Every command is rewritten mechanically, and only when it is unambiguous:
--   * it must contain exactly ONE `net.http_post(` — a command with two calls
--     is left alone rather than half-rewritten;
--   * it must not already set `timeout_milliseconds` (so this is idempotent
--     and replay-safe; running it three times changes nothing after the first);
--   * `net.http_post` takes all-named arguments, so prepending one named
--     argument is valid wherever the others sit.
-- Anything skipped is RAISED as a notice naming the job, so a silent
-- non-rewrite is impossible.

DO $$
DECLARE
  r          record;
  v_new      text;
  v_done     int := 0;
  v_skipped  text[] := '{}';
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RAISE NOTICE 'pg_cron not installed — nothing to re-schedule';
    RETURN;
  END IF;
  IF to_regprocedure('net.http_post(text,jsonb,jsonb,jsonb,integer)') IS NULL THEN
    RAISE NOTICE 'pg_net signature not as expected — leaving cron commands untouched';
    RETURN;
  END IF;

  FOR r IN
    SELECT jobid, jobname, schedule, command
      FROM cron.job
     WHERE command LIKE '%net.http_post(%'
       AND command NOT LIKE '%timeout_milliseconds%'
  LOOP
    -- Exactly one call, or leave it alone.
    IF (length(r.command) - length(replace(r.command, 'net.http_post(', ''))) 
       / length('net.http_post(') <> 1 THEN
      v_skipped := v_skipped || (r.jobname || ' (more than one net.http_post call)');
      CONTINUE;
    END IF;

    v_new := replace(r.command, 'net.http_post(', 'net.http_post(timeout_milliseconds := 30000, ');
    PERFORM cron.schedule(r.jobname, r.schedule, v_new);
    v_done := v_done + 1;
  END LOOP;

  RAISE NOTICE 'http cron timeout: % job(s) now wait 30s for the response', v_done;
  IF array_length(v_skipped, 1) > 0 THEN
    RAISE NOTICE 'http cron timeout: SKIPPED %, rewrite by hand: %',
      array_length(v_skipped, 1), array_to_string(v_skipped, '; ');
  END IF;
END;
$$;
