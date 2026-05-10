-- Anti-retaliation: hide review content for 14 days OR until the other
-- party also writes a review for the same job, whichever comes first.
-- Standard marketplace pattern (Airbnb, Uber). Without this, a helper
-- who gets a 2-star review can see it immediately and retaliate.
--
-- Implementation: feedback_visible_at column + AFTER INSERT trigger.
-- - New review with no reciprocal yet: visible_at = now + 14 days
-- - New review WITH reciprocal: both rows flipped to visible_at = now
-- Frontend filters reviews where feedback_visible_at <= NOW() at read time.

ALTER TABLE public.reviews
  ADD COLUMN IF NOT EXISTS feedback_visible_at timestamptz;

-- Backfill: any existing reviews are immediately visible (legacy data,
-- already public on the platform).
UPDATE public.reviews SET feedback_visible_at = created_at WHERE feedback_visible_at IS NULL;

CREATE INDEX IF NOT EXISTS reviews_feedback_visible_at_idx
  ON public.reviews (feedback_visible_at);

CREATE OR REPLACE FUNCTION public.set_review_visibility()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  reciprocal_id uuid;
BEGIN
  -- Skip if visibility was set explicitly (e.g. admin override or backfill).
  IF NEW.feedback_visible_at IS NOT NULL THEN
    RETURN NEW;
  END IF;

  -- Look for reciprocal review on the same job, where the new reviewer
  -- is the existing review's REVIEWEE (and vice versa).
  SELECT id INTO reciprocal_id
  FROM public.reviews
  WHERE job_id = NEW.job_id
    AND reviewee_id = NEW.reviewer_id
    AND id != NEW.id
  LIMIT 1;

  IF reciprocal_id IS NOT NULL THEN
    -- Reciprocal exists → reveal both immediately.
    UPDATE public.reviews
    SET feedback_visible_at = NOW()
    WHERE id IN (NEW.id, reciprocal_id);
  ELSE
    -- First side to review → hold for 14 days.
    UPDATE public.reviews
    SET feedback_visible_at = NOW() + INTERVAL '14 days'
    WHERE id = NEW.id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS set_review_visibility_tg ON public.reviews;
CREATE TRIGGER set_review_visibility_tg
  AFTER INSERT ON public.reviews
  FOR EACH ROW EXECUTE FUNCTION public.set_review_visibility();

REVOKE ALL ON FUNCTION public.set_review_visibility() FROM PUBLIC, anon, authenticated;
