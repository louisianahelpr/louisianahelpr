-- Q2780 (lead 11-14, owner rule go-with-recommendations; decision logged in LEAD-LOG.md and OWNER-DECISIONS): no
-- alert for a single stalled client, an alert only on a repeated pattern.
--
-- The item: ledger dd2ccbc600ce "/ · error screen shown: couldn't load the newest jobs." Its 3 error_logs rows
-- (11-04 13:40, 11-04 15:53, 11-09 13:12 UTC) came from signed-out visitors on the landing page's LiveJobsSection
-- read, over five days. Read on prod 11-14.
--
-- A guest has NO per-client id: tags.guest_fp is md5(normalised message | path), set by throttle_client_error_log
-- (20261012145240), so every guest on the same screen shares it (lh-silent-failure review). "One client" can
-- therefore only be told apart for members. The rule, for the public low-stakes read surfaces only
-- (LiveJobsSection, the landing's live jobs read, and BootWatchdog, the boot stall), in the branch that opens a NEW
-- item: open once 3 rows of that screen land within 24 hours (any visitors) or 2 distinct members see it. A real
-- outage on a guest page produces many rows and opens at once; one person's flaky connection does not. Every other
-- screen (money, disputes, admin queues, crashes) still opens on first sight. Repeats of an open item and the rate
-- caps are unchanged.
--
-- ops_alert_record_user_error_screen is its newest definition (20260923092838; md5 of the live prosrc equal to it,
-- read 11-14) with only that gate added. Grants restated as 20260923092838 states them.

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
  v_rows         int := 0;
  v_members      int := 0;
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

    -- Q2780 (lead 11-14, decided by recommendation): on the public low-stakes read surfaces, one person's failed
    -- read is not an outage. Open only on a pattern: 3 rows of this screen in 24 hours, or 2 distinct members.
    -- Guests carry no per-client id (guest_fp is per message and path), so guests count by rows. The scan stops
    -- at 50 rows. Every other surface opens on first sight, as before.
    IF v_surface IN ('LiveJobsSection', 'BootWatchdog') THEN
      SELECT count(*), count(DISTINCT x.user_id) INTO v_rows, v_members FROM (
        SELECT e.user_id FROM public.error_logs e
         WHERE e.created_at > v_seen - interval '24 hours'
           AND e.created_at <= v_seen
           AND e.tags ->> 'source' = v_surface
           AND public.is_user_error_screen_row(e.tags)
           AND public.user_error_screen_is_real(e.user_id, e.tags)
           AND public.ops_alert_normalise(public.user_error_screen_title(e.tags ->> 'screen', e.message)) = v_norm
         LIMIT 50) x;
      IF v_rows < 3 AND v_members < 2 THEN RETURN NULL; END IF;
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
