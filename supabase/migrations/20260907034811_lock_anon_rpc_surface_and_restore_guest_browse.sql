-- Lock the anonymous RPC surface, and repair the guest-browse 401 that the
-- credential-tier gate introduced on 2026-09-04.
--
-- Four separate things, all verified against PROD (fncmgoasalhdgfwzhsqa) before
-- being written — never from a migration file.
--
--   1. Guest browse is returning HTTP 401 in production RIGHT NOW.
--   2. 22 SECURITY DEFINER functions are EXECUTE-able by `anon` with no
--      unauthenticated call site. Four move money or cancel a booking.
--   3. Three functions carry a mutable search_path.
--   4. Nine tables carry client write grants that RLS already denies outright.
--
-- Nothing here changes `open_jobs_browse`'s security posture — see §5 for why
-- `security_invoker = false` is deliberate and stays.
--
-- ═════════════════════════════════════════════════════════════════════════
-- §1  GUEST BROWSE IS 401 — a function ACL leaking through a definer view
-- ═════════════════════════════════════════════════════════════════════════
--
-- Reproduced over real HTTP with the anon key:
--
--   GET /rest/v1/open_jobs_browse?select=id,title&limit=2
--   → HTTP 401
--     {"code":"42501",
--      "message":"permission denied for function get_user_credential_tier"}
--
-- Cause: 20260904203654_browse_hides_jobs_above_helper_credential_tier.sql put
-- `get_user_credential_tier(auth.uid())` into the body of `open_jobs_browse`.
--
-- THE TRAP: `security_invoker = false` delegates TABLE permissions to the view
-- owner. It does NOT delegate FUNCTION permissions. Postgres checks EXECUTE
-- against the *calling* role, in `init_fcache()` at expression-initialisation
-- time — so it fires even though the offending call sits behind two short-
-- circuiting OR branches that are false for a guest. `get_user_credential_tier`
-- is granted to authenticated and service_role but never to anon (`proacl`
-- confirms), so every anonymous read of the view dies before a row is scanned.
--
-- Why nobody noticed: the *other* three objects that migration touched are
-- SECURITY DEFINER FUNCTIONS, whose nested call is checked as postgres. So
-- `POST /rest/v1/rpc/get_ranked_open_jobs` returns HTTP 200 for anon and the
-- feed looks healthy. Only the VIEW breaks, and only for guests.
--
-- Blast radius: `/browse` (`src/pages/DashboardGuest.tsx:204`) is the one
-- unauthenticated route that reads this view; `/jobs/:id` reads it too but sits
-- behind `ProtectedRoute`, so authed users — who DO hold EXECUTE — are fine.
--
-- This is the same failure mode 20260529115941_restore_anon_browse_jobs_access
-- was written to fix, arriving through a new door.
--
-- THE FIX, and why it is not "GRANT EXECUTE TO anon":
-- `get_user_credential_tier(p_user_id uuid)` takes an ARBITRARY uuid. Granting
-- anon EXECUTE would hand an anonymous caller a primitive to read any user's
-- licence / insurance / identity-verification standing — and `open_jobs_browse`
-- hands out `customer_id`, so the uuids to feed it are free. That is the exact
-- exposure the rest of this migration exists to remove.
--
-- Instead: a no-argument wrapper that reads `auth.uid()` itself. A guest's uid
-- is NULL, the wrapper returns 0, and the tier gate still FAILS CLOSED — a
-- signed-out visitor sees only tier-0 jobs, which is the behaviour
-- 20260904203654 intended. anon gains no way to ask about anybody else.

CREATE OR REPLACE FUNCTION public.my_credential_tier()
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
SET "TimeZone" TO 'America/Chicago'
AS $function$
  -- Deliberately no parameter: the caller cannot ask about anyone but itself.
  -- NULL uid (guest) → get_user_credential_tier returns 0 → gate fails closed.
  SELECT COALESCE(public.get_user_credential_tier(auth.uid()), 0);
$function$;

-- House rule (CLAUDE.md): `REVOKE ... FROM PUBLIC` does NOT revoke anon.
-- Supabase's ALTER DEFAULT PRIVILEGES grants each role individually, so the
-- roles must be named. Strip the default grants, then re-grant deliberately.
REVOKE ALL ON FUNCTION public.my_credential_tier() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.my_credential_tier() TO anon, authenticated;

COMMENT ON FUNCTION public.my_credential_tier() IS
  'Viewer''s own credential tier (0-3), for use inside open_jobs_browse. '
  'Exists so anon can be granted EXECUTE without also being granted the '
  'arbitrary-uuid form get_user_credential_tier(uuid), which would let an '
  'anonymous caller enumerate any helper''s licence/insurance/identity status '
  'from the customer_id values the browse view already exposes. '
  'Added 20260907034811 to repair a guest-browse HTTP 401.';

-- Repoint the view. CREATE OR REPLACE VIEW preserves the ACL
-- (anon=rm, authenticated=rm). Column list, order, types, and every WHERE
-- predicate are byte-identical to the deployed definition except the one
-- function call in the tier gate.
--
-- It does NOT preserve reloptions — caught by the PGlite run, which reported
-- `reloptions = (none)` afterwards. Behaviour survives (Postgres defaults
-- security_invoker to false), but the EXPLICIT marker that 20260529115941 set
-- on purpose would be silently dropped, and that marker is the defence against
-- the Supabase-advisor strip which caused that outage in the first place. So it
-- is re-asserted below rather than assumed.
DO $$
BEGIN
  IF to_regclass('public.open_jobs_browse') IS NOT NULL
     AND to_regprocedure('public.my_credential_tier()') IS NOT NULL THEN

    CREATE OR REPLACE VIEW public.open_jobs_browse AS
      SELECT
        id,
        title,
        description,
        category,
        budget,
        date_needed,
        CASE
          WHEN offered_to_helper_id = auth.uid() AND direct_offer_status = 'pending'::text
            THEN location
          ELSE mask_job_location(location)
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
        (SELECT count(*)::integer FROM applications a WHERE a.job_id = jobs.id)
          AS applicant_count,
        pricing_mode,
        round(latitude, 2)  AS latitude,
        round(longitude, 2) AS longitude,
        parish,
        credential_tier
      FROM jobs
      WHERE status = 'open'::job_status
        AND customer_id IS NOT NULL
        AND payment_status = ANY (ARRAY['escrow'::text, 'payout_pending'::text, 'released'::text])
        AND (
          offered_to_helper_id IS NULL
          OR direct_offer_status = ANY (ARRAY['declined'::text, 'expired'::text])
          OR offered_to_helper_id = auth.uid()
        )
        AND (
          created_at <= early_access_cutoff()
          OR customer_id = auth.uid()
          OR offered_to_helper_id = auth.uid()
        )
        -- SCHEMA-QUALIFIED, deliberately. This is the launch switch that hides
        -- fixture jobs, and showSeedJobs.parity.test.ts asserts the LATEST
        -- definition of every gated surface calls
        -- `public.seed_jobs_hidden_publicly()` by that exact name. An
        -- unqualified call is also weaker on its own terms: the view is
        -- `security_invoker = false`, so an unqualified name resolves through
        -- the view owner's search_path rather than a fixed one.
        AND (NOT is_seed OR NOT public.seed_jobs_hidden_publicly())
        AND (
          COALESCE(credential_tier, 0) = 0
          OR customer_id = auth.uid()
          -- was: COALESCE((SELECT public.get_user_credential_tier(auth.uid())), 0)
          -- Kept as a scalar subquery so it stays an InitPlan evaluated once per
          -- statement, not once per row (the perf note in 20260904203654).
          OR COALESCE((SELECT public.my_credential_tier()), 0) >= credential_tier
        );

    -- Re-assert explicitly: CREATE OR REPLACE VIEW clears reloptions, and
    -- an absent setting reads identically to a flipped one in every advisor
    -- report. Idempotent, and a no-op when it already matches.
    ALTER VIEW public.open_jobs_browse SET (security_invoker = false);

  END IF;
END $$;

-- ═════════════════════════════════════════════════════════════════════════
-- §2  REVOKE anon EXECUTE where no unauthenticated caller exists
-- ═════════════════════════════════════════════════════════════════════════
--
-- Supabase's linter flags 57 SECURITY DEFINER functions as anon-executable.
-- That count is misleading: 16 of them RETURN trigger, and Postgres refuses a
-- direct call outright. Proven against prod as role anon:
--
--   SET LOCAL ROLE anon; SELECT public.enforce_ban_gate();
--   → 0A000  "trigger functions can only be called as triggers"
--
-- PostgREST does not expose them either. They are noise, not exposure, and are
-- left alone rather than churned. Of the ~42 callable ones, each was classified
-- by grepping its real call site and checking whether that route sits behind
-- `ProtectedRoute`. The 22 below have NO unauthenticated call site.
--
-- Most would currently fail internally on a NULL auth.uid(). That is defence by
-- accident, not by design — it breaks the moment a code path tolerates a null
-- uid. These make the denial structural.
--
-- Every REVOKE names PUBLIC *and* anon: revoking PUBLIC alone drops only the
-- implicit world grant and leaves Supabase's explicit `anon=X` untouched, which
-- reads as least privilege in review while achieving nothing (CLAUDE.md).
-- `authenticated` and `service_role` keep EXECUTE throughout — these are all
-- functions real signed-in users and edge functions call.

DO $$
DECLARE
  -- Money / booking mutation. A guest has no business calling any of these.
  --   apply_to_job          ← src/pages/dashboard/useApplyFlow.ts      (authed)
  --   poster_cancel_job     ← src/components/CancellationDialog.tsx    (authed)
  --   helper_cancel_booking ← .../appliedJobCard/ConfirmedSection.tsx  (authed)
  --   rpc_withdraw_dispute  ← .../postedJobCard/PostedJobActions.tsx   (authed)
  --
  -- People enumeration. Both return name/avatar/profile rows in bulk.
  --   search_profiles_by_name   ← .../payItForward/RecipientPicker.tsx (authed)
  --   get_top_helpers_by_parish ← NO call site at all; returns user_id,
  --                               full_name, avatar_url, bio, location, parish,
  --                               skills, subscription_tier — a scrapeable
  --                               directory of people, open to the internet.
  --
  -- Admin-only surfaces.
  --   get_pending_credentials  ← src/components/admin/AdminCredentialQueue.tsx
  --   get_payout_batch_job_ids ← src/components/admin/AdminPayoutBatches.tsx
  --   get_fill_rate_stats      ← src/components/admin/adminHealth/useFillRate.ts
  --
  -- "My" functions — meaningless without a session by definition.
  --   get_my_saved_helpers, get_my_reply_latency, get_muted_threads,
  --   get_monthly_profile_view_count (no call site), rpc_check_application_rate
  --
  -- WRITES reachable from protected routes only.
  --   record_profile_view ← /user/:userId  (ProtectedRoute, src/App.tsx:181)
  --   record_job_view     ← .../jobDetailDialog/useJobDetailData.ts (authed)
  --
  -- Poster-side applicant intelligence — leaks helper distances, on-time rates
  -- and hire history. All from /activity, which is authed.
  --   get_helper_completed_counts, get_helper_on_time_percents,
  --   get_helper_repeat_hire_percents, get_helper_distances_from_job,
  --   get_neighbor_hire_count, get_job_view_counts
  --
  -- Behind ProtectedRoute despite "public" in the name. /user/:userId and
  -- /post-job are both protected (src/App.tsx:181, :177). If public profiles
  -- ever become guest-viewable, these three come back together.
  --   get_public_profile_reviews, get_user_repeat_hire_percent,
  --   get_category_price_stats
  targets text[] := ARRAY[
    'public.apply_to_job(uuid,text)',
    'public.poster_cancel_job(uuid,text)',
    'public.helper_cancel_booking(uuid)',
    'public.rpc_withdraw_dispute(uuid)',
    'public.search_profiles_by_name(text)',
    'public.get_top_helpers_by_parish(text,integer)',
    'public.get_pending_credentials()',
    'public.get_payout_batch_job_ids(uuid)',
    'public.get_fill_rate_stats(integer)',
    'public.get_my_saved_helpers()',
    'public.get_my_reply_latency()',
    'public.get_muted_threads(jsonb)',
    'public.get_monthly_profile_view_count(uuid)',
    'public.rpc_check_application_rate(uuid)',
    'public.record_profile_view(uuid)',
    'public.record_job_view(uuid)',
    'public.get_helper_completed_counts(uuid[])',
    'public.get_helper_on_time_percents(uuid[])',
    'public.get_helper_repeat_hire_percents(uuid[])',
    'public.get_helper_distances_from_job(uuid,uuid[])',
    'public.get_neighbor_hire_count(uuid,numeric,numeric,numeric)',
    'public.get_job_view_counts(uuid[])',
    'public.get_public_profile_reviews(uuid,integer,integer)',
    'public.get_user_repeat_hire_percent(uuid)',
    'public.get_category_price_stats(text,text)'
  ];
  t text;
BEGIN
  FOREACH t IN ARRAY targets LOOP
    -- Replay-safe: a signature a later migration renames or drops is skipped.
    IF to_regprocedure(t) IS NOT NULL THEN
      EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon', t);
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role', t);
    END IF;
  END LOOP;
END $$;

-- ── KEPT anon-executable, deliberately ──────────────────────────────────
--
-- Genuinely pre-auth, with a guest call site proven in the client:
--   get_parish_for_zip        signup form (granted on purpose, 20260907013936)
--   get_public_platform_settings  read at BOOT by src/lib/minSupportedBuild.ts
--                             and src/lib/featureFlags.ts, before any session
--   get_ranked_open_jobs      /jobs — not behind ProtectedRoute (App.tsx:269)
--   get_open_jobs_for_map     BrowseMap, rendered by DashboardGuest.tsx:549
--   get_public_open_jobs      landing social proof + instant-job-match edge fn
--   get_safe_profiles         DashboardGuest.tsx — guest job cards
--   early_access_cutoff       DashboardGuest.tsx, useOpenJobsFeed.ts
--   seed_jobs_hidden_publicly the launch seed switch, read on guest surfaces
--   get_public_profile_stats  companion to get_safe_profiles on guest cards
--   mask_job_location         called inside open_jobs_browse for every guest
--
-- Aggregate marketing stats — no PII, no per-person row, intended for the
-- signed-out landing page. Currently UNCALLED (dead code worth a separate
-- look), but revoking would plant a 401 for whoever rewires the landing page:
--   get_platform_impact_stats, get_platform_benchmarks,
--   get_marketplace_activity_count, get_recent_public_payouts
--   (the last returns display_name + city only — a deliberate public ticker)
--
-- The 16 trigger-returning functions: uncallable by construction, see above.

-- ═════════════════════════════════════════════════════════════════════════
-- §3  Pin the three mutable search_paths
-- ═════════════════════════════════════════════════════════════════════════
--
-- None of the three is SECURITY DEFINER, so this is hardening rather than a
-- live escalation path — but an unpinned search_path is one `SECURITY DEFINER`
-- edit away from being one, and the fix is free.
--
-- Their real shapes, confirmed on prod (the brief called all three "functions"
-- and they are not alike):
--   set_profile_view_hour_bucket()  RETURNS trigger  — anon-executable, but
--                                   uncallable directly (trigger-only).
--   redact_audit_snapshot(jsonb)    RETURNS jsonb    — a genuinely callable
--                                   helper, anon-executable. Harmless: it is a
--                                   pure transform of caller-supplied jsonb and
--                                   reads no table, so the grant stays.
--   profiles_locked_update_columns() RETURNS text[]  — not granted to anon or
--                                   authenticated at all.
--
-- NOTE the argument list on redact_audit_snapshot. Written as `()` this whole
-- block resolves to NULL and skips in silence — a no-op that reads as done in
-- review, the same failure family as REVOKE ... FROM PUBLIC. Every signature
-- here was resolved through to_regprocedure against prod before being written.

DO $$
BEGIN
  IF to_regprocedure('public.set_profile_view_hour_bucket()') IS NOT NULL THEN
    ALTER FUNCTION public.set_profile_view_hour_bucket() SET search_path TO 'public';
  END IF;
  IF to_regprocedure('public.redact_audit_snapshot(jsonb)') IS NOT NULL THEN
    ALTER FUNCTION public.redact_audit_snapshot(jsonb) SET search_path TO 'public';
  END IF;
  IF to_regprocedure('public.profiles_locked_update_columns()') IS NOT NULL THEN
    ALTER FUNCTION public.profiles_locked_update_columns() SET search_path TO 'public';
  END IF;
END $$;

-- ═════════════════════════════════════════════════════════════════════════
-- §4  Drop client write grants that RLS already denies
-- ═════════════════════════════════════════════════════════════════════════
--
-- CONTEXT THAT MATTERS, because it reframes the finding this came from:
-- `louisiana_zip_parishes` having `anon=arwdxm` is NOT a bespoke hole. It is
-- Supabase's stock posture — ALTER DEFAULT PRIVILEGES hands anon and
-- authenticated full DML on EVERY new public table. Measured on prod: 71 of
-- them look exactly like this. RLS is the only thing standing in front, by
-- design, and a table-by-table revoke across all 71 would be a large,
-- risky, low-yield change.
--
-- So this narrows to the cases where the revoke is PROVABLY behaviour-
-- preserving: tables with RLS enabled and ZERO INSERT/UPDATE/DELETE/ALL
-- policies. No anon or authenticated write can succeed on them today, so
-- removing the grant cannot break a working path — it only converts "one
-- careless policy away from a hole" into "structurally impossible".
--
-- service_role is untouched, so every edge function keeps working, and
-- SECURITY DEFINER functions run as postgres and bypass both layers.

DO $$
DECLARE
  t text;
  -- Verified on prod: RLS on, and zero non-SELECT policies on each.
  tables text[] := ARRAY[
    'application_rate_log',       -- apply rate limiting, written by a definer fn
    'helper_verifications',
    'instant_payouts',            -- money; service_role only
    'notification_type_pref_map', -- static reference map
    'pif_credits',                -- money; service_role only
    'profile_search_rate_log',
    'referrals',
    'str_processed_events',
    'verification_checks'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    IF to_regclass('public.'||t) IS NOT NULL THEN
      EXECUTE format(
        'REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.%I FROM anon, authenticated',
        t);
    END IF;
  END LOOP;
END $$;

-- `louisiana_zip_parishes` is handled separately and asymmetrically. Its only
-- write policy is "Admins can manage zip parishes" with roles=authenticated, so
-- revoking from authenticated would lock admins out of zip management — the
-- grant wall fires before the policy's admin branch is ever evaluated.
-- anon has no such path: revoke anon only.
--
-- Why it is worth doing at all: `parish` feeds get_ranked_open_jobs ranking and
-- the helper notification fan-out, so a poisoned row degrades the feed for
-- every user. RLS denial is already proven, but this is a reference table with
-- no legitimate anonymous write under any future policy.
DO $$
BEGIN
  IF to_regclass('public.louisiana_zip_parishes') IS NOT NULL THEN
    REVOKE INSERT, UPDATE, DELETE, TRUNCATE
      ON TABLE public.louisiana_zip_parishes FROM anon;
  END IF;
END $$;

-- ═════════════════════════════════════════════════════════════════════════
-- §5  open_jobs_browse stays SECURITY DEFINER — record why
-- ═════════════════════════════════════════════════════════════════════════
--
-- Supabase's linter raises this view as an ERROR ("SECURITY DEFINER view").
-- The mechanism it describes is real; the risk conclusion is wrong here, and
-- "fixing" it takes production down. Verified against prod:
--
--   • anon holds NO SELECT grant on public.jobs at all (`anon=awdxm` — note
--     the absent `r`). With security_invoker = true, a guest read is a flat
--     42501, not an empty result.
--   • Every SELECT policy on `jobs` is roles=authenticated and scoped to
--     own / assigned / direct-offer / admin. There is NO "anyone may see open
--     jobs" policy. So invoker mode would also collapse the feed for signed-in
--     users to their own jobs.
--   • This exact flip was already made and already reverted, with the 42501
--     captured in the file: 20260529115941_restore_anon_browse_jobs_access.sql.
--
-- The view IS the public-browse authorization boundary, and it is a tighter
-- one than a table policy would be: it filters to open + escrow-funded +
-- owned + non-seed + early-access-eligible + credential-eligible, masks the
-- street address, and rounds coordinates to 2dp (~1.1km). Its own ACL is
-- SELECT-only for anon and authenticated (`anon=rm`), so it grants no write
-- path. Definer here is the mechanism that lets it be strict.
DO $$
BEGIN
  IF to_regclass('public.open_jobs_browse') IS NOT NULL THEN
    COMMENT ON VIEW public.open_jobs_browse IS
      'PUBLIC BROWSE BOUNDARY. Intentionally security_invoker = false — do NOT '
      '"fix" the Supabase linter ERROR on this view. anon holds no SELECT grant '
      'on public.jobs and jobs has no anon SELECT policy, so invoker mode is a '
      '42501 for guests and collapses the feed to own-jobs for authed users. '
      'Flipped and reverted once already (20260529115941). The view supplies the '
      'authorization itself: open + escrow-funded + owned + non-seed + '
      'early-access + credential-tier eligible, address masked, lat/lng rounded '
      'to 2dp. Its ACL is SELECT-only (anon=rm). Note also that a definer view '
      'delegates TABLE permissions but NOT FUNCTION EXECUTE — any function added '
      'to this body must be granted to anon, or guest browse 401s '
      '(see 20260907034811).';
  END IF;
END $$;
