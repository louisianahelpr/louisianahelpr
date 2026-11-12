-- Audit 11-10 F359d (owner pop-ups 11-11 ~5:00 PM, OWNER-DECISIONS.md): the Declutter seller card shows the seller's
-- successful pickup COUNT ("12 pickups"), for signed-in members and on the guest card. A COUNT only: no dates, no
-- items, no buyer names.
--
-- What counts (one number, the same for every viewer, the seller included):
--   a declutter_orders row of this seller with status 'handed_over' (the handover was confirmed; a sale, a free
--   giveaway and a Helpr delivery each count once, however many items the order holds), not test data (o.is_seed),
--   with a buyer who is not a test member (is_test_member: is_seed or test_accounts, 20261030015205) and not the
--   seller's own second account (profile_review_same_person, the rule the star rating uses, 20261105165059).
--   A test seller gets no count at all (NULL), so test data never shows.
--
-- 1. declutter_seller_pickup_count(p_seller_id) -> integer, for the member seller card (DeclutterSellerCard).
--    Signed-in callers only (authenticated; auth.uid() checked as well). NULL when the seller is not a public member
--    (email not verified, banned, anonymised, or a test member): the card then shows no line. The signed-in card has
--    no Declutter-only card RPC to add a field to (it reads get_safe_profiles and get_public_profile_stats, both shared
--    with Jobs), so the count is its own small read rather than a 21-column restatement of the shared stats function.
-- 2. declutter_guest_seller_card(item) gains a fifth field, pickup_count, from the same function. Restated VERBATIM
--    from its only definition (20261111205821) plus that column; a new OUT column cannot be added by CREATE OR REPLACE,
--    so it is dropped and created again, grants restated. The WHERE (who a guest may see) is unchanged.
--
-- SECURITY DEFINER: members hold no read on other members' orders. STABLE; search_path pinned.
-- REPLAY-SAFETY: CREATE OR REPLACE / DROP IF EXISTS + CREATE; grants restated; reads only objects that exist before this
-- timestamp (declutter_orders, profiles, is_test_member, profile_review_same_person, member_display_name,
-- get_public_profile_stats, declutter_items, declutter_open_to_guests).
-- Proof: src/test/pglite/declutterSellerPickupCount.pglite.mjs. Sensitive: authz (what one member learns of another).

CREATE OR REPLACE FUNCTION public.declutter_seller_pickup_count(p_seller_id uuid)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT (SELECT count(*)::integer
            FROM public.declutter_orders o
           WHERE o.seller_id = p.user_id
             AND o.status = 'handed_over'
             AND o.is_seed IS NOT TRUE
             AND o.buyer_id IS NOT NULL
             AND NOT public.is_test_member(o.buyer_id)
             AND NOT public.profile_review_same_person(o.buyer_id, o.seller_id))
    FROM public.profiles p
   WHERE p.user_id = p_seller_id
     AND (SELECT auth.uid()) IS NOT NULL
     AND p.email_verified
     AND (p.ban_status IS NULL OR p.ban_status NOT IN ('temp_banned', 'permanently_banned'))
     AND p.anonymized_at IS NULL
     AND p.is_seed IS NOT TRUE
     AND NOT public.is_test_member(p.user_id);
$fn$;

REVOKE ALL ON FUNCTION public.declutter_seller_pickup_count(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_seller_pickup_count(uuid) TO authenticated, service_role;
COMMENT ON FUNCTION public.declutter_seller_pickup_count(uuid) IS
  'F359d (owner 11-11): how many Declutter handovers this seller completed (handed_over orders, no test data, no own-account buyer). A count only. NULL for a seller who is not a public member or is a test member.';

DROP FUNCTION IF EXISTS public.declutter_guest_seller_card(uuid);
CREATE FUNCTION public.declutter_guest_seller_card(p_item_id uuid)
RETURNS TABLE(display_name text, avg_rating numeric, review_count integer, id_checked boolean, pickup_count integer)
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
             AND NOT public.profile_review_same_person(o.buyer_id, o.seller_id)) AS pickup_count
    FROM public.declutter_items i
    JOIN public.profiles p ON p.user_id = i.seller_id
    LEFT JOIN LATERAL (
      SELECT st.review_count, st.avg_rating
        FROM public.get_public_profile_stats(ARRAY[p.user_id]) st
       WHERE st.user_id = p.user_id
       LIMIT 1
    ) s ON true
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
  'F227/F319 (owner 11-11): a guest''s seller card for a guest-readable Declutter listing: "Ann S.", star average and count, ID checked, and (F359d) the completed pickup count. No photo, id, link or contact. No row otherwise.';
