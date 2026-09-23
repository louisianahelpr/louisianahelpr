-- Q76: every admin action writes its own admin_audit_log row, at the server.
--
-- resolve_stalled_job_flag() (20260919143637) is admin-only and changes state
-- (job_completion_nudges.resolved_at/by), but its audit row was written by the
-- CLIENT after the RPC returned (AdminStalledJobs.markReviewed ->
-- logAdminAction). A closed tab, a dropped request or a refused client insert
-- between the two left a resolved flag with no audit row. The row is now
-- written inside the same transaction as the UPDATE, only when the UPDATE
-- matched (a second tap that resolves nothing writes nothing), and the client
-- call is removed so there is exactly one row per action.
--
-- Body otherwise identical to 20260919143637. CREATE OR REPLACE is
-- replay-safe; grants restated by role name (FROM PUBLIC, anon).

CREATE OR REPLACE FUNCTION public.resolve_stalled_job_flag(p_job_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_rows integer;
  v_escalated_at timestamptz;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'not authorized';
  END IF;

  UPDATE public.job_completion_nudges
     SET resolved_at = now(),
         resolved_by = auth.uid()
   WHERE job_id = p_job_id
     AND escalated_at IS NOT NULL
     AND resolved_at IS NULL
  RETURNING escalated_at INTO v_escalated_at;

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  -- false means "there was nothing open to resolve" — already cleared, or
  -- never escalated. The caller must not read that as success.
  IF v_rows = 0 THEN
    RETURN false;
  END IF;

  INSERT INTO public.admin_audit_log (admin_id, action, target_type, target_id, details)
  VALUES (
    auth.uid(),
    'resolve_stalled_job_flag',
    'job',
    p_job_id::text,
    -- Only the nudge's own facts: reading public.jobs here would be a jobs
    -- read inside a writing function (race-class, 20260913014328) for
    -- decoration alone. The job is the target; its state is one lookup away.
    jsonb_build_object('escalated_at', v_escalated_at)
  );

  RETURN true;
END;
$function$;

REVOKE ALL ON FUNCTION public.resolve_stalled_job_flag(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resolve_stalled_job_flag(uuid) TO authenticated;

COMMENT ON FUNCTION public.resolve_stalled_job_flag(uuid) IS
  'Marks one stalled-job queue item as handled by the calling admin and writes its '
  'admin_audit_log row (Q76). Returns false when nothing was open to resolve. Moves '
  'no money — the release, refund or dispute goes through the existing admin money paths.';
