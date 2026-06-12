-- Public responses to reviews, written by the person who was reviewed.
ALTER TABLE reviews
  ADD COLUMN IF NOT EXISTS response_text text,
  ADD COLUMN IF NOT EXISTS response_at timestamptz;

-- RPC: reviewee adds/updates their response. One response per review.
-- Auth: must be the reviewee (reviews.reviewee_id = auth.uid()).
CREATE OR REPLACE FUNCTION respond_to_review(
  _review_id uuid,
  _response_text text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE reviews
  SET
    response_text = TRIM(_response_text),
    response_at   = now()
  WHERE id = _review_id
    AND reviewee_id = auth.uid()
    AND status = 'published';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Review not found or you are not the reviewee';
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION respond_to_review(uuid, text) TO authenticated;
