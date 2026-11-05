-- Owner 11-05 (L4, share-profile audit; profile leftovers): HIDE reviews between a person's own accounts on the
-- members' profile /user/:id too. 20261105165059 hid them on /u/<handle> (list, total, stars) and 20261105171508 in
-- get_public_profile_stats (the /user stars and count), but the /user review LIST reads get_public_profile_reviews,
-- which still returned them.
-- Body: the newest definition (20261103224601_review_tags_column.sql) verbatim plus ONE line:
--   the reviewer and reviewee are not one person (profile_review_same_person)
-- so total_count (the list's "N reviews") drops them too. profile_review_same_person is SECURITY DEFINER and
-- service_role-only; this function is SECURITY DEFINER (owner postgres), so it calls it as the owner and no caller
-- gains EXECUTE on it. Read side only; nothing is deleted.
-- REPLAY-SAFE: CREATE OR REPLACE; grants restated unchanged (authenticated, service_role; never anon).
-- MONEY: none. Proof: src/test/pglite/profileReviewListSamePerson.pglite.mjs (3x; --before red).

CREATE OR REPLACE FUNCTION public.get_public_profile_reviews(p_user_id uuid, p_limit integer DEFAULT 20, p_offset integer DEFAULT 0)
 RETURNS TABLE(id uuid, rating integer, feedback text, created_at timestamp with time zone, reviewer_name text, job_category text, response_text text, response_at timestamp with time zone, total_count bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH target AS (
    SELECT p.user_id
    FROM public.profiles p
    WHERE (p.user_id = p_user_id OR p.id = p_user_id)
      AND (
        (
          p.email_verified
          AND (p.ban_status IS NULL OR p.ban_status NOT IN ('temp_banned', 'permanently_banned'))
          -- Q552: the same seed clause get_safe_profiles carries.
          AND (p.is_seed IS NOT TRUE OR NOT (SELECT public.seed_hidden_from_caller()))
        )
        OR p.user_id = auth.uid()
      )
    -- DISAMBIGUATE, don't take row 0 blind. `user_id` and `id` are two key
    -- spaces over one table, and on prod today a single uuid is one member's
    -- auth id AND a different member's profiles.id (20260828030738 fixed the
    -- same trap in get_safe_profiles). A user_id hit always wins; the id hit
    -- is only the fallback Messages needs.
    ORDER BY (p.user_id = p_user_id) DESC
    LIMIT 1
  ),
  visible AS (
    SELECT
      r.id, r.rating,
      public.review_text(r.feedback, r.tags) AS feedback, r.created_at, r.reviewer_id, r.response_text, r.response_at,
      j.category AS job_category
    FROM target t
    JOIN public.reviews r ON r.reviewee_id = t.user_id
    JOIN public.jobs j ON j.id = r.job_id
    WHERE r.status = 'published'
      AND r.feedback_visible_at IS NOT NULL
      AND r.feedback_visible_at <= now()
      AND j.status <> 'cancelled'
      -- Q552: the reviews read policy's seed clause (your own list keeps them).
      AND (t.user_id = auth.uid() OR NOT public.seed_review_hidden(r.reviewer_id, r.reviewee_id, r.job_id))
      -- Owner 11-05 (L4): a review between two accounts of one person (the same phone) never shows, for every caller.
      AND NOT public.profile_review_same_person(r.reviewer_id, r.reviewee_id)
  )
  SELECT
    v.id,
    v.rating,
    v.feedback,
    v.created_at,
    -- Reviewer identity is masked by the SAME rule get_safe_profiles applies:
    -- approved and not banned, else NULL and the client renders "a neighbor".
    -- Only the display name crosses; no avatar, no id, no contact field.
    (
      SELECT public.display_name_for_viewer(rp.full_name, rp.user_id) FROM public.profiles rp
      WHERE rp.user_id = v.reviewer_id
        AND rp.email_verified
        AND (rp.ban_status IS NULL OR rp.ban_status NOT IN ('temp_banned', 'permanently_banned'))
      LIMIT 1
    ) AS reviewer_name,
    -- CATEGORY, never the job title. Titles are free text and routinely carry
    -- a street, a business or a surname; "lawn_care" carries none of that and
    -- is what the reviews filter groups by anyway.
    v.job_category,
    v.response_text,
    v.response_at,
    -- Window count so pagination has a true denominator without a second
    -- round trip that would hit the same RLS wall.
    COUNT(*) OVER () AS total_count
  FROM visible v
  ORDER BY v.created_at DESC
  LIMIT GREATEST(COALESCE(p_limit, 20), 0)
  OFFSET GREATEST(COALESCE(p_offset, 0), 0);
$function$;
REVOKE ALL ON FUNCTION public.get_public_profile_reviews(uuid, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_public_profile_reviews(uuid, integer, integer) TO authenticated, service_role;
