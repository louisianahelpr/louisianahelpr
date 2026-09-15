-- jobs.offered_to_helper_id is readable by the POSTER and the OFFERED Helpr
-- only.
--
-- OWNER DECISION 2026-09-14 (docs/OPEN.md "hide jobs.offered_to_helper_id from
-- non-posters", and the lh-authz-rls OWNER QUESTION beside it): a direct offer
-- is the poster's private approach to one Helpr. Nobody else on the job may
-- learn who that is: not the hired Helpr, not a group roster member, not an
-- applicant, not a stranger browsing.
--
-- WHAT LEAKED, path by path (latest definitions replayed from the migrations):
--
--   1. The jobs table itself. authenticated holds a TABLE-level SELECT grant,
--      and RLS is row-level: whoever a SELECT policy lets see the row sees
--      every column. "Selected helpers can view their job"
--      (user_may_see_job_address: poster, hired Helpr, live offeree, roster
--      member, accepted applicant) and "Users can view their own jobs"
--      (poster, hired Helpr) therefore hand offered_to_helper_id to the hired
--      Helpr, every roster member and an accepted applicant. A declined or
--      expired offer never clears the column (20260904031002), so a Helpr hired
--      after a declined offer reads who was asked first.
--   2. get_jobs_for_my_applications() (SECURITY DEFINER, SETOF jobs): every
--      job I APPLIED to that is open, or that I am hired / on the roster for,
--      comes back as a whole jobs row, the column included. Any applicant on an
--      open job read the offeree.
--   3. open_jobs_browse (definer view, SELECT to anon + authenticated) projects
--      the raw column, and shows a job whose offer was declined or expired to
--      the whole pool. Every signed-out visitor and every signed-in browser
--      read the id of the Helpr who turned the job down.
--   4. src/pages/messages/messagesData/loadConversations.ts selected the
--      column by name for every job in the inbox (rides on path 1).
--
-- WHAT DOES NOT LEAK (checked, left alone): get_my_pending_direct_offers()
-- returns only rows WHERE offered_to_helper_id = auth.uid(), so the value is
-- always the caller's own id. The browse RPCs (get_public_open_jobs,
-- get_ranked_open_jobs, get_open_jobs_for_map) filter on the column but do
-- not return it. Every other SECURITY DEFINER reader returns a boolean or a
-- timestamp. Realtime postgres_changes drops a column the subscriber's role
-- cannot SELECT (realtime.apply_rls is_selectable), so it follows path 1.
--
-- THE FIX:
--
--   A. Column privilege. `REVOKE SELECT (col)` is a NO-OP while a table-level
--      grant exists (20260818070000 shipped exactly that and changed nothing;
--      see 20260901011254). The only construct that works is to drop the
--      table-level SELECT and re-grant the complement column by column. The
--      complement is DERIVED from the catalog by sync_jobs_select_grants(),
--      never hand-typed, so nothing is missed today. A column added by a LATER
--      migration comes up with no SELECT for authenticated, so such a
--      migration must call `SELECT public.sync_jobs_select_grants();`
--      (src/test/offeredHelperPrivacy.test.ts fails CI when it does not).
--      service_role, postgres and every SECURITY DEFINER function are
--      untouched: they read the column exactly as before. RLS policy
--      expressions that test the column ("Targeted helper can view direct
--      offer" and the rest) keep working: policy quals are not subject to
--      the querying role's column privileges.
--   B. get_job_offer_targets(p_job_ids uuid[] DEFAULT NULL): the accessor. It
--      returns (job_id, offered_to_helper_id) only for jobs where the caller
--      IS the poster or IS the offeree. The poster's Activity screen and the
--      Messages loader read the column through it.
--   C. get_jobs_for_my_applications(): body verbatim from 20260908020801 plus
--      one override, offered_to_helper_id is NULL unless the caller is the
--      poster or the offeree.
--   D. open_jobs_browse: body verbatim from 20260912021641 with the
--      offered_to_helper_id projection CASE-nulled the same way. Row
--      visibility (the WHERE) is unchanged; so are the grants.
--
-- CLIENT IMPACT: a `select("*")` on jobs expands to every column and is now a
-- 42501 for authenticated. Every src/ caller names its columns (the shared
-- JOB_READABLE_COLUMNS list in src/lib/jobColumns.ts), and the class test
-- rejects any new `*` read of jobs.
--
-- Replay-safe: CREATE OR REPLACE, grants re-derived idempotently, and each
-- block is skipped (NOTICE) if the objects it builds on are absent.

-- ═════════════════════════════════════════════════════════════════════════
-- A. The private column set + the grant sync
-- ═════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.jobs_private_select_columns()
RETURNS text[]
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $$
  SELECT ARRAY['offered_to_helper_id']::text[];
$$;

REVOKE ALL ON FUNCTION public.jobs_private_select_columns() FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.jobs_private_select_columns() IS
  'Single source of truth for which public.jobs columns authenticated may NOT select directly (poster + offered Helpr read them through get_job_offer_targets). Consumed by sync_jobs_select_grants().';

CREATE OR REPLACE FUNCTION public.sync_jobs_select_grants()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_private   text[] := public.jobs_private_select_columns();
  v_readable  text[];
  v_needs_fix boolean := false;
  v_col       text;
BEGIN
  IF to_regclass('public.jobs') IS NULL THEN
    RETURN jsonb_build_object('repaired', false, 'reason', 'public.jobs absent');
  END IF;

  SELECT array_agg(a.attname::text ORDER BY a.attnum)
    INTO v_readable
    FROM pg_attribute a
   WHERE a.attrelid = 'public.jobs'::regclass
     AND a.attnum > 0
     AND NOT a.attisdropped
     AND NOT (a.attname::text = ANY (v_private));

  IF v_readable IS NULL OR array_length(v_readable, 1) IS NULL THEN
    -- Refuse to revoke SELECT and grant nothing back.
    RETURN jsonb_build_object('repaired', false, 'reason', 'no readable columns resolved');
  END IF;

  -- Drift test, lock-free: a table-level SELECT anywhere, a private column
  -- still selectable, or a readable column that is not.
  IF has_table_privilege('authenticated', 'public.jobs', 'SELECT')
     OR has_table_privilege('anon', 'public.jobs', 'SELECT') THEN
    v_needs_fix := true;
  ELSE
    FOREACH v_col IN ARRAY v_private LOOP
      IF EXISTS (SELECT 1 FROM pg_attribute
                  WHERE attrelid = 'public.jobs'::regclass AND attname = v_col AND NOT attisdropped)
         AND (has_column_privilege('authenticated', 'public.jobs', v_col, 'SELECT')
              OR has_column_privilege('anon', 'public.jobs', v_col, 'SELECT')) THEN
        v_needs_fix := true;
      END IF;
    END LOOP;
    IF NOT v_needs_fix THEN
      FOREACH v_col IN ARRAY v_readable LOOP
        IF NOT has_column_privilege('authenticated', 'public.jobs', v_col, 'SELECT') THEN
          v_needs_fix := true;
          EXIT;
        END IF;
      END LOOP;
    END IF;
  END IF;

  IF NOT v_needs_fix THEN
    RETURN jsonb_build_object('repaired', false,
                              'private_columns', to_jsonb(v_private),
                              'granted_columns', array_length(v_readable, 1));
  END IF;

  -- A table-level REVOKE also removes every column-level SELECT grant, so this
  -- starts from nothing. anon gets nothing back: it held no SELECT on jobs
  -- before this migration (guest browse reads open_jobs_browse).
  REVOKE SELECT ON public.jobs FROM PUBLIC, anon, authenticated;
  EXECUTE format(
    'GRANT SELECT (%s) ON public.jobs TO authenticated',
    (SELECT string_agg(quote_ident(c), ', ') FROM unnest(v_readable) AS c)
  );

  RETURN jsonb_build_object('repaired', true,
                            'private_columns', to_jsonb(v_private),
                            'granted_columns', array_length(v_readable, 1));
END;
$fn$;

REVOKE ALL ON FUNCTION public.sync_jobs_select_grants() FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.sync_jobs_select_grants() IS
  'Re-derives authenticated''s column-level SELECT grants on public.jobs as the complement of jobs_private_select_columns(). Idempotent and DDL-free when already correct. CALL THIS from any migration that adds a column to jobs.';

-- ═════════════════════════════════════════════════════════════════════════
-- B. The accessor: poster + offeree only
-- ═════════════════════════════════════════════════════════════════════════
DO $migration$
BEGIN
  IF to_regclass('public.jobs') IS NULL THEN
    RAISE NOTICE 'public.jobs absent: get_job_offer_targets skipped';
    RETURN;
  END IF;

  EXECUTE $fn$
CREATE OR REPLACE FUNCTION public.get_job_offer_targets(p_job_ids uuid[] DEFAULT NULL)
 RETURNS TABLE(job_id uuid, offered_to_helper_id uuid)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $body$
  -- Caller-bound: auth.uid() is read here, never taken as an argument, and a
  -- row comes back only when the caller is the poster or the offeree. A NULL
  -- uid (anon, service calls without a JWT) matches nothing.
  SELECT j.id, j.offered_to_helper_id
    FROM public.jobs j
   WHERE j.offered_to_helper_id IS NOT NULL
     AND (j.customer_id = (SELECT auth.uid()) OR j.offered_to_helper_id = (SELECT auth.uid()))
     AND (p_job_ids IS NULL OR j.id = ANY (p_job_ids));
$body$;
$fn$;

  REVOKE ALL ON FUNCTION public.get_job_offer_targets(uuid[]) FROM PUBLIC, anon;
  GRANT EXECUTE ON FUNCTION public.get_job_offer_targets(uuid[]) TO authenticated, service_role;
  COMMENT ON FUNCTION public.get_job_offer_targets(uuid[]) IS
    'jobs.offered_to_helper_id for jobs where the caller is the poster or the offered Helpr, and nobody else (owner decision 2026-09-14). Pass NULL for all such jobs.';
END
$migration$;

-- ═════════════════════════════════════════════════════════════════════════
-- C. get_jobs_for_my_applications: null the offeree for non-posters
-- ═════════════════════════════════════════════════════════════════════════
DO $migration$
BEGIN
  IF to_regprocedure('public.get_jobs_for_my_applications()') IS NULL
     OR to_regprocedure('public.user_may_see_job_address(uuid,uuid)') IS NULL
     OR to_regprocedure('public.mask_job_location(text)') IS NULL
     OR to_regclass('public.applications') IS NULL
     OR to_regclass('public.group_job_helpers') IS NULL THEN
    RAISE NOTICE 'get_jobs_for_my_applications / user_may_see_job_address / mask_job_location / applications / group_job_helpers absent: skipped';
    RETURN;
  END IF;

  EXECUTE $fn$
CREATE OR REPLACE FUNCTION public.get_jobs_for_my_applications()
 RETURNS SETOF jobs
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT rec.*
  FROM public.jobs j
  CROSS JOIN LATERAL (
    SELECT public.user_may_see_job_address(j.id, v_uid) AS ok
  ) e
  -- Function-scan lateral, NOT a scalar sub-select: evaluated once per row.
  CROSS JOIN LATERAL jsonb_populate_record(
           NULL::public.jobs,
           to_jsonb(j) || jsonb_build_object(
             'location',
             CASE WHEN e.ok THEN j.location ELSE public.mask_job_location(j.location) END,
             'latitude',
             CASE WHEN e.ok THEN j.latitude ELSE ROUND(j.latitude, 2) END,
             'longitude',
             CASE WHEN e.ok THEN j.longitude ELSE ROUND(j.longitude, 2) END,
             -- Offer privacy (20260915045110): the offeree is the poster's and
             -- the offeree's business only.
             'offered_to_helper_id',
             CASE WHEN j.customer_id = v_uid OR j.offered_to_helper_id = v_uid
                  THEN j.offered_to_helper_id ELSE NULL END
           )
         ) AS rec
  WHERE EXISTS (
          SELECT 1 FROM public.applications a
          WHERE a.job_id = j.id AND a.helper_id = v_uid
        )
    AND (
          j.customer_id = v_uid
          OR j.helper_id = v_uid
          OR j.status = 'open'
          -- A group roster member who is not the lead. NULL-safe as above.
          OR EXISTS (
               SELECT 1 FROM public.group_job_helpers g
               WHERE g.job_id = j.id AND g.helper_id = v_uid
             )
        );
END;
$function$;
$fn$;

  REVOKE ALL ON FUNCTION public.get_jobs_for_my_applications() FROM PUBLIC, anon;
  GRANT EXECUTE ON FUNCTION public.get_jobs_for_my_applications() TO authenticated, service_role;
END
$migration$;

-- ═════════════════════════════════════════════════════════════════════════
-- D. open_jobs_browse: null the offeree for everyone but poster + offeree
-- ═════════════════════════════════════════════════════════════════════════
DO $migration$
BEGIN
  IF to_regclass('public.open_jobs_browse') IS NULL
     OR to_regprocedure('public.mask_job_location(text)') IS NULL
     OR to_regprocedure('public.early_access_cutoff()') IS NULL
     OR to_regprocedure('public.seed_jobs_hidden_publicly()') IS NULL
     OR to_regprocedure('public.my_credential_tier()') IS NULL
     OR NOT EXISTS (SELECT 1 FROM pg_attribute
                     WHERE attrelid = to_regclass('public.jobs') AND attname = 'require_photo_proof' AND NOT attisdropped) THEN
    RAISE NOTICE 'open_jobs_browse or a function / column it reads is absent: skipped';
    RETURN;
  END IF;

  -- Same columns, same order, same types: only the offered_to_helper_id
  -- expression changes, so CREATE OR REPLACE keeps the view's grants.
  EXECUTE $view$
CREATE OR REPLACE VIEW public.open_jobs_browse
WITH (security_invoker = false)
AS
 SELECT id,
    title,
    description,
    category,
    budget,
    date_needed,
        CASE
            WHEN offered_to_helper_id = auth.uid() AND direct_offer_status = 'pending'::text THEN location
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
        CASE
            WHEN customer_id = auth.uid() OR offered_to_helper_id = auth.uid() THEN offered_to_helper_id
            ELSE NULL::uuid
        END AS offered_to_helper_id,
    direct_offer_status,
    direct_offer_expires_at,
    ( SELECT count(*)::integer AS count
           FROM applications a
          WHERE a.job_id = jobs.id) AS applicant_count,
    pricing_mode,
    round(latitude, 2) AS latitude,
    round(longitude, 2) AS longitude,
    parish,
    credential_tier,
    require_photo_proof
   FROM jobs
  WHERE status = 'open'::job_status AND customer_id IS NOT NULL AND (payment_status = ANY (ARRAY['escrow'::text, 'payout_pending'::text, 'released'::text])) AND (offered_to_helper_id IS NULL OR (direct_offer_status = ANY (ARRAY['declined'::text, 'expired'::text])) OR offered_to_helper_id = auth.uid()) AND (created_at <= early_access_cutoff() OR customer_id = auth.uid() OR offered_to_helper_id = auth.uid()) AND (NOT is_seed OR NOT seed_jobs_hidden_publicly()) AND (COALESCE(credential_tier, 0) = 0 OR customer_id = auth.uid() OR COALESCE(( SELECT my_credential_tier() AS my_credential_tier), 0) >= credential_tier)
$view$;

  -- RESTATED, not assumed — the same two statements 20260915041247 landed.
  --
  -- open_jobs_browse is owned by `postgres` (rolbypassrls), so ANY write
  -- privilege on it is a write to public.jobs with jobs' RLS bypassed. That
  -- was fixed in 20260706140000 and RE-OPENED by 20260912021641, because prod
  -- carries an ALTER DEFAULT PRIVILEGES rule that re-grants anon and
  -- authenticated the full set on every postgres-owned relation — so every
  -- `DROP VIEW; CREATE VIEW` silently hands the writes back.
  --
  -- This migration redefines the view, so it re-asserts the grant set on the
  -- way out. Belt and braces, both deliberate: the redefinition above is
  -- CREATE OR REPLACE (never DROP + CREATE), which keeps the ACL and never
  -- triggers the default-privilege rule; and these two statements make the
  -- result correct even if someone later changes that.
  --
  -- `REVOKE ALL`, never a named privilege list: prod is PG17 and the view
  -- holds MAINTAIN, but db-deploy's replay-smoke Postgres is older and errors
  -- with `unrecognized privilege type "maintain"` — which is how the CRITICAL
  -- fix failed to deploy on 2026-09-15 while every local check was green.
  -- `ALL` names no version-specific keyword (src/test/migrationPrivilegeKeywords.test.ts).
  REVOKE ALL ON public.open_jobs_browse FROM PUBLIC, anon, authenticated;

  -- The one privilege the view exists to provide (anon guest browse:
  -- DashboardGuest.tsx).
  GRANT SELECT ON public.open_jobs_browse TO anon, authenticated;
END
$migration$;

-- ═════════════════════════════════════════════════════════════════════════
-- A (applied). Last, so every block above has run before the revoke lands.
-- ═════════════════════════════════════════════════════════════════════════
SELECT public.sync_jobs_select_grants();
