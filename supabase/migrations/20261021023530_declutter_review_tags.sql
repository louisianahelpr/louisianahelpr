-- Board 163 / Q2265 (owner approved 2026-10-21): quick tags on a Declutter review.
--
-- A review may carry up to four quick tags chosen from a FIXED list per side (the board's chips):
--   the buyer about the seller: as_described, easy_pickup, friendly, fair_price
--   the seller about the buyer: on_time, paid_fast, friendly, easy_to_deal
-- One immutable function (declutter_review_tags_for) is the only list: the table CHECK and the RPC both read it.
-- Tags are shown wherever the review is shown, under the same blind rule (declutter_visible_reviews: both sides
-- reviewed, or 14 days after the handover). export_my_data already exports the row with to_jsonb, so the tags
-- go with it.
--
-- declutter_leave_review gains p_tags text[] DEFAULT '{}' (the old 3-argument call still resolves to it), and
-- declutter_visible_reviews returns tags. Both restated from 20261015042253 (prod prosrc md5 fd291121e5e944bc7b384d868e1e944e
-- and 5b0f3a79e99bf153cc44def7d494c570 = that file's bodies, measured 2026-10-21) with only the tag lines added.
-- Changing an argument list / a RETURNS TABLE needs DROP + CREATE; grants are restated as live
-- (authenticated, service_role; never anon). Replay-safe: every step is IF [NOT] EXISTS or OR REPLACE.

-- APPEND-ONLY (lh-authz-rls review of Q2265 #2): the table CHECK reads this list, so removing a tag would make every
-- later UPDATE of an old row carrying it fail (including the reviewer_id SET NULL when an account is deleted). To retire
-- a tag, split an "allowed" list (CHECK, append-only) from an "offered" list (the RPC and the sheet).
CREATE OR REPLACE FUNCTION public.declutter_review_tags_for(p_side text)
RETURNS text[]
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT CASE p_side
    WHEN 'buyer'  THEN ARRAY['as_described', 'easy_pickup', 'friendly', 'fair_price']
    WHEN 'seller' THEN ARRAY['on_time', 'paid_fast', 'friendly', 'easy_to_deal']
  END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_review_tags_for(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_review_tags_for(text) TO authenticated, service_role;

ALTER TABLE public.declutter_reviews ADD COLUMN IF NOT EXISTS tags text[] NOT NULL DEFAULT '{}';

DO $do$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'declutter_reviews_tags_allowed') THEN
    ALTER TABLE public.declutter_reviews
      ADD CONSTRAINT declutter_reviews_tags_allowed
      CHECK (cardinality(tags) <= 4 AND tags <@ public.declutter_review_tags_for(reviewer_side));
  END IF;
END
$do$;

DROP FUNCTION IF EXISTS public.declutter_leave_review(uuid, integer, text);
CREATE OR REPLACE FUNCTION public.declutter_leave_review(p_order_id uuid, p_stars integer, p_comment text, p_tags text[] DEFAULT '{}')
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  o public.declutter_orders;
  v_side text;
  v_id uuid;
  v_tags text[];
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO o FROM public.declutter_orders WHERE id = p_order_id;
  v_side := public.declutter_order_side(o.buyer_id, o.seller_id, v_uid);
  IF v_side IS NULL THEN
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF o.status <> 'handed_over' THEN
    RAISE EXCEPTION 'not_handed_over' USING ERRCODE = '55000', HINT = 'Reviews open after the handover.';
  END IF;
  IF p_stars IS NULL OR p_stars NOT BETWEEN 1 AND 5 THEN
    RAISE EXCEPTION 'invalid_stars' USING ERRCODE = '22023';
  END IF;
  p_comment := NULLIF(btrim(p_comment), '');
  IF p_comment IS NOT NULL AND char_length(p_comment) > 1000 THEN
    RAISE EXCEPTION 'comment_too_long' USING ERRCODE = '22023';
  END IF;
  IF p_comment IS NOT NULL AND public.contact_leak_reason(p_comment) IS NOT NULL THEN
    RAISE EXCEPTION 'review_contact_info' USING ERRCODE = '23514',
      HINT = 'Reviews cannot include phone numbers, emails or links.';
  END IF;
  -- Q2265: each tag once, only from this side's list.
  v_tags := ARRAY(SELECT DISTINCT t FROM unnest(coalesce(p_tags, '{}')) AS t WHERE t IS NOT NULL ORDER BY t);
  IF NOT (v_tags <@ public.declutter_review_tags_for(v_side)) THEN
    RAISE EXCEPTION 'invalid_tags' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.declutter_reviews (order_id, reviewer_id, reviewee_id, reviewer_side, stars, comment, tags)
  VALUES (o.id, v_uid, CASE WHEN v_side = 'buyer' THEN o.seller_id ELSE o.buyer_id END, v_side, p_stars, p_comment, v_tags)
  ON CONFLICT (order_id, reviewer_side) DO NOTHING
  RETURNING id INTO v_id;
  IF v_id IS NULL THEN
    RAISE EXCEPTION 'already_reviewed' USING ERRCODE = '23505';
  END IF;
  RETURN v_id;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_leave_review(uuid, integer, text, text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_leave_review(uuid, integer, text, text[]) TO authenticated, service_role;

DROP FUNCTION IF EXISTS public.declutter_visible_reviews(uuid);
CREATE OR REPLACE FUNCTION public.declutter_visible_reviews(p_user_id uuid)
RETURNS TABLE (id uuid, reviewer_side text, stars smallint, comment text, created_at timestamptz, tags text[])
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
  -- No order id (lh-authz-rls review 2.5); a test account's review stays hidden under the seed switch (Q552).
  SELECT r.id, r.reviewer_side, r.stars, r.comment, r.created_at, r.tags
    FROM public.declutter_reviews r
    JOIN public.declutter_orders o ON o.id = r.order_id
   WHERE r.reviewee_id = p_user_id
     AND (SELECT auth.uid()) IS NOT NULL
     AND (r.reviewer_id = (SELECT auth.uid())
          OR o.handed_over_at <= now() - interval '14 days'
          OR (SELECT count(*) FROM public.declutter_reviews r2 WHERE r2.order_id = r.order_id) = 2)
     AND (r.reviewee_id = (SELECT auth.uid()) OR r.is_seed IS NOT TRUE OR NOT (SELECT public.seed_hidden_from_caller()))
   ORDER BY r.created_at DESC;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_visible_reviews(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_visible_reviews(uuid) TO authenticated, service_role;
