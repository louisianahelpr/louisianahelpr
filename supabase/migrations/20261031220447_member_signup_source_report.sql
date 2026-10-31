-- OPS-5 (owner 10-29): the owner cannot tell which posts or links bring members. The only source kept today is the
-- one on signup_leads (an email typed into the sign-up form), so a member who signed up with Apple or Google, or who
-- never left an email there, has no source at all, and nothing links a source to a member's FIRST POST, which is the
-- number that matters.
--
-- 1. public.member_signup_sources: one row per member, the place they came from when they joined. ONLY a short
--    source word (utm_source, or the outside site's host name, or 'direct') and an optional campaign word
--    (utm_campaign, e.g. the post it was shared from). No email, no name, no IP, no full link or query string.
--    Deleted with the member (ON DELETE CASCADE).
-- 2. public.record_my_signup_source(source, campaign): the signed-in member's own row, written once (first one wins),
--    and only in the first 2 days after the account was made, so an old member opening a tagged link is never
--    counted as a new sign-up from it. Both words are cleaned on the server: lower case, only a-z 0-9 . _ -,
--    64 characters at most; an empty source is 'direct'; a word with an @ or %40 or 7+ digits in all (maybe an email or a phone, separators included) is never kept. Never an error for the member: false when nothing is written.
-- 3. public.admin_signup_source_report(days): admins only (42501 otherwise). Per source and campaign, for the last
--    N days (1-365, default 30): how many joined, and how many made their first post (a job or a Declutter item
--    going live) in that window. Real members only: seed profiles, anonymised profiles and test accounts
--    (public.is_test_subject) never count (owner rule: test data never shows). Counts only.
--
-- Replay-safe: IF NOT EXISTS / CREATE OR REPLACE. Grants: the table is service_role only (members write through the
-- function); REVOKE ALL ... FROM PUBLIC, anon on both functions.
-- Proof: src/test/pglite/memberSignupSource.pglite.mjs (NEW_MIGRATION=skip shows the [fix] checks red).

CREATE TABLE IF NOT EXISTS public.member_signup_sources (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  source text NOT NULL CHECK (source ~ '^[a-z0-9._-]{1,64}$'),
  campaign text CHECK (campaign IS NULL OR campaign ~ '^[a-z0-9._-]{1,64}$'),
  recorded_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.member_signup_sources ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.member_signup_sources FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, DELETE ON TABLE public.member_signup_sources TO service_role;
CREATE INDEX IF NOT EXISTS member_signup_sources_recorded_idx ON public.member_signup_sources (recorded_at);

CREATE OR REPLACE FUNCTION public.record_my_signup_source(p_source text, p_campaign text DEFAULT NULL)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid      uuid := auth.uid();
  v_made     timestamptz;
  v_source   text;
  v_campaign text;
  v_n        integer;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_signed_in' USING ERRCODE = '42501';
  END IF;
  SELECT u.created_at INTO v_made FROM auth.users u WHERE u.id = v_uid;
  -- Only a new account has a sign-up source.
  IF v_made IS NULL OR v_made < now() - interval '2 days' THEN
    RETURN false;
  END IF;
  -- A word with an @ or a %40 (an email, raw or link-encoded) or 7+ digits in all (a phone number, with or
  -- without separators: "555-123-4567", "(555) 123-4567", "+1 555 123 4567") may be someone's details put in
  -- a link: never kept ('other' / no campaign).
  v_source := CASE WHEN position('@' IN coalesce(p_source, '')) > 0 OR position('%40' IN coalesce(p_source, '')) > 0
                     OR regexp_replace(coalesce(p_source, ''), '[^0-9]', '', 'g') ~ '[0-9]{7,}' THEN 'other'
                   ELSE left(regexp_replace(lower(coalesce(p_source, '')), '[^a-z0-9._-]', '', 'g'), 64) END;
  IF v_source = '' THEN v_source := 'direct'; END IF;
  v_campaign := CASE WHEN position('@' IN coalesce(p_campaign, '')) > 0 OR position('%40' IN coalesce(p_campaign, '')) > 0
                       OR regexp_replace(coalesce(p_campaign, ''), '[^0-9]', '', 'g') ~ '[0-9]{7,}' THEN NULL
                     ELSE nullif(left(regexp_replace(lower(coalesce(p_campaign, '')), '[^a-z0-9._-]', '', 'g'), 64), '') END;

  INSERT INTO public.member_signup_sources (user_id, source, campaign)
  VALUES (v_uid, v_source, v_campaign)
  ON CONFLICT (user_id) DO NOTHING;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n > 0;
END;
$fn$;
REVOKE ALL ON FUNCTION public.record_my_signup_source(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_my_signup_source(text, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.admin_signup_source_report(p_days integer DEFAULT 30)
RETURNS TABLE (source text, campaign text, signups bigint, first_posts bigint)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_since timestamptz;
BEGIN
  IF auth.uid() IS NULL OR NOT coalesce(public.has_role(auth.uid(), 'admin'::public.app_role), false) THEN
    RAISE EXCEPTION 'admin only' USING ERRCODE = '42501';
  END IF;
  v_since := now() - make_interval(days => greatest(1, least(coalesce(p_days, 30), 365)));

  RETURN QUERY
  WITH real_members AS (
    SELECT s.user_id, s.source, s.campaign, s.recorded_at
      FROM public.member_signup_sources s
      JOIN public.profiles p ON p.user_id = s.user_id
     WHERE NOT coalesce(p.is_seed, false)
       AND p.anonymized_at IS NULL
       AND NOT public.is_test_subject(s.user_id)
  ), first_post AS (
    SELECT m.user_id,
           least((SELECT min(j.created_at) FROM public.jobs j
                   WHERE j.customer_id = m.user_id AND NOT coalesce(j.is_seed, false)),
                 (SELECT min(i.live_at) FROM public.declutter_items i
                   WHERE i.seller_id = m.user_id AND NOT coalesce(i.is_seed, false))) AS at
      FROM real_members m
  )
  SELECT m.source,
         m.campaign,
         count(*) FILTER (WHERE m.recorded_at >= v_since),
         count(*) FILTER (WHERE f.at >= v_since)
    FROM real_members m
    JOIN first_post f ON f.user_id = m.user_id
   GROUP BY m.source, m.campaign
  HAVING count(*) FILTER (WHERE m.recorded_at >= v_since) > 0
      OR count(*) FILTER (WHERE f.at >= v_since) > 0
   ORDER BY 3 DESC, 4 DESC, 1, 2;
END;
$fn$;
REVOKE ALL ON FUNCTION public.admin_signup_source_report(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_signup_source_report(integer) TO authenticated, service_role;
