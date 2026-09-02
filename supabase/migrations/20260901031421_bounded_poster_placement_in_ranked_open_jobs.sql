-- Bound the poster-tier placement boost, and apply it on /jobs too.
--
-- ── WHY ─────────────────────────────────────────────────────────────────────
--
-- Jobs posted by Pro/Elite members were lifted up the SIGNED-IN helper's browse
-- feed and nowhere else. Two problems, both measured on 2026-09-01:
--
--   1. IT WAS AN OVERRIDE, NOT A BOOST. `useDashboardData`'s queryFn ended with
--      a full re-sort of the page by `tierWeight` (elite 3, pro 1, else 0), and
--      `useDashboardFilters` carried a second, harder one: if the VIEWER held
--      any tier, every job from a subscribed poster sorted above every job from
--      an unsubscribed one, ahead of the smart rank entirely. Freshness, budget
--      and distance — the three things a helper scanning for work actually
--      needs — all lost to whether the poster had a card on file. A helper is
--      the customer of this ranking; selling them a worse-matched job makes the
--      feed worth less to them and, downstream, to the posters paying for
--      placement.
--
--   2. THE TWO FEEDS DISAGREED. `get_ranked_open_jobs` — the public /jobs board
--      — never mentioned `subscription_tier` at all, so the same job ranked one
--      way for a guest and another way the moment they signed in. A feed that
--      reorders itself on sign-in is a bug independent of the boost's size.
--
-- (Worth recording: the client-side `tierWeight` sort never even reached the
-- screen. `sortJobsSmart` re-ranks the whole array by a continuous score whose
-- only tie-break is input index, so exact ties essentially never occur and the
-- tier order was discarded on every render — the same defect the applicant list
-- had. The perk was being charged for and delivered nowhere.)
--
-- ── THE BOUND ───────────────────────────────────────────────────────────────
--
-- Same rule as Priority Placement on the applicant list: cap the boost BELOW
-- the smallest genuine signal on the feed's own scale, so it settles near-ties
-- and can never outrank a better-matched job. This scale is not the applicant
-- list's, so the number is derived here rather than copied across.
--
--   boosted (paid pin-to-top)                  1000
--   parish match                                500
--   urgent                                      100
--   recency span, fresh → 50h+ old             0–50   ← smallest signal
--   POSTER PLACEMENT, Elite                       5   ← 10% of that span
--   POSTER PLACEMENT, Pro                       2.5   ← 5%
--
-- 5 is strictly less than every other term's WEIGHT, so a boosted,
-- parish-matching or urgent job from a FREE poster still outranks an Elite
-- poster's ordinary one. (Stated precisely because the recency term is
-- continuous rather than a flag: it takes every value in 0–50, so a 45h-old
-- job does contribute exactly 5. What the cap buys against recency is ~5 hours
-- of freshness — the linear span here is 50 points over 50 hours — and no
-- more.)
--
-- The client mirror uses the identical 10%/5%-of-the-recency-span ratio on its
-- own scale (`POSTER_PLACEMENT_MAX_POINTS = 0.1` in `src/lib/smartSort.ts`,
-- where the recency span is 1.0 and the smallest discrete signal is the 0.15
-- proximity band), so both feeds move a paid poster the same relative distance.
-- `smartSort.test.ts` pins the inequality on the client side and
-- `earlyAccess.parity.test.ts` grades this file, so a later "make it feel
-- stronger" fails the build rather than quietly becoming an override again.
--
-- Basic is deliberately absent: `TIER_PERKS.basic.priorityPlacement` is false.
-- An expired tier scores 0 (same NULL-is-active convention as
-- `early_access_cutoff()`), as does a retired 'business' or any unknown string
-- — unknown loses a perk, never gains one.
--
-- ── DISCLOSURE: DELIBERATELY NONE ───────────────────────────────────────────
--
-- The applicant list discloses its placement bump in the UI, because a poster
-- is choosing between PEOPLE there. This is a job feed and the owner decided on
-- 2026-09-01 NOT to surface it. Recording the trade-off so the next reader
-- knows it was a decision rather than an oversight: some app-store and
-- marketplace rules require paid ranking to be disclosed. That call is the
-- owner's and they have made it. Do not add a disclosure here without asking.
--
-- ── PRIVACY ─────────────────────────────────────────────────────────────────
--
-- `rank_score` is already a returned column, so a caller can now infer roughly
-- whether a poster is Pro/Elite from its arithmetic. That is not a disclosure:
-- the poster's tier is ALREADY public on the card — `JobPosterCard.tsx` renders
-- an Elite / Pro / Basic badge from `posterSubscriptionTier` on every job. No
-- new column is returned and no new row is reachable.
--
-- ── SECURITY / RECURSION ────────────────────────────────────────────────────
--
-- The function is unchanged in kind: still SECURITY DEFINER with a pinned
-- search_path, so the new LEFT JOIN onto `public.profiles` runs as the owner
-- and bypasses RLS — necessary, because `profiles` has no cross-member SELECT
-- policy (20260901011254). It cannot recurse the way 20260529111503 did:
-- `profiles`' policies are own-row / has_role / service_role and none of them
-- reads `jobs`. The join is on `user_id`, which is unique.
--
-- ── REPLAY-SAFETY ───────────────────────────────────────────────────────────
--
-- One CREATE OR REPLACE. The signature, the RETURNS TABLE and the column order
-- are byte-identical to 20260901022522, so the anon/PUBLIC EXECUTE grants the
-- guest feed depends on carry over untouched and every historic call arity
-- keeps resolving (no PGRST202 window). Nothing here references an object a
-- LATER migration defines. Applied three times consecutively against a
-- prod-shaped PGlite schema with assertions after each pass.

CREATE OR REPLACE FUNCTION public.get_ranked_open_jobs(p_limit integer DEFAULT 20, p_offset integer DEFAULT 0, p_include_seed boolean DEFAULT true)
 RETURNS TABLE(id uuid, title text, description text, category job_category, budget numeric, date_needed date, start_time time without time zone, location text, parish text, is_urgent boolean, urgent_fee numeric, is_flexible_schedule boolean, is_recurring boolean, recurrence_interval text, is_group_job boolean, helpers_needed integer, estimated_hours numeric, photos text[], special_requirements text, created_at timestamp with time zone, expires_at timestamp with time zone, boosted_at timestamp with time zone, boost_expires_at timestamp with time zone, parish_match boolean, rank_score numeric, pricing_mode text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH viewer_parishes AS (
    SELECT parish FROM public.helper_preferred_parishes
    WHERE helper_id = (SELECT auth.uid())
    UNION
    SELECT parish FROM public.profiles
    WHERE user_id = (SELECT auth.uid())
      AND parish IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM public.helper_preferred_parishes
        WHERE helper_id = (SELECT auth.uid())
      )
  ),
  -- Evaluated once per call, not once per row: the cutoff does not depend on j.
  cutoff AS (SELECT public.early_access_cutoff() AS ts),
  scored AS (
    SELECT
      j.id, j.title, j.description, j.category, j.budget, j.date_needed,
      j.start_time, j.location, j.parish, j.is_urgent, j.urgent_fee,
      j.is_flexible_schedule, j.is_recurring, j.recurrence_interval,
      j.is_group_job, j.helpers_needed, j.estimated_hours, j.photos,
      j.special_requirements, j.created_at, j.expires_at, j.boosted_at,
      j.boost_expires_at, j.pricing_mode,
      (j.parish IS NOT NULL AND j.parish IN (SELECT parish FROM viewer_parishes)) AS parish_match,
      (
        CASE WHEN j.boost_expires_at IS NOT NULL AND j.boost_expires_at > now() THEN 1000 ELSE 0 END
        + CASE WHEN j.parish IS NOT NULL AND j.parish IN (SELECT parish FROM viewer_parishes) THEN 500 ELSE 0 END
        + CASE WHEN j.is_urgent THEN 100 ELSE 0 END
        + GREATEST(0, 50 - EXTRACT(EPOCH FROM (now() - j.created_at)) / 3600.0)::numeric
        -- Poster placement. BOUNDED — 10% / 5% of the recency span above, so
        -- it is strictly smaller than every other term here and cannot
        -- outrank boost, parish, urgency or a real age gap. See the header.
        + CASE
            WHEN pp.subscription_expires_at IS NOT NULL
                 AND pp.subscription_expires_at <= now() THEN 0
            WHEN pp.subscription_tier = 'elite' THEN 5
            WHEN pp.subscription_tier = 'pro'   THEN 2.5
            ELSE 0
          END
      )::numeric AS rank_score
    FROM public.jobs j
    CROSS JOIN cutoff
    -- Poster's membership row. LEFT so a job whose poster has no profile row
    -- still ranks (it simply earns no placement points).
    LEFT JOIN public.profiles pp ON pp.user_id = j.customer_id
    WHERE j.status = 'open'
      AND (j.date_needed IS NULL OR j.date_needed >= CURRENT_DATE)
      -- Hide jobs under a live direct offer — mirrors open_jobs_browse.
      AND (
        j.offered_to_helper_id IS NULL
        OR j.direct_offer_status = ANY (ARRAY['declined'::text, 'expired'::text])
        OR j.offered_to_helper_id = (SELECT auth.uid())
      )
      -- F-1: escrow must exist before a helper can see the job.
      AND j.payment_status = ANY (ARRAY['escrow'::text, 'payout_pending'::text, 'released'::text])
      -- Fixture rows, gated by the caller. Default true = unchanged behaviour.
      AND (p_include_seed OR NOT j.is_seed)
      -- Early Access (20260901022522). auth.uid() IS NULL for a guest, which
      -- lands on the free 20-minute delay — the free experience, by design.
      AND (
        j.created_at <= cutoff.ts
        OR j.customer_id = (SELECT auth.uid())
        OR j.offered_to_helper_id = (SELECT auth.uid())
      )
  )
  SELECT id, title, description, category, budget, date_needed, start_time,
    public.mask_job_location(location) AS location, parish, is_urgent, urgent_fee,
    is_flexible_schedule, is_recurring, recurrence_interval, is_group_job,
    helpers_needed, estimated_hours, photos, special_requirements, created_at,
    expires_at, boosted_at, boost_expires_at, parish_match, rank_score, pricing_mode
  FROM scored
  ORDER BY rank_score DESC, created_at DESC
  LIMIT p_limit OFFSET p_offset;
$function$;
