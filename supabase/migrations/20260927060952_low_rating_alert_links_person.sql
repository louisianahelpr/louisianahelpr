-- Q752: the "Low rating alert" an admin gets opened /admin?view=fraud, and the
-- fraud dashboard reads only fraud_flags. apply_low_rating_flag writes a
-- user_violations row, so the admin landed on a screen that did not show the
-- flag they were told about. The link now opens the flagged person on
-- /admin?view=people&user=<id> (AdminUsers opens that profile, whose
-- violations list reads user_violations).
--
-- apply_low_rating_flag: effective definition is
-- 20260923205635_notification_producers_carry_their_subject.sql; restated
-- verbatim except the link's view (fraud -> people). The '&user=<id>' param is
-- kept, so admin_alert_ref and notification_crosses_seed_boundary (both read
-- [?&]user=<uuid> whatever the view) still find the member.
CREATE OR REPLACE FUNCTION public.apply_low_rating_flag(
  p_reviewee_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_low_count int;
  v_recent uuid;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  IF p_reviewee_id IS NULL OR p_reviewee_id = v_caller THEN
    -- No self-flagging, and nothing to do without a subject.
    RETURN jsonb_build_object('action', 'none');
  END IF;

  -- Standing to report at all: the caller must actually have reviewed this
  -- person. Without this a client could poll the function against arbitrary
  -- user ids to discover who is one bad review away from the fraud queue.
  IF NOT EXISTS (
    SELECT 1 FROM public.reviews
     WHERE reviewer_id = v_caller AND reviewee_id = p_reviewee_id
  ) THEN
    RETURN jsonb_build_object('action', 'none');
  END IF;

  -- The count the DECISION rests on is recomputed here, from the source of
  -- truth, not accepted from the caller.
  SELECT count(*) INTO v_low_count
    FROM public.reviews
   WHERE reviewee_id = p_reviewee_id AND rating <= 2;

  IF v_low_count < 3 THEN
    RETURN jsonb_build_object('action', 'none', 'low_count', v_low_count);
  END IF;

  -- Dedupe: one open flag per user per 30 days. The old client code had no
  -- dedupe at all — once a user crossed 3 low ratings, EVERY subsequent review
  -- of them (any rating, from anyone) re-inserted the same violation and
  -- re-notified every admin.
  SELECT id INTO v_recent
    FROM public.user_violations
   WHERE user_id = p_reviewee_id
     AND violation_type = 'low_ratings'
     AND created_at > now() - interval '30 days'
   LIMIT 1;

  IF v_recent IS NOT NULL THEN
    RETURN jsonb_build_object('action', 'duplicate', 'violation_id', v_recent);
  END IF;

  INSERT INTO public.user_violations (user_id, violation_type, description, reported_by, action_taken)
  VALUES (
    p_reviewee_id,
    'low_ratings',
    format('User has %s ratings of 2 stars or below. Auto-flagged for admin review.', v_low_count),
    NULL,               -- system-detected, not a person's report
    'warning'
  );

  -- Same admin-fanout shape as apply_message_violation_consequence.
  INSERT INTO public.notifications (user_id, type, title, message, link, read)
  SELECT ur.user_id,
         'system_alert',
         'Low rating alert',
         format('%s has received %s low ratings and has been auto-flagged.',
                COALESCE(NULLIF(p.full_name, ''), p.email, 'A user'), v_low_count),
         '/admin?view=people&user=' || p_reviewee_id,
         false
    FROM public.user_roles ur
    CROSS JOIN LATERAL (
      SELECT full_name, email FROM public.profiles WHERE user_id = p_reviewee_id
    ) p
   WHERE ur.role = 'admin';

  RETURN jsonb_build_object('action', 'flagged', 'low_count', v_low_count);
END;
$$;

REVOKE ALL ON FUNCTION public.apply_low_rating_flag(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.apply_low_rating_flag(uuid) TO authenticated;
