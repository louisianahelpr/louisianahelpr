-- Enforce the early-access perk server-side on /jobs, the dashboard list and
-- the map — and stop `get_safe_profiles` selling Priority Placement to an
-- expired card.
--
-- ── WHY ─────────────────────────────────────────────────────────────────────
--
-- Early Access is sold on three tiers (Basic 5 min, Pro 10, Elite the full 20)
-- and, before this migration, exactly ONE of the three browse surfaces
-- enforced it:
--
--   surface                     enforcement            measured 2026-09-01
--   ─────────────────────────── ────────────────────── ─────────────────────
--   /jobs  (get_ranked_open_jobs)  NONE                the function body did
--                                                      not contain the string
--                                                      `subscription` at all
--   dashboard list (open_jobs_browse) CLIENT           useDashboardData built
--                                                      the cutoff in JS and
--                                                      sent `.lte(created_at)`
--   map    (get_open_jobs_for_map)   server            the only real gate
--
-- A filter the client supplies is a filter the client can drop: the dashboard
-- gate was one deleted `.lte()` (or one hand-rolled PostgREST call with the
-- anon key, which every visitor has) away from nothing. And `/jobs` needed no
-- dodge at all — it is a public, anon-callable feed with no gate whatsoever,
-- so any free member could open a private window and read the same "early"
-- jobs they were being asked to pay $5–$20/mo for. A paid perk enforced in the
-- client is not enforced.
--
-- ── THE SHAPE OF THE FIX ────────────────────────────────────────────────────
--
-- One authority — `public.early_access_cutoff()` — returns the oldest
-- `created_at` the CALLER is allowed to see, derived from their own profile
-- row inside the database where the client cannot reach it. All three surfaces
-- compare against it. The client keeps its cutoff arithmetic only as a
-- redundant pre-filter (it can subtract rows, never add them); dropping it
-- now changes nothing.
--
-- Two directions this deliberately fails toward:
--
--   1. FREE, ALWAYS. No auth.uid() (anon, and therefore both guest surfaces),
--      no profile row, an unrecognised tier string, a retired 'business' — all
--      fall through COALESCE/ELSE to 0 earned minutes and wait the full 20.
--      Same direction as `DEFAULT_TIER_FEE_PERCENT` in
--      `_shared/helperFees.ts`: an unknown value must never hand out the perk.
--   2. AN EXPIRED PAID TIER IS FREE. Resolved here rather than trusted to the
--      raw column, because `expire-subscriptions` nulls the tier on a delay.
--
-- ── A CONVENTION BUG THIS FIXES ON THE WAY PAST ─────────────────────────────
--
-- `get_open_jobs_for_map` graded expiry as:
--
--     WHEN p.subscription_expires_at IS NULL OR p.subscription_expires_at <= now()
--       THEN NULL          -- i.e. a NULL expiry meant EXPIRED
--
-- Every other expiry resolver in the codebase says the opposite, and says so
-- explicitly: `tierFeePercent` (subscriptionTiers.ts), `feePercentForTier`
-- (`_shared/helperFees.ts` — "An unparseable / absent `expiresAt` is treated as
-- NOT expired"), and `resolveEarlyAccessTier` (earlyAccess.ts — "a null expiry
-- means ACTIVE — the expire-subscriptions cron nulls the tier on lapse, so only
-- a stamped PAST date means expired"). So an Elite member holding a NULL expiry
-- — a manual grant, a legacy row — got early access on the dashboard list and
-- was silently demoted to free on the map: pins vanished when they toggled
-- from the list, which is the exact failure `earlyAccess.parity.test.ts` was
-- written to catch and could not, because it only asserted the SQL contained
-- the substring `subscription_expires_at <= now()` — true of both readings.
-- `early_access_cutoff()` implements the documented convention (NULL = active,
-- only a stamped past date lapses) and the test now grades the whole predicate.
--
-- ── WHO IS EXEMPT, AND WHY ──────────────────────────────────────────────────
--
-- The delay is a BROWSE-ordering perk, not a visibility rule about your own
-- business, so two rows are never delayed regardless of tier:
--   • your own post (`customer_id = auth.uid()`) — a poster watching their
--     brand-new job appear is not consuming someone else's perk, and hiding it
--     for 20 minutes reads as "my job didn't post";
--   • a job directly offered to you (`offered_to_helper_id = auth.uid()`) — a
--     direct offer is addressed mail, and it already carries a response
--     deadline that would have been burning while the row was hidden.
-- Both exemptions are self-scoped: they can only ever reveal a row the caller
-- is already a party to.
--
-- ── PRIORITY PLACEMENT / `get_safe_profiles` ────────────────────────────────
--
-- `get_safe_profiles` emitted `p.subscription_tier` raw, and it is the ONLY
-- way one member ever learns another member's tier (the three surviving
-- `profiles` SELECT policies are own-row / admin / service_role — see
-- 20260901011254). So every cross-member consumer of a tier was reading a
-- column that keeps its value until the `expire-subscriptions` cron gets
-- around to it: the applicant list ranked a lapsed Pro as Pro, and
-- ApplicantsPanel printed the ELITE chip and the gold halo on a subscription
-- that had ended. Folding the expiry in here fixes every consumer at once and
-- adds no new exposure — the alternative, returning `subscription_expires_at`,
-- would publish another member's billing date to do it. Nothing else changes:
-- same signature, same column list, same order, same WHERE.
--
-- ── SECURITY / RECURSION ────────────────────────────────────────────────────
--
-- `early_access_cutoff()` is SECURITY DEFINER with a pinned `search_path` and
-- reads exactly one table, `public.profiles`, by `auth.uid()`. It cannot
-- recurse the way 20260529111503 did: `profiles`' SELECT policies are
-- `auth.uid() = user_id`, `has_role(...)` and a `service_role` grant — none of
-- them reads `jobs`, and none reads back into a function that reads `profiles`.
-- It is SECURITY DEFINER rather than INVOKER so that the answer cannot change
-- with the caller's ability to read their own row.
--
-- GRANTS: EXECUTE to `anon` and `authenticated` because `open_jobs_browse` is
-- `security_invoker = false` (20260529115941) — table access is checked as the
-- view owner, but a FUNCTION referenced by the view is still checked against
-- the calling role, so both browse roles need it by name. `service_role` for
-- the reconciliation/administrative reads. PUBLIC is revoked first so the
-- grant list is the whole story rather than a leftover default (the #355/#364
-- grant-regression class).
--
-- ── REPLAY-SAFETY ───────────────────────────────────────────────────────────
--
-- Every statement is CREATE OR REPLACE / REVOKE / GRANT / a to_regclass-guarded
-- ALTER VIEW, no object is dropped, no signature or return type changes, and
-- nothing here references an object a LATER migration defines. Applied three
-- times consecutively against a prod-shaped PGlite schema; pass 3 was identical
-- to pass 1, no overloads accumulated, and get_ranked_open_jobs stayed callable
-- at 0-, 1-, 2- and 3-argument arity throughout (so the guest feed's existing
-- call forms never 404 during the db-deploy window).

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. The one authority
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.early_access_cutoff()
RETURNS timestamptz
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  -- Mirror of earlyAccessDelayMs() + resolveEarlyAccessTier() in
  -- src/lib/earlyAccess.ts: a 20-minute base, minus the minutes the caller's
  -- ACTIVE tier has earned. Rows created after the returned instant are the
  -- perk; rows at or before it are the free feed.
  --
  -- `business` is deliberately absent — the tier was retired on 2026-09-01
  -- (see 20260901010104 and subscriptionTiers.ts) and a stray string must fall
  -- to ELSE 0, losing a perk rather than being handed one.
  SELECT now() - make_interval(mins => 20 - COALESCE((
    SELECT CASE
             -- Lapsed. Only a STAMPED PAST date lapses: a NULL expiry is an
             -- active grant, matching tierFeePercent / feePercentForTier /
             -- resolveEarlyAccessTier. The cron nulls the TIER on lapse.
             WHEN p.subscription_expires_at IS NOT NULL
                  AND p.subscription_expires_at <= now() THEN 0
             WHEN p.subscription_tier = 'elite' THEN 20
             WHEN p.subscription_tier = 'pro'   THEN 10
             WHEN p.subscription_tier = 'basic' THEN 5
             ELSE 0
           END
    FROM public.profiles p
    WHERE p.user_id = (SELECT auth.uid())
  ), 0));
$function$;

COMMENT ON FUNCTION public.early_access_cutoff() IS
  'Oldest jobs.created_at the CALLER may browse. The single server-side authority for the Early Access perk: /jobs (get_ranked_open_jobs), the dashboard list (open_jobs_browse) and the map (get_open_jobs_for_map) all compare against it. Anon, an absent profile, an unrecognised tier and an expired paid tier all resolve to the free 20-minute delay. Mirrors src/lib/earlyAccess.ts; earlyAccess.parity.test.ts pins the two together.';

REVOKE ALL ON FUNCTION public.early_access_cutoff() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.early_access_cutoff() TO anon, authenticated, service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. Surface 1 — the dashboard list (view, queried directly by PostgREST)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- CREATE OR REPLACE VIEW preserves the existing grants and the column list, so
-- every PostgREST select keeps working. Body is 20260831010000's verbatim, plus
-- the final predicate.
--
-- It does NOT preserve reloptions — measured, not assumed: against a PGlite
-- database this replace took `pg_class.reloptions` from
-- `{security_invoker=false}` to NULL on all three passes. Harmless here only
-- because `security_invoker` defaults to OFF, so the wipe lands on the same
-- effective posture; on a `security_invoker = true` view the identical
-- statement silently flips the privilege model. 20260616120000 and
-- 20260628120000 both re-assert it after their replace for exactly this
-- reason. Follow the convention rather than relying on the default matching.

CREATE OR REPLACE VIEW public.open_jobs_browse AS
 SELECT id,
    title,
    description,
    category,
    budget,
    date_needed,
        CASE
            WHEN offered_to_helper_id = auth.uid() THEN location
            ELSE public.mask_job_location(location)
        END AS location,
    is_urgent,
    urgent_fee,
    is_flexible_schedule,
    is_recurring,
    is_group_job,
    helpers_needed,
    estimated_hours,
    start_time,
    photos,
    special_requirements,
    status,
    created_at,
    updated_at,
    boosted_at,
    boost_expires_at,
    expires_at,
    recurrence_interval,
    recurrence_end_date,
    parent_job_id,
    payment_status,
    customer_id,
    offered_to_helper_id,
    direct_offer_status,
    direct_offer_expires_at,
    (( SELECT count(*) AS count
           FROM public.applications a
          WHERE a.job_id = jobs.id))::integer AS applicant_count,
    pricing_mode
   FROM public.jobs
  WHERE status = 'open'::job_status
    -- F-1: escrow must exist before a helper can see the job.
    AND payment_status = ANY (ARRAY['escrow'::text, 'payout_pending'::text, 'released'::text])
    AND (offered_to_helper_id IS NULL OR (direct_offer_status = ANY (ARRAY['declined'::text, 'expired'::text])) OR offered_to_helper_id = auth.uid())
    -- Early Access, enforced here rather than trusted to the caller's
    -- `.lte("created_at", …)`. Your own post and a job offered to you are
    -- never delayed — see the exemption note in this migration's header.
    AND (
      created_at <= public.early_access_cutoff()
      OR customer_id = auth.uid()
      OR offered_to_helper_id = auth.uid()
    );

-- Re-assert the owner-evaluated posture (see 20260529115941 and the note
-- above): CREATE OR REPLACE VIEW resets the reloption to its default.
DO $$
BEGIN
  IF to_regclass('public.open_jobs_browse') IS NOT NULL THEN
    ALTER VIEW public.open_jobs_browse SET (security_invoker = false);
  END IF;
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. Surface 2 — /jobs (anon-callable; had no gate at all)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- CREATE OR REPLACE, signature unchanged, so the PUBLIC/anon EXECUTE grants the
-- guest feed depends on carry over and there is no PGRST202 window: the client
-- calls the same 2- and 3-argument forms it always has, and gets the gate the
-- moment this deploys. Body is 20260831010000's verbatim plus one predicate.

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
      )::numeric AS rank_score
    FROM public.jobs j
    CROSS JOIN cutoff
    WHERE j.status = 'open'
      AND (j.date_needed IS NULL OR j.date_needed >= CURRENT_DATE)
      -- Hide jobs under a live direct offer — mirrors open_jobs_browse.
      AND (
        j.offered_to_helper_id IS NULL
        OR j.direct_offer_status = ANY (ARRAY['declined'::text, 'expired'::text])
        OR j.offered_to_helper_id = (SELECT auth.uid())
      )
      -- F-1: escrow must exist before a helper can see the job. This
      -- supersedes the old `payment_status IS DISTINCT FROM 'abandoned'`
      -- test, which only caught rows void-cancelled-payments had already
      -- swept ~an hour after a declined checkout — and served the
      -- still-'unpaid' row to helpers for the whole hour in between.
      AND j.payment_status = ANY (ARRAY['escrow'::text, 'payout_pending'::text, 'released'::text])
      -- Fixture rows, gated by the caller. Default true = unchanged behaviour.
      AND (p_include_seed OR NOT j.is_seed)
      -- Early Access. THIS is the surface that had nothing: /jobs is
      -- anon-callable, so before this line a free member could read the perk
      -- by opening a private window. auth.uid() IS NULL for a guest, which
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

-- ═══════════════════════════════════════════════════════════════════════════
-- 4. Surface 3 — the map (already gated; move it onto the shared authority)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Byte-identical to 20260901010104 apart from the CTEs: the inline viewer/delay
-- pair is replaced by the shared cutoff (which also corrects the NULL-expiry
-- reading described in the header), and the poster/offeree exemptions are added
-- so the three surfaces agree about which rows the delay applies to.

CREATE OR REPLACE FUNCTION public.get_open_jobs_for_map()
 RETURNS TABLE(id uuid, title text, category text, budget numeric, is_urgent boolean, latitude numeric, longitude numeric, parish text, created_at timestamp with time zone, location text, date_needed date, start_time time without time zone, urgent_fee numeric, is_group_job boolean, helpers_needed integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH cutoff AS (SELECT public.early_access_cutoff() AS ts)
  SELECT
    j.id,
    j.title,
    j.category,
    j.budget,
    COALESCE(j.is_urgent, false) AS is_urgent,
    -- 2 decimal places ≈ 1.1km at Louisiana latitudes. The pin lands in
    -- the right neighborhood, never on the doorstep, and can't be
    -- reverse-engineered to the source coords.
    ROUND(j.latitude, 2) AS latitude,
    ROUND(j.longitude, 2) AS longitude,
    j.parish,
    j.created_at,
    -- City, State only — same masker the public /jobs board uses. The popup
    -- prints the city and falls back to the parish when this is empty.
    public.mask_job_location(j.location) AS location,
    j.date_needed,
    j.start_time,
    j.urgent_fee,
    COALESCE(j.is_group_job, false) AS is_group_job,
    j.helpers_needed
  FROM public.jobs j
  CROSS JOIN cutoff
  WHERE j.status = 'open'
    -- F-1: same funded gate as get_ranked_open_jobs and open_jobs_browse, so
    -- the map cannot pin a job the list refuses to show.
    AND j.payment_status = ANY (ARRAY['escrow'::text, 'payout_pending'::text, 'released'::text])
    AND j.latitude IS NOT NULL
    AND j.longitude IS NOT NULL
    AND (j.expires_at IS NULL OR j.expires_at > NOW())
    -- Hide jobs whose needed date has already passed — matches the
    -- client-side filter in useDashboardFilters.ts and the SQL filter in
    -- get_ranked_open_jobs, so list + map + /jobs page all agree on
    -- which posts are "still open for browse."
    AND (j.date_needed IS NULL OR j.date_needed >= CURRENT_DATE)
    -- Same visibility rule as get_public_open_jobs: a job with a pending
    -- direct offer is private to its targeted helper; it reappears once
    -- the offer resolves (declined/expired).
    AND (j.offered_to_helper_id IS NULL OR j.direct_offer_status <> 'pending')
    -- The paid perk, on the shared authority.
    AND (
      j.created_at <= cutoff.ts
      OR j.customer_id = (SELECT auth.uid())
      OR j.offered_to_helper_id = (SELECT auth.uid())
    )
  ORDER BY j.boosted_at DESC NULLS LAST, j.created_at DESC
  LIMIT 100;
$function$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 5. Priority Placement cannot be bought with an expired card
-- ═══════════════════════════════════════════════════════════════════════════
--
-- 20260831213259's body verbatim, with ONE expression changed: the raw
-- `p.subscription_tier` becomes the expiry-resolved tier. Same NULL-is-active
-- convention as early_access_cutoff() above. CREATE OR REPLACE (no DROP): the
-- signature and RETURNS TABLE are identical, so the anon/authenticated/
-- service_role grants from that migration carry over untouched.

CREATE OR REPLACE FUNCTION public.get_safe_profiles(user_ids uuid[])
RETURNS TABLE(
  user_id uuid, full_name text, avatar_url text, bio text, location text,
  skills text, hourly_rate numeric, role text, subscription_tier text,
  portfolio_urls text[], created_at timestamptz,
  is_id_verified boolean, is_payout_ready boolean, profile_id uuid,
  is_licensed boolean, license_status text,
  is_insured boolean, insurance_status text,
  business_name text
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT
    p.user_id, p.full_name, p.avatar_url, p.bio, p.location,
    p.skills, p.hourly_rate,
    (
      SELECT CASE
               -- Only an admin caller may learn that someone else is an admin.
               WHEN ur.role = 'admin'::app_role
                    AND auth.uid() IS NOT NULL
                    AND has_role(auth.uid(), 'admin')
                 THEN 'admin'
               ELSE 'member'
             END
      FROM public.user_roles ur WHERE ur.user_id = p.user_id
      ORDER BY CASE ur.role WHEN 'admin'::app_role THEN 1 ELSE 2 END LIMIT 1
    ) AS role,
    -- The tier as it stands TODAY, not as the column last remembers it.
    -- This is the only route by which one member learns another's tier, and
    -- it drives Priority Placement's ranking bump plus the Pro/Elite chip and
    -- halo on the applicant card. `expire-subscriptions` nulls the column on
    -- a cron, so the raw value keeps paying out after the plan ended.
    CASE
      WHEN p.subscription_expires_at IS NOT NULL
           AND p.subscription_expires_at <= now() THEN NULL
      ELSE p.subscription_tier
    END AS subscription_tier,
    p.portfolio_urls, p.created_at,
    (p.idv_status = 'verified') AS is_id_verified,
    -- Restored. Same expression 20260828030738 shipped.
    (p.stripe_account_id IS NOT NULL AND p.stripe_payouts_enabled) AS is_payout_ready,
    p.id AS profile_id,
    p.is_licensed, p.license_status,
    p.is_insured, p.insurance_status,
    -- Never emit an unvetted business name. The badge is the trust signal
    -- and the name is part of it, so the two go public together or not at all.
    CASE
      WHEN (p.is_licensed AND p.license_status = 'verified')
        OR (p.is_insured AND p.insurance_status = 'verified')
      THEN p.business_name
    END AS business_name
  FROM public.profiles p
  WHERE (p.user_id = ANY(user_ids) OR p.id = ANY(user_ids))
    AND p.approval_status = 'approved'
    AND (p.ban_status IS NULL OR p.ban_status NOT IN ('temp_banned', 'permanently_banned'));
$function$;
