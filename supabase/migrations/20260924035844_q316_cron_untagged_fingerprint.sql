-- Q316 (docs/OPEN.md): the ledger fingerprint collapsed digit-bearing cron
-- job names.
--
-- ops_alert_apply fingerprints md5(source_kind | source | normalised title),
-- and ops_alert_normalise turns a free-standing number into '#'. So the
-- 'cron-http-untagged' rows for the jobs cleanup-7d and cleanup-30d (or the
-- unnamed 'jobid 12' and 'jobid 13') shared ONE ledger item. sample_ref keeps
-- only the last job's name, so ops_alert_condition (Q287) could close the item
-- while the other job was still untagged, and the next daily sweep reopened it.
--
-- Fix: for source 'cron-http-untagged' only, the fingerprint also carries the
-- job name, verbatim (digits intact), from sample_ref->>'job' (the name the
-- sweep files and the close rule judges by). Every other source keeps the
-- exact fingerprint it had, so existing open items keep matching. Live had 0
-- 'cron-http-untagged' ledger rows when this was written (2026-09-24), so no
-- item is orphaned by the change.
--
-- Restated from the live definition (pg_get_functiondef, 2026-09-24; last
-- written by 20260923050059). Only the v_fp line changed.
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
  v_fp := md5(p_source_kind || '|' || v_source || '|' || v_title
              -- Q316: one item per untagged job, the name kept verbatim.
              || CASE WHEN v_source = 'cron-http-untagged' AND p_sample_ref ->> 'job' IS NOT NULL
                      THEN '|job:' || (p_sample_ref ->> 'job') ELSE '' END);

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

-- Same grants as live ({postgres=X/postgres}): callable only through
-- ops_alert_record / the fold, which run as the owner.
REVOKE ALL ON FUNCTION public.ops_alert_apply(text, text, text, text, text, jsonb, text, text, timestamptz)
  FROM PUBLIC, anon, authenticated, service_role;
