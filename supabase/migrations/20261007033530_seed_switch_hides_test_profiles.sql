-- Q552: the launch switch hides test PROFILES and their reviews, not only
-- test jobs, from real people and anon, and stops hiding test rows from TEST
-- ACCOUNTS (owner, 2026-10-07: "hide test profiles and test jobs NOW"; lead:
-- "real users never see test jobs or test profiles" with no red-nightly gap).
--
-- WHAT WAS WRONG. `seed_jobs_hidden_publicly()` gated every JOB surface, but
-- the 57 is_seed profiles stayed findable by name (search_profiles_by_name),
-- readable as profiles and stats (get_safe_profiles, get_public_profile_stats),
-- counted in the parish activity card (get_parish_activity counts seed jobs,
-- their fees and their Helprs) and their reviews stayed readable through the
-- "Published reviews visible after reveal" policy. And the job gates hid test
-- jobs from EVERY caller: once flipped, the apply gate (enforce_application_job_state
-- C6) and the direct-offer accept gate refused test accounts too, so every
-- nightly journey that posts a test job and applies to it would go red.
--
-- WHO IS A TEST ACCOUNT: a row in public.test_accounts (below), AND
-- profiles.is_seed. NOT is_seed alone: trg_profiles_seed_from_fixture_email
-- sets is_seed for ANY signup whose address is a fixture address, and
-- @mailinator.com is a public inbox, so anyone could make themselves "seed"
-- by choosing their sign-up email (lh-authz-rls review of 40adb6ade, finding
-- 1; measured: f55112c7, created 2026-10-01 through the email-confirmation
-- sign-up, is is_seed). public.test_accounts has no client grant and no
-- policy, so only the service role (the harness, an admin migration) can
-- enrol an account; it is backfilled with today's is_seed accounts.
--   seed_hidden_for(user)       switch on AND that user is not a test account.
--   seed_hidden_in_discovery()  the same for the caller. Discovery (job browse,
--                               map, ranked feed, name search, parish card):
--                               admins see what the public sees.
--   seed_hidden_from_caller()   the same, but an admin is spared: a KNOWN
--                               counterpart's profile row, stats or review keeps
--                               its name on a thread or dispute the owner is on.
-- So with the switch on: real people and anon see no test job, profile or
-- review; a test account still sees, finds and applies to test jobs and test
-- accounts; anyone keeps their own row and the reviews they wrote or received.
-- With the switch off (today until the flip) every predicate is false.
--
-- Every body below is the one live today with one clause added or one call
-- swapped; nothing else changes. The profile read functions and the reviews
-- policy are pasted from pg_get_functiondef / pg_policies (read 2026-10-07).
-- The job gates are the newest migration statements (src/test/helpers/
-- effectiveFunctionDefs), whose bodies were compared with pg_get_functiondef
-- on 2026-10-07: byte-equal for all four functions; open_jobs_browse is the
-- 20261006042617 statement, whose live pg_get_viewdef carries the same
-- conjuncts (ban_settlement_queue included). Job counts inside
-- get_public_profile_stats are unchanged (a real person's history is theirs).
-- get_public_open_jobs (the landing teaser), the announcement paths and the digest keep
-- asking seed_jobs_hidden_publicly() directly: no test account is the caller
-- there.
--
-- Replay-safe: CREATE OR REPLACE throughout; the policy is dropped IF EXISTS
-- and re-created; grants restated as they read live.

CREATE TABLE IF NOT EXISTS public.test_accounts (
  user_id     uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  enrolled_at timestamptz NOT NULL DEFAULT now(),
  note        text
);
COMMENT ON TABLE public.test_accounts IS
  'Q552: the accounts the launch switch treats as TEST accounts (they keep seeing and applying to test jobs and profiles). Service role only: a sign-up can never enrol itself.';
ALTER TABLE public.test_accounts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.test_accounts FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.test_accounts TO service_role;
-- Q807: every new public table carries the unconfirmed-email write gate (a no-op
-- here: no client role can write this table at all).
DO $$
BEGIN
  IF to_regprocedure('public.attach_unconfirmed_email_gate()') IS NOT NULL THEN
    PERFORM public.attach_unconfirmed_email_gate();
  END IF;
END;
$$;

-- Backfill: every account that is is_seed today (the fixture set; the owner's
-- accounts are not is_seed). Joined to auth.users for the foreign key.
INSERT INTO public.test_accounts (user_id, note)
SELECT p.user_id, 'backfill 20261007033530 (is_seed at migration time)'
  FROM public.profiles p
  JOIN auth.users u ON u.id = p.user_id
 WHERE p.is_seed IS TRUE
   -- Frozen to the accounts that existed when this was written (57, read
   -- 2026-10-07: the harness's mailinator accounts, f55112c7, the App Review
   -- account f2098932 and the seed admin 68c11a39), so a mailinator sign-up
   -- made before db-deploy runs is not enrolled (lh-authz-rls re-review, LOW 1).
   AND u.created_at <= '2026-10-07 04:30:00+00'
ON CONFLICT (user_id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.seed_hidden_for(p_user_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  -- TRUE = the launch switch hides test (is_seed) rows from this user. False
  -- while the switch is off and for a test account. A NULL user (anon, a
  -- server call with no JWT) is hidden from, like the public.
  SELECT public.seed_jobs_hidden_publicly()
     AND NOT EXISTS (
       SELECT 1 FROM public.profiles me
        WHERE me.user_id = p_user_id AND me.is_seed IS TRUE
          AND EXISTS (SELECT 1 FROM public.test_accounts t WHERE t.user_id = me.user_id)
     );
$function$;

-- No client may call it: it would answer "is this uuid a test account".
REVOKE ALL ON FUNCTION public.seed_hidden_for(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.seed_hidden_for(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.seed_hidden_in_discovery()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  -- Discovery hides test rows from admins too (the owner browses as an admin
  -- and must see what the public sees); only a test account keeps them.
  -- (seed_hidden_for's body for the caller, written out so the switch is
  -- asked directly: showSeedJobs.parity.test.ts allows one `via` hop.)
  SELECT public.seed_jobs_hidden_publicly()
     AND NOT EXISTS (
       SELECT 1 FROM public.profiles me
        WHERE me.user_id = (SELECT auth.uid()) AND me.is_seed IS TRUE
          AND EXISTS (SELECT 1 FROM public.test_accounts t WHERE t.user_id = me.user_id)
     );
$function$;

REVOKE ALL ON FUNCTION public.seed_hidden_in_discovery() FROM PUBLIC, anon, authenticated;
-- anon and authenticated NEED it: open_jobs_browse (security_invoker = false)
-- reads tables as its owner, but Postgres checks EXECUTE on a function a view
-- calls against the CALLER (the PGlite proof failed R4 with "permission denied
-- for function seed_hidden_in_discovery" for anon without this). It answers
-- only "does the switch hide test rows from ME".
GRANT EXECUTE ON FUNCTION public.seed_hidden_in_discovery() TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.seed_hidden_from_caller()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  -- A KNOWN counterpart (profile row, stats, review): hidden like discovery,
  -- except from an admin.
  SELECT public.seed_jobs_hidden_publicly()
     AND NOT EXISTS (
       SELECT 1 FROM public.profiles me
        WHERE me.user_id = (SELECT auth.uid()) AND me.is_seed IS TRUE
          AND EXISTS (SELECT 1 FROM public.test_accounts t WHERE t.user_id = me.user_id)
     )
     AND NOT COALESCE(public.has_role((SELECT auth.uid()), 'admin'::app_role), false);
$function$;

REVOKE ALL ON FUNCTION public.seed_hidden_from_caller() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.seed_hidden_from_caller() TO service_role;

CREATE OR REPLACE FUNCTION public.seed_review_hidden(p_reviewer_id uuid, p_reviewee_id uuid, p_job_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  -- A review is hidden from this caller when the switch hides test rows from
  -- them and the review involves a test account or a test job.
  SELECT public.seed_hidden_from_caller()
     AND (
       EXISTS (SELECT 1 FROM public.profiles p
                WHERE p.user_id IN (p_reviewer_id, p_reviewee_id) AND p.is_seed IS TRUE)
       OR EXISTS (SELECT 1 FROM public.jobs j WHERE j.id = p_job_id AND j.is_seed IS TRUE)
     );
$function$;

REVOKE ALL ON FUNCTION public.seed_review_hidden(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.seed_review_hidden(uuid, uuid, uuid) TO authenticated, service_role;

DROP POLICY IF EXISTS "Published reviews visible after reveal" ON public.reviews;
CREATE POLICY "Published reviews visible after reveal" ON public.reviews
  FOR SELECT TO authenticated
  USING (
    reviewer_id = (SELECT auth.uid())
    OR (
      status = 'published'
      AND feedback_visible_at IS NOT NULL
      AND feedback_visible_at <= now()
      AND (
        reviewee_id = (SELECT auth.uid())
        OR NOT public.seed_review_hidden(reviewer_id, reviewee_id, job_id)
      )
    )
  );


-- ===== search_profiles_by_name (live body 2026-10-07 + the seed clause)
CREATE OR REPLACE FUNCTION public.search_profiles_by_name(query text)
 RETURNS TABLE(user_id uuid, full_name text, avatar_url text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _minute_count int;
  _day_count int;
BEGIN
  IF _uid IS NULL THEN
    RETURN;
  END IF;

  -- Log the attempt first (including short queries), then check the window
  -- — so the rate limit itself can't be bypassed by staying under the
  -- 2-character floor.
  INSERT INTO public.profile_search_rate_log (searcher_id) VALUES (_uid);

  SELECT count(*) INTO _minute_count
  FROM public.profile_search_rate_log
  WHERE searcher_id = _uid AND created_at >= now() - interval '1 minute';
  IF _minute_count > 20 THEN
    RAISE EXCEPTION 'rate_limit_minute' USING HINT = 'Too many searches — try again in a minute';
  END IF;

  SELECT count(*) INTO _day_count
  FROM public.profile_search_rate_log
  WHERE searcher_id = _uid AND created_at >= now() - interval '1 day';
  IF _day_count > 200 THEN
    RAISE EXCEPTION 'rate_limit_day' USING HINT = 'Daily search limit reached — try again tomorrow';
  END IF;

  IF length(trim(coalesce(query, ''))) < 2 THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT p.user_id, p.full_name, p.avatar_url
  FROM public.profiles p
  WHERE p.user_id <> _uid
    AND p.full_name IS NOT NULL
    AND p.full_name ILIKE '%' || trim(query) || '%'
    AND p.email_verified
    AND (p.ban_status IS NULL OR p.ban_status NOT IN ('temp_banned', 'permanently_banned'))
    -- Q552: test accounts are not findable once the launch switch is on.
    AND (p.is_seed IS NOT TRUE OR NOT public.seed_hidden_in_discovery())
  ORDER BY p.full_name ASC
  LIMIT 10;
END;
$function$;

REVOKE ALL ON FUNCTION public.search_profiles_by_name(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.search_profiles_by_name(text) TO authenticated, service_role;

-- ===== get_safe_profiles (live body 2026-10-07 + the seed clause)
CREATE OR REPLACE FUNCTION public.get_safe_profiles(user_ids uuid[])
 RETURNS TABLE(user_id uuid, full_name text, avatar_url text, bio text, location text, skills text, hourly_rate numeric, role text, subscription_tier text, portfolio_urls text[], created_at timestamp with time zone, is_id_verified boolean, is_payout_ready boolean, profile_id uuid, is_licensed boolean, license_status text, is_insured boolean, insurance_status text, business_name text)
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
    -- THE identity verdict, shared with get_public_profile_stats and the gates.
    public.identity_is_verified(p.idv_status, p.stripe_identity_verified) AS is_id_verified,
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
    AND p.email_verified
    AND (p.ban_status IS NULL OR p.ban_status NOT IN ('temp_banned', 'permanently_banned'))
    AND p.anonymized_at IS NULL
    -- Q552: a test account's profile is hidden once the launch switch is on
    -- (your own row never is).
    AND (p.is_seed IS NOT TRUE OR p.user_id = auth.uid() OR NOT (SELECT public.seed_hidden_from_caller()));
$function$;

REVOKE ALL ON FUNCTION public.get_safe_profiles(uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_safe_profiles(uuid[]) TO anon, authenticated, service_role;

-- ===== get_public_profile_stats (live body 2026-10-07 + the seed clause)
CREATE OR REPLACE FUNCTION public.get_public_profile_stats(p_user_ids uuid[])
 RETURNS TABLE(user_id uuid, review_count integer, avg_rating numeric, poster_review_count integer, poster_avg_rating numeric, completed_jobs_as_helper integer, completed_jobs_total integer, posted_jobs_total integer, jobs_total integer, cancelled_jobs integer, cancellation_rate numeric, on_time_sample integer, on_time_rate numeric, revision_sample integer, revision_rate numeric, repeat_client_sample integer, repeat_hire_percent numeric, is_id_verified boolean, has_stripe_account boolean, is_background_checked boolean, has_pending_credentials boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH target AS (
    SELECT p.user_id, p.stripe_identity_verified, p.idv_status,
           p.stripe_account_id, p.background_check_status
    FROM public.profiles p
    WHERE (p.user_id = ANY(p_user_ids) OR p.id = ANY(p_user_ids))
      AND (
        -- Public gate, character-for-character the one get_safe_profiles uses.
        (
          p.email_verified
          AND (p.ban_status IS NULL OR p.ban_status NOT IN ('temp_banned', 'permanently_banned'))
          -- Q552: the same seed clause get_safe_profiles carries.
          AND (p.is_seed IS NOT TRUE OR NOT (SELECT public.seed_hidden_from_caller()))
        )
        -- …or it is your own row. Your own preview must not lie to you while
        -- your email is unverified, which is the same reason the client keeps a
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
      -- Q552: the reviews read policy's seed clause (your own stats keep them).
      AND (t.user_id = auth.uid() OR NOT public.seed_review_hidden(r.reviewer_id, r.reviewee_id, r.job_id))
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
      -- The Helpr side: the single Helpr, or (Q728) a crew member, who is joined
      -- below through the roster and is never the job's poster.
      COUNT(*) FILTER (WHERE j.customer_id IS DISTINCT FROM t.user_id AND j.status = 'completed')::integer AS completed_as_helper,
      COUNT(DISTINCT j.id) FILTER (WHERE j.status = 'completed')::integer AS completed_total,
      COUNT(*) FILTER (WHERE j.customer_id = t.user_id)::integer AS posted_total,
      COUNT(*)::integer AS jobs_total,
      COUNT(*) FILTER (WHERE j.status = 'cancelled')::integer AS cancelled_jobs
    FROM target t
    LEFT JOIN public.jobs j
      ON j.customer_id = t.user_id OR j.helper_id = t.user_id
      -- Q728: a crew has no lead (Q407), so a crew member's jobs are found
      -- through the roster.
      OR (j.is_group_job IS TRUE AND EXISTS (
            SELECT 1 FROM public.group_job_helpers g WHERE g.job_id = j.id AND g.helper_id = t.user_id))
    GROUP BY t.user_id
  ),
  -- Timing, over this person's ENTIRE completed helper history. The client
  -- version capped its sample at the 50 most recent rows purely because that
  -- was one page of a `select`; there is no reason to throw away the rest here.
  -- Q731(a), 2026-10-05: every completed job this person WORKED, the single
  -- Helpr's and (a crew has no lead, Q407) each crew job they were on, with
  -- the member's OWN arrival stamp from the roster. Timing and repeat-client
  -- both read this one set, so neither can drop crews again.
  worked AS (
    SELECT t.user_id, j.id AS job_id, j.customer_id, j.revision_count, j.helper_arrived_at,
           j.date_needed, j.start_time
    FROM target t
    JOIN public.jobs j ON j.helper_id = t.user_id AND j.status = 'completed'
    UNION ALL
    SELECT t.user_id, j.id, j.customer_id, j.revision_count, g.helper_arrived_at,
           j.date_needed, j.start_time
    FROM target t
    JOIN public.group_job_helpers g ON g.helper_id = t.user_id
    JOIN public.jobs j ON j.id = g.job_id AND j.is_group_job IS TRUE AND j.status = 'completed'
  ),
  -- Timing, over this person's ENTIRE completed helper history. The client
  -- version capped its sample at the 50 most recent rows purely because that
  -- was one page of a `select`; there is no reason to throw away the rest here.
  timing AS (
    SELECT
      w.user_id,
      w.revision_count,
      w.helper_arrived_at,
      -- date_needed + start_time are wall-clock LOUISIANA time, not UTC.
      ((w.date_needed::date + COALESCE(w.start_time::text, '00:00')::time)
        AT TIME ZONE 'America/Chicago') AS scheduled_at
    FROM worked w
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
    SELECT w.user_id, w.customer_id, COUNT(*) AS jobs_together
    FROM worked w
    WHERE w.customer_id IS NOT NULL
    GROUP BY w.user_id, w.customer_id
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
    -- THE identity verdict. Was `(t.stripe_identity_verified IS TRUE)` — the
    -- Connect verdict alone, false for 3 of the 4 idv-verified people.
    public.identity_is_verified(t.idv_status, t.stripe_identity_verified),
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

REVOKE ALL ON FUNCTION public.get_public_profile_stats(uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_public_profile_stats(uuid[]) TO anon, authenticated, service_role;

-- ===== get_parish_activity (live body 2026-10-07 + the seed clause)
CREATE OR REPLACE FUNCTION public.get_parish_activity(p_limit integer DEFAULT 5)
 RETURNS TABLE(parish text, active_jobs integer, completed_jobs_30d integer, revenue_30d numeric, helper_count integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH job_stats AS (
    SELECT COALESCE(j.parish, 'Unknown') AS parish,
      COUNT(*) FILTER (WHERE j.status IN ('open','accepted','in_progress'))::int AS active_jobs,
      COUNT(*) FILTER (WHERE j.status = 'completed' AND COALESCE(j.poster_completed_at, j.helper_completed_at, j.updated_at) > now() - interval '30 days')::int AS completed_jobs_30d,
      COALESCE(SUM(CASE WHEN j.status = 'completed' AND COALESCE(j.poster_completed_at, j.helper_completed_at, j.updated_at) > now() - interval '30 days' THEN COALESCE(j.platform_fee_amount, 0) + COALESCE(j.customer_fee_amount, 0) ELSE 0 END), 0)::numeric(10,2) AS revenue_30d
    FROM public.jobs j WHERE j.parish IS NOT NULL
      -- Q552: test jobs, their fees and their Helprs leave the card with the switch.
      AND (j.is_seed IS NOT TRUE OR NOT (SELECT public.seed_hidden_in_discovery()))
    GROUP BY COALESCE(j.parish, 'Unknown')
  ),
  helper_stats AS (
    SELECT p.parish, COUNT(*)::int AS helper_count
    FROM public.profiles p
    WHERE EXISTS (SELECT 1 FROM public.jobs jj WHERE jj.helper_id = p.user_id
                    AND (jj.is_seed IS NOT TRUE OR NOT (SELECT public.seed_hidden_in_discovery())))
      AND (p.is_seed IS NOT TRUE OR NOT (SELECT public.seed_hidden_in_discovery()))
      AND p.parish IS NOT NULL AND p.email_verified AND COALESCE(p.ban_status, 'active') = 'active'
    GROUP BY p.parish
  )
  SELECT js.parish, js.active_jobs, js.completed_jobs_30d, js.revenue_30d, COALESCE(hs.helper_count, 0) AS helper_count
  FROM job_stats js LEFT JOIN helper_stats hs ON hs.parish = js.parish
  WHERE (js.active_jobs + js.completed_jobs_30d) > 0
  ORDER BY (js.active_jobs * 2 + js.completed_jobs_30d) DESC, js.revenue_30d DESC LIMIT p_limit;
$function$;

REVOKE ALL ON FUNCTION public.get_parish_activity(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_parish_activity(integer) TO authenticated, service_role;

-- ===== direct_accept_block_reason (effective body from 20261003214350_direct_offer_accept_works_like_an_offer.sql; asks about the offered Helpr)
CREATE OR REPLACE FUNCTION public.direct_accept_block_reason(p_job_id uuid, p_helper uuid)
 RETURNS text
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
 SET "TimeZone" TO 'America/Chicago'
AS $fn$
DECLARE
  v_job record;
  v_profile record;
BEGIN
  SELECT j.status::text AS status, j.helper_id, j.customer_id, j.offered_to_helper_id,
         j.direct_offer_status, j.direct_offer_expires_at, j.parent_job_id, j.is_seed,
         j.date_needed, j.expires_at, j.payment_status, COALESCE(j.credential_tier, 0) AS credential_tier
    INTO v_job
    FROM public.jobs j
   WHERE j.id = p_job_id;
  IF NOT FOUND THEN
    RETURN 'job_not_found';
  END IF;
  -- the offer itself
  IF v_job.status IS DISTINCT FROM 'open' OR v_job.helper_id IS NOT NULL
     OR v_job.offered_to_helper_id IS DISTINCT FROM p_helper
     OR v_job.direct_offer_status IS DISTINCT FROM 'pending' THEN
    RETURN 'offer_not_active';
  END IF;
  IF v_job.direct_offer_expires_at IS NOT NULL AND v_job.direct_offer_expires_at < now() THEN
    RETURN 'offer_expired';
  END IF;
  -- enforce_application_job_state's refusals
  IF v_job.customer_id IS NULL OR v_job.customer_id = p_helper THEN
    RETURN 'offer_not_active';
  END IF;
  IF public.are_users_blocked(p_helper, v_job.customer_id) THEN
    RETURN 'applicant_blocked';
  END IF;
  IF v_job.parent_job_id IS NOT NULL
     -- Q552: a test account may still accept a test job's direct offer.
     OR (COALESCE(v_job.is_seed, false) AND public.seed_hidden_for(p_helper)) THEN
    RETURN 'offer_not_active';
  END IF;
  IF v_job.date_needed IS NOT NULL AND v_job.date_needed < CURRENT_DATE THEN
    RETURN 'job_date_has_passed';
  END IF;
  IF v_job.expires_at IS NOT NULL AND v_job.expires_at <= now() THEN
    RETURN 'job_expired';
  END IF;
  -- funded (enforce_job_funded_before_award; the server path skips it)
  IF NOT public.job_payment_is_funded(v_job.payment_status::text) THEN
    RETURN 'job_not_funded';
  END IF;
  -- enforce_application_credential_tier
  IF v_job.credential_tier > 0
     AND COALESCE(public.get_user_credential_tier(p_helper), 0) < v_job.credential_tier THEN
    RETURN 'credential_tier_required';
  END IF;
  -- enforce_ban_gate (is_caller_banned's predicate, for this Helpr) and block_shadowbanned_applications
  SELECT p.ban_status, p.auto_suspended_until INTO v_profile FROM public.profiles p WHERE p.user_id = p_helper;
  IF v_profile.ban_status IN ('banned', 'temp_banned', 'permanently_banned')
     AND (v_profile.ban_status <> 'temp_banned' OR v_profile.auto_suspended_until IS NULL
          OR v_profile.auto_suspended_until > now()) THEN
    RETURN 'account_restricted';
  END IF;
  IF public.is_helper_shadowbanned(p_helper) THEN
    RETURN 'account_restricted';
  END IF;
  RETURN NULL;
END;
$fn$;

REVOKE ALL ON FUNCTION public.direct_accept_block_reason(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.direct_accept_block_reason(uuid, uuid) TO service_role;

-- ===== enforce_application_job_state (effective body from 20261006042617_ban_review_hides_posts_on_crew_surfaces.sql; C6 asks about the APPLICANT)
CREATE OR REPLACE FUNCTION public.enforce_application_job_state()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET "TimeZone" TO 'America/Chicago'
AS $function$
DECLARE
  v_job RECORD;
BEGIN
  -- Service-role writers run with no JWT. Same gate as the credential tier
  -- trigger beside this one: a cron spawning the next recurring visit, or an
  -- admin tool, is not a helper tapping Apply.
  --
  -- This early return is safe only because RLS excludes NULL-uid callers
  -- before the trigger fires: the sole INSERT policy on `applications` is
  -- TO authenticated with WITH CHECK (auth.uid() = helper_id), which is
  -- NULL -> false for an anon or sub-less token. If that policy is ever
  -- loosened, this line becomes a bypass.
  -- 20260915051905: no longer rests on that. An anon caller (NULL uid, role
  -- anon) is judged like any other client; only a server context passes.
  IF public.is_server_context() THEN
    RETURN NEW;
  END IF;

  -- FOR SHARE (added 2026-09-13): block behind any in-flight UPDATE of this
  -- job — poster_cancel_job's FOR UPDATE, accept_application, a status PATCH —
  -- and read the status THAT transaction committed, not the one before it.
  -- Without the lock, 14 of 20 applications fired alongside a cancel landed on
  -- the cancelled job (the FK's KEY SHARE made the INSERT wait, but only after
  -- this SELECT had already said 'open').
  SELECT j.status,
         j.customer_id,
         j.offered_to_helper_id,
         j.direct_offer_status,
         j.created_at,
         j.is_seed,
         j.date_needed,
         j.expires_at,
         j.parent_job_id
    INTO v_job
    FROM public.jobs j
   WHERE j.id = NEW.job_id
   FOR SHARE;

  -- No row is the FK's problem, not ours; let it raise its own error.
  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  -- C2. A job outlives the person who posted it: account deletion anonymises
  -- rather than deletes and deliberately preserves `status`, so an ownerless
  -- job stays 'open' forever. Until now this was refused only because the
  -- notification trigger downstream could not address a NULL poster — a
  -- protection that would evaporate the moment that path was made
  -- null-tolerant, and which meanwhile showed the helper a raw NOT NULL
  -- constraint violation.
  IF v_job.customer_id IS NULL THEN
    RAISE EXCEPTION 'job_has_no_owner'
      USING ERRCODE = '42501',
            HINT = 'The person who posted this job has closed their account.';
  END IF;

  -- C3 (2026-09-21). You cannot apply to your own post. See the header: the
  -- INSERT policy never named customer_id, no constraint covered it, and the
  -- only enforcement lived inside the apply_to_job RPC — which the client's
  -- own PGRST202 fallback, and any direct PostgREST call, goes around.
  --
  -- Deliberately BEFORE the status/early-access/date checks: whatever else is
  -- wrong with the job, this is the reason the person can act on.
  --
  -- Compared against NEW.helper_id rather than auth.uid() so it holds for the
  -- SECURITY DEFINER paths too (apply_to_job, respond_to_direct_offer), where
  -- a row could be written for a helper_id other than the caller. A poster who
  -- direct-offers a job to themselves is refused here as well, which is
  -- correct: the row that offer would create is still a self-application.
  IF v_job.customer_id = NEW.helper_id THEN
    RAISE EXCEPTION 'cannot_apply_to_own_job'
      USING ERRCODE = '42501',
            HINT = 'You posted this job, so you cannot also apply to it.';
  END IF;

  -- C10 (2026-09-24, Q341). No application across a block, in either
  -- direction. The INSERT policy already said so, but apply_to_job is SECURITY
  -- DEFINER and never reaches the policy; this trigger is on every path. The
  -- code does not say who blocked whom — the helper gets the same sentence
  -- either way.
  IF public.are_users_blocked(NEW.helper_id, v_job.customer_id) THEN
    RAISE EXCEPTION 'applicant_blocked'
      USING ERRCODE = '42501',
            HINT = 'This job is not available to you.';
  END IF;

  -- C11 (20260927012806, money review MEDIUM-1). claim_series_dates hands a
  -- VACATED series visit (still funded) to the Helpr who claimed its date: it
  -- books the visit, then records their accepted application. By then the
  -- visit is no longer 'open' and it may still be in its Early Access window,
  -- so the discovery checks below (C1, C4-C9) do not describe that write. The
  -- claim sets app.series_claim_rpc only around that one INSERT, after its
  -- own checks (the claimer is on the series, not banned, not blocked, not
  -- the poster); C3 and C10 above still run on it.
  IF current_setting('app.series_claim_rpc', true) = '1' THEN
    RETURN NEW;
  END IF;

  -- C12 (authz review HIGH). A series VISIT is never applied to. A visit a
  -- Helpr gave up is 'open' with no helper and still funded, but it belongs
  -- to the series: it goes only to a Helpr already on the series, through
  -- claim_series_dates (C11 above). No discovery surface lists it
  -- (20260927015010), and this refuses the direct INSERT and apply_to_job.
  IF v_job.parent_job_id IS NOT NULL THEN
    RAISE EXCEPTION 'series_visit_not_open'
      USING ERRCODE = '42501',
            HINT = 'This visit is part of a series.';
  END IF;

  -- C1. Every discovery surface requires status = 'open'.
  -- Q1409: and a booked crew's re-listed free spot (crew_spots_open), the
  -- same rule every browse surface lists it by.
  IF v_job.status <> 'open'
     AND NOT (v_job.status = 'accepted' AND COALESCE(public.crew_spots_open(NEW.job_id), 0) > 0) THEN
    RAISE EXCEPTION 'job_not_open'
      USING ERRCODE = '42501',
            HINT = 'This job is no longer accepting applications.';
  END IF;

  -- C4. A job under a live direct offer is private to the helper it was
  -- offered to. The feed withholds it; so must the write path.
  IF v_job.offered_to_helper_id IS NOT NULL
     AND v_job.direct_offer_status = 'pending'
     AND v_job.offered_to_helper_id IS DISTINCT FROM NEW.helper_id THEN
    RAISE EXCEPTION 'job_reserved_for_another_helper'
      USING ERRCODE = '42501',
            HINT = 'This job has been offered directly to someone else.';
  END IF;

  -- C5. The Early Access perk. The targeted helper of a direct offer keeps the
  -- same escape hatch the four surfaces give them, so a person who was invited
  -- to a job can always answer it immediately.
  IF v_job.created_at > public.early_access_cutoff()
     AND v_job.offered_to_helper_id IS DISTINCT FROM NEW.helper_id THEN
    RAISE EXCEPTION 'job_in_early_access_window'
      USING ERRCODE = '42501',
            HINT = 'This job is in its Early Access window. Pro and Elite members can apply first.';
  END IF;

  -- C6. Fixture rows, on the shared switch — so when the flag is flipped at
  -- launch the seed jobs go quiet in the feed AND stop accruing real
  -- applications, instead of only the former.
  -- Q552: a test account may still apply to a test job (the nightly journeys);
  -- keyed on the applicant's profiles.is_seed, which no member can set.
  IF COALESCE(v_job.is_seed, false) AND public.seed_hidden_for(NEW.helper_id) THEN
    RAISE EXCEPTION 'job_not_available'
      USING ERRCODE = '42501',
            HINT = 'This job is no longer available.';
  END IF;

  -- C13 (Q1411, owner 2026-10-05). The poster is under an open ban settlement
  -- review: the post is hidden from browse and takes no new application.
  -- The same neutral words as C6: the applicant learns nothing about why.
  IF EXISTS (SELECT 1 FROM public.ban_settlement_queue q
              WHERE q.user_id = v_job.customer_id AND q.review_state = 'open') THEN
    RAISE EXCEPTION 'job_not_available'
      USING ERRCODE = '42501',
            HINT = 'This job is no longer available.';
  END IF;

  -- C8. A job whose day has passed is not workable. This IS a feed filter —
  -- `date_needed >= CURRENT_DATE` appears in get_ranked_open_jobs,
  -- get_public_open_jobs and get_open_jobs_for_map (not in open_jobs_browse) —
  -- which is why the TimeZone above has to match theirs exactly.
  IF v_job.date_needed IS NOT NULL AND v_job.date_needed < CURRENT_DATE THEN
    RAISE EXCEPTION 'job_date_has_passed'
      USING ERRCODE = '42501',
            HINT = 'The date this job was needed has already passed.';
  END IF;

  -- C9. Likewise an expired one. This is filtered on only ONE surface today
  -- (get_open_jobs_for_map), so enforcing it here is deliberately stricter
  -- than any feed currently implies — confirmed with the owner before shipping.
  IF v_job.expires_at IS NOT NULL AND v_job.expires_at <= now() THEN
    RAISE EXCEPTION 'job_expired'
      USING ERRCODE = '42501',
            HINT = 'This job posting has expired.';
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.enforce_application_job_state() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enforce_application_job_state() TO service_role;

-- ===== get_ranked_open_jobs (effective body from 20261006042617_ban_review_hides_posts_on_crew_surfaces.sql; test jobs stay listed for a test account only)
CREATE OR REPLACE FUNCTION public.get_ranked_open_jobs(p_limit integer DEFAULT 20, p_offset integer DEFAULT 0, p_include_seed boolean DEFAULT true, p_lat numeric DEFAULT NULL::numeric, p_lng numeric DEFAULT NULL::numeric, p_max_miles numeric DEFAULT NULL::numeric)
 RETURNS TABLE(id uuid, title text, description text, category job_category, budget numeric, date_needed date, start_time time without time zone, location text, parish text, is_urgent boolean, urgent_fee numeric, is_flexible_schedule boolean, is_recurring boolean, recurrence_interval text, is_group_job boolean, helpers_needed integer, estimated_hours numeric, photos text[], special_requirements text, created_at timestamp with time zone, expires_at timestamp with time zone, boosted_at timestamp with time zone, boost_expires_at timestamp with time zone, parish_match boolean, rank_score numeric, pricing_mode text, distance_band text)
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
      j.boost_expires_at, j.pricing_mode,
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
      AND (j.date_needed IS NULL OR j.date_needed >= CURRENT_DATE)
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
    END AS distance_band
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
$function$;

REVOKE ALL ON FUNCTION public.get_ranked_open_jobs(integer, integer, boolean, numeric, numeric, numeric) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_ranked_open_jobs(integer, integer, boolean, numeric, numeric, numeric) TO anon, authenticated, service_role;

-- ===== get_open_jobs_for_map (effective body from 20261006042617_ban_review_hides_posts_on_crew_surfaces.sql; test jobs stay listed for a test account only)
CREATE OR REPLACE FUNCTION public.get_open_jobs_for_map()
 RETURNS TABLE(id uuid, title text, category text, budget numeric, is_urgent boolean, latitude numeric, longitude numeric, parish text, created_at timestamp with time zone, location text, date_needed date, start_time time without time zone, urgent_fee numeric, is_group_job boolean, helpers_needed integer, boost_expires_at timestamp with time zone, expires_at timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
 SET "TimeZone" TO 'America/Chicago'
AS $function$
  WITH cutoff AS (
    SELECT public.early_access_cutoff()      AS ts,
           public.seed_hidden_in_discovery() AS seed_hidden,  -- Q552: false for a test account
           COALESCE(public.get_user_credential_tier((SELECT auth.uid())), 0) AS viewer_tier
  )
  SELECT
    j.id,
    j.title,
    j.category,
    j.budget,
    COALESCE(j.is_urgent, false) AS is_urgent,
    -- 2 decimal places ~ 1.1km at Louisiana latitudes. The pin lands in
    -- the right neighborhood, never on the doorstep.
    ROUND(j.latitude, 2) AS latitude,
    ROUND(j.longitude, 2) AS longitude,
    j.parish,
    j.created_at,
    public.mask_job_location(j.location) AS location,
    j.date_needed,
    j.start_time,
    j.urgent_fee,
    COALESCE(j.is_group_job, false) AS is_group_job,
    j.helpers_needed,
    j.boost_expires_at,
    j.expires_at
  FROM public.jobs j
  CROSS JOIN cutoff
  WHERE (j.status = 'open' OR (j.status = 'accepted' AND j.is_group_job IS TRUE AND public.crew_spots_open(j.id) > 0))
    -- A series visit is re-offered only inside its series (20260927015010).
    AND j.parent_job_id IS NULL
    AND j.customer_id IS NOT NULL
    AND ((SELECT auth.uid()) IS NULL OR j.customer_id <> (SELECT auth.uid()))
    AND j.payment_status = ANY (ARRAY['escrow'::text, 'payout_pending'::text, 'released'::text])
    AND (COALESCE(j.credential_tier, 0) = 0 OR cutoff.viewer_tier >= j.credential_tier)
    AND j.latitude IS NOT NULL
    AND j.longitude IS NOT NULL
    AND (j.expires_at IS NULL OR j.expires_at > NOW())
    AND (j.date_needed IS NULL OR j.date_needed >= CURRENT_DATE)
    AND (j.offered_to_helper_id IS NULL OR j.direct_offer_status <> 'pending')
    AND (
      j.created_at <= cutoff.ts
      OR j.offered_to_helper_id = (SELECT auth.uid())
    )
    AND (NOT j.is_seed OR NOT cutoff.seed_hidden)
    -- Q1411: not while the poster is under an open ban settlement review.
    AND NOT EXISTS (SELECT 1 FROM public.ban_settlement_queue q WHERE q.user_id = j.customer_id AND q.review_state = 'open')
  ORDER BY j.boosted_at DESC NULLS LAST, j.created_at DESC
  LIMIT 100;
$function$;

REVOKE ALL ON FUNCTION public.get_open_jobs_for_map() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_open_jobs_for_map() TO anon, authenticated, service_role;

-- ===== open_jobs_browse (the statement from 20261006042617_ban_review_hides_posts_on_crew_surfaces.sql; the seed conjunct asks
-- seed_hidden_in_discovery(), so a test account still lists test jobs). It MUST
-- stay security_invoker = false (src/test/openJobsBrowseStaysDefiner.test.ts).
DO $view$
BEGIN
  IF to_regclass('public.open_jobs_browse') IS NULL THEN
    RAISE NOTICE 'open_jobs_browse absent: skipped';
    RETURN;
  END IF;
  EXECUTE $v$
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
    require_photo_proof,
    recurrence_days,
    recurrence_weeks,
    series_split_ok,
        CASE
            WHEN is_group_job IS TRUE THEN (CASE WHEN is_group_job IS NOT TRUE OR parent_job_id IS NOT NULL THEN 0 WHEN status = 'open'::job_status OR (status = 'accepted'::job_status AND (CASE WHEN start_time IS NULL THEN ((date_needed + 1)::timestamp without time zone AT TIME ZONE 'America/Chicago') ELSE ((date_needed + start_time) AT TIME ZONE 'America/Chicago') END) > (now() + '00:15:00'::interval)) THEN GREATEST(0, COALESCE(helpers_needed, 1) - (SELECT count(*)::integer AS count FROM group_job_helpers g WHERE g.job_id = jobs.id)) ELSE 0 END)
            ELSE NULL::integer
        END AS crew_spots_open
   FROM jobs
  WHERE (status = 'open'::job_status OR (status = 'accepted'::job_status AND is_group_job IS TRUE AND (CASE WHEN is_group_job IS NOT TRUE OR parent_job_id IS NOT NULL THEN 0 WHEN status = 'open'::job_status OR (status = 'accepted'::job_status AND (CASE WHEN start_time IS NULL THEN ((date_needed + 1)::timestamp without time zone AT TIME ZONE 'America/Chicago') ELSE ((date_needed + start_time) AT TIME ZONE 'America/Chicago') END) > (now() + '00:15:00'::interval)) THEN GREATEST(0, COALESCE(helpers_needed, 1) - (SELECT count(*)::integer AS count FROM group_job_helpers g WHERE g.job_id = jobs.id)) ELSE 0 END) > 0)) AND parent_job_id IS NULL AND customer_id IS NOT NULL AND (payment_status = ANY (ARRAY['escrow'::text, 'payout_pending'::text, 'released'::text])) AND (offered_to_helper_id IS NULL OR (direct_offer_status = ANY (ARRAY['declined'::text, 'expired'::text])) OR offered_to_helper_id = auth.uid()) AND (created_at <= early_access_cutoff() OR customer_id = auth.uid() OR offered_to_helper_id = auth.uid()) AND (NOT is_seed OR NOT public.seed_hidden_in_discovery()) AND (COALESCE(credential_tier, 0) = 0 OR customer_id = auth.uid() OR COALESCE(( SELECT my_credential_tier() AS my_credential_tier), 0) >= credential_tier) AND (NOT (EXISTS ( SELECT 1 FROM ban_settlement_queue q WHERE q.user_id = jobs.customer_id AND q.review_state = 'open'::text)))
$v$;
END
$view$;

REVOKE ALL ON public.open_jobs_browse FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.open_jobs_browse TO anon, authenticated;

-- ===== get_public_profile_reviews (live body 2026-10-07 + the seed clauses).
-- It reads public.reviews as its owner, so the policy above never applies to it
-- (lh-authz-rls review of 667446afd, finding 7).
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
      r.feedback, r.created_at, r.reviewer_id, r.response_text, r.response_at,
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

REVOKE ALL ON FUNCTION public.get_public_profile_reviews(uuid, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_public_profile_reviews(uuid, integer, integer) TO authenticated, service_role;
