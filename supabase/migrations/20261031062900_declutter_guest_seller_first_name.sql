-- BUY-16 (audit 10-30, High), seller name for guests. Owner 10-30 (OWNER-DECISIONS "Declutter buying"): "Guests see
-- Declutter Browse and item pages; sign up to buy or offer; no seller full name or address." The guest item page
-- (20261031060656 + its client) hid the whole seller card, because the card reads get_safe_profiles, which returns the
-- FULL name. This gives a guest the seller's FIRST name only, and only for a listing a guest can already read.
--
-- declutter_guest_seller_first_name(item): the first word of the seller's profile name (at most 40 characters), or
-- NULL. It answers only while ALL of these hold, the same rules as the anon read policy of 20261031060656 plus the
-- profile rules of get_safe_profiles (newest definition 20261007033530):
--   - Declutter is open to everyone (declutter_open_to_guests());
--   - the item is live or reserved, not a hidden seller's (seller_hidden), not test data (is_seed);
--   - the seller's profile is email-verified, not banned, not anonymised (deleted), and not a test profile.
-- Nothing else is returned: no surname, no avatar, no id beyond the item id the caller already holds.
--
-- SECURITY DEFINER because anon holds no grant on profiles; STABLE; search_path pinned.
-- REPLAY-SAFETY: CREATE OR REPLACE; grants restated; reads only objects that exist before this timestamp
-- (declutter_items.seller_hidden/is_seed, profiles columns, declutter_open_to_guests from 20261031060656).

CREATE OR REPLACE FUNCTION public.declutter_guest_seller_first_name(p_item_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT NULLIF(left(split_part(regexp_replace(btrim(COALESCE(p.full_name, '')), '\s+', ' ', 'g'), ' ', 1), 40), '')
    FROM public.declutter_items i
    JOIN public.profiles p ON p.user_id = i.seller_id
   WHERE i.id = p_item_id
     AND i.status IN ('live', 'reserved')
     AND NOT i.seller_hidden
     AND NOT i.is_seed
     AND (SELECT public.declutter_open_to_guests())
     AND p.email_verified
     AND (p.ban_status IS NULL OR p.ban_status NOT IN ('temp_banned', 'permanently_banned'))
     AND p.anonymized_at IS NULL
     AND p.is_seed IS NOT TRUE;
$fn$;

REVOKE ALL ON FUNCTION public.declutter_guest_seller_first_name(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_guest_seller_first_name(uuid) TO anon, authenticated, service_role;
COMMENT ON FUNCTION public.declutter_guest_seller_first_name(uuid) IS
  'BUY-16: the seller''s first name for a guest-readable Declutter listing (open to everyone, live/reserved, not hidden, not seed); NULL otherwise. Never the full name.';
