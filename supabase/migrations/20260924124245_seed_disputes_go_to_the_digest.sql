-- A dispute on a SEED job goes to the daily digest, not a critical page.
--
-- 2026-09-24 08:06 the prod-audit dispute fixture ("Prod audit dispute
-- fixture: patch a drywall hole", jobs.is_seed = true) paged #ops-alerts
-- CRITICAL "Job disputed" (ops ledger 076553f2). Tests run against prod by
-- design, so fixture disputes are routine; the edge side already routes seed
-- alerts to the digest (postSlackOpsAlert `seed`, _shared/slack-alerts.ts) as
-- an error_logs row tagged source 'ops-alert-seed', seed: true — which
-- public.error_log_is_seed (20260923052520) keeps out of the open ledger.
-- This function never asked: it takes _job_id and reads no table, so the
-- seed-policy class guard's inventory missed it too (widened in
-- src/test/alertingDetectorsDeclareSeedPolicy.test.ts).
--
-- Nothing is dropped: the seed row carries the same title, message, fields
-- and link. A job whose poster deleted their account keeps its is_seed, and a
-- missing job row (NULL) is treated as REAL and pages.
--
-- Body otherwise identical to 20260902035447. CREATE OR REPLACE is replay-safe.

CREATE OR REPLACE FUNCTION public.notify_ops_dispute_filed(
  _job_id uuid,
  _job_title text,
  _reason text,
  _opener_id uuid,
  _refiled boolean DEFAULT false
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_url text;
  v_key text;
  v_seed boolean;
  v_title text;
  v_message text;
  v_fields jsonb;
  v_link text := 'https://www.louisianahelpr.com/admin?view=disputes';
BEGIN
  v_title := CASE WHEN _refiled THEN 'Job re-disputed — escrow re-frozen'
                  ELSE 'Job disputed' END;
  v_message := '*' || COALESCE(_job_title, 'a job') || '* — ' || COALESCE(_reason, 'no reason given')
               || '. Payment is on hold pending admin review.';
  v_fields := jsonb_build_object(
    'Job ID',      _job_id::text,
    'Reason',      COALESCE(_reason, '—'),
    'Disputed by', _opener_id::text,
    'Re-filed',    CASE WHEN _refiled THEN 'yes' ELSE 'no' END
  );

  SELECT j.is_seed INTO v_seed FROM public.jobs j WHERE j.id = _job_id;
  IF coalesce(v_seed, false) THEN
    INSERT INTO public.error_logs (severity, message, tags, context)
    VALUES (
      'info',
      left(v_title || ' — ' || v_message, 1000),
      jsonb_build_object('source', 'ops-alert-seed', 'kind', 'dispute_filed',
                         'seed', true, 'would_have_been', 'critical'),
      jsonb_build_object('fields', v_fields, 'link', v_link)
    );
    RETURN;
  END IF;

  v_url := public.get_supabase_url();
  v_key := public.get_service_role_key();

  IF v_url IS NULL OR v_key IS NULL THEN
    RAISE WARNING 'notify_ops_dispute_filed: vault secrets missing — Slack alert skipped for job %', _job_id;
    RETURN;
  END IF;

  PERFORM net.http_post(
    url     := v_url || '/functions/v1/slack-ops-alert',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || v_key,
      'Content-Type',  'application/json'
    ),
    body := jsonb_build_object(
      'kind',     'dispute_filed',
      'severity', 'critical',
      'title',    v_title,
      'message',  v_message,
      'fields',   v_fields,
      -- `?view=`, not `?tab=`: Admin.tsx reads searchParams.get("view").
      'link',     v_link
    )
  );
EXCEPTION WHEN OTHERS THEN
  -- pg_net absent, http_post signature changed, vault unreadable — none of
  -- these are worth failing a dispute over.
  RAISE WARNING 'notify_ops_dispute_filed: alert not posted for job %: %', _job_id, SQLERRM;
END;
$function$;
