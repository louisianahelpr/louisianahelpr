-- "Book me on Helpr" (owner-approved growth item, B59, 2026-10-29): every Helpr
-- gets a share link (/book/<user id>). A visitor who taps "Book <First>" lands on
-- Post a job with a direct offer to that Helpr already set (?offerTo=). The owner
-- wants to see which Helpr brought each NEW poster.
--
-- The landing page itself needs nothing new: it reads get_safe_profiles and
-- get_public_profile_stats, both already granted to anon (live grants restated in
-- 20261021131322 and 20261021074131), so a signed-out visitor sees exactly what the
-- public profile gate already shows (masked "First L." name, avatar, counts).
--
-- What is new here, and only this:
--   1. public.booking_sources: one row per poster, "which Helpr's link brought
--      them". RLS on with NO policy, no grant to anon or authenticated: nobody
--      reads or writes it directly.
--   2. record_booking_source(p_helpr_id): the signed-in caller records the Helpr
--      whose link they came through. Self only (auth.uid(), never an id from the
--      body), set once (first link wins), only while the caller has never posted
--      a job (a "new poster"), never yourself, and only a Helpr the public
--      profile gate would show. No money moves: this is not the referral program
--      and pays nothing.
--   3. admin_booking_sources(): admin-only read for the owner, per Helpr: how
--      many posters their link brought and how many of those went on to post.
--      Test accounts (is_seed / test_accounts) never count, on either side.
--
-- REPLAY-SAFETY: CREATE TABLE IF NOT EXISTS, CREATE OR REPLACE FUNCTION, and
-- grants restated; every function called (auth.uid, has_role, is_caller_banned)
-- exists before this file.

CREATE TABLE IF NOT EXISTS public.booking_sources (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  helpr_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  source text NOT NULL DEFAULT 'book_link' CHECK (source IN ('book_link')),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (user_id <> helpr_id)
);
CREATE INDEX IF NOT EXISTS booking_sources_helpr_idx ON public.booking_sources (helpr_id);
ALTER TABLE public.booking_sources ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.booking_sources FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.booking_sources TO service_role;
COMMENT ON TABLE public.booking_sources IS
  'Which Helpr''s "Book me" link brought each new poster (B59). Written only by record_booking_source (self, set once), read only by admin_booking_sources.';

CREATE OR REPLACE FUNCTION public.record_booking_source(p_helpr_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_me uuid := auth.uid();
BEGIN
  IF v_me IS NULL THEN
    RAISE EXCEPTION 'not_signed_in' USING ERRCODE = '42501';
  END IF;
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  IF p_helpr_id IS NULL OR p_helpr_id = v_me THEN
    RETURN 'skipped';
  END IF;
  -- Only a Helpr the public profile gate would show (get_safe_profiles' clause).
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles p
     WHERE p.user_id = p_helpr_id
       AND p.email_verified
       AND p.anonymized_at IS NULL
       AND (p.ban_status IS NULL OR p.ban_status NOT IN ('banned', 'temp_banned', 'permanently_banned'))
  ) THEN
    RETURN 'skipped';
  END IF;
  -- A NEW poster only: someone who has posted before was not brought by this link.
  -- FOR SHARE: the read decides the write (race-class rule, 20260913014328).
  PERFORM 1 FROM public.jobs j WHERE j.customer_id = v_me LIMIT 1 FOR SHARE;
  IF FOUND THEN
    RETURN 'skipped';
  END IF;
  INSERT INTO public.booking_sources (user_id, helpr_id)
  VALUES (v_me, p_helpr_id)
  ON CONFLICT (user_id) DO NOTHING;
  RETURN CASE WHEN FOUND THEN 'recorded' ELSE 'skipped' END;
END;
$fn$;
REVOKE ALL ON FUNCTION public.record_booking_source(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_booking_source(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_booking_sources()
RETURNS TABLE(helpr_id uuid, helpr_name text, posters_brought integer, posters_who_posted integer, last_at timestamptz)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'admin_only' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT b.helpr_id,
         -- Through the masking helper like every reader (an admin caller gets the full name).
         public.display_name_for_viewer(max(hp.full_name), b.helpr_id),
         count(*)::integer,
         count(*) FILTER (WHERE EXISTS (SELECT 1 FROM public.jobs j WHERE j.customer_id = b.user_id))::integer,
         max(b.created_at)
    FROM public.booking_sources b
    LEFT JOIN public.profiles hp ON hp.user_id = b.helpr_id
    LEFT JOIN public.profiles up ON up.user_id = b.user_id
   -- Test data never counts (owner rule): neither a test Helpr nor a test poster.
   WHERE hp.is_seed IS NOT TRUE AND up.is_seed IS NOT TRUE
     AND NOT EXISTS (SELECT 1 FROM public.test_accounts t WHERE t.user_id IN (b.helpr_id, b.user_id))
   GROUP BY b.helpr_id
   ORDER BY count(*) DESC, max(b.created_at) DESC;
END;
$fn$;
REVOKE ALL ON FUNCTION public.admin_booking_sources() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_booking_sources() TO authenticated;
