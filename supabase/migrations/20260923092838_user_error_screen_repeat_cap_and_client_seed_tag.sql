-- Two holes in the Q39 user-error-screen -> ops_alert_ledger path, found by its
-- authz review (docs/OPEN.md Q96, Q97).
--
-- ── Q96 (MEDIUM): repeats of a known screen were unlimited ──────────────────
-- ops_alert_record_user_error_screen (20260923085642) rate-limited only the
-- opening of a NEW item (5 new screens per person per hour, 20 new items per
-- hour overall). A repeat of an EXISTING fingerprint always went through
-- ops_alert_record, so one signed-in account (or a guest, anon can insert
-- error_logs with user_id NULL) looping POST /rest/v1/error_logs bumped the
-- ledger item's count and last_seen without bound.
-- Fix: a repeat bumps the ledger only while THIS account has hit THIS
-- fingerprint at most 5 times in the hour (guests, who have no account, share
-- one budget of 20 per fingerprint per hour) — the same 5 / 20 numbers as the
-- new-item caps. Over the cap the error_logs row is still stored (the trigger
-- never blocks the write), it just does not touch the ledger.
-- The CLOSE RULE is unchanged on purpose: ops_alert_condition('user-error-
-- screen') re-asks error_logs for a real row in the last 24 h, so an item a
-- real person keeps hitting stays open even when their repeats are capped.
-- Counting uses idx_error_logs_user (user_id, created_at DESC) and stops at
-- cap+1 matches (LIMIT), so the check is bounded per insert.
--
-- ── Q97 (LOW): a client could mark its own rows as seed ─────────────────────
-- error_log_is_seed(tags) (20260923052520) trusted tags.seed = 'true' and a
-- '-seed' source suffix. Those tags are client-writable on origin='client'
-- rows, so a real account could hide its own genuine error screens from the
-- ledger. Fix: for a client-origin row the tags are NOT evidence of seed; the
-- function returns false and the caller decides seed status from
-- profiles.is_seed for the row's user_id (user_error_screen_is_real already
-- does exactly that). Server-origin rows keep the tag (the stamp trigger
-- trg_error_logs_00_stamp_origin forces origin='client' for anon and
-- authenticated, so a client cannot claim 'server').
-- Callers, measured live 2026-09-23 (pg_proc.prosrc):
--   notify_slack_on_error_log, ops_alert_ledger_from_error_log — both return
--     for origin='client' BEFORE calling it: unchanged behaviour.
--   detect_stuck_payments — writes server rows tagged seed: unchanged.
--   user_error_screen_is_real — client rows only: now uses profiles.is_seed.
-- Prod had 0 client-origin rows the old predicate called seed in the last 30
-- days (25 server-origin ones), so no existing row changes meaning.
--
-- Replay-safe: CREATE OR REPLACE only; privileges restated (service_role only,
-- matching live proacl {postgres=X, service_role=X}).

-- ── Q97: the one seed predicate no longer trusts a client's tags ────────────
CREATE OR REPLACE FUNCTION public.error_log_is_seed(p_tags jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $fn$
  SELECT CASE WHEN jsonb_typeof(p_tags) = 'object'
                   AND coalesce(p_tags ->> 'origin', '') <> 'client' THEN
           coalesce(p_tags ->> 'seed', '') = 'true'
           OR coalesce(p_tags ->> 'source', p_tags ->> 'area', '') LIKE '%-seed'
         ELSE false END
$fn$;

REVOKE ALL ON FUNCTION public.error_log_is_seed(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.error_log_is_seed(jsonb) TO service_role;

-- Body unchanged from 20260923085642; restated so the seed decision for a
-- client row is visibly profiles.is_seed (error_log_is_seed is false for it).
CREATE OR REPLACE FUNCTION public.user_error_screen_is_real(p_user_id uuid, p_tags jsonb)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
  SELECT NOT public.error_log_is_seed(p_tags)
     AND NOT EXISTS (SELECT 1 FROM public.profiles p
                      WHERE p_user_id IS NOT NULL
                        AND p.user_id = p_user_id
                        AND p.is_seed IS TRUE)
$fn$;

REVOKE ALL ON FUNCTION public.user_error_screen_is_real(uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.user_error_screen_is_real(uuid, jsonb) TO service_role;

-- ── Q96: repeats are capped per account per fingerprint per hour ────────────
-- Body is the live (= 20260923085642) definition plus the repeat cap.
CREATE OR REPLACE FUNCTION public.ops_alert_record_user_error_screen(
  p_error_log_id uuid,
  p_user_id      uuid,
  p_message      text,
  p_tags         jsonb,
  p_seen_at      timestamptz DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_tags         jsonb := CASE WHEN jsonb_typeof(p_tags) = 'object' THEN p_tags ELSE '{}'::jsonb END;
  v_seen         timestamptz := coalesce(p_seen_at, now());
  v_title        text;
  v_norm         text;
  v_surface      text;
  v_screens      int := 0;
  v_new_in_hour  int := 0;
  v_repeats      int := 0;
  v_repeat_cap   int;
BEGIN
  IF NOT public.is_user_error_screen_row(v_tags) THEN RETURN NULL; END IF;
  IF NOT public.user_error_screen_is_real(p_user_id, v_tags) THEN RETURN NULL; END IF;

  v_title   := public.user_error_screen_title(v_tags ->> 'screen', p_message);
  v_norm    := public.ops_alert_normalise(v_title);
  v_surface := left(regexp_replace(coalesce(v_tags ->> 'source', ''), '[^A-Za-z0-9._-]', '', 'g'), 60);

  -- The new-item rate limit applies only to opening a NEW item. The title is
  -- the whole fingerprint here (source_kind and source are constant).
  IF NOT EXISTS (SELECT 1 FROM public.ops_alert_ledger
                  WHERE source_kind = 'user-error-screen' AND source = 'user-error-screen'
                    AND title = v_norm) THEN
    IF p_user_id IS NOT NULL THEN
      SELECT count(DISTINCT coalesce(e.tags ->> 'screen', '')) INTO v_screens
        FROM public.error_logs e
       WHERE e.user_id = p_user_id
         AND e.created_at > v_seen - interval '1 hour'
         AND e.created_at <= v_seen
         AND public.is_user_error_screen_row(e.tags);
    END IF;
    SELECT count(*) INTO v_new_in_hour
      FROM public.ops_alert_ledger l
     WHERE l.source_kind = 'user-error-screen'
       AND l.first_seen > v_seen - interval '1 hour'
       AND l.first_seen <= v_seen
       AND NOT coalesce((l.sample_ref ->> 'overflow')::boolean, false);

    IF v_screens > 5 OR v_new_in_hour >= 20 THEN
      RETURN public.ops_alert_record(
        'user-error-screen', 'user-error-screen',
        'Real users hit more NEW error screens than the cap (20 per hour overall, 5 per person); the rest are only in error_logs',
        'error',
        left(v_title, 1000),
        jsonb_build_object('overflow', true, 'surface', v_surface, 'error_log_id', p_error_log_id,
                           'capped_by', CASE WHEN v_screens > 5 THEN 'per-person' ELSE 'global' END),
        'sql_condition', 'user-error-screen', v_seen);
    END IF;
  ELSE
    -- Q96 repeat cap: a REPEAT of a known screen bumps the ledger only while
    -- this account hit this fingerprint <= 5 times in the hour (guests share
    -- 20). The row being recorded is already in error_logs (AFTER trigger),
    -- so it counts itself. Over the cap: the row stays in error_logs (the
    -- close rule still sees it), the ledger is not touched.
    v_repeat_cap := CASE WHEN p_user_id IS NULL THEN 20 ELSE 5 END;
    IF p_user_id IS NULL THEN
      SELECT count(*) INTO v_repeats FROM (
        SELECT 1 FROM public.error_logs e
         WHERE e.user_id IS NULL
           AND e.created_at > v_seen - interval '1 hour'
           AND e.created_at <= v_seen
           AND public.is_user_error_screen_row(e.tags)
           AND public.ops_alert_normalise(public.user_error_screen_title(e.tags ->> 'screen', e.message)) = v_norm
         LIMIT v_repeat_cap + 1) x;
    ELSE
      SELECT count(*) INTO v_repeats FROM (
        SELECT 1 FROM public.error_logs e
         WHERE e.user_id = p_user_id
           AND e.created_at > v_seen - interval '1 hour'
           AND e.created_at <= v_seen
           AND public.is_user_error_screen_row(e.tags)
           AND public.ops_alert_normalise(public.user_error_screen_title(e.tags ->> 'screen', e.message)) = v_norm
         LIMIT v_repeat_cap + 1) x;
    END IF;
    IF v_repeats > v_repeat_cap THEN
      RETURN NULL;
    END IF;
  END IF;

  RETURN public.ops_alert_record(
    'user-error-screen', 'user-error-screen',
    v_title,
    'error',
    left(v_title, 1000),
    jsonb_strip_nulls(jsonb_build_object(
      'title_norm', v_norm,
      'screen', left(v_tags ->> 'screen', 200),
      'surface', v_surface,
      'error_log_id', p_error_log_id,
      'signed_in', p_user_id IS NOT NULL)),
    'sql_condition', 'user-error-screen', v_seen);
END;
$fn$;

REVOKE ALL ON FUNCTION public.ops_alert_record_user_error_screen(uuid, uuid, text, jsonb, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ops_alert_record_user_error_screen(uuid, uuid, text, jsonb, timestamptz) TO service_role;
