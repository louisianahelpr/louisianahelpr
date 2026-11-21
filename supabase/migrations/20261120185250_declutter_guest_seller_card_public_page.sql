-- Declutter item page polish (owner approved 2026-11-20, item 6): the signed-out seller card ("Sold by Courtney B.")
-- becomes a link to the seller's public profile page (/u/<handle>) and says "Member since Mar 2025". The guest card
-- read (declutter_guest_seller_card) had neither field, so a guest's card could not link or show the date.
--
-- What changes: two new columns, `handle` and `member_since`, and nothing else.
--   handle       = public.handle_for_user(p.user_id): the /u address, NULL exactly when public_profile_by_handle would
--                  show no page for this member (20261105171316's rule, proven equal by handleForUser.pglite.mjs).
--   member_since = p.created_at, ONLY when that handle is not NULL. public_profile_by_handle (anon-callable, newest
--                  20261115073802) already gives anyone this exact value as 'member_since' on that page, so this
--                  reveals nothing a signed-out visitor cannot already read. A seller with no public page gets neither.
-- Owner 11-11 (F227/F319) said "no profile page" for the guest card; the owner's 11-20 item-page approval reverses that
-- for the link only ("It must work signed out too"; public profile data only; no widening of what anon can read).
--
-- The rest is restated VERBATIM from its newest definition (20261112002528): the five old fields, the WHERE (who a
-- guest may see) and the grants. A new OUT column cannot be added by CREATE OR REPLACE, so DROP + CREATE.
-- REPLAY-SAFETY: DROP IF EXISTS + CREATE; reads only objects that exist before this timestamp (declutter_items,
-- profiles, member_display_name, identity_is_verified, get_public_profile_stats, declutter_orders, is_test_member,
-- profile_review_same_person, declutter_open_to_guests, handle_for_user). Grants restated.
-- Proof: src/test/pglite/declutterGuestSellerCardPublicPage.pglite.mjs. Sensitive: authz (an anon read).

DROP FUNCTION IF EXISTS public.declutter_guest_seller_card(uuid);
CREATE FUNCTION public.declutter_guest_seller_card(p_item_id uuid)
RETURNS TABLE(display_name text, avg_rating numeric, review_count integer, id_checked boolean, pickup_count integer, handle text, member_since timestamptz)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT public.member_display_name(p.full_name, NULL)::text AS display_name,
         CASE WHEN COALESCE(s.review_count, 0) > 0 THEN s.avg_rating END AS avg_rating,
         COALESCE(s.review_count, 0)::integer AS review_count,
         public.identity_is_verified(p.idv_status, p.stripe_identity_verified) AS id_checked,
         -- F359d (20261112002528): the same count the member card reads, computed here without the caller check
         -- (a guest has no auth.uid()); this row only exists for a seller who passed the WHERE below.
         (SELECT count(*)::integer
            FROM public.declutter_orders o
           WHERE o.seller_id = p.user_id
             AND o.status = 'handed_over'
             AND o.is_seed IS NOT TRUE
             AND o.buyer_id IS NOT NULL
             AND NOT public.is_test_member(o.buyer_id)
             AND NOT public.profile_review_same_person(o.buyer_id, o.seller_id)) AS pickup_count,
         -- Item page polish (20261120185250): the public page's address and that page's own member_since, only with a page.
         h.handle AS handle,
         CASE WHEN h.handle IS NOT NULL THEN p.created_at END AS member_since
    FROM public.declutter_items i
    JOIN public.profiles p ON p.user_id = i.seller_id
    LEFT JOIN LATERAL (
      SELECT st.review_count, st.avg_rating
        FROM public.get_public_profile_stats(ARRAY[p.user_id]) st
       WHERE st.user_id = p.user_id
       LIMIT 1
    ) s ON true
    LEFT JOIN LATERAL (SELECT public.handle_for_user(p.user_id) AS handle) h ON true
   WHERE i.id = p_item_id
     AND i.status IN ('live', 'reserved')
     AND NOT i.seller_hidden
     AND NOT i.is_seed
     AND (SELECT public.declutter_open_to_guests())
     AND p.email_verified
     AND (p.ban_status IS NULL OR p.ban_status NOT IN ('temp_banned', 'permanently_banned'))
     AND p.anonymized_at IS NULL
     AND p.is_seed IS NOT TRUE
     -- lh-authz-rls should-fix 3: a seller in test_accounts without is_seed is a test member too (test data never shows).
     AND NOT public.is_test_member(p.user_id)
     AND public.member_display_name(p.full_name, NULL) IS NOT NULL;
$fn$;

REVOKE ALL ON FUNCTION public.declutter_guest_seller_card(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_guest_seller_card(uuid) TO anon, authenticated, service_role;
COMMENT ON FUNCTION public.declutter_guest_seller_card(uuid) IS
  'F227/F319 (owner 11-11): a guest''s seller card for a guest-readable Declutter listing: "Ann S.", star average and count, ID checked, (F359d) the completed pickup count, and (20261120185250, owner 11-20) the public /u handle and member_since, both only when the seller has a public profile page. No photo, id or contact. No row otherwise.';
