-- ONE SENTRY ERROR = ONE LEDGER ROW (owner 2026-10-14: the docs/OPEN.md FEEDS
-- list kept refilling with copies of the same problem).
--
-- ops_alert_apply keys a row on md5(source_kind|source|normalised title), and
-- the Sentry sync (scripts/lib/sentryLedgerSync.mjs) used Sentry's culprit as
-- the source. A culprit names the Vite bundle by its CONTENT HASH plus a
-- minified function name, so every deploy minted a new source for the same
-- error: `sentry:cu(assets/app-shared-DUoNbpYC)`, then
-- `sentry:Ku(assets/app-shared-CkIDj-oG)`. Measured on prod 2026-10-14
-- (ops_alert_ledger WHERE source_kind = 'sentry', 58 rows: 40 open, 18 closed): "permission
-- denied for table profiles" 5 rows / 5 sources, "...table jobs" 5,
-- "dashboard.ctx ... applications" 4, "session lost on a signed-in screen" 3.
--
-- The sync now sends sentryCulpritKey(culprit) (same file). This migration
-- (1) adds its SQL twin, public.ops_alert_sentry_source(text), held to the
-- same answers by src/test/sentryCulpritOneFingerprint.test.ts, and
-- (2) folds the rows recorded before: each sentry row is re-keyed to the
-- normalised source; rows that land on one fingerprint are merged (counts
-- summed, first/last seen widened, worst severity, open wins over closed),
-- exactly as 20260923050059 section 9 merged the v1->v2 title re-key.
--
-- Replay-safe: a row whose source is already normalised is skipped, so a
-- second run changes nothing (the normaliser is idempotent:
-- ops_alert_sentry_source(ops_alert_sentry_source(s)) = ops_alert_sentry_source(s));
-- no DDL depends on a later migration. The fold holds a SHARE ROW EXCLUSIVE
-- lock so no ops_alert_record lands on a fingerprint it is about to use.

CREATE OR REPLACE FUNCTION public.ops_alert_sentry_source(p_source text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $fn$
DECLARE
  v_raw    text;
  v_call   text[];
  v_loc    text;
  v_hashed text[];
BEGIN
  IF p_source IS NULL OR p_source NOT LIKE 'sentry:%' THEN
    RETURN p_source;
  END IF;
  v_raw := btrim(substr(p_source, length('sentry:') + 1));
  IF v_raw = '' THEN
    RETURN 'sentry:unknown';
  END IF;
  -- `fn(location)`: the location is what survives; a bare location is itself.
  v_call := regexp_match(v_raw, '^([^()]*)\(([^()]*)\)$');
  v_loc := coalesce(v_call[2], v_raw);
  -- A hashed Vite bundle (assets/<name>-<8-char hash>[.js]) keeps its NAME
  -- only; its function name is minified noise. Anything else stays as it is.
  -- A hash has a capital, a digit, '_' or '-' among its 8 characters: a
  -- lower-case word is a NAME (`assets/tiktok-provider` stays whole), so
  -- normalising a normalised source changes nothing.
  IF v_loc !~ '(^|/)assets/' THEN
    RETURN p_source;
  END IF;
  v_hashed := regexp_match(v_loc, '^(.*/)?([^/]*)-(?=[A-Za-z0-9_-]{0,7}[A-Z0-9_-])[A-Za-z0-9_-]{8}(\.m?js)?$');
  IF v_hashed IS NULL THEN
    RETURN p_source;
  END IF;
  RETURN left('sentry:' || regexp_replace(coalesce(v_hashed[1], ''), '^/', '') || v_hashed[2], 120);
END;
$fn$;

REVOKE ALL ON FUNCTION public.ops_alert_sentry_source(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ops_alert_sentry_source(text) TO service_role;

DO $fold$
DECLARE
  r        public.ops_alert_ledger%ROWTYPE;
  o        public.ops_alert_ledger%ROWTYPE;
  v_id     uuid;
  v_source text;
  v_fp     text;
  v_rank   text[] := ARRAY['info','warning','error','critical','fatal'];
BEGIN
  IF to_regclass('public.ops_alert_ledger') IS NULL THEN
    RETURN;
  END IF;
  -- No ops_alert_record may insert a row under a fingerprint this fold is
  -- about to give another row (that would be a unique violation and fail the
  -- deploy). ops_alert_record waits at most 100 ms for this lock and then
  -- queues its occurrence in ops_alert_pending (20260923050059 section 5), so
  -- nothing is lost while the fold holds it; the fold touches tens of rows.
  LOCK TABLE public.ops_alert_ledger IN SHARE ROW EXCLUSIVE MODE;
  -- Oldest first, so the row that has carried the error longest survives
  -- (its id, and the earliest first_seen) and the later copies fold into it.
  FOR v_id IN
    SELECT l.id
      FROM public.ops_alert_ledger l
     WHERE l.source_kind = 'sentry'
       AND public.ops_alert_sentry_source(l.source) IS DISTINCT FROM l.source
     ORDER BY l.first_seen, l.id
  LOOP
    SELECT * INTO r FROM public.ops_alert_ledger WHERE id = v_id FOR UPDATE;
    CONTINUE WHEN NOT FOUND;
    v_source := public.ops_alert_sentry_source(r.source);
    -- ops_alert_apply's own key: md5(kind|source|title), title already normalised.
    v_fp := md5(r.source_kind || '|' || v_source || '|' || r.title);

    SELECT * INTO o FROM public.ops_alert_ledger WHERE fingerprint = v_fp AND id <> r.id FOR UPDATE;
    IF NOT FOUND THEN
      UPDATE public.ops_alert_ledger
         SET fingerprint = v_fp, source = v_source, updated_at = now()
       WHERE id = r.id;
    ELSE
      UPDATE public.ops_alert_ledger SET
        count        = o.count + r.count,
        first_seen   = least(o.first_seen, r.first_seen),
        last_seen    = greatest(o.last_seen, r.last_seen),
        severity     = CASE WHEN array_position(v_rank, r.severity) > array_position(v_rank, o.severity)
                            THEN r.severity ELSE o.severity END,
        sample       = CASE WHEN r.last_seen > o.last_seen THEN r.sample ELSE o.sample END,
        sample_ref   = CASE WHEN r.last_seen > o.last_seen THEN r.sample_ref ELSE o.sample_ref END,
        reopen_count = o.reopen_count + r.reopen_count,
        -- closed only if BOTH were verified closed; an open copy wins over
        -- everything (a 'verifying' row must not hide an open one)
        status       = CASE WHEN o.status = 'closed' AND r.status = 'closed' THEN 'closed'
                            WHEN 'open' IN (o.status, r.status) THEN 'open'
                            WHEN o.status = 'closed' THEN r.status
                            ELSE o.status END,
        closed_at    = CASE WHEN o.status = 'closed' AND r.status = 'closed' THEN greatest(o.closed_at, r.closed_at) END,
        closed_evidence = CASE WHEN o.status = 'closed' AND r.status = 'closed'
                               THEN CASE WHEN r.closed_at > o.closed_at THEN r.closed_evidence ELSE o.closed_evidence END END,
        -- as ops_alert_apply does: a reopened row has no verification running
        verify_started_at = CASE WHEN o.status = 'closed' AND r.status = 'closed'
                                 THEN greatest(o.verify_started_at, r.verify_started_at)
                                 WHEN 'open' IN (o.status, r.status) THEN NULL
                                 WHEN o.status = 'closed' THEN r.verify_started_at
                                 ELSE o.verify_started_at END,
        verify_note  = coalesce(o.verify_note, r.verify_note),
        updated_at   = now()
       WHERE id = o.id;
      DELETE FROM public.ops_alert_ledger WHERE id = r.id;
    END IF;
  END LOOP;
END;
$fold$;
