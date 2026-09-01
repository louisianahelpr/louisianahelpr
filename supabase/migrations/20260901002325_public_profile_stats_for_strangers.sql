-- Public profile stats a STRANGER can actually see.
--
-- ── THE BUG, MEASURED ──────────────────────────────────────────────────────
-- Reproduced 2026-09-01 against prod with a purpose-made auth user that had
-- zero shared history with anybody (the exact viewer RLS is written about),
-- querying through PostgREST with the anon key + that user's session:
--
--   jobs                              -> []          (RLS: party-scoped only)
--   applications                      -> []          (RLS: party-scoped only)
--   profiles (another member's row)   -> []          (RLS: own row only)
--   reviews ... jobs!inner(status)    -> []   *      (the join drops everything)
--   reviews (no join)                 -> 5 rows      (the join is what kills it)
--
--   * as ANON it is worse than empty: `jobs` is not even GRANTed to anon, so
--     the same query returns HTTP 401 / 42501 rather than a row set.
--
-- Consequence on src/pages/UserProfile.tsx: review count, average rating, job
-- counts, cancellation rate, on-time rate and the reply metrics were all
-- structurally 0/null for every visitor, while `get_user_repeat_hire_percent`
-- — SECURITY DEFINER, and therefore the lone survivor — kept answering
-- truthfully. The two halves contradicted each other on the same card:
--
--   profile 6bdc1f67-ae1f-46a0-8edf-4035629a6147 ("Audit Helper") rendered
--   "New · No reviews yet"  beside  "100% Clients who rebooked"
--
-- both of which a stranger read as measurements. One of them was.
--
-- ── THE FIX ────────────────────────────────────────────────────────────────
-- Same shape `get_safe_profiles` already establishes: a SECURITY DEFINER
-- function that returns exactly what a stranger may see, with the gating
-- written in SQL instead of hoped for in the client.
--
--   1. get_public_profile_stats(uuid[])   — aggregates. anon + authenticated.
--   2. get_public_profile_reviews(uuid,…) — the review list. authenticated.
--
-- WHAT IS PUBLISHED, AND WHY
--
--   review_count / avg_rating            The core trust signal, and the whole
--   poster_review_count / poster_avg_…   reason a public profile exists. Both
--                                        are already readable by any signed-in
--                                        member via a bare `reviews` select;
--                                        an aggregate names nobody.
--   completed_jobs_as_helper             Counts. No titles, no addresses, no
--   completed_jobs_total                 counterparties — "12 jobs completed"
--   posted_jobs_total                    says nothing about WHO.
--   is_id_verified / has_stripe_account  Booleans the trust ladder already
--   is_background_checked                renders; see the redactions below.
--   has_pending_credentials
--
-- WHAT IS PUBLISHED ONLY ABOVE A SAMPLE FLOOR (NULL below it)
--
--   cancellation_rate     >= 5 jobs        A "100% cancel rate" off one job is
--   on_time_rate          >= 5 arrivals    a lie of precision. These floors are
--   revision_rate         >= 5 jobs        not new — they are the exact floors
--   poster_avg_rating     >= 3 reviews     the client already applied; they are
--   repeat_hire_percent   >= 3 clients     moved into SQL so there is one rule.
--
--   `repeat_hire_percent` is the exception that is genuinely NEW. The existing
--   get_user_repeat_hire_percent() has no floor at all, which is precisely how
--   ONE returning customer became a public, boldfaced "100% Clients who
--   rebooked". Below three distinct completed-job clients this returns NULL and
--   the cell does not render. The raw sample size is returned alongside every
--   gated rate so the UI can say "not enough history yet" instead of "0".
--
-- WHAT IS DELIBERATELY *NOT* PUBLISHED
--
--   * Anything naming the counterparty. No job ids, titles, locations,
--     coordinates, customer_id or helper_id ever leaves these functions. A
--     sibling lane spent today closing an address leak (20260831232513); this
--     migration does not open a new one. get_public_profile_reviews returns the
--     job's CATEGORY ("lawn_care") and never its title — titles are free text
--     and routinely carry a street or a surname.
--   * `stripe_account_id`. The verification ladder only ever truthiness-tests
--     it (src/lib/helperTier.ts: `if (!profile.stripe_account_id) return false`),
--     so `has_stripe_account boolean` is all the client needs and the acct_…
--     identifier stays private.
--   * `background_check_status` verbatim. Only the affirmative verdict is
--     published, as `is_background_checked`. 'pending' and 'failed' are
--     negative safety claims about a named individual and are nobody's
--     business but the owner's; the owner's own card keeps reading the raw
--     column off their own row, where RLS already permits it.
--   * The reply metrics — `avg_response_hours` and `acceptance_rate`. Not for
--     privacy: because they do not measure what their labels claim. Both are
--     derived from `applications`, and "avg reply time" is computed as
--     `updated_at - created_at` on the application row — i.e. how long the
--     POSTER took to accept, published under the helper's name as their reply
--     speed. Acceptance rate is likewise a tally of other people's hiring
--     decisions rendered as a defect in the applicant. Publishing a
--     mislabelled number to strangers is worse than publishing none, so these
--     stay exactly where they are: computed client-side from rows only the
--     owner can read, and therefore visible only to the owner.
--
-- ── SECURITY NOTES ─────────────────────────────────────────────────────────
-- * SECURITY DEFINER + `SET search_path TO 'public'` on both functions, so
--   every unqualified name resolves against public and `auth.uid()` is spelled
--   out in full (the same discipline get_safe_profiles keeps).
-- * NO RECURSION. 20260529111503 documents the 42P17 cycle you get when an RLS
--   policy reads a table whose policy reads back. These functions are owned by
--   the migration role and RLS is not evaluated inside them at all, so neither
--   `jobs` (whose SELECT policy calls user_may_see_job_address) nor
--   `applications` can re-enter. Nothing here is called FROM a policy, which is
--   the direction that caused the cycle.
-- * Row gating mirrors get_safe_profiles exactly — approved, not banned — with
--   ONE addition: `OR p.user_id = auth.uid()`, so a member whose account is
--   still pending approval sees their own true stats in the "How others see
--   you" preview. That is a self-read and leaks nothing about anyone else.
-- * GRANTS. Stats go to anon AND authenticated: the profile route is publicly
--   reachable (get_safe_profiles is itself granted to anon), and a signed-out
--   visitor is the truest stranger there is — an aggregate count and a mean
--   identify nobody. Review TEXT goes to authenticated ONLY, deliberately:
--   that is the exact audience the `reviews` SELECT policy already allows
--   ("Published reviews visible after reveal", TO authenticated), so this
--   function fixes a broken join without widening who can read a review by one
--   person. Extending review prose to the open internet is a policy decision,
--   not a bug fix, and is not made here.
--   Stated plainly so nobody over-reads the anon grant: `/user/:userId` sits
--   inside <ProtectedRoute> today, so a signed-out browser cannot reach the
--   profile page and the anon path is currently unexercised BY THAT ROUTE. The
--   grant is still the right call — it matches get_safe_profiles and
--   get_user_repeat_hire_percent, which are already anon-callable, and it means
--   any future public or prerendered profile surface inherits true numbers
--   rather than quietly inheriting this exact bug. The incremental disclosure
--   over what anon can read today is a count and a mean on a profile that is
--   already public.
--
-- Replay-safe: DROP … IF EXISTS before each CREATE, no data is written, and
-- applying the file three times in a row is a no-op after the first
-- (verified on PGlite).

-- ---------------------------------------------------------------------------
-- 1. Aggregates.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.get_public_profile_stats(uuid[]);

CREATE FUNCTION public.get_public_profile_stats(p_user_ids uuid[])
RETURNS TABLE(
  user_id uuid,
  -- Reviews received as a helper AND as a poster (the whole visible set).
  review_count integer,
  avg_rating numeric,
  -- The subset received on jobs this person POSTED. Floored at 3.
  poster_review_count integer,
  poster_avg_rating numeric,
  -- Job counts.
  completed_jobs_as_helper integer,
  completed_jobs_total integer,
  posted_jobs_total integer,
  jobs_total integer,
  cancelled_jobs integer,
  cancellation_rate numeric,
  -- Behaviour rates, each with the sample it was computed from so the UI can
  -- distinguish "we measured 0%" from "we have not measured this yet".
  on_time_sample integer,
  on_time_rate numeric,
  revision_sample integer,
  revision_rate numeric,
  repeat_client_sample integer,
  repeat_hire_percent numeric,
  -- Trust signals that were previously unreadable for a visitor.
  approval_status text,
  is_id_verified boolean,
  has_stripe_account boolean,
  is_background_checked boolean,
  has_pending_credentials boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH target AS (
    SELECT p.user_id, p.approval_status, p.stripe_identity_verified,
           p.stripe_account_id, p.background_check_status
    FROM public.profiles p
    WHERE (p.user_id = ANY(p_user_ids) OR p.id = ANY(p_user_ids))
      AND (
        -- Public gate, character-for-character the one get_safe_profiles uses.
        (
          p.approval_status = 'approved'
          AND (p.ban_status IS NULL OR p.ban_status NOT IN ('temp_banned', 'permanently_banned'))
        )
        -- …or it is your own row. Your own preview must not lie to you while
        -- your account is pending, which is the same reason the client keeps a
        -- self-select fallback next to get_safe_profiles.
        OR p.user_id = auth.uid()
      )
  ),
  -- Reviews this person RECEIVED that are genuinely public: published, past
  -- the anti-retaliation reveal, and not attached to a job that ended up
  -- cancelled. That last clause is the one the client used to express as
  -- `jobs!inner(status)` — a join through a table no visitor can read, which
  -- is why it silently returned zero reviews for everyone. It is a real guard,
  -- not a no-op: the status machine in 20260504152414 allows
  -- completed -> disputed -> cancelled, so an admin resolving a
  -- post-completion dispute for the poster leaves a live review on a cancelled
  -- job. Enforced here, where `jobs` is readable, instead of there.
  visible_reviews AS (
    SELECT t.user_id, r.rating, (j.customer_id = t.user_id) AS as_poster
    FROM target t
    JOIN public.reviews r ON r.reviewee_id = t.user_id
    JOIN public.jobs j ON j.id = r.job_id
    WHERE r.status = 'published'
      AND r.feedback_visible_at IS NOT NULL
      AND r.feedback_visible_at <= now()
      AND j.status <> 'cancelled'
  ),
  review_agg AS (
    SELECT
      t.user_id,
      COUNT(v.rating)::integer AS review_count,
      ROUND(AVG(v.rating)::numeric, 2) AS avg_rating,
      COUNT(v.rating) FILTER (WHERE v.as_poster)::integer AS poster_review_count,
      ROUND(AVG(v.rating) FILTER (WHERE v.as_poster)::numeric, 2) AS poster_avg_rating
    FROM target t
    LEFT JOIN visible_reviews v ON v.user_id = t.user_id
    GROUP BY t.user_id
  ),
  -- Job counts. `jobs_total` / `cancelled_jobs` deliberately span BOTH sides
  -- of the marketplace, matching the combined denominator the profile card has
  -- always shown ("Cancelled · 3 of 12 jobs").
  job_agg AS (
    SELECT
      t.user_id,
      COUNT(*) FILTER (WHERE j.helper_id = t.user_id AND j.status = 'completed')::integer AS completed_as_helper,
      COUNT(DISTINCT j.id) FILTER (WHERE j.status = 'completed')::integer AS completed_total,
      COUNT(*) FILTER (WHERE j.customer_id = t.user_id)::integer AS posted_total,
      COUNT(*)::integer AS jobs_total,
      COUNT(*) FILTER (WHERE j.status = 'cancelled')::integer AS cancelled_jobs
    FROM target t
    LEFT JOIN public.jobs j
      ON j.customer_id = t.user_id OR j.helper_id = t.user_id
    GROUP BY t.user_id
  ),
  -- Timing, over this person's ENTIRE completed helper history. The client
  -- version capped its sample at the 50 most recent rows purely because that
  -- was one page of a `select`; there is no reason to throw away the rest here.
  timing AS (
    SELECT
      t.user_id,
      j.revision_count,
      j.helper_arrived_at,
      -- date_needed + start_time are wall-clock LOUISIANA time, not UTC. The
      -- client built this comparison with `new Date("YYYY-MM-DDTHH:MM:SS")`,
      -- which resolves in the VIEWER's timezone — so the same helper was
      -- "on time" in Baton Rouge and five hours late in London. Pin the zone.
      ((j.date_needed::date + COALESCE(j.start_time::text, '00:00')::time)
        AT TIME ZONE 'America/Chicago') AS scheduled_at
    FROM target t
    JOIN public.jobs j ON j.helper_id = t.user_id AND j.status = 'completed'
  ),
  timing_agg AS (
    SELECT
      t.user_id,
      COUNT(ti.revision_count)::integer AS revision_sample,
      COUNT(*) FILTER (WHERE COALESCE(ti.revision_count, 0) > 0)::integer AS revised,
      COUNT(*) FILTER (WHERE ti.helper_arrived_at IS NOT NULL AND ti.scheduled_at IS NOT NULL)::integer AS on_time_sample,
      -- 10-minute grace, carried over verbatim: "on time" is a humane window,
      -- not a stopwatch.
      COUNT(*) FILTER (
        WHERE ti.helper_arrived_at IS NOT NULL
          AND ti.scheduled_at IS NOT NULL
          AND ti.helper_arrived_at <= ti.scheduled_at + interval '10 minutes'
      )::integer AS on_time_hits
    FROM target t
    LEFT JOIN timing ti ON ti.user_id = t.user_id
    GROUP BY t.user_id
  ),
  -- Repeat hire: share of this helper's distinct completed-job clients who
  -- came back. Same arithmetic as get_user_repeat_hire_percent (20260612470000),
  -- now with a sample size attached so the caller can refuse to publish it.
  repeat_clients AS (
    SELECT t.user_id, j.customer_id, COUNT(*) AS jobs_together
    FROM target t
    JOIN public.jobs j ON j.helper_id = t.user_id AND j.status = 'completed'
    GROUP BY t.user_id, j.customer_id
  ),
  repeat_agg AS (
    SELECT
      t.user_id,
      COUNT(rc.customer_id)::integer AS client_sample,
      COUNT(rc.customer_id) FILTER (WHERE rc.jobs_together > 1)::integer AS returning_clients
    FROM target t
    LEFT JOIN repeat_clients rc ON rc.user_id = t.user_id
    GROUP BY t.user_id
  ),
  cred_agg AS (
    SELECT t.user_id,
           EXISTS (
             SELECT 1 FROM public.helper_credentials hc
             WHERE hc.user_id = t.user_id AND hc.status = 'submitted'
           ) AS has_pending
    FROM target t
  )
  SELECT
    t.user_id,
    ra.review_count,
    -- NULL, never 0.0, when there is nothing to average. A zero average is a
    -- terrible review; "no reviews" is not.
    CASE WHEN ra.review_count > 0 THEN ra.avg_rating END,
    ra.poster_review_count,
    -- 3 poster reviews minimum — the floor the card already applied.
    CASE WHEN ra.poster_review_count >= 3 THEN ra.poster_avg_rating END,
    ja.completed_as_helper,
    ja.completed_total,
    ja.posted_total,
    ja.jobs_total,
    ja.cancelled_jobs,
    CASE WHEN ja.jobs_total >= 5
      THEN ROUND(100.0 * ja.cancelled_jobs / ja.jobs_total, 1) END,
    ta.on_time_sample,
    CASE WHEN ta.on_time_sample >= 5
      THEN ROUND(100.0 * ta.on_time_hits / ta.on_time_sample, 1) END,
    ta.revision_sample,
    CASE WHEN ta.revision_sample >= 5
      THEN ROUND(100.0 * ta.revised / ta.revision_sample, 1) END,
    rpa.client_sample,
    -- The 100%-from-one-client fix. 0% here is a genuine measurement across at
    -- least three clients and is published as such.
    CASE WHEN rpa.client_sample >= 3
      THEN ROUND(100.0 * rpa.returning_clients / rpa.client_sample) END,
    t.approval_status,
    (t.stripe_identity_verified IS TRUE),
    (t.stripe_account_id IS NOT NULL),
    (t.background_check_status = 'verified'),
    ca.has_pending
  FROM target t
  JOIN review_agg ra ON ra.user_id = t.user_id
  JOIN job_agg    ja ON ja.user_id = t.user_id
  JOIN timing_agg ta ON ta.user_id = t.user_id
  JOIN repeat_agg rpa ON rpa.user_id = t.user_id
  JOIN cred_agg   ca ON ca.user_id = t.user_id;
$function$;

COMMENT ON FUNCTION public.get_public_profile_stats(uuid[]) IS
  'Aggregate trust stats a stranger may see for the given users. SECURITY '
  'DEFINER because every underlying table (jobs, reviews, profiles, '
  'helper_credentials) is RLS-scoped to the parties involved, so a visitor '
  'measured every one of these as 0. Rates below their sample floor return '
  'NULL, never 0 — a number nobody can see beats a wrong one. Emits no job '
  'ids, titles, locations or counterparty ids.';

REVOKE ALL ON FUNCTION public.get_public_profile_stats(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_profile_stats(uuid[])
  TO anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. The review list, without the join that could never work.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.get_public_profile_reviews(uuid, integer, integer);

CREATE FUNCTION public.get_public_profile_reviews(
  p_user_id uuid,
  p_limit integer DEFAULT 20,
  p_offset integer DEFAULT 0
)
RETURNS TABLE(
  id uuid,
  rating integer,
  punctuality integer,
  quality integer,
  communication integer,
  feedback text,
  created_at timestamptz,
  reviewer_name text,
  job_category text,
  response_text text,
  response_at timestamptz,
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
      r.id, r.rating, r.punctuality, r.quality, r.communication,
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
    v.punctuality,
    v.quality,
    v.communication,
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

COMMENT ON FUNCTION public.get_public_profile_reviews(uuid, integer, integer) IS
  'Publicly visible reviews received by one user, paginated. Replaces the '
  'client-side `reviews ... jobs!inner(status)` select, whose inner join ran '
  'through a table RLS hides from every visitor and therefore returned zero '
  'rows for all of them. Emits the job CATEGORY, never the title, and never a '
  'job id or counterparty id. Granted to authenticated only — the same '
  'audience the reviews SELECT policy already allows.';

REVOKE ALL ON FUNCTION public.get_public_profile_reviews(uuid, integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_profile_reviews(uuid, integer, integer)
  TO authenticated, service_role;
