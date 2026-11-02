-- Informational error_logs rows never become ops-alert ledger items (owner, 11-02).
--
-- The owner closed Q2545 ("sweep_old_notifications: deleted # rows (# read, #
-- unread)", seen twice): the notifications sweeper writes one severity-info
-- error_logs row each run that deleted something, so admins can see it ran.
-- trg_error_logs_zz_ledger folded that receipt into public.ops_alert_ledger,
-- and open-sync-trackers mirrored it into docs/OPEN.md as a defect to fix.
--
-- ops_alert_ledger_from_error_log is restated from 20260923052520, its newest
-- definition (prosrc on prod read 11-02 matches that file byte for byte). Its
-- one change: 'sweep_old_notifications' joins the sources it skips, beside
-- 'ops-alert' and 'ops-digest'. The error_logs row itself is unchanged, and so
-- is the Slack trigger. Guard: src/test/informationalAlertsNeverReachTheLedger.test.ts.
--
-- Replay-safe: CREATE OR REPLACE of a trigger function; the trigger already
-- points at it by name.

CREATE OR REPLACE FUNCTION public.ops_alert_ledger_from_error_log()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_tags   jsonb := CASE WHEN jsonb_typeof(NEW.tags) = 'object' THEN NEW.tags ELSE '{}'::jsonb END;
  v_source text;
BEGIN
  -- Same trust line as notify_slack_on_error_log: a browser can write these.
  IF v_tags ->> 'origin' = 'client' THEN
    RETURN NULL;
  END IF;
  -- Seed/E2E data: listed in the daily digest under its '-seed' source, not a
  -- to-do in the ledger (20260923052520). Same predicate as the Slack trigger.
  IF public.error_log_is_seed(v_tags) THEN
    RETURN NULL;
  END IF;
  v_source := coalesce(v_tags ->> 'source', v_tags ->> 'area', 'app');
  -- postSlackOpsAlert records its own ledger entry; ops-digest is the digest's
  -- delivery receipt (read by check_ops_digest_delivery), not an alert.
  -- sweep_old_notifications' info row is its own "I ran, deleted N" receipt
  -- (owner closed Q2545 11-02: an intended notice, not a defect). The row stays
  -- in error_logs for anyone checking the sweeper; it is never a ledger item.
  IF v_source IN ('ops-alert', 'ops-digest', 'sweep_old_notifications') THEN
    RETURN NULL;
  END IF;

  BEGIN
    PERFORM public.ops_alert_record(
      'error_logs',
      v_source,
      split_part(coalesce(NEW.message, ''), ' — ', 1),
      coalesce(NEW.severity, 'error'),
      left(coalesce(NEW.message, ''), 1000),
      jsonb_strip_nulls(jsonb_build_object(
        'error_log_id', NEW.id,
        'job', v_tags ->> 'job',
        'job_id', v_tags ->> 'job_id',
        'queue', v_tags ->> 'queue',
        'url', NEW.url)),
      NULL, NULL,
      coalesce(NEW.created_at, now()));
  EXCEPTION WHEN OTHERS THEN
    -- The ledger must never take down the write that raised the alert. Loud in
    -- the Postgres log, and the error_logs row itself still exists.
    RAISE WARNING 'ops_alert_ledger_from_error_log: % (error_logs.id=%)', SQLERRM, NEW.id;
  END;
  RETURN NULL;
END;
$fn$;

REVOKE ALL ON FUNCTION public.ops_alert_ledger_from_error_log() FROM PUBLIC, anon, authenticated;
