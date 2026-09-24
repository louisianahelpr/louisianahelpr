-- Q316 follow-up (docs/OPEN.md): ONE fingerprint function for the ops ledger.
--
-- 20260924035844 made ops_alert_apply append '|job:<name>' to the fingerprint
-- of 'cron-http-untagged' items. But ops_alert_verify's companions path
-- rebuilt error_logs fingerprints on its own, as
-- md5('error_logs|' || left(src,120) || '|' || normalised title), without the
-- suffix, and joined the ledger ON fingerprint. So for that source the
-- verifier never found the items the sweep's Slack summary (verify_kind
-- 'companions') summarised: the summary could close early (only its
-- 'cron-http' companions counted, untagged items still open) or never close
-- (an untagged-only run: zero companions found).
--
-- Fix: public.ops_alert_fingerprint(kind, source, title, job) is the one
-- definition; ops_alert_apply and ops_alert_verify both call it, so they can
-- no longer drift. It reproduces ops_alert_apply exactly (source btrimmed,
-- 'unknown' when blank, cut to 120; title normalised, '(no message)' when
-- blank; the '|job:' suffix for 'cron-http-untagged' only), so every stored
-- fingerprint is unchanged. The verifier's source now gets the same btrim /
-- 'unknown' treatment as the writer, which only makes the two agree.
--
-- Both functions restated from their live definitions (pg_get_functiondef,
-- 2026-09-24): ops_alert_apply from 20260924035844, ops_alert_verify from
-- 20260924005818. Only the fingerprint expressions changed. Grants as live.
-- Proof: src/test/pglite/cronUntaggedFingerprint.pglite.mjs.

CREATE OR REPLACE FUNCTION public.ops_alert_fingerprint(
  p_source_kind text,
  p_source      text,
  p_title       text,
  p_job         text DEFAULT NULL
) RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $function$
  SELECT md5(p_source_kind || '|' || s.src || '|'
             || coalesce(nullif(public.ops_alert_normalise(p_title), ''), '(no message)')
             -- Q316: one item per untagged job, the name kept verbatim.
             || CASE WHEN s.src = 'cron-http-untagged' AND p_job IS NOT NULL
                     THEN '|job:' || p_job ELSE '' END)
    FROM (SELECT left(coalesce(nullif(btrim(p_source), ''), 'unknown'), 120) AS src) s
$function$;

REVOKE ALL ON FUNCTION public.ops_alert_fingerprint(text, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ops_alert_fingerprint(text, text, text, text) TO service_role;

CREATE OR REPLACE FUNCTION public.ops_alert_apply(
  p_source_kind text,
  p_source      text,
  p_title       text,
  p_severity    text,
  p_sample      text DEFAULT NULL,
  p_sample_ref  jsonb DEFAULT '{}'::jsonb,
  p_verify_kind text DEFAULT NULL,
  p_verify_ref  text DEFAULT NULL,
  p_seen_at     timestamptz DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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
  -- Q316: the one fingerprint definition, shared with ops_alert_verify.
  v_fp := public.ops_alert_fingerprint(p_source_kind, p_source, p_title, p_sample_ref ->> 'job');

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
$function$;

REVOKE ALL ON FUNCTION public.ops_alert_apply(text, text, text, text, text, jsonb, text, text, timestamptz)
  FROM PUBLIC, anon, authenticated, service_role;

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
            ORDER BY verify_started_at ASC NULLS FIRST, last_seen DESC LIMIT 200
  LOOP
    BEGIN
      -- NOTE: not side-effect free for every source — ops-digest-undelivered
      -- may write error_logs and post to Slack (see ops_alert_condition).
      v_still := public.ops_alert_condition(coalesce(r.verify_ref, r.source), r.sample_ref, r.last_seen, false);
    EXCEPTION WHEN OTHERS THEN
      v_still := NULL;
      UPDATE public.ops_alert_ledger SET verify_note = left('verify raised: ' || SQLERRM, 500),
             verify_started_at = v_at, updated_at = now()
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
      -- Asked, no answer. Stamped all the same, so an item that can never be
      -- answered goes to the back of the queue instead of holding a slot.
      UPDATE public.ops_alert_ledger SET verify_started_at = v_at, updated_at = now()
       WHERE id = r.id AND verify_started_at IS DISTINCT FROM v_at;
      v_unknown := v_unknown + 1;
    END IF;
  END LOOP;
  -- Slack posts that SUMMARISE error_logs rows: closed when there ARE
  -- companion error_logs items (seen in the 5 minutes up to the post) and
  -- every one of them is closed. No companions -> it stays open for a person.
  FOR r IN SELECT * FROM public.ops_alert_ledger
            WHERE status <> 'closed' AND verify_kind = 'companions'
            ORDER BY verify_started_at ASC NULLS FIRST, last_seen DESC LIMIT 200
  LOOP
    WITH comp AS (
      -- Q316: the same fingerprint ops_alert_ledger_from_error_log -> ops_alert_apply
      -- stored (same title split, same tags.job), from the one shared function.
      SELECT DISTINCT public.ops_alert_fingerprint('error_logs', src,
                          split_part(coalesce(e.message, ''), ' — ', 1),
                          CASE WHEN jsonb_typeof(e.tags) = 'object' THEN e.tags ->> 'job' END) AS fp
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
    ELSE
      UPDATE public.ops_alert_ledger SET verify_started_at = v_at, updated_at = now()
       WHERE id = r.id;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('folded', v_folded, 'closed', v_closed, 'still_failing', v_open,
                            'could_not_ask', v_unknown, 'at', v_at);
END;
$fn$;

REVOKE ALL ON FUNCTION public.ops_alert_verify() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ops_alert_verify() TO service_role;
