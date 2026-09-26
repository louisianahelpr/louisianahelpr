-- log_cron_defect: the hourly cap is no longer silent (CJ-007 follow-up).
--
-- ── WHY ────────────────────────────────────────────────────────────────────
-- log_cron_defect (20260831193039) is the failure sink every SQL sweep calls
-- from its per-row EXCEPTION handler, and since 20260926040817 it is also
-- where detect_stuck_payments files a stuck payment it could not alert on. It
-- files one error_logs row per (function, ref) per hour, capped at 20 rows
-- per function per hour, and past the cap it only RAISE WARNINGs, which
-- nothing reads. So a sweep failing on 300 rows in an hour showed 20: the
-- biggest failures looked like the small ones, and every row past the 20th
-- (a stuck payment that could not be alerted, a last-chance escrow warning
-- that did not go out) left no trace at all.
--
-- ── WHAT CHANGES ───────────────────────────────────────────────────────────
-- Only the cap branch, everything else verbatim from 20260831193039 (the
-- effective definition; no later migration redefines or rewrites it):
--   * the first drop in an hour inserts ONE 'defect-cap' row for the function
--     (tags.ref = 'defect-cap', same source), severity error, so it reaches
--     Slack and the ops ledger once, with a title that does not vary;
--   * every later drop in that hour adds 1 to that row's context.dropped and
--     records the latest ref and error (an UPDATE: no new row, no new page);
--   * the cap counts defect rows only, not the cap row, so it stays 20;
--   * an advisory lock per function stops two sessions inserting two rows.
-- Still never raises: the outer EXCEPTION handler is unchanged.
--
-- Replay-safe: CREATE OR REPLACE (same signature and return type).
-- Grants: FROM PUBLIC, anon, authenticated; service_role only.

CREATE OR REPLACE FUNCTION public.log_cron_defect(
  p_fn      text,
  p_ref     text,
  p_err     text,
  p_context jsonb DEFAULT '{}'::jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_ref text := COALESCE(NULLIF(p_ref, ''), 'run');
BEGIN
  -- Same (function, row) already reported this hour — the sweep is simply
  -- retrying a row it cannot process, which is one fact, not sixty.
  IF EXISTS (
    SELECT 1 FROM public.error_logs e
     WHERE e.tags->>'source' = p_fn
       AND e.tags->>'ref'    = v_ref
       AND e.created_at > now() - interval '1 hour'
  ) THEN
    RETURN;
  END IF;

  -- Flood cap: at most 20 defect rows per function per hour, so an alert
  -- cannot fill the log. Past the cap a row is still dropped, but no longer
  -- silently (20260926043528): ONE 'defect-cap' row per function per hour
  -- says the cap was hit and counts every failure dropped after it, so "20
  -- failures" can never hide "300". It keeps p_fn as its source, so a '-seed'
  -- function's cap row stays seed (error_log_is_seed) and never pages. The
  -- cap row itself is not counted toward the cap.
  IF (
    SELECT count(*) FROM public.error_logs e
     WHERE e.tags->>'source' = p_fn
       AND e.tags->>'ref' IS DISTINCT FROM 'defect-cap'
       AND e.created_at > now() - interval '1 hour'
  ) >= 20 THEN
    -- Two sessions hitting the cap at once must not both insert the row.
    PERFORM pg_advisory_xact_lock(hashtext('log_cron_defect-cap:' || p_fn));
    UPDATE public.error_logs e
       SET context = coalesce(e.context, '{}'::jsonb)
                     || jsonb_build_object(
                          'dropped', coalesce((e.context ->> 'dropped')::int, 0) + 1,
                          'last_dropped_ref', v_ref,
                          'last_error', left(coalesce(p_err, 'unknown error'), 400),
                          'last_dropped_at', now())
     WHERE e.id = (SELECT c.id FROM public.error_logs c
                    WHERE c.tags->>'source' = p_fn
                      AND c.tags->>'ref' = 'defect-cap'
                      AND c.created_at > now() - interval '1 hour'
                    ORDER BY c.created_at DESC
                    LIMIT 1);
    IF NOT FOUND THEN
      INSERT INTO public.error_logs (severity, message, tags, context)
      VALUES (
        'error',
        format('%s: over 20 failures in an hour — further failures are being dropped (log_cron_defect cap); the dropped count is in context.dropped',
               p_fn),
        jsonb_build_object('source', p_fn, 'area', 'cron', 'job', p_fn, 'ref', 'defect-cap'),
        jsonb_build_object('dropped', 1, 'cap', 20,
                           'first_dropped_ref', v_ref,
                           'first_error', left(coalesce(p_err, 'unknown error'), 400),
                           'last_dropped_ref', v_ref,
                           'last_error', left(coalesce(p_err, 'unknown error'), 400),
                           'last_dropped_at', now()));
    END IF;
    RAISE WARNING 'log_cron_defect(%): hourly cap reached, dropped and counted: % (%)', p_fn, p_err, v_ref;
    RETURN;
  END IF;

  INSERT INTO public.error_logs (severity, message, tags, context)
  VALUES (
    'error',
    format('%s: %s failed: %s', p_fn, v_ref, left(COALESCE(p_err, 'unknown error'), 400)),
    jsonb_build_object('source', p_fn, 'area', 'cron', 'job', p_fn, 'ref', v_ref),
    COALESCE(p_context, '{}'::jsonb) || jsonb_build_object('error', p_err)
  );
EXCEPTION WHEN OTHERS THEN
  -- Logging must never be the thing that breaks the sweep.
  RAISE WARNING 'log_cron_defect(%): could not record defect: % (original: %)', p_fn, SQLERRM, p_err;
END;
$$;

REVOKE ALL ON FUNCTION public.log_cron_defect(text, text, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.log_cron_defect(text, text, text, jsonb) TO service_role;

COMMENT ON FUNCTION public.log_cron_defect(text, text, text, jsonb) IS
'Failure sink for SQL cron functions: writes one error_logs row per (function, ref) per hour, capped at 20 per function per hour; past the cap, one ''defect-cap'' row per function per hour counts every dropped failure in context.dropped. Never raises. Call it from inside an EXCEPTION handler.';
