-- A strike, once issued, was permanent. There was no way to take one back.
--
-- Six paths WRITE user_violations (four ladder wrappers, the no-show reporter,
-- the low-rating flagger). Exactly two things ever mutate the table afterwards
-- — the ban-review approve/deny edge actions — and both are scoped to
-- action_taken = 'pending_ban_review', the top rung. Every rung below it, and
-- every strike that never escalated at all, was write-once forever.
--
-- That is not a cosmetic gap, because the rows COMPOUND. Each wrapper counts
-- priors to decide the rung:
--   apply_cancellation_violation_consequence  count(*) where type='cancel_with_helper'
--   apply_message_violation_consequence       count(*) where type='off_platform'
--   apply_job_denial_consequence              count(*) where type='job_denial'
--                                             (and an EXISTS for the Elite shield)
--   report_helper_no_show                     count(DISTINCT reported_by), plus a
--                                             one-report-per-job EXISTS guard
--   auto_restrict_repeat_violators            count(*) across ALL types
-- So a single false report — a poster who reports a no-show for a helper who
-- was demonstrably there — is not one wrong warning. It permanently shifts that
-- person one rung up EVERY future ladder, and the next legitimate strike lands
-- as a final warning or a 7-day restriction. The admin could SEE the bad row in
-- the audit log and had no way to act on it.
--
-- WHY DELETE RATHER THAN A reversed_at FLAG. A flag is the tidier-looking
-- design and it is the wrong one here. It would require adding
-- `AND reversed_at IS NULL` to all six read sites above — each a large
-- SECURITY DEFINER body that would have to be rewritten wholesale — and every
-- one of those predicates is subtle in its own way (count(DISTINCT reported_by)
-- ignoring NULLs, the Elite shield's 180-day EXISTS, the already_reported
-- guard). Miss one and the reversal silently does nothing on that path, which
-- looks exactly like a working reversal. Deleting the row gets all six correct
-- at once, by construction, and cannot drift as new count sites are added.
--
-- It is also the better SEMANTICS. A reversed strike should restore the Elite
-- shield, should stop blocking a re-report of the same job, and should vanish
-- from the user's own /profile?tab=warnings — a flag makes each of those a
-- separate decision to remember; deletion makes them all true for free.
--
-- The audit trail does not depend on the row surviving: the whole row is
-- snapshotted into admin_audit_log.details BEFORE the delete, so what was
-- reversed, by whom, when and why is recoverable — and UserAuditLog already
-- renders admin_audit_log entries above violation rows.

CREATE OR REPLACE FUNCTION public.admin_reverse_violation(
  p_violation_id uuid,
  p_reason text,
  p_restore_access boolean DEFAULT false
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_admin uuid := auth.uid();
  v_row public.user_violations%ROWTYPE;
  v_remaining int;
  v_status text;
  v_restored boolean := false;
BEGIN
  IF v_admin IS NULL OR NOT public.has_role(v_admin, 'admin'::app_role) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  -- A reason is mandatory. Reversing a strike is itself a moderation decision
  -- and the next admin reading the log needs to know why, not just that.
  IF p_reason IS NULL OR btrim(p_reason) = '' THEN
    RAISE EXCEPTION 'reason_required';
  END IF;

  -- Lock it. Two admins reversing the same row must not both snapshot-and-log.
  SELECT * INTO v_row FROM public.user_violations
   WHERE id = p_violation_id FOR UPDATE;

  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'violation_not_found';
  END IF;

  -- Snapshot BEFORE the delete — this row is the audit trail from here on.
  INSERT INTO public.admin_audit_log (admin_id, action, target_type, target_id, details)
  VALUES (
    v_admin, 'reverse_violation', 'user', v_row.user_id,
    jsonb_build_object(
      'reason',         p_reason,
      'violation_id',   v_row.id,
      'violation_type', v_row.violation_type,
      'description',    v_row.description,
      'action_taken',   v_row.action_taken,
      'job_id',         v_row.job_id,
      'reported_by',    v_row.reported_by,
      'issued_at',      v_row.created_at
    ));

  DELETE FROM public.user_violations WHERE id = p_violation_id;

  -- Restoring account access is a SEPARATE, opt-in decision, and deliberately
  -- narrow. The ladder sets ban_status from several places and an admin ban is
  -- indistinguishable here from an automatic one, so this only ever DOWNGRADES,
  -- only when the user has no strikes left at all, and never out of a permanent
  -- ban — that stays with the ban-review flow, which owns the appeal record.
  -- Anything more nuanced is what the ban dialog is for.
  IF p_restore_access THEN
    SELECT count(*) INTO v_remaining
      FROM public.user_violations WHERE user_id = v_row.user_id;

    SELECT ban_status INTO v_status
      FROM public.profiles WHERE user_id = v_row.user_id;

    IF v_remaining = 0 AND v_status IN ('final_warning', 'temp_banned') THEN
      UPDATE public.profiles
         SET ban_status = 'active', auto_suspended_until = NULL
       WHERE user_id = v_row.user_id;
      v_restored := true;

      INSERT INTO public.notifications (user_id, title, message, type, link)
      VALUES (v_row.user_id, 'Your account is back in good standing',
              'An admin reviewed a warning on your account and removed it. Your account is fully active again.',
              'system_alert', '/profile?tab=warnings');
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'reversed', true,
    'user_id', v_row.user_id,
    'violation_type', v_row.violation_type,
    'access_restored', v_restored,
    'remaining_violations', COALESCE(v_remaining, -1));
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_reverse_violation(uuid, text, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_reverse_violation(uuid, text, boolean) TO authenticated;
