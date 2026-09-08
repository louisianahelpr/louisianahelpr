-- ONE REPUTATION, ONE NUMBER.
--
-- `reviews` has carried four scores since 20260418075616: `rating` plus
-- `punctuality`, `quality` and `communication`. Two things were true of the
-- three sub-criteria by the time this ran:
--
--   1. NOTHING RENDERED THEM. Both display surfaces dropped the per-category
--      breakdown on 2026-08-30 (`ReviewsTab.tsx`, `userProfile/RatingBreakdown.tsx`)
--      on the owner's "one overall rating only". They were write-only from
--      that day forward — collected, stored, read by no screen.
--   2. ONE OF THEM MEANT TWO DIFFERENT THINGS. On 2026-09-06 the form was
--      split by direction, and the poster-facing set asked "Promptness —
--      confirmed the work and released payment quickly" into the SAME
--      `punctuality` column that means "showed up on time" when a poster rates
--      a helper. `reviews` is keyed by `reviewee_id` and one account here is
--      both poster and helper, so a single person's rows already mixed the two
--      questions. Any future average over that column would have been a blend
--      of two different questions with no way to tell them apart after the
--      fact — the columns were not merely unread, they were becoming unusable.
--
-- Owner, 2026-09-07: "One reputation, and we only do overall — no punctuality
-- etc." The inputs are removed from the form in the same commit, so nothing
-- writes these after this migration lands.
--
-- The star aggregate is unchanged and stays one number per person:
-- `reviewStats.ts`, `useProfileTabData.ts` and `get_public_profile_stats` all
-- average `reviews.rating` alone and never referenced these three.
--
-- Replay-safe: every statement is guarded on the object still existing, and
-- the function is dropped before being recreated because its RETURNS TABLE
-- signature changes (CREATE OR REPLACE cannot narrow a result column list).

-- ── 1. The reader, first ──────────────────────────────────────────────────
--
-- `get_public_profile_reviews` returns the three columns to strangers viewing
-- a profile. It must stop selecting them BEFORE they are dropped, or the drop
-- fails on the dependency. Dropped and recreated (not replaced) because the
-- OUT-parameter list is part of the identity of the result type.
--
-- The GRANTs below are re-issued deliberately: a DROP takes the ACL with it,
-- and prod's is exactly {authenticated, service_role} (`pg_proc.proacl` read
-- 2026-09-07: postgres=X, authenticated=X, service_role=X — no anon, no
-- PUBLIC). Naming them here keeps that identical rather than falling back to
-- whatever ALTER DEFAULT PRIVILEGES would hand a brand-new function.
DROP FUNCTION IF EXISTS public.get_public_profile_reviews(uuid, integer, integer);

CREATE FUNCTION public.get_public_profile_reviews(
  p_user_id uuid,
  p_limit integer DEFAULT 20,
  p_offset integer DEFAULT 0
)
RETURNS TABLE(
  id uuid,
  rating integer,
  feedback text,
  created_at timestamp with time zone,
  reviewer_name text,
  job_category text,
  response_text text,
  response_at timestamp with time zone,
  total_count bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH target AS (
    SELECT p.user_id
    FROM public.profiles p
    WHERE (p.user_id = p_user_id OR p.id = p_user_id)
      AND (
        (
          p.approval_status = 'approved'
          AND (p.ban_status IS NULL OR p.ban_status NOT IN ('temp_banned', 'permanently_banned'))
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
      r.feedback, r.created_at, r.reviewer_id, r.response_text, r.response_at,
      j.category AS job_category
    FROM target t
    JOIN public.reviews r ON r.reviewee_id = t.user_id
    JOIN public.jobs j ON j.id = r.job_id
    WHERE r.status = 'published'
      AND r.feedback_visible_at IS NOT NULL
      AND r.feedback_visible_at <= now()
      AND j.status <> 'cancelled'
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
      SELECT rp.full_name FROM public.profiles rp
      WHERE rp.user_id = v.reviewer_id
        AND rp.approval_status = 'approved'
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

-- Name the roles explicitly. `REVOKE ... FROM PUBLIC` alone does NOT revoke
-- anon here: Supabase's ALTER DEFAULT PRIVILEGES grants EXECUTE on every new
-- public function to anon, authenticated and service_role INDIVIDUALLY, so
-- revoking PUBLIC would drop only the implicit world grant and leave all three
-- explicit ones — including anon's, which this function never had.
REVOKE ALL ON FUNCTION public.get_public_profile_reviews(uuid, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_public_profile_reviews(uuid, integer, integer) TO authenticated, service_role;

-- ── 2. The columns ────────────────────────────────────────────────────────
--
-- The three CHECK constraints (`reviews_punctuality_range`,
-- `reviews_quality_range`, `reviews_communication_range`) are dropped by
-- Postgres along with their columns; naming them separately would be a
-- DROP CONSTRAINT the destructive-DDL gate correctly flags for no reason.

-- DESTRUCTIVE-DDL-ACK: DROP COLUMN public.reviews.punctuality
-- ACK-REASON: sub-criteria ratings removed (owner, 2026-09-07: "one
--   reputation, and we only do overall"). Unrendered since 2026-08-30, and the
--   column had begun collecting two different questions — "showed up on time"
--   from posters, "released payment quickly" from helpers — into one average.
-- ACK-DATA-LOSS: 0 non-null rows. `SELECT count(punctuality) FROM reviews`
--   against prod fncmgoasalhdgfwzhsqa on 2026-09-07 returns 0, on 0 total
--   rows — the table is empty pre-launch. Nothing is destroyed.
ALTER TABLE public.reviews DROP COLUMN IF EXISTS punctuality;

-- DESTRUCTIVE-DDL-ACK: DROP COLUMN public.reviews.quality
-- ACK-REASON: same removal — one overall star rating in both directions. The
--   poster-facing form had already stopped asking this one on 2026-09-06, and
--   no display surface has read it since 2026-08-30.
-- ACK-DATA-LOSS: 0 non-null rows. `SELECT count(quality) FROM reviews` against
--   prod fncmgoasalhdgfwzhsqa on 2026-09-07 returns 0, on 0 total rows.
ALTER TABLE public.reviews DROP COLUMN IF EXISTS quality;

-- DESTRUCTIVE-DDL-ACK: DROP COLUMN public.reviews.communication
-- ACK-REASON: same removal — the form now collects one overall star, optional
--   tags and free text, identically in both directions. This column has had no
--   reader on any screen since the breakdown was deleted on 2026-08-30.
-- ACK-DATA-LOSS: 0 non-null rows. `SELECT count(communication) FROM reviews`
--   against prod fncmgoasalhdgfwzhsqa on 2026-09-07 returns 0, on 0 rows.
ALTER TABLE public.reviews DROP COLUMN IF EXISTS communication;

COMMENT ON COLUMN public.reviews.rating IS
  'The ONLY score this marketplace keeps. One overall 1-5 star per review, in '
  'both directions (owner, 2026-09-07). The punctuality/quality/communication '
  'columns that used to sit beside it were dropped in 20260907194823 — do not '
  'reintroduce a per-dimension score without re-reading that migration first.';
