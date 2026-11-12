-- Shops audit 11-12 S052 (Builder 1, Shops DB lane): a shop review row shows the buyer's name the way profile and
-- Declutter review rows do ("First L.", member_display_name), under the profile reviews' name rules, hidden across a
-- block or an active ban and for test reviewers; otherwise "A neighbor" (lh-authz-rls review FAIL -> fixed).
-- shops_shop_reviews restated VERBATIM from 20261111021548 (newest) plus 'reviewer_name' on each review. The read stays
-- members-only (authenticated; signed-out pages never call it) and still lists only public buyer reviews; it never
-- returns the reviewer's id.
-- MONEY: none. AUTHZ: lh-authz-rls (a definer read gains the reviewer's short name).
-- REPLAY-SAFE: CREATE OR REPLACE; REVOKE/GRANT restated as before.
-- Proof: src/test/pglite/shopsReviewFirstName.pglite.mjs (3x; NEW_MIGRATION=skip red).

CREATE OR REPLACE FUNCTION public.shops_shop_reviews(p_shop_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_rating numeric;
  v_count integer;
BEGIN
  PERFORM public.require_feature('shops');
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF NOT public.shop_visible_to(p_shop_id, v_uid) THEN
    RAISE EXCEPTION 'shop_not_found' USING ERRCODE = 'PT404';
  END IF;
  SELECT rr.rating, rr.review_count INTO v_rating, v_count FROM public.shop_review_rating(p_shop_id) rr;
  RETURN jsonb_build_object(
    'rating', v_rating,
    'review_count', COALESCE(v_count, 0),
    'reviews', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id', x.id, 'stars', x.stars, 'comment', x.comment, 'created_at', x.created_at,
                                          -- NEW (S052): "First L." under the profile reviews' rules (20261103224601: verified, never
                                          -- banned, not deleted, not out of Declutter, not under 18), hidden across a block or an
                                          -- active ban (declutter_names_hidden, 20261112010100) and for a test reviewer; else "A neighbor".
                                          'reviewer_name', CASE
                                            WHEN x.reviewer_id IS NULL OR public.declutter_names_hidden(v_uid, x.reviewer_id)
                                                 OR public.is_test_member(x.reviewer_id) THEN 'A neighbor'
                                            ELSE public.member_display_name(
                                              (SELECT rp.full_name FROM public.profiles rp
                                                WHERE rp.user_id = x.reviewer_id
                                                  AND rp.email_verified
                                                  AND rp.ban_status IS DISTINCT FROM 'banned'
                                                  AND rp.ban_status IS DISTINCT FROM 'temp_banned'
                                                  AND rp.ban_status IS DISTINCT FROM 'permanently_banned'
                                                  AND rp.anonymized_at IS NULL
                                                  AND NOT public.declutter_member_out(rp.user_id)
                                                  AND NOT COALESCE(public.member_under_18(rp.user_id), true)
                                                LIMIT 1)) END)
                       ORDER BY x.created_at DESC, x.id)
        FROM (SELECT r.id, r.stars, r.comment, r.created_at, r.reviewer_id FROM public.shop_reviews r
               WHERE r.shop_id = p_shop_id AND r.reviewer_side = 'buyer' AND public.shop_review_public(r.id)
               ORDER BY r.created_at DESC, r.id LIMIT 100) x), '[]'::jsonb));
END;
$fn$;
REVOKE ALL ON FUNCTION public.shops_shop_reviews(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.shops_shop_reviews(uuid) TO authenticated, service_role;
