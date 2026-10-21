-- Q1848 (owner decided 2026-10-21): every leftover paid-tier perk is OFF while
-- the 'memberships' switch is off for the member, the same rule F4a gave the
-- Advanced Analytics gate (helper_has_advanced_analytics, 20261017085012).
--   (1) apply_job_denial_consequence: the Elite strike shield
--       (newest 20261012184444_offer_free_to_refuse);
--   (2) get_ranked_open_jobs: the poster placement boost
--       (newest 20261017094018_browse_rpcs_carry_fee_stamp);
--   (6) admin_support_queue: priority support ordering
--       (newest 20260915043200_admin_support_queue_admits_plus).
-- (4) weekly-helper-report and (5) check-pro-subscription's $10 referral bonus
-- are edge functions, gated in this same change.
--
-- Each body is the newest repo definition VERBATIM (md5 of the whitespace-
-- stripped prosrc equals prod's, checked 2026-10-21) plus one switch check.
-- feature_enabled_for_user is false for a null user, so an ownerless job and a
-- deleted reporter get no perk. CREATE OR REPLACE keeps every grant as it is.
-- Prod 2026-10-17: 0 of 97 profiles hold a tier, so nothing changes today.

CREATE OR REPLACE FUNCTION public.apply_job_denial_consequence(p_helper uuid, p_job uuid, p_description text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_prior_count int;
  v_is_elite boolean;
  v_shield_available boolean := false;
BEGIN
  PERFORM set_config('app.trusted_ladder_write', 'on', true);

  -- Shielded strikes don't count toward escalation.
  SELECT count(*) INTO v_prior_count
    FROM public.user_violations
   WHERE user_id = p_helper
     AND violation_type = 'job_denial'
     AND COALESCE(action_taken, '') <> 'forgiven_elite_shield';

  -- Active Elite + no shield used in the rolling window?
  SELECT (p.subscription_tier = 'elite'
          AND (p.subscription_expires_at IS NULL OR p.subscription_expires_at > now())
          -- Q1848 (1): no Elite shield while memberships are off for this member.
          AND public.feature_enabled_for_user('memberships', p_helper))
    INTO v_is_elite
    FROM public.profiles p WHERE p.user_id = p_helper;

  IF COALESCE(v_is_elite, false) THEN
    SELECT NOT EXISTS (
      SELECT 1 FROM public.user_violations
       WHERE user_id = p_helper
         AND action_taken = 'forgiven_elite_shield'
         AND created_at > now() - interval '180 days'
    ) INTO v_shield_available;
  END IF;

  IF v_shield_available THEN
    INSERT INTO public.user_violations (user_id, violation_type, description, job_id, action_taken)
    VALUES (p_helper, 'job_denial', p_description, p_job, 'forgiven_elite_shield');
    INSERT INTO public.notifications (user_id, title, message, type, link, job_id)
    VALUES (p_helper, 'Your Elite shield absorbed this one',
            'As an Elite member, your first reliability strike every 6 months is forgiven. This one''s on the house — the next one counts.',
            'info', '/profile?tab=warnings', p_job);
    RETURN jsonb_build_object('action', 'shielded', 'prior_count', v_prior_count);
  END IF;

  RETURN public.apply_consequence_ladder(
    p_user                      => p_helper,
    p_violation_type            => 'job_denial',
    p_description               => p_description,
    p_job_id                    => p_job,
    p_prior_count               => v_prior_count,
    p_rungs                     => ARRAY['none', 'warning', 'temp_ban', 'pending_ban_review'],
    p_effects                   => ARRAY['record', 'final_warning', 'suspend', 'permanent'],
    p_copy                      => jsonb_build_array(
      -- Rung 1 is recorded SILENTLY: no notification. Cast is required —
      -- jsonb_build_array is VARIADIC "any" and cannot resolve a bare NULL.
      null::jsonb,
      jsonb_build_object(
        'title', 'Final warning',
        'message', 'This is your second reliability strike. One more — backing out of a job you accepted — and your account is suspended for 7 days.'),
      jsonb_build_object(
        'title', 'Account suspended for 7 days',
        'message', 'Third reliability strike — your account is suspended for 7 days. A fourth strike restricts your account again while an admin decides whether to ban it permanently.'),
      jsonb_build_object(
        'title', 'Account restricted for 7 days',
        'message', 'Fourth reliability strike — your account is restricted for 7 days and an admin is reviewing it for a permanent ban. If you think this is wrong, email admin@louisianahelpr.com.')
    ),
    p_permanent_requires_review => true,
    p_suspension_days           => 7,
    p_clamp_to_worse_status     => false,
    p_admin_message_format      => '%s has %s reliability strikes on file (backed out of jobs they accepted) and is restricted for 7 days pending your decision.',
    -- Unused while p_permanent_requires_review is true; kept so the direct-ban
    -- path stays fully specified if that policy is ever revisited.
    p_ban_reason                => 'Fourth reliability strike (backed out of jobs they accepted)'
  );
END;
$function$
;

CREATE OR REPLACE FUNCTION public.get_ranked_open_jobs(p_limit integer DEFAULT 20, p_offset integer DEFAULT 0, p_include_seed boolean DEFAULT true, p_lat numeric DEFAULT NULL::numeric, p_lng numeric DEFAULT NULL::numeric, p_max_miles numeric DEFAULT NULL::numeric)
 RETURNS TABLE(id uuid, title text, description text, category job_category, budget numeric, date_needed date, start_time time without time zone, location text, parish text, is_urgent boolean, urgent_fee numeric, is_flexible_schedule boolean, is_recurring boolean, recurrence_interval text, is_group_job boolean, helpers_needed integer, estimated_hours numeric, photos text[], special_requirements text, created_at timestamp with time zone, expires_at timestamp with time zone, boosted_at timestamp with time zone, boost_expires_at timestamp with time zone, parish_match boolean, rank_score numeric, pricing_mode text, distance_band text, helper_fee_flat_cents integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
 SET "TimeZone" TO 'America/Chicago'
AS $function$
  WITH viewer_parishes AS (
    SELECT parish FROM public.profiles
    WHERE user_id = (SELECT auth.uid())
      AND parish IS NOT NULL
  ),
  -- Where the viewer is. Argument first (a fresh device fix, and the only
  -- option for a guest), then the stored fix.
  viewer_point AS (
    SELECT
      COALESCE(p_lat, (SELECT pr.latitude  FROM public.profiles pr
                        WHERE pr.user_id = (SELECT auth.uid()))) AS lat,
      COALESCE(p_lng, (SELECT pr.longitude FROM public.profiles pr
                        WHERE pr.user_id = (SELECT auth.uid()))) AS lng
  ),
  cutoff AS (
    SELECT public.early_access_cutoff()      AS ts,
           public.seed_hidden_in_discovery() AS seed_hidden,  -- Q552: false for a test account
           COALESCE(public.get_user_credential_tier((SELECT auth.uid())), 0) AS viewer_tier
  ),
  scored AS (
    SELECT
      j.id, j.title, j.description, j.category, j.budget, j.date_needed,
      j.start_time, j.location, j.parish, j.is_urgent, j.urgent_fee,
      j.is_flexible_schedule, j.is_recurring, j.recurrence_interval,
      j.is_group_job, j.helpers_needed, j.estimated_hours, j.photos,
      j.special_requirements, j.created_at, j.expires_at, j.boosted_at,
      j.boost_expires_at, j.pricing_mode, j.helper_fee_flat_cents,
      (j.parish IS NOT NULL AND j.parish IN (SELECT parish FROM viewer_parishes)) AS parish_match,
      -- Measured against the job's 2dp-ROUNDED coordinates, the identical
      -- masked pair open_jobs_browse already publishes.
      public.miles_between(
        round(j.latitude, 2), round(j.longitude, 2),
        (SELECT lat FROM viewer_point), (SELECT lng FROM viewer_point)
      ) AS distance_miles,
      (
        CASE WHEN j.boost_expires_at IS NOT NULL AND j.boost_expires_at > now() THEN 1000 ELSE 0 END
        + CASE WHEN j.parish IS NOT NULL AND j.parish IN (SELECT parish FROM viewer_parishes) THEN 500 ELSE 0 END
        + CASE WHEN j.is_urgent THEN 100 ELSE 0 END
        + GREATEST(0, 50 - EXTRACT(EPOCH FROM (now() - j.created_at)) / 3600.0)::numeric
        -- Poster placement. BOUNDED (20260901031421, 20260915051752).
        + CASE
            WHEN pp.subscription_expires_at IS NOT NULL
                 AND pp.subscription_expires_at <= now() THEN 0
            -- Q1848 (2): no poster boost while memberships are off for the poster.
            WHEN NOT public.feature_enabled_for_user('memberships', j.customer_id) THEN 0
            WHEN pp.subscription_tier = 'elite' THEN 5
            WHEN pp.subscription_tier = 'plus'  THEN 2.5
            WHEN pp.subscription_tier = 'pro'   THEN 2.5
            ELSE 0
          END
      )::numeric AS rank_score
    FROM public.jobs j
    CROSS JOIN cutoff
    LEFT JOIN public.profiles pp ON pp.user_id = j.customer_id
    WHERE (j.status = 'open' OR (j.status = 'accepted' AND j.is_group_job IS TRUE AND public.crew_spots_open(j.id) > 0))
      -- A series visit is re-offered only inside its series (20260927015010).
      AND j.parent_job_id IS NULL
      AND j.customer_id IS NOT NULL
      AND ((SELECT auth.uid()) IS NULL OR j.customer_id <> (SELECT auth.uid()))
      AND (j.date_needed IS NULL OR public.job_offer_cutoff(j.date_needed, j.start_time) > now())
      AND (
        j.offered_to_helper_id IS NULL
        OR j.direct_offer_status = ANY (ARRAY['declined'::text, 'expired'::text])
        OR j.offered_to_helper_id = (SELECT auth.uid())
      )
      AND j.payment_status = ANY (ARRAY['escrow'::text, 'payout_pending'::text, 'released'::text])
      AND (COALESCE(j.credential_tier, 0) = 0 OR cutoff.viewer_tier >= j.credential_tier)
      AND (NOT j.is_seed OR (p_include_seed AND NOT cutoff.seed_hidden))
      AND (
        j.created_at <= cutoff.ts
        OR j.offered_to_helper_id = (SELECT auth.uid())
      )
      -- Q1411: not while the poster is under an open ban settlement review.
      AND NOT EXISTS (SELECT 1 FROM public.ban_settlement_queue q WHERE q.user_id = j.customer_id AND q.review_state = 'open')
  )
  SELECT id, title, description, category, budget, date_needed, start_time,
    public.mask_job_location(location) AS location, parish, is_urgent, urgent_fee,
    is_flexible_schedule, is_recurring, recurrence_interval, is_group_job,
    helpers_needed, estimated_hours, photos, special_requirements, created_at,
    expires_at, boosted_at, boost_expires_at, parish_match,
    -- rank_score WITHOUT the distance term, so distance cannot be recovered
    -- by subtraction.
    rank_score,
    pricing_mode,
    CASE
      WHEN distance_miles IS NULL   THEN NULL
      WHEN distance_miles < 5       THEN 'Under 5 mi'
      WHEN distance_miles < 15      THEN '5-15 mi'
      WHEN distance_miles < 30      THEN '15-30 mi'
      ELSE '30+ mi'
    END AS distance_band,
    -- Q1839: the jobs flat-fee stamp (roadmap F3), so a flat job's pay is
    -- priced 5% + 70c, never the viewer's tier.
    helper_fee_flat_cents
  FROM scored
  WHERE
    -- Radius filter. An unevaluable radius KEEPS the row.
    p_max_miles IS NULL
    OR distance_miles IS NULL
    OR distance_miles <= p_max_miles
  -- The distance term orders the feed and never reaches the payload.
  ORDER BY
    (rank_score + CASE
       -- Unknown distance is NEUTRAL (the middle band), never "far".
       WHEN distance_miles IS NULL THEN 100
       WHEN distance_miles < 5     THEN 400
       WHEN distance_miles < 15    THEN 250
       WHEN distance_miles < 30    THEN 100
       ELSE 0
     END) DESC,
    created_at DESC
  LIMIT p_limit OFFSET p_offset;
$function$
;

CREATE OR REPLACE FUNCTION public.admin_support_queue(
  p_status text DEFAULT 'pending'::text,
  p_priority_tiers text[] DEFAULT ARRAY['plus'::text, 'elite'::text],
  p_head_start_minutes integer DEFAULT 2880
)
RETURNS TABLE(
  id uuid,
  reporter_id uuid,
  reason text,
  description text,
  status text,
  created_at timestamp with time zone,
  reporter_name text,
  reporter_email text,
  support_tier text,
  priority_support boolean,
  priority_at timestamp with time zone
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH graded AS (
    SELECT
      r.id,
      r.reporter_id,
      r.reason,
      r.description,
      r.status,
      r.created_at,
      p.full_name AS reporter_name,
      p.email     AS reporter_email,
      -- Effective tier NOW, expiry folded in. Mirrors tierFeePercent().
      -- Every paid rung of the ladder; anything else (incl. a retired
      -- 'business') resolves to 'free'. Pinned to TIER_ORDER by
      -- src/test/perkEnforcementParity.test.ts.
      CASE
        WHEN p.subscription_expires_at IS NOT NULL
             AND p.subscription_expires_at < now() THEN 'free'
        -- Q1848 (6): no priority support while memberships are off for the reporter.
        WHEN NOT public.feature_enabled_for_user('memberships', r.reporter_id) THEN 'free'
        WHEN lower(coalesce(p.subscription_tier, '')) IN ('basic', 'pro', 'plus', 'elite')
          THEN lower(p.subscription_tier)
        ELSE 'free'
      END AS support_tier
    FROM public.reports r
    LEFT JOIN public.profiles p ON p.user_id = r.reporter_id
    WHERE r.reported_type = 'support'
      -- Server-side authorization: non-admins get no rows, not an error.
      AND public.has_role(auth.uid(), 'admin')
      AND (
        p_status = 'all'
        OR (p_status = 'pending'  AND r.status =  'pending')
        OR (p_status = 'resolved' AND r.status <> 'pending')
      )
  )
  SELECT
    g.id,
    g.reporter_id,
    g.reason,
    g.description,
    g.status,
    g.created_at,
    g.reporter_name,
    g.reporter_email,
    g.support_tier,
    (g.support_tier = ANY (coalesce(p_priority_tiers, ARRAY[]::text[]))) AS priority_support,
    g.created_at
      - CASE
          WHEN g.support_tier = ANY (coalesce(p_priority_tiers, ARRAY[]::text[]))
            THEN make_interval(mins => greatest(coalesce(p_head_start_minutes, 0), 0))
          ELSE interval '0'
        END AS priority_at
  FROM graded g
  ORDER BY
    -- 1. Open work above closed history. Only bites on the 'all' filter.
    (g.status = 'pending') DESC,
    -- 2. The queue proper: oldest EFFECTIVE arrival first.
    CASE WHEN g.status = 'pending' THEN
      g.created_at
        - CASE
            WHEN g.support_tier = ANY (coalesce(p_priority_tiers, ARRAY[]::text[]))
              THEN make_interval(mins => greatest(coalesce(p_head_start_minutes, 0), 0))
            ELSE interval '0'
          END
    END ASC,
    -- 3. Closed history reads newest-first. NULL for every open row, so it is
    --    a no-op inside the open group.
    CASE WHEN g.status <> 'pending' THEN g.created_at END DESC,
    -- 4. Deterministic tiebreak so identical timestamps cannot shuffle between
    --    refetches (and cannot shuffle across a page boundary if this ever
    --    grows a .range()).
    g.id ASC;
$function$
;
