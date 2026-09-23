-- Ops alert ledger (docs/OPEN.md Q1).
--
-- Owner standing order, 2026-09-23: "Every alert, from anywhere, is fixed AND
-- verified fixed. Posted is not handled." Until now an alert was a Slack
-- message and, sometimes, an error_logs row. Neither is a to-do: the message
-- scrolls away and the rows are a log. Nothing said which alerts were still
-- true, so "handled" meant "someone saw it".
--
-- ── WHAT THIS ADDS ─────────────────────────────────────────────────────────
-- ONE row per alert FINGERPRINT = md5(source_kind | source | normalised
-- title), where the title has uuids, Stripe ids, hex ids, emails and numbers
-- stripped, so "Stuck payment on job 5eed0a10…" and "… on job ab12cd34…" are
-- one item, not two. Each row carries first_seen / last_seen / count /
-- severity / a sample, and a status:
--
--   open       the alert fired and nobody has shown it cleared
--   verifying  someone says it is fixed; waiting for the detector to agree
--   closed     the alert's own detector was RE-RUN and showed it cleared
--
-- Any new occurrence re-opens a closed or verifying item (reopen_count + 1).
--
-- ── HOW AN ITEM CLOSES (never "it went quiet") ─────────────────────────────
-- Every existing detector DEDUPES its own reports (per day, per response id,
-- per DLQ high-water mark — read from pg_get_functiondef on prod 2026-09-23),
-- so "the detector ran again and said nothing" is NOT evidence the condition
-- cleared. So each item names a verify hook:
--
--   sql_condition  ops_alert_condition(source, sample_ref, last_seen) re-asks
--                  the detector's QUESTION directly (not its dedupe):
--                    detect_stuck_payments   same predicate as the detector
--                    ops-digest-undelivered  check_ops_digest_delivery()->ok
--                    email-dlq-*             pgmq DLQ depth > 0
--                    cron-dead, cron-startup-timeout
--                                            no succeeded cron.job_run_details
--                                            run of that job since last_seen
--                  ops_alert_verify() evaluates them and closes the cleared.
--   workflow       closed by scripts/ops-alert-ledger.mjs sync when the named
--                  workflow's newest run on main is green AND started after
--                  last_seen, or the nightly-red issue was closed by the sync
--                  step's own green run. The workflow IS the detector.
--   companions     a Slack post (edge or SQL) that summarises error_logs
--                  rows closes when those rows' items (seen in the 5 minutes
--                  up to the post) all exist and are all closed.
--   manual         no automatable question yet. Closed only through
--                  ops_alert_close(id, evidence, rerun_started_at), which
--                  refuses unless the stated re-run started AFTER last_seen and
--                  the evidence says what was run.
--
-- ── WHO WRITES IT ──────────────────────────────────────────────────────────
--  * trg_error_logs_zz_ledger (AFTER INSERT on error_logs): every SERVER row,
--    every severity. Client-origin rows are skipped for the same reason the
--    Slack trigger skips them: a browser can write them. 'ops-alert' rows are
--    skipped because postSlackOpsAlert records its own ledger entry; the
--    'ops-digest' row is the digest's delivery receipt, not an alert.
--  * postSlackOpsAlert (edge) and the slack-ops-alert function (every SQL
--    caller) call ops_alert_record directly.
--  * GitHub workflows that post to Slack run `ops-alert-ledger.mjs record`;
--    open nightly-red / prod-down / prod-errors / supabase-usage issues are
--    synced in by `ops-alert-ledger.mjs sync`.
--  src/test/opsAlertLedgerCoverage.test.ts fails if any Slack path skips it.
--
-- A ledger write can never break the thing that raised the alert: the trigger
-- swallows its own failure (and says so with a WARNING), and callers treat the
-- RPC as best-effort. Nothing is muted: Slack posting is untouched.
--
-- Access: service_role writes through the SECURITY DEFINER functions only;
-- admins may SELECT (the /admin?view=health card). No anon access at all.

-- ── 1. table ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ops_alert_ledger (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fingerprint       text NOT NULL UNIQUE,
  source_kind       text NOT NULL,
  source            text NOT NULL,
  title             text NOT NULL,
  severity          text NOT NULL,
  sample            text,
  sample_ref        jsonb NOT NULL DEFAULT '{}'::jsonb,
  first_seen        timestamptz NOT NULL DEFAULT now(),
  last_seen         timestamptz NOT NULL DEFAULT now(),
  count             bigint NOT NULL DEFAULT 1,
  status            text NOT NULL DEFAULT 'open',
  verify_kind       text NOT NULL DEFAULT 'manual',
  verify_ref        text,
  verify_note       text,
  verify_started_at timestamptz,
  closed_at         timestamptz,
  closed_evidence   text,
  reopen_count      integer NOT NULL DEFAULT 0,
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ops_alert_ledger_source_kind_chk
    CHECK (source_kind IN ('error_logs', 'edge_slack', 'sql_slack', 'workflow', 'nightly_red', 'sentry')),
  CONSTRAINT ops_alert_ledger_severity_chk
    CHECK (severity IN ('fatal', 'critical', 'error', 'warning', 'info')),
  CONSTRAINT ops_alert_ledger_status_chk
    CHECK (status IN ('open', 'verifying', 'closed')),
  CONSTRAINT ops_alert_ledger_verify_kind_chk
    CHECK (verify_kind IN ('sql_condition', 'workflow', 'companions', 'manual')),
  CONSTRAINT ops_alert_ledger_closed_has_evidence_chk
    CHECK (status <> 'closed' OR (closed_at IS NOT NULL AND length(coalesce(closed_evidence, '')) >= 10))
);

CREATE INDEX IF NOT EXISTS ops_alert_ledger_open_idx
  ON public.ops_alert_ledger (last_seen DESC) WHERE status <> 'closed';

ALTER TABLE public.ops_alert_ledger ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.ops_alert_ledger FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.ops_alert_ledger TO authenticated;
GRANT ALL ON TABLE public.ops_alert_ledger TO service_role;

DROP POLICY IF EXISTS ops_alert_ledger_admin_read ON public.ops_alert_ledger;
CREATE POLICY ops_alert_ledger_admin_read
  ON public.ops_alert_ledger
  FOR SELECT
  TO authenticated
  USING (public.has_role((SELECT auth.uid()), 'admin'::public.app_role));

COMMENT ON TABLE public.ops_alert_ledger IS
  'One row per alert fingerprint (source_kind|source|normalised title). Open until the alert''s own detector is re-run and shows it cleared (verify_kind). Written only via ops_alert_record/ops_alert_verify/ops_alert_close; admins read it on /admin?view=health. docs/OPEN.md Q1.';

-- ── 2. normalisation ────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.ops_alert_normalise(p_text text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $fn$
  SELECT left(btrim(regexp_replace(
    regexp_replace(
    regexp_replace(
    regexp_replace(
    regexp_replace(
    regexp_replace(
    regexp_replace(lower(coalesce(p_text, '')),
      '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}', '<id>', 'g'),
      '\m(pi|ch|tr|po|py|re|in|cs|pm|acct|cus|evt|sub|seti|txn|src|ba|card|dp|ipi|price|prod|whsec)_[a-z0-9]{6,}', '<id>', 'g'),
      '[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}', '<email>', 'g'),
      'https?://[^ )]+', '<url>', 'g'),
      '\m(?=[a-f]*[0-9])[0-9a-f]{6,}\M', '<id>', 'g'),
      '[0-9]+([.,:][0-9]+)*', '#', 'g'),
    '\s+', ' ', 'g')), 200)
$fn$;

REVOKE ALL ON FUNCTION public.ops_alert_normalise(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ops_alert_normalise(text) TO service_role;

-- ── 3. record (the one write path for new occurrences) ─────────────────────
CREATE OR REPLACE FUNCTION public.ops_alert_record(
  p_source_kind text,
  p_source      text,
  p_title       text,
  p_severity    text,
  p_sample      text  DEFAULT NULL,
  p_sample_ref  jsonb DEFAULT '{}'::jsonb,
  p_verify_kind text  DEFAULT NULL,
  p_verify_ref  text  DEFAULT NULL,
  p_seen_at     timestamptz DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_source   text := left(coalesce(nullif(btrim(p_source), ''), 'unknown'), 120);
  v_title    text := public.ops_alert_normalise(p_title);
  v_sev      text := CASE lower(coalesce(p_severity, ''))
                       WHEN 'fatal' THEN 'fatal' WHEN 'critical' THEN 'critical'
                       WHEN 'error' THEN 'error' WHEN 'warning' THEN 'warning'
                       WHEN 'warn' THEN 'warning' WHEN 'info' THEN 'info'
                       ELSE 'error' END;   -- an unreadable severity is not a quiet one
  v_seen     timestamptz := coalesce(p_seen_at, now());
  v_kind     text;
  v_ref      text := p_verify_ref;
  v_fp       text;
  v_id       uuid;
BEGIN
  IF v_title = '' THEN v_title := '(no message)'; END IF;
  v_fp := md5(p_source_kind || '|' || v_source || '|' || v_title);

  -- Default verify hook: a registered condition beats "manual".
  v_kind := coalesce(p_verify_kind,
              CASE WHEN public.ops_alert_condition(v_source, coalesce(p_sample_ref, '{}'::jsonb), v_seen, true) IS NOT NULL
                   THEN 'sql_condition'
                   WHEN p_source_kind IN ('workflow', 'nightly_red') THEN 'workflow'
                   WHEN p_source_kind IN ('sql_slack', 'edge_slack') THEN 'companions'
                   ELSE 'manual' END);
  IF v_kind = 'sql_condition' AND v_ref IS NULL THEN v_ref := v_source; END IF;

  INSERT INTO public.ops_alert_ledger AS l
    (fingerprint, source_kind, source, title, severity, sample, sample_ref,
     first_seen, last_seen, count, status, verify_kind, verify_ref)
  VALUES
    (v_fp, p_source_kind, v_source, v_title, v_sev, left(p_sample, 2000),
     coalesce(p_sample_ref, '{}'::jsonb), v_seen, v_seen, 1, 'open', v_kind, v_ref)
  ON CONFLICT (fingerprint) DO UPDATE SET
    last_seen    = greatest(l.last_seen, EXCLUDED.last_seen),
    first_seen   = least(l.first_seen, EXCLUDED.first_seen),
    count        = l.count + 1,
    -- Keep the WORST severity this fingerprint has carried.
    severity     = CASE WHEN array_position(ARRAY['info','warning','error','critical','fatal'], EXCLUDED.severity)
                             > array_position(ARRAY['info','warning','error','critical','fatal'], l.severity)
                        THEN EXCLUDED.severity ELSE l.severity END,
    sample       = coalesce(EXCLUDED.sample, l.sample),
    sample_ref   = EXCLUDED.sample_ref,
    -- A new occurrence re-opens anything not open. An occurrence OLDER than
    -- the close (a backfill, a late sync) does not.
    status       = CASE WHEN l.status = 'closed' AND EXCLUDED.last_seen <= l.closed_at THEN 'closed'
                        ELSE 'open' END,
    reopen_count = l.reopen_count + CASE WHEN l.status <> 'open'
                                          AND NOT (l.status = 'closed' AND EXCLUDED.last_seen <= l.closed_at)
                                         THEN 1 ELSE 0 END,
    closed_at       = CASE WHEN l.status = 'closed' AND EXCLUDED.last_seen <= l.closed_at THEN l.closed_at END,
    closed_evidence = CASE WHEN l.status = 'closed' AND EXCLUDED.last_seen <= l.closed_at THEN l.closed_evidence END,
    verify_started_at = CASE WHEN l.status = 'closed' AND EXCLUDED.last_seen <= l.closed_at THEN l.verify_started_at END,
    updated_at   = now()
  RETURNING l.id INTO v_id;
  RETURN v_id;
END;
$fn$;

REVOKE ALL ON FUNCTION public.ops_alert_record(text, text, text, text, text, jsonb, text, text, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ops_alert_record(text, text, text, text, text, jsonb, text, text, timestamptz) TO service_role;

-- ── 4. the verify conditions ────────────────────────────────────────────────
-- TRUE  = the condition is still true (still failing)
-- FALSE = re-asked just now and it is cleared
-- NULL  = no automatable question for this source (verify_kind 'manual')
-- p_probe_only: return whether a condition EXISTS (non-null) without doing any
-- work with side effects — used by ops_alert_record to pick the verify kind.
CREATE OR REPLACE FUNCTION public.ops_alert_condition(
  p_source     text,
  p_sample_ref jsonb,
  p_since      timestamptz,
  p_probe_only boolean DEFAULT false
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_job   text := p_sample_ref ->> 'job';
  v_dlq   text;
  v_depth bigint;
BEGIN
  IF p_source = 'detect_stuck_payments' THEN
    IF p_probe_only THEN RETURN true; END IF;
    -- The detector's own predicate, minus its notification dedupe.
    RETURN EXISTS (
      SELECT 1 FROM public.jobs j
       WHERE j.stripe_session_id IS NOT NULL
         AND j.payment_status = 'unpaid'
         AND j.created_at < now() - interval '10 minutes'
         AND j.created_at > now() - interval '24 hours');

  ELSIF p_source = 'ops-digest-undelivered' THEN
    IF p_probe_only THEN RETURN true; END IF;
    IF to_regprocedure('public.check_ops_digest_delivery()') IS NULL THEN RETURN NULL; END IF;
    -- 'ok' is computed before the function's once-a-day dedupe, so it is
    -- honest even on a day it has already reported.
    RETURN NOT coalesce((public.check_ops_digest_delivery() ->> 'ok')::boolean, false);

  ELSIF p_source IN ('email-dlq-auth', 'email-dlq-transactional') THEN
    IF p_probe_only THEN RETURN true; END IF;
    v_dlq := CASE p_source WHEN 'email-dlq-auth' THEN 'auth_emails_dlq' ELSE 'transactional_emails_dlq' END;
    IF to_regclass('pgmq.q_' || v_dlq) IS NULL THEN RETURN NULL; END IF;
    EXECUTE format('SELECT count(*) FROM pgmq.%I', 'q_' || v_dlq) INTO v_depth;
    RETURN v_depth > 0;

  ELSIF p_source IN ('cron-dead', 'cron-startup-timeout') AND v_job IS NOT NULL THEN
    IF p_probe_only THEN RETURN true; END IF;
    IF to_regclass('cron.job_run_details') IS NULL THEN RETURN NULL; END IF;
    -- Cleared only by a run that SUCCEEDED after the last report.
    RETURN NOT EXISTS (
      SELECT 1 FROM cron.job_run_details d
        JOIN cron.job c ON c.jobid = d.jobid
       WHERE c.jobname = v_job
         AND d.status = 'succeeded'
         AND d.start_time > p_since);
  END IF;
  RETURN NULL;
END;
$fn$;

REVOKE ALL ON FUNCTION public.ops_alert_condition(text, jsonb, timestamptz, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ops_alert_condition(text, jsonb, timestamptz, boolean) TO service_role;

-- ── 5. verify: re-ask every sql_condition item, close the cleared ──────────
CREATE OR REPLACE FUNCTION public.ops_alert_verify()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  r         record;
  v_still   boolean;
  v_closed  int := 0;
  v_open    int := 0;
  v_unknown int := 0;
  v_comp      int;
  v_comp_open int;
  v_at      timestamptz := clock_timestamp();
BEGIN
  FOR r IN SELECT * FROM public.ops_alert_ledger
            WHERE status <> 'closed' AND verify_kind = 'sql_condition'
            ORDER BY last_seen DESC LIMIT 200
  LOOP
    BEGIN
      v_still := public.ops_alert_condition(coalesce(r.verify_ref, r.source), r.sample_ref, r.last_seen, false);
    EXCEPTION WHEN OTHERS THEN
      v_still := NULL;
      UPDATE public.ops_alert_ledger SET verify_note = left('verify raised: ' || SQLERRM, 500), updated_at = now()
       WHERE id = r.id;
    END;

    IF v_still IS FALSE THEN
      -- Guard against a new occurrence landing between the read and here.
      UPDATE public.ops_alert_ledger
         SET status = 'closed', closed_at = now(), verify_started_at = v_at,
             closed_evidence = format('ops_alert_condition(%s) re-asked at %s: cleared', coalesce(r.verify_ref, r.source), v_at),
             updated_at = now()
       WHERE id = r.id AND last_seen = r.last_seen AND status <> 'closed';
      v_closed := v_closed + 1;
    ELSIF v_still IS TRUE THEN
      UPDATE public.ops_alert_ledger
         SET verify_started_at = v_at,
             verify_note = format('still failing when re-asked at %s', v_at),
             status = CASE WHEN status = 'verifying' THEN 'open' ELSE status END,
             updated_at = now()
       WHERE id = r.id;
      v_open := v_open + 1;
    ELSE
      v_unknown := v_unknown + 1;
    END IF;
  END LOOP;
  -- Slack posts that SUMMARISE error_logs rows. Every SQL watcher but one
  -- writes its error_logs rows and then posts one summary through
  -- slack-ops-alert ("3 cron(s) need attention"), and several edge callers do
  -- the same through postSlackOpsAlert. The summary has no question of its
  -- own to re-ask; its rows do. So it closes when there ARE companion
  -- error_logs items (seen in the 5 minutes up to the post) and every one of
  -- them is closed. No companions -> it stays open for a person.
  FOR r IN SELECT * FROM public.ops_alert_ledger
            WHERE status <> 'closed' AND verify_kind = 'companions'
            ORDER BY last_seen DESC LIMIT 200
  LOOP
    -- Companions are the ledger items of the server error_logs ROWS written in
    -- the 5 minutes up to the post (fingerprint recomputed exactly as the
    -- trigger computes it) — not items that merely span that time.
    WITH comp AS (
      SELECT DISTINCT md5('error_logs|' || left(src, 120) || '|' ||
                          coalesce(nullif(public.ops_alert_normalise(split_part(coalesce(e.message, ''), ' — ', 1)), ''), '(no message)')) AS fp
        FROM public.error_logs e
        CROSS JOIN LATERAL (SELECT coalesce(CASE WHEN jsonb_typeof(e.tags) = 'object'
                                                 THEN coalesce(e.tags ->> 'source', e.tags ->> 'area') END, 'app') AS src) s
       WHERE e.created_at BETWEEN r.last_seen - interval '5 minutes' AND r.last_seen
         AND coalesce(e.tags ->> 'origin', '') <> 'client'
         AND s.src NOT IN ('ops-alert', 'ops-digest')
    )
    SELECT count(*), count(*) FILTER (WHERE l.status <> 'closed')
      INTO v_comp, v_comp_open
      FROM comp JOIN public.ops_alert_ledger l ON l.fingerprint = comp.fp;

    IF v_comp > 0 AND v_comp_open = 0 THEN
      UPDATE public.ops_alert_ledger
         SET status = 'closed', closed_at = now(), verify_started_at = v_at,
             closed_evidence = format('all %s error_logs alert(s) this post summarised (rows %s .. %s) are verified cleared',
                                      v_comp, r.last_seen - interval '5 minutes', r.last_seen),
             updated_at = now()
       WHERE id = r.id AND last_seen = r.last_seen AND status <> 'closed';
      v_closed := v_closed + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('closed', v_closed, 'still_failing', v_open, 'could_not_ask', v_unknown, 'at', v_at);
END;
$fn$;

REVOKE ALL ON FUNCTION public.ops_alert_verify() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ops_alert_verify() TO service_role;

-- ── 6. close / mark-fixed for workflow and manual items ────────────────────
-- Refuses unless the re-run started AFTER the last occurrence and the evidence
-- says what was run. A closed item re-opens on the next occurrence.
CREATE OR REPLACE FUNCTION public.ops_alert_close(
  p_id               uuid,
  p_evidence         text,
  p_rerun_started_at timestamptz
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_rows int;
BEGIN
  IF length(btrim(coalesce(p_evidence, ''))) < 10 THEN
    RAISE EXCEPTION 'ops_alert_close: evidence must say which detector was re-run and what it showed'
      USING ERRCODE = '22023';
  END IF;
  IF p_rerun_started_at IS NULL OR p_rerun_started_at > now() + interval '5 minutes' THEN
    RAISE EXCEPTION 'ops_alert_close: rerun_started_at is required and cannot be in the future'
      USING ERRCODE = '22023';
  END IF;
  UPDATE public.ops_alert_ledger
     SET status = 'closed', closed_at = now(), verify_started_at = p_rerun_started_at,
         closed_evidence = left(p_evidence, 1000), updated_at = now()
   WHERE id = p_id
     AND status <> 'closed'
     AND p_rerun_started_at > last_seen;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows = 1;
END;
$fn$;

REVOKE ALL ON FUNCTION public.ops_alert_close(uuid, text, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ops_alert_close(uuid, text, timestamptz) TO service_role;

CREATE OR REPLACE FUNCTION public.ops_alert_mark_fixed(p_id uuid, p_note text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_rows int;
BEGIN
  UPDATE public.ops_alert_ledger
     SET status = 'verifying', verify_note = left(coalesce(p_note, 'fix shipped; awaiting detector'), 500),
         updated_at = now()
   WHERE id = p_id AND status = 'open';
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows = 1;
END;
$fn$;

REVOKE ALL ON FUNCTION public.ops_alert_mark_fixed(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ops_alert_mark_fixed(uuid, text) TO service_role;

-- ── 7. error_logs feeds it ──────────────────────────────────────────────────
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
  v_source := coalesce(v_tags ->> 'source', v_tags ->> 'area', 'app');
  -- postSlackOpsAlert records its own ledger entry; ops-digest is the digest's
  -- delivery receipt (read by check_ops_digest_delivery), not an alert.
  IF v_source IN ('ops-alert', 'ops-digest') THEN
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

-- 'zz_' sorts after the 00_ origin stamp (BEFORE) and the Slack trigger: this
-- one only reads NEW.
DROP TRIGGER IF EXISTS trg_error_logs_zz_ledger ON public.error_logs;
CREATE TRIGGER trg_error_logs_zz_ledger
  AFTER INSERT ON public.error_logs
  FOR EACH ROW EXECUTE FUNCTION public.ops_alert_ledger_from_error_log();

-- ── 8. backfill: the last 72 hours of server error_logs ────────────────────
-- Only into an EMPTY ledger, so a replay (or the PGlite 3x apply) cannot
-- double every count.
DO $backfill$
DECLARE
  r record;
BEGIN
  IF EXISTS (SELECT 1 FROM public.ops_alert_ledger) THEN
    RETURN;
  END IF;
  FOR r IN
    SELECT e.id, e.message, e.severity, e.url, e.created_at,
           CASE WHEN jsonb_typeof(e.tags) = 'object' THEN e.tags ELSE '{}'::jsonb END AS tags
      FROM public.error_logs e
     WHERE e.created_at > now() - interval '72 hours'
     ORDER BY e.created_at
  LOOP
    CONTINUE WHEN r.tags ->> 'origin' = 'client';
    CONTINUE WHEN coalesce(r.tags ->> 'source', r.tags ->> 'area') = 'ops-digest';
    IF r.tags ->> 'source' = 'ops-alert' THEN
      -- The transport's own row: title is the part before ' — ', and the
      -- live path records it as edge_slack/ops-alert:<kind>.
      PERFORM public.ops_alert_record(
        'edge_slack', 'ops-alert:' || coalesce(r.tags ->> 'kind', 'custom'),
        split_part(coalesce(r.message, ''), ' — ', 1),
        CASE WHEN r.severity = 'error' THEN 'critical' ELSE r.severity END,
        left(coalesce(r.message, ''), 1000),
        jsonb_build_object('error_log_id', r.id), NULL, NULL, r.created_at);
    ELSE
      PERFORM public.ops_alert_record(
        'error_logs', coalesce(r.tags ->> 'source', r.tags ->> 'area', 'app'),
        split_part(coalesce(r.message, ''), ' — ', 1),
        coalesce(r.severity, 'error'),
        left(coalesce(r.message, ''), 1000),
        jsonb_strip_nulls(jsonb_build_object('error_log_id', r.id, 'job', r.tags ->> 'job',
          'job_id', r.tags ->> 'job_id', 'queue', r.tags ->> 'queue', 'url', r.url)),
        NULL, NULL, r.created_at);
    END IF;
  END LOOP;
END;
$backfill$;
