-- Q122 (docs/OPEN.md): rename error_log_throttle_drops.kind -> drop_kind.
--
-- WHY. 20260923100454 (Q113) made error_log_throttle_drops the only table with
-- a column named `kind`. src/test/fixtureSchemaContract.test.ts attributes a
-- test object literal to a table through a column only one table has
-- (distinctiveColumns in src/test/helpers/schemaConstraints.ts), so every
-- `{ kind: "custom", ... }` literal in src/test and e2e was graded against
-- CHECK kind IN ('guest','guest_fp','account'): 40 false findings (measured 2026-09-23 at 0ff197995), Vitest red
-- on main. Two guard-side rules were measured and rejected (half-own-columns
-- left 12 false positives; >= 2 own columns cut graded values 840 -> 614), so
-- the fix is at the source: a column name no fixture uses.
--
-- WHAT. The column, its CHECK (dropped and re-added under the new name; the
-- table holds at most 14 days of per-minute counters), and the two functions
-- whose bodies name it. PL/pgSQL bodies are text: a rename does NOT rewrite
-- them, and record_error_log_throttle_drop swallows every error, so without
-- the CREATE OR REPLACE below every drop would silently stop being counted.
-- Bodies are the live pg_get_functiondef of 2026-09-23 (md5 471c458a...,
-- d8bfc4e1... on prod) with only `kind` -> `drop_kind` changed; the parameter
-- p_kind and the output key 'by_kind' are unchanged (callers and the alert
-- text keep their shape). The primary key and its index follow the rename by
-- themselves. ops_alert_condition('error-log-throttled') does not name the
-- column (it filters on d.minute only; checked on the live definition), so it
-- is not redefined here.
--
-- Replay-safe: the rename runs only while `kind` exists and `drop_kind` does
-- not; the CHECK is dropped IF EXISTS under both names and re-added;
-- CREATE OR REPLACE for both functions.

-- ── 1. the column ──────────────────────────────────────────────────────────
DO $ren$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name = 'error_log_throttle_drops' AND column_name = 'kind')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name = 'error_log_throttle_drops' AND column_name = 'drop_kind')
  THEN
    ALTER TABLE public.error_log_throttle_drops RENAME COLUMN kind TO drop_kind;
  END IF;
END
$ren$;

-- DESTRUCTIVE-DDL-ACK: DROP CONSTRAINT public.error_log_throttle_drops.error_log_throttle_drops_kind_check
-- ACK-REASON: the same CHECK is re-added two lines below under the renamed column's name, drop_kind.
-- ACK-DATA-LOSS: none; a CHECK constraint holds no rows, and no row is deleted or rewritten.
ALTER TABLE public.error_log_throttle_drops DROP CONSTRAINT IF EXISTS error_log_throttle_drops_kind_check;
ALTER TABLE public.error_log_throttle_drops DROP CONSTRAINT IF EXISTS error_log_throttle_drops_drop_kind_check;
ALTER TABLE public.error_log_throttle_drops ADD CONSTRAINT error_log_throttle_drops_drop_kind_check CHECK (drop_kind IN ('guest', 'guest_fp', 'account'));

COMMENT ON TABLE public.error_log_throttle_drops IS
  'Q113: rows dropped by throttle_client_error_log, per minute x backend pid x drop_kind (guest | guest_fp | account). Written only by record_error_log_throttle_drop; read by check_error_log_throttle and ops_alert_condition(''error-log-throttled''). 14 days kept. Column renamed from kind (Q122).';

-- ── 2. record a drop: bounded, never raises ────────────────────────────────
CREATE OR REPLACE FUNCTION public.record_error_log_throttle_drop(p_kind text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $rec$
DECLARE
  v_prev text := current_setting('lock_timeout');
BEGIN
  BEGIN
    -- Keyed by backend pid: the only row this can meet was written by an
    -- earlier transaction on this same connection. Bounded anyway.
    IF v_prev IN ('0', '') OR v_prev::interval > interval '50 milliseconds' THEN
      PERFORM set_config('lock_timeout', '50ms', true);
    END IF;
    INSERT INTO public.error_log_throttle_drops AS d (minute, backend_pid, drop_kind, dropped, first_at, last_at)
    VALUES (date_trunc('minute', now()), pg_backend_pid(), p_kind, 1, now(), now())
    ON CONFLICT (minute, backend_pid, drop_kind)
    DO UPDATE SET dropped = d.dropped + 1, last_at = EXCLUDED.last_at;
    PERFORM set_config('lock_timeout', v_prev, true);
  EXCEPTION WHEN lock_not_available OR deadlock_detected THEN
    -- The sub-block's abort restored lock_timeout. The row is still dropped.
    NULL;
  WHEN OTHERS THEN
    NULL;
  END;
END;
$rec$;

COMMENT ON FUNCTION public.record_error_log_throttle_drop(text) IS
  'Q113: bumps error_log_throttle_drops for this minute/backend/drop_kind. lock_timeout 50ms, swallows every error: counting a drop can never block or break the insert path.';

REVOKE ALL ON FUNCTION public.record_error_log_throttle_drop(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_error_log_throttle_drop(text) TO service_role;

-- ── 3. the check: sustained throttling -> one error_logs row -> ledger ─────
CREATE OR REPLACE FUNCTION public.check_error_log_throttle()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $chk$
DECLARE
  v_min_minutes CONSTANT int := 2;    -- "sustained": drops in >= 2 minutes ...
  v_lookback    CONSTANT int := 10;   -- ... of the last 10 complete minutes
  v_now_min  timestamptz := date_trunc('minute', now());
  v_minutes  int;
  v_dropped  bigint;
  v_by_kind  jsonb;
  v_raised   boolean := false;
BEGIN
  SELECT count(DISTINCT d.minute), coalesce(sum(d.dropped), 0)
    INTO v_minutes, v_dropped
    FROM public.error_log_throttle_drops d
   WHERE d.minute >= v_now_min - make_interval(mins => v_lookback)
     AND d.minute < v_now_min;
  SELECT coalesce(jsonb_object_agg(drop_kind, n), '{}'::jsonb) INTO v_by_kind
    FROM (SELECT d.drop_kind, sum(d.dropped) n FROM public.error_log_throttle_drops d
           WHERE d.minute >= v_now_min - make_interval(mins => v_lookback)
             AND d.minute < v_now_min
           GROUP BY d.drop_kind) k;

  IF v_minutes >= v_min_minutes AND NOT EXISTS (
    SELECT 1 FROM public.error_logs e
     WHERE e.created_at > now() - interval '15 minutes'
       AND jsonb_typeof(e.tags) = 'object'
       AND e.tags ->> 'source' = 'error-log-throttled')
  THEN
    INSERT INTO public.error_logs (severity, message, tags, context)
    VALUES ('error',
            format('Client error logs throttled — %s rows dropped in %s of the last %s minutes (%s). See docs/OPEN.md Q113.',
                   v_dropped, v_minutes, v_lookback, v_by_kind::text),
            jsonb_build_object('source', 'error-log-throttled', 'area', 'observability'),
            jsonb_build_object('dropped', v_dropped, 'minutes', v_minutes, 'lookback_minutes', v_lookback,
                               'by_kind', v_by_kind));
    v_raised := true;
  END IF;

  DELETE FROM public.error_log_throttle_drops WHERE minute < now() - interval '14 days';

  RETURN jsonb_build_object('ok', v_minutes < v_min_minutes, 'dropped', v_dropped, 'minutes', v_minutes,
                            'lookback_minutes', v_lookback, 'by_kind', v_by_kind, 'raised', v_raised);
END;
$chk$;

REVOKE ALL ON FUNCTION public.check_error_log_throttle() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.check_error_log_throttle() TO service_role;
