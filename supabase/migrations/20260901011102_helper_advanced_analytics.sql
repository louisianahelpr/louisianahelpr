-- Helper Advanced Analytics — the Pro/Elite perk, gated in SQL.
--
-- ── THE PROBLEM ────────────────────────────────────────────────────────────
-- "Advanced Analytics" is printed on the $10 Pro card
-- (src/lib/subscriptionTiers.ts, TIER_PERKS.pro.featureBullets) and on Elite,
-- and `TierPerks.advancedAnalytics` is `true` for both. Nothing satisfied it.
-- `/analytics` was an unconditional `<Navigate to="/profile?tab=earnings">`
-- (src/App.tsx) — the Earnings tab, which every FREE helper already has. The
-- last thing that looked like the perk (`HelperAnalyticsBody`: an activity
-- chart plus a grid of PRO-locked teaser tiles) was deleted on 2026-08-30
-- precisely because "none of it was wired to a real Pro feature; it only ever
-- showed a lock icon and an upgrade CTA."
--
-- The owner's decision was to BUILD it. This migration is the data half.
--
-- ── WHY A SECURITY DEFINER RPC AND NOT A CLIENT QUERY ──────────────────────
-- Two independent reasons, both measured against prod (fncmgoasalhdgfwzhsqa)
-- on 2026-09-01:
--
--  1. THE PERK HAS TO BE GATED SERVER-SIDE. A client-only gate on a paid perk
--     is a suggestion. That exact bug was found on `earlyAccess` and fixed by
--     moving the tier check into `get_open_jobs_for_map()`
--     (20260820001000_map_rpc_server_side_early_access). This function makes
--     the same move for analytics: a Free or Basic caller gets
--     `entitled:false` and NO analysis, no matter what the client does.
--
--  2. THE MARKET HALF IS NOT READABLE BY A HELPER AT ALL. After
--     20260831232513_address_only_when_offered, `public.jobs` SELECT for a
--     helper is: own posted, own assigned, accepted applicant, group roster,
--     live direct offer. "When do jobs get posted around me" spans everyone
--     else's rows. It can only come from a definer function.
--
--     (Empirically, on prod TODAY a signed-in seed account still reads all 64
--     job rows — but every seeded test account in `user_roles` carries the
--     `admin` role, so that is the admin policy answering, not a helper
--     policy. Do not mistake it for permission this feature can rely on.)
--
-- ── WHAT THIS FUNCTION DOES *NOT* DO: THE MONEY MATH ───────────────────────
-- Deliberate, and the single most important decision in this file.
--
-- `helperTakeHomeDollars()` (src/lib/helperEarnings.ts) is the ONE definition
-- of what a helper took home, and its header documents three details that each
-- caused real drift (per-job frozen fee vs today's tier; `??` not `||` so a
-- stamped $0 is honoured; group jobs paying budget/N). Re-implementing that in
-- SQL would create a second definition, and the new Analytics page would
-- eventually contradict the Earnings tab about the same dollar.
--
-- So this function returns the per-job FACTS — `budget`, the stamped
-- `helper_fee_percent`, the stamped `platform_fee_amount`, `payment_status`,
-- `is_group_job`, `helpers_needed`, `urgent_fee` — exactly the fields
-- `HelperEarningsJob` takes, and the client runs them through the shared
-- library. Two surfaces, one arithmetic, by construction rather than by
-- vigilance.
--
-- The FLOORS, by contrast, live here (`floors` in the payload) and the client
-- reads them from the response, so the sample-size rule also has one home.
--
-- ── NULL, NEVER 0 ──────────────────────────────────────────────────────────
-- Same discipline 20260901002325_public_profile_stats_for_strangers
-- established, for the same reason: a rate computed off one or two rows is a
-- lie of precision, and this app has repeatedly shipped an outage or an empty
-- set rendered as an all-clear. Every rate here is returned with the sample it
-- came from, and below the floor the metric is absent so the UI can say "not
-- enough history yet" instead of "0%".
--
--   own category median take-home   >= 3 completed jobs in that category
--   application win rate            >= 5 DECIDED applications
--   median time-to-apply            >= 3 applications
--   speed vs. the applicant who won >= 3 head-to-head jobs
--   market demand clock             >= 20 market jobs in the window
--   market median rate per category >= 5 market jobs in that category
--
-- ── WHAT COUNTS AS A "DECIDED" APPLICATION ─────────────────────────────────
-- `application_status` is only ('pending','accepted','rejected') — nothing
-- ever moves a pending row to rejected when the poster simply hires someone
-- else, so a naive `accepted / count(*)` understates every helper and a naive
-- `accepted / (accepted+rejected)` overstates them. Decided is:
--   won  = accepted
--   lost = rejected, OR still pending while the job has moved on to somebody
--          else (job left 'open' and the caller is neither its helper_id nor
--          on its group roster)
-- Everything else — pending on a still-open job, and jobs that were cancelled
-- or expired without anyone being hired — is `undecided` and is excluded from
-- the denominator. A job nobody won is not a loss.
--
-- ── WHAT IS DELIBERATELY NOT MEASURED ──────────────────────────────────────
--  * "Poster viewed your application." `applications.poster_viewed_at` is NULL
--    on 27 of 27 rows in prod — the column has no writer. A funnel step off it
--    would render "0% of your applications were seen", which is not a
--    measurement, it is the absence of one.
--  * "Your average reply time" from `applications.updated_at - created_at`.
--    That interval is how long the POSTER took to decide;
--    20260901002325 already documents it being published under the helper's
--    name as their reply speed. Time-to-apply here is
--    `application.created_at - job.created_at`, which is genuinely the
--    helper's own clock, and it is labelled as that.
--  * Per-parish OWN earnings. `jobs.parish` is client-populated, unvalidated
--    and NULL on 18 of 64 prod rows (and on 2 of the 3 completed jobs of the
--    account this was built against). Parish is backfilled from `zip_code`
--    via `louisiana_zip_parishes` where possible and used for MARKET scope
--    only; a "best parish" chart off that coverage would be fiction.
--  * `job_views` / `profile_views`. 47 and 68 rows platform-wide, dominated by
--    a handful of admin viewers. Not a demand signal yet.
--
-- ── SEED ROWS ──────────────────────────────────────────────────────────────
-- Asymmetric on purpose. The caller's OWN seeded jobs are included, because
-- the Earnings tab counts them and two screens about the same money must
-- agree. Everyone ELSE's seeded jobs are excluded from every market aggregate:
-- 59 of 64 prod job rows are `is_seed`, and a demand clock drawn from
-- fabricated timestamps would be a chart of the seed script. The honest
-- consequence is that the market panel renders its below-floor state on prod
-- today. That is the correct output, not a bug.
--
-- ── SECURITY ───────────────────────────────────────────────────────────────
--  * SECURITY DEFINER + `SET search_path TO 'public'`, and every subject is
--    `auth.uid()`. There is NO caller-supplied user id: the trap that
--    20260825170000_guard_monthly_profile_view_count had to fix (definer +
--    caller-supplied id + no self-check) cannot exist in a function that takes
--    no id at all.
--  * Emits no counterparty id, no job title, no address, no coordinates. Job
--    ids of the caller's OWN jobs are returned so the client can dedupe; those
--    are rows the caller can already read.
--  * Market output is aggregate only: a cell count and a median. It never
--    names a job, a poster or a helper.
--  * Not callable from any RLS policy — the 42P17 cycle documented in
--    20260529111503 is a jobs-policy/applications-policy loop and nothing here
--    is referenced by a policy.
--
-- Replay-safe: DROP … IF EXISTS before each CREATE, no data is written, and no
-- object defined by a later migration is referenced. Applying the file three
-- times consecutively is a no-op after the first (verified on PGlite).

-- ---------------------------------------------------------------------------
-- 1. The entitlement predicate, alone and by itself, so it is greppable and
--    testable.
--
--    The tier list mirrors `TIER_PERKS[*].advancedAnalytics === true` in
--    src/lib/subscriptionTiers.ts. `src/test/advancedAnalyticsTierParity.test.ts`
--    parses this file and fails CI if the two ever disagree — the same parity
--    discipline `src/lib/helperFees.parity.test.ts` keeps over the fee ladder.
--
--    EXPIRY POLARITY: a lapsed subscription is Free. Two conventions exist in
--    this schema and they disagree about a NULL `subscription_expires_at` —
--    get_open_jobs_for_map treats NULL as expired, the Elite reliability
--    shield treats it as "no scheduled end". This follows the SHIELD, because
--    that is what `tierFeePercent()` in src/lib/subscriptionTiers.ts does and
--    what `EarningsTab.tsx` gates Instant Payout on ("a NULL expiry on a paid
--    tier means no scheduled end and counts as active"). One rule per product
--    surface; the fee the helper is charged and the perk they are shown must
--    not disagree about whether their membership is live.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.helper_has_advanced_analytics(uuid);

CREATE FUNCTION public.helper_has_advanced_analytics(p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  -- SELF-ONLY. This is SECURITY DEFINER and takes a caller-supplied id, which
  -- is the precise shape 20260825170000_guard_monthly_profile_view_count had to
  -- fix: definer + caller id + no self-check let anyone read anyone's row. The
  -- soft form (false, not RAISE) is used for the same reason that migration
  -- gives — the caller renders a not-entitled surface either way.
  --
  -- Without this guard the function is an oracle over subscription LIVENESS for
  -- any guessed uuid: get_safe_profiles publishes `subscription_tier` for
  -- approved, non-banned profiles, but nothing public exposes whether a
  -- membership is still in date, and nothing exposes the tier of a banned or
  -- unapproved profile at all.
  --
  -- get_helper_analytics calls this with auth.uid(), so the guard is a no-op on
  -- the only path that exists.
  SELECT COALESCE(
    (
      SELECT p.subscription_tier IN ('pro', 'elite')  -- advancedAnalytics tiers
         AND (p.subscription_expires_at IS NULL OR p.subscription_expires_at > now())
      FROM public.profiles p
      WHERE p.user_id = p_user_id
        AND auth.uid() IS NOT NULL
        AND auth.uid() = p_user_id
      LIMIT 1
    ),
    false
  );
$function$;

COMMENT ON FUNCTION public.helper_has_advanced_analytics(uuid) IS
  'True when this user''s live subscription includes the Advanced Analytics '
  'perk, for the CALLER only — auth.uid() must equal p_user_id, or this is '
  'false. Mirrors TIER_PERKS[*].advancedAnalytics in src/lib/subscriptionTiers.ts '
  '(pro, elite); kept in step by src/test/advancedAnalyticsTierParity.test.ts. '
  'A lapsed subscription is Free, matching tierFeePercent().';

-- Belt AND braces: the self-check above makes an `authenticated` grant
-- harmless, and the grant is withheld anyway. Nothing in src/ or
-- supabase/functions/ calls this by name; get_helper_analytics invokes it while
-- running as this function's owner, which holds EXECUTE implicitly. A perk
-- predicate is not a client API.
REVOKE ALL ON FUNCTION public.helper_has_advanced_analytics(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.helper_has_advanced_analytics(uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- 2. The payload.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.get_helper_analytics(integer);

CREATE FUNCTION public.get_helper_analytics(p_days integer DEFAULT 365)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  -- The subject is always the caller. No id parameter exists, so there is
  -- nothing to forge.
  v_uid          uuid := auth.uid();
  v_tier         text;
  v_entitled     boolean;
  -- Clamped: 30 days is the shortest window any panel can say something true
  -- about, 730 keeps the scan bounded.
  v_days         integer := LEAST(GREATEST(COALESCE(p_days, 365), 30), 730);
  v_since        timestamptz;
  -- The market window is fixed at 180 days and deliberately NOT the caller's
  -- window: "when do jobs get posted" is a property of the marketplace, not of
  -- the slider the helper happens to have dragged.
  v_market_days  constant integer := 180;
  v_market_since timestamptz;   -- := now() - v_market_days, set in the body
  v_parishes     text[];
  v_scope        text;

  -- Sample floors. Returned in the payload so the client applies the SAME
  -- numbers to the rows it aggregates itself.
  c_min_category_jobs        constant integer := 3;
  c_min_decided_apps         constant integer := 5;
  c_min_apps                 constant integer := 3;
  c_min_head_to_head         constant integer := 3;
  c_min_market_jobs          constant integer := 20;
  c_min_market_category_jobs constant integer := 5;

  v_jobs         jsonb;
  v_apps         jsonb;
  v_h2h          jsonb;
  v_demand       jsonb;
  v_rates        jsonb;
  v_market_n     integer;
  v_floors       jsonb;
BEGIN
  -- Derived from the constant the payload ADVERTISES, not from a second copy of
  -- the number. The two were separate literals for one draft, which is all it
  -- takes for the page to name a window it did not scan.
  v_market_since := now() - make_interval(days => v_market_days);

  v_floors := jsonb_build_object(
    'category_jobs',        c_min_category_jobs,
    'decided_applications', c_min_decided_apps,
    'applications',         c_min_apps,
    'head_to_head',         c_min_head_to_head,
    'market_jobs',          c_min_market_jobs,
    'market_category_jobs', c_min_market_category_jobs
  );

  IF v_uid IS NULL THEN
    -- Signed out / torn session. Deliberately the ONLY branch that omits
    -- `preview`, and the client keys off exactly that: an absent `preview`
    -- means "we could not identify you", while `preview.jobs = []` means "we
    -- looked and you have no completed jobs". Returning an empty preview here
    -- instead would have the page tell a ten-year helper they had never
    -- finished a job. Not an error, either — the route sits behind
    -- ProtectedRoute, so this is a stale-session render, not a crash.
    RETURN jsonb_build_object(
      'generated_at', now(),
      'window_days',  v_days,
      'tier',         NULL,
      'entitled',     false,
      'floors',       v_floors
    );
  END IF;

  SELECT p.subscription_tier INTO v_tier
  FROM public.profiles p WHERE p.user_id = v_uid LIMIT 1;

  v_entitled := public.helper_has_advanced_analytics(v_uid);
  v_since := now() - make_interval(days => v_days);

  -- ── The caller's completed helper jobs ───────────────────────────────────
  -- `status = 'completed'` matches what EarningsTab aggregates
  -- (Profile.tsx: `earningsJobs.filter(j => j.status === "completed")`), so
  -- the two screens count the same jobs.
  --
  -- THE GROUP-JOB ROSTER IS PART OF THAT, and it is the one place where these
  -- two surfaces used to disagree. Only ONE member is written to
  -- `jobs.helper_id`, while `release-payout` pays every row of
  -- `group_job_helpers`, so a `helper_id`-only query silently drops a paid
  -- group job from every non-lead member's earnings. `useProfileEarnings`
  -- (src/hooks/useProfileTabData.ts) was changed in the same commit to fold the
  -- roster in the same way. Both surfaces are now right, and they agree —
  -- rather than agreeing on the same omission. Zero rows in
  -- `group_job_helpers` on prod today, so the change is a no-op there and a
  -- correctness fix the first time a group job completes.
  --
  -- `completed_at` is COALESCE(helper_completed_at, created_at) — the exact
  -- fallback EarningsBreakdownCharts.tsx already uses to place a job on a
  -- month axis. `poster_completed_at` would arguably be a better second
  -- choice, but agreeing with the chart that already ships beats being
  -- marginally more correct and disagreeing with it.
  WITH mine AS (
    SELECT
      j.id,
      j.category::text                                   AS category,
      COALESCE(j.parish, z.parish)                       AS parish,
      COALESCE(j.helper_completed_at, j.created_at)      AS completed_at,
      j.budget,
      j.helper_fee_percent,
      j.platform_fee_amount,
      j.payment_status,
      j.is_group_job,
      j.helpers_needed,
      j.urgent_fee
    FROM public.jobs j
    LEFT JOIN public.louisiana_zip_parishes z ON z.zip_code = LEFT(REGEXP_REPLACE(COALESCE(j.zip_code, ''), '[^0-9]', '', 'g'), 5)
    WHERE j.status = 'completed'
      AND (
        j.helper_id = v_uid
        OR EXISTS (
          SELECT 1 FROM public.group_job_helpers g
          WHERE g.job_id = j.id AND g.helper_id = v_uid
        )
      )
      AND COALESCE(j.helper_completed_at, j.created_at) >= v_since
  )
  SELECT COALESCE(jsonb_agg(to_jsonb(m) ORDER BY m.completed_at DESC), '[]'::jsonb)
  INTO v_jobs
  FROM mine m;

  -- ── NOT ENTITLED ─────────────────────────────────────────────────────────
  -- Return early with a PREVIEW, not a broken dashboard.
  --
  -- The preview carries only the money fields of the caller's own completed
  -- jobs — the identical rows the Earnings tab already hands them for free —
  -- so the upgrade screen can say "you paid $X in platform fees last year; at
  -- the Pro rate those same jobs cost $Y" with a real number instead of a
  -- brochure. Category, parish, dates, the application funnel and every market
  -- aggregate stay behind the gate.
  IF NOT v_entitled THEN
    RETURN jsonb_build_object(
      'generated_at', now(),
      'window_days',  v_days,
      'tier',         v_tier,
      'entitled',     false,
      'floors',       v_floors,
      'preview',      jsonb_build_object(
        'jobs', (
          SELECT COALESCE(jsonb_agg(jsonb_build_object(
            'budget',              e->'budget',
            'helper_fee_percent',  e->'helper_fee_percent',
            'platform_fee_amount', e->'platform_fee_amount',
            'payment_status',      e->'payment_status',
            'is_group_job',        e->'is_group_job',
            'helpers_needed',      e->'helpers_needed',
            'urgent_fee',          e->'urgent_fee'
          )), '[]'::jsonb)
          FROM jsonb_array_elements(v_jobs) AS e
        )
      )
    );
  END IF;

  -- ── The caller's applications ────────────────────────────────────────────
  -- `minutes_to_apply` is the helper's own clock: how long after the job was
  -- posted they got their application in.
  WITH my_apps AS (
    SELECT
      a.id,
      a.created_at AS applied_at,
      j.id         AS job_id,
      j.status     AS job_status,
      j.helper_id  AS job_helper_id,
      j.category::text AS category,
      COALESCE(j.parish, z.parish) AS parish,
      a.status::text AS app_status,
      ROUND(EXTRACT(EPOCH FROM (a.created_at - j.created_at)) / 60.0)::integer AS minutes_to_apply
    FROM public.applications a
    JOIN public.jobs j ON j.id = a.job_id
    LEFT JOIN public.louisiana_zip_parishes z ON z.zip_code = LEFT(REGEXP_REPLACE(COALESCE(j.zip_code, ''), '[^0-9]', '', 'g'), 5)
    WHERE a.helper_id = v_uid
      AND a.created_at >= v_since
  ),
  classified AS (
    SELECT
      m.*,
      CASE
        WHEN m.app_status = 'accepted' THEN 'won'
        WHEN m.app_status = 'rejected' THEN 'lost'
        -- Still pending, but the job moved on without them. `pending_approval`
        -- and `open` are undecided; `cancelled` is nobody's loss.
        WHEN m.job_status IN ('accepted', 'in_progress', 'completed', 'revision_requested', 'disputed')
             AND m.job_helper_id IS DISTINCT FROM v_uid
             AND NOT EXISTS (
               SELECT 1 FROM public.group_job_helpers g
               WHERE g.job_id = m.job_id AND g.helper_id = v_uid
             )
          THEN 'lost'
        ELSE 'undecided'
      END AS outcome
    FROM my_apps m
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id',               c.id,
    'applied_at',       c.applied_at,
    'minutes_to_apply', c.minutes_to_apply,
    'outcome',          c.outcome,
    'category',         c.category,
    'parish',           c.parish
  ) ORDER BY c.applied_at DESC), '[]'::jsonb)
  INTO v_apps
  FROM classified c;

  -- ── Speed vs. the applicant who actually won ─────────────────────────────
  -- Only jobs the caller applied to where SOMEBODY ELSE was accepted. Jobs the
  -- caller won are excluded on purpose: including them would put the caller on
  -- both sides of the comparison and flatter the result.
  WITH contested AS (
    SELECT
      j.id AS job_id,
      MIN(EXTRACT(EPOCH FROM (mine.created_at - j.created_at)) / 60.0) AS mine_min,
      MIN(EXTRACT(EPOCH FROM (won.created_at  - j.created_at)) / 60.0) AS won_min
    FROM public.applications mine
    JOIN public.jobs j ON j.id = mine.job_id
    JOIN public.applications won
      ON won.job_id = j.id AND won.status = 'accepted' AND won.helper_id <> v_uid
    WHERE mine.helper_id = v_uid
      AND mine.status <> 'accepted'
      AND mine.created_at >= v_since
    GROUP BY j.id
  )
  SELECT jsonb_build_object(
    'sample', COUNT(*)::integer,
    -- How many of those jobs the caller actually applied to FIRST. The medians
    -- alone cannot answer that — a lower median is compatible with being last
    -- on half the set — and the first draft of the UI turned "my median is
    -- lower" into "you got in first on those", which is a different claim.
    'you_were_first', COUNT(*) FILTER (WHERE mine_min < won_min)::integer,
    'your_median_minutes',
      CASE WHEN COUNT(*) >= c_min_head_to_head
        THEN ROUND(percentile_cont(0.5) WITHIN GROUP (ORDER BY mine_min)::numeric) END,
    'winner_median_minutes',
      CASE WHEN COUNT(*) >= c_min_head_to_head
        THEN ROUND(percentile_cont(0.5) WITHIN GROUP (ORDER BY won_min)::numeric) END
  )
  INTO v_h2h
  FROM contested;

  -- ── Market scope ─────────────────────────────────────────────────────────
  -- Mirrors the `viewer_parishes` ladder in get_ranked_open_jobs
  -- (20260506020000_get_ranked_open_jobs_fallback_to_profile_parish), then adds
  -- one more rung: the parishes the caller has actually worked in. That third
  -- rung matters because `helper_preferred_parishes` has ZERO rows in prod —
  -- it has no UI that writes it — so keying scope off it alone would put every
  -- helper on the statewide fallback.
  -- ORDERED. scopeLabel() renders parishes[0] as the headline parish, and an
  -- unordered array_agg let "Jobs posted in Lafayette + 3 more" become
  -- "...in Orleans + 3 more" between two loads of the same page.
  SELECT COALESCE(array_agg(DISTINCT parish ORDER BY parish) FILTER (WHERE parish IS NOT NULL), '{}')
  INTO v_parishes
  FROM (
    SELECT hpp.parish
    FROM public.helper_preferred_parishes hpp
    WHERE hpp.helper_id = v_uid
    UNION
    SELECT p.parish
    FROM public.profiles p
    WHERE p.user_id = v_uid AND p.parish IS NOT NULL
    UNION
    SELECT COALESCE(j.parish, z.parish)
    FROM public.jobs j
    LEFT JOIN public.louisiana_zip_parishes z ON z.zip_code = LEFT(REGEXP_REPLACE(COALESCE(j.zip_code, ''), '[^0-9]', '', 'g'), 5)
    WHERE j.helper_id = v_uid
  ) s;

  v_scope := CASE WHEN COALESCE(array_length(v_parishes, 1), 0) > 0
                  THEN 'parish' ELSE 'statewide' END;

  -- ── The market population ────────────────────────────────────────────────
  -- Everyone else's real, human-posted demand.
  --   is_seed          — 59 of 64 prod rows; a clock drawn from those is a
  --                      picture of the seed script, not of the market.
  --   is_auto_created  — recurring clones are stamped by the cron that made
  --                      them, not by a person deciding to post at 7pm.
  --   customer_id      — the caller's own postings are not demand FOR them.
  WITH market AS (
    SELECT
      j.id,
      j.category::text AS category,
      j.budget,
      COALESCE(j.parish, z.parish) AS parish,
      (j.created_at AT TIME ZONE 'America/Chicago') AS posted_local
    FROM public.jobs j
    LEFT JOIN public.louisiana_zip_parishes z ON z.zip_code = LEFT(REGEXP_REPLACE(COALESCE(j.zip_code, ''), '[^0-9]', '', 'g'), 5)
    WHERE j.created_at >= v_market_since
      AND j.is_seed IS NOT TRUE
      AND j.is_auto_created IS NOT TRUE
      AND j.customer_id <> v_uid
  ),
  scoped AS (
    SELECT * FROM market
    WHERE v_scope = 'statewide' OR parish = ANY(v_parishes)
  )
  SELECT
    COUNT(*)::integer,
    -- The clock. Day-of-week 0=Sunday, six 4-hour blocks. Emitted only above
    -- the floor: a heatmap off nine jobs is a Rorschach test.
    CASE WHEN COUNT(*) >= c_min_market_jobs THEN (
      SELECT COALESCE(jsonb_agg(jsonb_build_object('dow', d.dow, 'block', d.block, 'jobs', d.n)
                                ORDER BY d.dow, d.block), '[]'::jsonb)
      FROM (
        SELECT EXTRACT(DOW FROM posted_local)::integer AS dow,
               (EXTRACT(HOUR FROM posted_local)::integer / 4) AS block,
               COUNT(*)::integer AS n
        FROM scoped
        GROUP BY 1, 2
      ) d
    ) END,
    -- Median posted budget per category, each with its own floor.
    (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
               'category', r.category, 'jobs', r.n, 'median_budget', r.median_budget)
               ORDER BY r.n DESC, r.category), '[]'::jsonb)
      FROM (
        SELECT category,
               COUNT(*)::integer AS n,
               CASE WHEN COUNT(*) >= c_min_market_category_jobs
                 THEN ROUND(percentile_cont(0.5) WITHIN GROUP (ORDER BY budget)::numeric, 2) END
                 AS median_budget
        FROM scoped
        WHERE budget IS NOT NULL
        GROUP BY category
      ) r
    )
  INTO v_market_n, v_demand, v_rates
  FROM scoped;

  RETURN jsonb_build_object(
    'generated_at',  now(),
    'window_days',   v_days,
    'tier',          v_tier,
    'entitled',      true,
    'floors',        v_floors,
    'jobs',          v_jobs,
    'applications',  v_apps,
    'head_to_head',  v_h2h,
    'market',        jsonb_build_object(
      'scope',       v_scope,
      'parishes',    to_jsonb(v_parishes),
      'window_days', v_market_days,
      'sample',      COALESCE(v_market_n, 0),
      'demand',      v_demand,          -- NULL below the floor, never a grid of zeros
      'rates',       COALESCE(v_rates, '[]'::jsonb)
    )
  );
END;
$function$;

COMMENT ON FUNCTION public.get_helper_analytics(integer) IS
  'Advanced Analytics for the CALLER (auth.uid() — there is no user-id '
  'parameter to forge). Returns entitled:false plus a fee-comparison preview '
  'for tiers without TIER_PERKS.advancedAnalytics, so the paid perk is gated '
  'in SQL rather than in the client. Returns per-job FACTS, not dollars: the '
  'take-home arithmetic stays in src/lib/helperEarnings.ts so Analytics and '
  'the Earnings tab cannot drift. Rates below their sample floor are absent, '
  'never 0. Market aggregates exclude seeded, auto-created and own-posted '
  'jobs, and name no job, poster or helper.';

REVOKE ALL ON FUNCTION public.get_helper_analytics(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_helper_analytics(integer)
  TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. Indexes the two hot scans need.
--    Both are IF NOT EXISTS and neither is referenced by a later migration.
-- ---------------------------------------------------------------------------
-- The market scan is `created_at >= …` over live (non-seed) rows.
CREATE INDEX IF NOT EXISTS jobs_created_at_market_idx
  ON public.jobs (created_at DESC)
  WHERE is_seed IS NOT TRUE;

-- The caller's own completed history. Indexed on the EXPRESSION the query
-- filters by — `COALESCE(helper_completed_at, created_at) >= v_since` is not
-- sargable against a bare `helper_completed_at` column, so a plain composite
-- would have served the equality and then scanned. Both inputs are timestamptz
-- columns, so the COALESCE is immutable and indexable.
CREATE INDEX IF NOT EXISTS jobs_helper_completed_idx
  ON public.jobs (helper_id, (COALESCE(helper_completed_at, created_at)) DESC)
  WHERE status = 'completed';
