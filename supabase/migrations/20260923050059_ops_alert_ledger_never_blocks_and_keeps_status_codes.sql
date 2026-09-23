-- Ops alert ledger, review follow-up (docs/OPEN.md Q1). Three findings on
-- 20260923043402_ops_alert_ledger:
--
-- ── HIGH: the ledger could stall the transaction that raised the alert ─────
-- trg_error_logs_zz_ledger -> ops_alert_record did an upsert ON CONFLICT
-- (fingerprint) DO UPDATE, which takes the ledger row's lock and holds it to
-- the caller's COMMIT. Live (2026-09-23): lock_timeout = 0, service_role has no
-- statement_timeout of its own. Two service_role transactions logging the same
-- fingerprint (a webhook retry, a money path, an incident storm — exactly when
-- the same alert fires many times) therefore serialised: the second waited for
-- the first to COMMIT, up to the 2-minute default statement timeout, before
-- the trigger's swallowed exception. The logger blocked its caller.
--
-- Now: ops_alert_record tries the upsert with lock_timeout bounded to 100 ms
-- (set_config(.., true) inside a sub-block; a sub-block's abort restores the
-- GUC by itself, success restores it explicitly — SET LOCAL would leak to the
-- caller's whole transaction). If the row is busy it does NOT wait: the
-- occurrence goes into ops_alert_pending, an append-only table with no unique
-- key (a plain INSERT there never waits on another row), and returns NULL.
-- ops_alert_verify() (hourly, prod-errors.yml `ledger` job) folds pending rows
-- into the ledger first, so count / last_seen / re-open are exact, only late.
-- ops_alert_apply is the old upsert, unchanged, used only by the fold and
-- anything else that is allowed to wait.
--
-- ── MEDIUM: fingerprints merged alerts that differ only by a status code ──
-- ops_alert_normalise turned EVERY digit run into '#', so "returned 500" and
-- "returned 404" were one item and the second problem was hidden under the
-- first. Now kept: a 3-digit [1-5]xx code right after http / status / returned
-- / responded / code / error, and digits glued to a name (v2, s3, job_7:
-- preceded by a letter or '_'). Still stripped: uuids, Stripe ids, emails,
-- urls, ISO timestamps (now '<ts>' as a unit), hex ids, and every other number
-- — ids, amounts, counts, durations — with its sign, so "-0.27 ms" and
-- "0.27 ms" no longer split one timeout into two items (prod had 9 such pairs).
--
-- Existing rows are re-keyed where it is PROVABLE: the stored sample's first
-- ' — ' segment, run through the OLD normaliser, must equal the stored title
-- (so we know it is the text the title came from). Such a row gets its new
-- fingerprint/title; if that fingerprint already exists the two are merged
-- (counts summed, first/last seen widened, worst severity, open wins). Rows
-- that cannot be proven keep their old fingerprint: they still work exactly as
-- before (verify by source, close by id), they just stop receiving new
-- occurrences, which land on the new key.
--
-- ── LOW: check_ops_digest_delivery() said ok:true with nothing to check ───
-- If the cron_work_expectations row for ops-daily-digest was missing, "no
-- digest in 30 h" could never be true, and the check reported ok:true — a
-- false clear, which ops_alert_verify would then use to CLOSE the item. A
-- missing row is now itself the problem. (Live 2026-09-23: the row exists,
-- registered 2026-09-14, expected_max_gap 30 h.) The call site in
-- ops_alert_condition now says that this "question" has side effects.

-- ── 1. pending occurrences (append-only, never contended) ──────────────────
CREATE TABLE IF NOT EXISTS public.ops_alert_pending (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_kind  text NOT NULL,
  source       text,
  title        text,
  severity     text,
  sample       text,
  sample_ref   jsonb,
  verify_kind  text,
  verify_ref   text,
  seen_at      timestamptz NOT NULL,
  queued_at    timestamptz NOT NULL DEFAULT clock_timestamp()
);

ALTER TABLE public.ops_alert_pending ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.ops_alert_pending FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.ops_alert_pending TO service_role;

COMMENT ON TABLE public.ops_alert_pending IS
  'Ledger occurrences whose ledger row was locked by another transaction when they arrived (ops_alert_record never waits more than 100 ms). Folded into ops_alert_ledger by ops_alert_verify(). docs/OPEN.md Q1.';

-- ── 2. re-key capture (uses the normaliser still installed = the old one) ──
DROP TABLE IF EXISTS pg_temp._ops_alert_rekey;
CREATE TEMP TABLE _ops_alert_rekey AS
  SELECT l.id, split_part(l.sample, ' — ', 1) AS raw
    FROM public.ops_alert_ledger l
   WHERE l.sample IS NOT NULL
     AND coalesce(nullif(public.ops_alert_normalise(split_part(l.sample, ' — ', 1)), ''), '(no message)') = l.title;

-- ── 3. normalisation v2 ─────────────────────────────────────────────────────
-- chr(1) marks the digits of a protected status code so the number pass skips
-- them; it is removed at the end.
CREATE OR REPLACE FUNCTION public.ops_alert_normalise(p_text text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $fn$
  SELECT left(btrim(replace(regexp_replace(
    regexp_replace(
    regexp_replace(
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
      -- ISO date / timestamp, as one unit
      '\m[0-9]{4}-[0-9]{2}-[0-9]{2}([t ][0-9]{2}:[0-9]{2}(:[0-9]{2}(\.[0-9]+)?)?(z|[+-][0-9]{2}(:?[0-9]{2})?)?)?', '<ts>', 'g'),
      '\m(?=[a-f]*[0-9])[0-9a-f]{6,}\M', '<id>', 'g'),
      -- KEEP an HTTP-ish status code after its keyword: "returned 500", "status: 404", "http 502"
      '\m(https?|status|returned|responded|code|error)([ :=]{0,3})([1-5])([0-9])([0-9])(?![0-9])',
      '\1\2' || chr(1) || '\3' || chr(1) || '\4' || chr(1) || '\5', 'g'),
      -- every other number (with its sign), unless glued to a name (v2, job_7)
      '(?<![0-9a-z_' || chr(1) || '])-?[0-9]+([.,:][0-9]+)*', '#', 'g'),
    '\s+', ' ', 'g'), chr(1), '')), 200)
$fn$;

REVOKE ALL ON FUNCTION public.ops_alert_normalise(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ops_alert_normalise(text) TO service_role;

-- ── 4. ops_alert_apply: the upsert itself (may wait; fold/backfill only) ───
CREATE OR REPLACE FUNCTION public.ops_alert_apply(
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
    -- the close (a backfill, a late sync, a folded pending row) does not.
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

-- Internal: only the SECURITY DEFINER functions below call it.
REVOKE ALL ON FUNCTION public.ops_alert_apply(text, text, text, text, text, jsonb, text, text, timestamptz) FROM PUBLIC, anon, authenticated, service_role;

-- ── 5. ops_alert_record: the one write path — never waits > 100 ms ─────────
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
  v_prev text := current_setting('lock_timeout');
  v_id   uuid;
  v_seen timestamptz := coalesce(p_seen_at, now());
BEGIN
  BEGIN
    -- Bound the wait on a ledger row another transaction holds. Keep a caller's
    -- own tighter bound if it has one.
    IF v_prev IN ('0', '') OR v_prev::interval > interval '100 milliseconds' THEN
      PERFORM set_config('lock_timeout', '100ms', true);
    END IF;
    v_id := public.ops_alert_apply(p_source_kind, p_source, p_title, p_severity, p_sample,
                                   p_sample_ref, p_verify_kind, p_verify_ref, v_seen);
    PERFORM set_config('lock_timeout', v_prev, true);
    RETURN v_id;
  EXCEPTION WHEN lock_not_available OR deadlock_detected THEN
    -- The sub-block's abort already restored lock_timeout. Queue it; the
    -- hourly ops_alert_verify() folds it in with its real seen_at.
    INSERT INTO public.ops_alert_pending
      (source_kind, source, title, severity, sample, sample_ref, verify_kind, verify_ref, seen_at)
    VALUES
      (p_source_kind, p_source, p_title, p_severity, left(p_sample, 2000), p_sample_ref,
       p_verify_kind, p_verify_ref, v_seen);
    RETURN NULL;
  END;
END;
$fn$;

REVOKE ALL ON FUNCTION public.ops_alert_record(text, text, text, text, text, jsonb, text, text, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ops_alert_record(text, text, text, text, text, jsonb, text, text, timestamptz) TO service_role;

-- ── 6. fold pending occurrences into the ledger ─────────────────────────────
CREATE OR REPLACE FUNCTION public.ops_alert_fold_pending()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  r      record;
  v_n    int := 0;
BEGIN
  FOR r IN
    DELETE FROM public.ops_alert_pending p
     WHERE p.id IN (SELECT id FROM public.ops_alert_pending
                     ORDER BY seen_at LIMIT 5000 FOR UPDATE SKIP LOCKED)
    RETURNING p.*
  LOOP
    PERFORM public.ops_alert_apply(r.source_kind, r.source, r.title, r.severity, r.sample,
                                   r.sample_ref, r.verify_kind, r.verify_ref, r.seen_at);
    v_n := v_n + 1;
  END LOOP;
  RETURN v_n;
END;
$fn$;

REVOKE ALL ON FUNCTION public.ops_alert_fold_pending() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ops_alert_fold_pending() TO service_role;

-- ── 7. condition: same questions, side effect of one now stated ────────────
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
    -- SIDE EFFECTS: this is not a pure question. When delivery is NOT ok,
    -- check_ops_digest_delivery() INSERTs an error_logs row (which feeds this
    -- ledger through trg_error_logs_zz_ledger) and POSTs to Slack via
    -- slack-ops-alert — at most once per UTC day (its own dedupe). So an hourly
    -- ops_alert_verify() can raise the day's digest alert itself. 'ok' is
    -- computed before that dedupe, so it is honest on a day already reported.
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

-- ── 8. verify: fold pending first, then as before ──────────────────────────
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
  v_folded  int;
  v_at      timestamptz := clock_timestamp();
BEGIN
  -- Occurrences that arrived while their ledger row was busy. Folded BEFORE
  -- anything is judged, so a queued re-occurrence re-opens its item instead of
  -- the item being closed under it.
  v_folded := public.ops_alert_fold_pending();

  FOR r IN SELECT * FROM public.ops_alert_ledger
            WHERE status <> 'closed' AND verify_kind = 'sql_condition'
            ORDER BY last_seen DESC LIMIT 200
  LOOP
    BEGIN
      -- NOTE: not side-effect free for every source — ops-digest-undelivered
      -- may write error_logs and post to Slack (see ops_alert_condition).
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
  -- Slack posts that SUMMARISE error_logs rows: closed when there ARE
  -- companion error_logs items (seen in the 5 minutes up to the post) and
  -- every one of them is closed. No companions -> it stays open for a person.
  FOR r IN SELECT * FROM public.ops_alert_ledger
            WHERE status <> 'closed' AND verify_kind = 'companions'
            ORDER BY last_seen DESC LIMIT 200
  LOOP
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

  RETURN jsonb_build_object('folded', v_folded, 'closed', v_closed, 'still_failing', v_open,
                            'could_not_ask', v_unknown, 'at', v_at);
END;
$fn$;

REVOKE ALL ON FUNCTION public.ops_alert_verify() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ops_alert_verify() TO service_role;

-- ── 9. re-key existing rows under normalisation v2 ─────────────────────────
DO $rekey$
DECLARE
  r       record;
  v_title text;
  v_fp    text;
  o       public.ops_alert_ledger%ROWTYPE;
  v_rank  text[] := ARRAY['info','warning','error','critical','fatal'];
BEGIN
  FOR r IN
    SELECT l.*, k.raw FROM pg_temp._ops_alert_rekey k
      JOIN public.ops_alert_ledger l ON l.id = k.id
     ORDER BY l.last_seen DESC
  LOOP
    v_title := coalesce(nullif(public.ops_alert_normalise(r.raw), ''), '(no message)');
    v_fp := md5(r.source_kind || '|' || r.source || '|' || v_title);
    CONTINUE WHEN v_fp = r.fingerprint;

    SELECT * INTO o FROM public.ops_alert_ledger WHERE fingerprint = v_fp;
    IF NOT FOUND THEN
      UPDATE public.ops_alert_ledger SET fingerprint = v_fp, title = v_title, updated_at = now()
       WHERE id = r.id;
    ELSE
      -- Two old items are one item under v2 (e.g. "-#.<id> ms" / "#.<id> ms").
      UPDATE public.ops_alert_ledger SET
        count        = o.count + r.count,
        first_seen   = least(o.first_seen, r.first_seen),
        last_seen    = greatest(o.last_seen, r.last_seen),
        severity     = CASE WHEN array_position(v_rank, r.severity) > array_position(v_rank, o.severity)
                            THEN r.severity ELSE o.severity END,
        sample       = CASE WHEN r.last_seen > o.last_seen THEN r.sample ELSE o.sample END,
        sample_ref   = CASE WHEN r.last_seen > o.last_seen THEN r.sample_ref ELSE o.sample_ref END,
        reopen_count = o.reopen_count + r.reopen_count,
        -- closed only if BOTH were verified closed; otherwise open wins
        status       = CASE WHEN o.status = 'closed' AND r.status = 'closed' THEN 'closed'
                            WHEN o.status = 'closed' THEN r.status
                            ELSE o.status END,
        closed_at    = CASE WHEN o.status = 'closed' AND r.status = 'closed' THEN greatest(o.closed_at, r.closed_at) END,
        closed_evidence = CASE WHEN o.status = 'closed' AND r.status = 'closed'
                               THEN CASE WHEN r.closed_at > o.closed_at THEN r.closed_evidence ELSE o.closed_evidence END END,
        verify_started_at = CASE WHEN o.status = 'closed' AND r.status = 'closed'
                                 THEN greatest(o.verify_started_at, r.verify_started_at) ELSE o.verify_started_at END,
        verify_note  = coalesce(o.verify_note, r.verify_note),
        updated_at   = now()
       WHERE id = o.id;
      DELETE FROM public.ops_alert_ledger WHERE id = r.id;
    END IF;
  END LOOP;
END;
$rekey$;

DROP TABLE IF EXISTS pg_temp._ops_alert_rekey;

-- ── 10. check_ops_digest_delivery: a missing expectation is not "ok" ───────
CREATE OR REPLACE FUNCTION public.check_ops_digest_delivery()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_records   int;
  v_delivered int := 0;
  v_failed    int := 0;
  v_problem   text;
  v_has_row   boolean;
BEGIN
  SELECT count(*) INTO v_records
    FROM public.error_logs e
   WHERE jsonb_typeof(e.tags) = 'object'
     AND e.tags ->> 'source' = 'ops-digest'
     AND e.created_at > now() - interval '30 hours';

  IF to_regclass('net._http_response') IS NOT NULL THEN
    EXECUTE $q$
      SELECT count(*) FILTER (WHERE r.status_code = 200 AND r.content::text ~ '"ok"\s*:\s*true'),
             count(*) FILTER (WHERE r.id IS NOT NULL
                               AND NOT (r.status_code IS NOT DISTINCT FROM 200
                                        AND r.content::text ~ '"ok"\s*:\s*true'))
             + count(*) FILTER (WHERE e.context ->> 'request_id' IS NULL)
        FROM public.error_logs e
        LEFT JOIN net._http_response r ON r.id = (e.context ->> 'request_id')::bigint
       WHERE jsonb_typeof(e.tags) = 'object'
         AND e.tags ->> 'source' = 'ops-digest'
         AND e.created_at > now() - interval '30 hours'
         AND e.created_at < now() - interval '10 minutes'
    $q$ INTO v_delivered, v_failed;
  END IF;

  SELECT EXISTS (SELECT 1 FROM public.cron_work_expectations c WHERE c.jobname = 'ops-daily-digest')
    INTO v_has_row;

  v_problem := CASE
    -- Without the expectation row "none in 30 h" can never fire, so ok:true
    -- would be a false clear (and ops_alert_verify would close on it).
    WHEN NOT v_has_row THEN 'Daily ops digest delivery cannot be checked: cron_work_expectations has no ops-daily-digest row.'
    -- Grace: the digest's first run is up to a day after this migration, so
    -- "none in 30 h" only counts once the digest has existed for 30 h.
    WHEN v_records = 0 AND EXISTS (
           SELECT 1 FROM public.cron_work_expectations c
            WHERE c.jobname = 'ops-daily-digest'
              AND c.registered_at < now() - interval '30 hours') THEN 'No daily ops digest has been sent in 30 hours (ops-daily-digest did not run or raised).'
    WHEN v_delivered = 0 AND v_failed > 0 THEN 'The daily ops digest was sent but Slack did not accept it (see net._http_response / slack-ops-alert logs). Alerts may not be reaching #ops-alerts.'
    ELSE NULL
  END;

  IF v_problem IS NULL THEN
    RETURN jsonb_build_object('ok', true, 'records', v_records, 'delivered', v_delivered);
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.error_logs e
     WHERE jsonb_typeof(e.tags) = 'object'
       AND e.tags ->> 'source' = 'ops-digest-undelivered'
       AND e.created_at > date_trunc('day', now())
  ) THEN
    RETURN jsonb_build_object('ok', false, 'already_reported', true);
  END IF;

  INSERT INTO public.error_logs (severity, message, tags, context)
  VALUES ('error', v_problem,
          jsonb_build_object('source', 'ops-digest-undelivered', 'area', 'alerting'),
          jsonb_build_object('records', v_records, 'delivered', v_delivered, 'failed', v_failed));

  BEGIN
    PERFORM net.http_post(
      url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'supabase_url' LIMIT 1)
             || '/functions/v1/slack-ops-alert',
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1),
        'Content-Type', 'application/json'),
      body := jsonb_build_object(
        'title', 'Daily ops digest not delivered',
        'message', v_problem,
        'severity', 'critical'));
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  RETURN jsonb_build_object('ok', false, 'problem', v_problem);
END;
$fn$;
REVOKE ALL ON FUNCTION public.check_ops_digest_delivery() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.check_ops_digest_delivery() TO service_role;
