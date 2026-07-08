-- rpc_decide_dispute previously wrote NO admin_audit_log row — the one
-- admin action outside the centralized audit trail (the decision was
-- still attributable via disputes.decided_by, but not surfaced in the
-- AdminAuditLog view). Add the audit insert so every dispute decision
-- shows up alongside every other admin mutation for compliance review.
--
-- Contract identical to the previous version (uuid, text, jsonb → void);
-- SECURITY DEFINER + admin gate + FOR UPDATE row lock all preserved. The
-- only substantive change is the INSERT INTO admin_audit_log near the
-- end, wrapped in an EXCEPTION-WHEN-others block so an audit-log write
-- failure never rolls back the dispute decision (writing the decision is
-- the load-bearing action; the audit row is secondary observability).

CREATE OR REPLACE FUNCTION public.rpc_decide_dispute(
  _dispute_id uuid,
  _decision_text text,
  _payout_split jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _job_id uuid;
  _customer_id uuid;
  _helper_id uuid;
  _job_title text;
  _existing_status text;
  _poster_share numeric;
  _helper_share numeric;
  _new_job_status text;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  IF NOT public.has_role(_uid, 'admin') THEN
    RAISE EXCEPTION 'admin only';
  END IF;

  IF _decision_text IS NULL OR length(trim(_decision_text)) = 0 THEN
    RAISE EXCEPTION 'decision_text required';
  END IF;

  SELECT job_id, status INTO _job_id, _existing_status
    FROM public.disputes
   WHERE id = _dispute_id
     FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'dispute not found';
  END IF;

  IF _existing_status <> 'open' THEN
    RAISE EXCEPTION 'dispute already %', _existing_status;
  END IF;

  SELECT customer_id, helper_id, title
    INTO _customer_id, _helper_id, _job_title
    FROM public.jobs
   WHERE id = _job_id;

  _poster_share := COALESCE((_payout_split->>'poster')::numeric, 0.5);
  _helper_share := COALESCE((_payout_split->>'helper')::numeric, 0.5);
  IF _poster_share > 1 OR _helper_share > 1 THEN
    _poster_share := _poster_share / 100.0;
    _helper_share := _helper_share / 100.0;
  END IF;

  IF _poster_share >= 1 AND _helper_share <= 0 THEN
    _new_job_status := 'cancelled';
  ELSE
    _new_job_status := 'completed';
  END IF;

  UPDATE public.disputes
     SET status = 'decided',
         decided_at = now(),
         decided_by = _uid,
         decision_text = _decision_text,
         payout_split = jsonb_build_object(
           'poster', _poster_share,
           'helper', _helper_share
         )
   WHERE id = _dispute_id;

  UPDATE public.jobs
     SET status = _new_job_status::public.job_status,
         dispute_resolved_at = now()
   WHERE id = _job_id;

  IF _customer_id IS NOT NULL THEN
    INSERT INTO public.notifications (user_id, type, title, message, link, read)
    VALUES (
      _customer_id,
      'info',
      'Dispute resolved',
      'A decision has been made on "' || COALESCE(_job_title, 'your job') || '": ' || _decision_text,
      '/activity',
      false
    );
  END IF;

  IF _helper_id IS NOT NULL THEN
    INSERT INTO public.notifications (user_id, type, title, message, link, read)
    VALUES (
      _helper_id,
      'info',
      'Dispute resolved',
      'A decision has been made on "' || COALESCE(_job_title, 'a job you worked') || '": ' || _decision_text,
      '/activity',
      false
    );
  END IF;

  -- Audit-log entry so this admin action shows up alongside every other
  -- admin mutation in AdminAuditLog. Non-fatal — the decision itself has
  -- already committed; a failed audit write shouldn't roll it back.
  BEGIN
    INSERT INTO public.admin_audit_log (admin_id, action, target_id, target_type, details)
    VALUES (
      _uid,
      'decide_dispute',
      _dispute_id,
      'dispute',
      jsonb_build_object(
        'job_id', _job_id,
        'poster_share', _poster_share,
        'helper_share', _helper_share,
        'new_job_status', _new_job_status,
        'decision_preview', left(_decision_text, 200)
      )
    );
  EXCEPTION WHEN others THEN
    -- Swallow. The decision is committed above; missing an audit row is
    -- an observability gap, not a correctness bug.
    NULL;
  END;
END;
$$;

REVOKE ALL ON FUNCTION public.rpc_decide_dispute(uuid, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_decide_dispute(uuid, text, jsonb) TO authenticated;
