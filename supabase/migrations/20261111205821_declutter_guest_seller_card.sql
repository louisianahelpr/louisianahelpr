-- F227/F319 (audit 11-10; owner 11-11 ~2:10 PM, OWNER-DECISIONS): "guests DO see a small seller card on Declutter
-- listings: first name + last initial, rating, ID-checked badge (no photo, no profile page). Narrow exception to
-- BUY-16." Until now a guest got only the seller's first word (declutter_guest_seller_first_name, 20261031062900).
--
-- declutter_guest_seller_card(item): ONE row of exactly four fields, or no row:
--   display_name  "Ann S." through member_display_name (newest definition 20261021131322): first word + last initial,
--                 never the full name;
--   avg_rating    the seller's public star average, NULL while they have no public review;
--   review_count  how many public reviews it is from;
--   id_checked    the "ID checked" badge: Stripe Identity verified (idv_status = 'verified'), the expression
--                 get_public_profile_stats.is_id_verified and get_safe_profiles use. A badge, never a gate.
-- The rating is get_public_profile_stats' own (newest 20261105171508): the same public reviews a member sees on the
-- seller card (published, past the blind rule, no test data, no same-person review). Nothing else leaves: no user id,
-- no photo, no join date, no profile link, no email or phone.
--
-- It answers only for a listing a guest can already read, the WHERE of declutter_guest_seller_first_name verbatim:
--   - Declutter is open to everyone (declutter_open_to_guests());
--   - the item is live or reserved, not a hidden seller's (seller_hidden), not test data (is_seed);
--   - the seller's profile is email-verified, not banned, not anonymised (deleted), and not a test profile;
-- and two more: the seller is not a test member at all (is_test_member: is_seed or test_accounts, 20261030015205), and
-- has a name (member_display_name gives NULL for a blank one).
-- declutter_guest_seller_first_name stays: the guest pickup block still names the giver by first word.
--
-- SECURITY DEFINER because anon holds no grant on profiles (nor on member_display_name / get_public_profile_stats'
-- inputs); STABLE; search_path pinned.
-- REPLAY-SAFETY: CREATE OR REPLACE with an unchanged signature; grants restated; reads only objects that exist before
-- this timestamp (declutter_items, profiles, declutter_open_to_guests 20261031060656, member_display_name 20261021131322,
-- get_public_profile_stats 20261105171508, is_test_member 20261030015205).

CREATE OR REPLACE FUNCTION public.declutter_guest_seller_card(p_item_id uuid)
RETURNS TABLE(display_name text, avg_rating numeric, review_count integer, id_checked boolean)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT public.member_display_name(p.full_name, NULL)::text AS display_name,
         CASE WHEN COALESCE(s.review_count, 0) > 0 THEN s.avg_rating END AS avg_rating,
         COALESCE(s.review_count, 0)::integer AS review_count,
         (p.idv_status IS NOT DISTINCT FROM 'verified') AS id_checked
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
  'F227/F319 (owner 11-11): a guest''s seller card for a guest-readable Declutter listing: "Ann S.", star average and count, ID checked. No photo, id, link or contact. No row otherwise.';
