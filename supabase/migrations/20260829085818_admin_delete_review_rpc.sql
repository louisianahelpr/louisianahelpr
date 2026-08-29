-- Admin review takedown. There was previously NO way for an admin to remove
-- a review — reports with reported_type='review' land in the AdminReports
-- queue but the queue only offers assign/resolve/dismiss, never a delete.
-- Star aggregates are computed live via AVG(rating) at query time (see
-- 20260701000000_canonical_rating_filter_in_rpcs.sql), not a denormalized
-- column, so deleting the row is sufficient — no separate recompute step.
CREATE OR REPLACE FUNCTION public.admin_delete_review(_review_id uuid, _reason text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _job_id uuid;
  _reviewee_id uuid;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  IF NOT public.has_role(_uid, 'admin') THEN
    RAISE EXCEPTION 'admin only';
  END IF;

  IF _reason IS NULL OR length(trim(_reason)) = 0 THEN
    RAISE EXCEPTION 'reason required';
  END IF;

  SELECT job_id, reviewee_id INTO _job_id, _reviewee_id
    FROM public.reviews
   WHERE id = _review_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'review not found';
  END IF;

  DELETE FROM public.reviews WHERE id = _review_id;

  BEGIN
    INSERT INTO public.admin_audit_log (admin_id, action, target_id, target_type, details)
    VALUES (
      _uid,
      'delete_review',
      _review_id,
      'review',
      jsonb_build_object('reason', _reason, 'job_id', _job_id, 'reviewee_id', _reviewee_id)
    );
  EXCEPTION WHEN OTHERS THEN
    -- Deleting the review is the load-bearing action; an audit-log write
    -- failure must never roll it back (same pattern as rpc_decide_dispute).
    NULL;
  END;
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_delete_review(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_delete_review(uuid, text) TO authenticated;
