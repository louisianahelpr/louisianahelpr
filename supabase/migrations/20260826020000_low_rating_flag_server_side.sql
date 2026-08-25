-- Low-rating auto-flag moves SERVER-side.
--
-- BEFORE: src/components/CompletionPrompts.tsx, immediately after a reviewer
-- submitted a review, ran the whole moderation decision in the REVIEWER'S
-- browser:
--   1. SELECT every rating the reviewee has ever received,
--   2. count the ones <= 2 in JavaScript,
--   3. if >= 3, INSERT a `low_ratings` row into user_violations against
--      ANOTHER USER, and
--   4. fan a "user auto-flagged" notification to every admin
--      (SELECT user_id FROM user_roles WHERE role='admin' — from the client).
--
-- Three separate problems, same root cause as the message-scanner ladder
-- (20260825183000) and the job-denial ladder (20260824243000): a client was
-- deciding a consequence.
--
--   * It never worked. `user_violations` only has "Admins can manage
--     violations" (FOR ALL, has_role(...,'admin')) and `notifications` INSERT
--     needs admin or service_role — so for every ordinary reviewer both writes
--     were rejected by RLS and the error was merely `report()`ed. The flag has
--     been silently failing to fire for its entire life; nothing has ever
--     reached the fraud queue this way.
--   * If an admin happened to be the reviewer, it DID fire — so the feature
--     was live for exactly the population least likely to trigger it.
--   * It flagged a THIRD PARTY on the strength of a count the client computed.
--     Had the RLS ever been loosened to make the "feature work", any modified
--     client could have flagged any user it liked.
--
-- AFTER: one SECURITY DEFINER function. The client reports "I just reviewed
-- this person"; the SERVER re-counts the reviewee's low ratings from the
-- reviews table, decides whether the threshold is met, dedupes, and writes the
-- violation + the admin fanout under its own authority. The caller cannot
-- choose the count, cannot flag someone they have not actually reviewed, and
-- gains nothing by skipping the call (an unflagged user simply stays unflagged
-- until the next genuine reviewer submits).
--
-- Consequence tier is unchanged: `action_taken = 'warning'`, admin-visible,
-- nothing automatic happens to the account. This is a queue entry, not a ban.

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
         '/admin?view=fraud',
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

-- Keeps both the dedupe lookup and the admin fraud queue cheap.
CREATE INDEX IF NOT EXISTS idx_user_violations_low_ratings
  ON public.user_violations (user_id, created_at DESC)
  WHERE violation_type = 'low_ratings';
