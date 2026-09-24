-- Q291: ops_alert_verify re-asks at most 200 open items per kind per run. It
-- took them newest last_seen first, so a burst of fresh items (e.g. 250 user
-- reports) meant an older money item (detect_stuck_payments) was never
-- re-checked until the burst cleared. Now the least-recently-asked go first
-- (never-asked before all), then newest: every open item is re-asked within
-- ceil(open / 200) runs, whatever the volume. Every ask stamps
-- verify_started_at, including "could not ask" and a companions post that is
-- not yet closable, so no item can hold a slot forever.
-- Body otherwise verbatim from 20260923050059 (live prosrc md5
-- c37f3f9e2da3d53bfb4cf7bd974c8c76 checked 2026-09-24).
-- Proof: src/test/pglite/opsAlertVerifyFair.pglite.mjs.
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
