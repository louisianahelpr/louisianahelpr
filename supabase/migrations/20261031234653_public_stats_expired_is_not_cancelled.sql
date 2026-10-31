-- Expired is not cancelled (owner 10-31 ~18:30, "people shouldnt see on my
-- profile that the job was cancelled"). auto-expire-jobs closes a listing
-- whose time passed with no Helpr as status 'cancelled' with the fixed reason
-- 'Job listing expired — scheduled time passed with no Helpr assigned'
-- (supabase/functions/auto-expire-jobs/index.ts). get_public_profile_stats
-- counted those in cancelled_jobs / cancellation_rate. This redefines it from
-- its newest definition (20261030015205_test_data_never_counts.sql, md5 on
-- prod 025dd2806ed8989397ca5e3d0e09911e at 2026-10-31 18:50 CT) with ONE
-- change: cancelled_jobs leaves out an unfilled expired listing. Real
-- cancellations still count. CREATE OR REPLACE keeps the existing grants
-- (anon, authenticated, service_role: public profile cards read it).
-- FOR VERDICT (lead): read-only stats function, no money.

CREATE OR REPLACE FUNCTION public.get_public_profile_stats(p_user_ids uuid[])
 RETURNS TABLE(user_id uuid, review_count integer, avg_rating numeric, poster_review_count integer, poster_avg_rating numeric, completed_jobs_as_helper integer, completed_jobs_total integer, posted_jobs_total integer, jobs_total integer, cancelled_jobs integer, cancellation_rate numeric, on_time_sample integer, on_time_rate numeric, revision_sample integer, revision_rate numeric, repeat_client_sample integer, repeat_hire_percent numeric, is_id_verified boolean, has_stripe_account boolean, is_background_checked boolean, has_pending_credentials boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH target AS (
    SELECT p.user_id, p.idv_status,
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
      -- Test data never counts (b62; replaces Q552's switch-gated clause): not on a
      -- test job, not from or about a test account, for every caller, own stats too.
      AND j.is_seed IS NOT TRUE
      AND NOT public.is_test_member(r.reviewer_id)
      AND NOT public.is_test_member(r.reviewee_id)
    UNION ALL
    -- Declutter slice 4 (row 45, lead 2026-10-15): ONE star rating across job
    -- reviews and Declutter reviews. A Declutter review counts once it is
    -- public (both sides reviewed, or 14 days after the handover: the blind
    -- rule of declutter_visible_reviews); it is never a poster review.
    SELECT t.user_id, dr.stars::integer, false
    FROM target t
    JOIN public.declutter_reviews dr ON dr.reviewee_id = t.user_id
    JOIN public.declutter_orders o ON o.id = dr.order_id
    WHERE o.status = 'handed_over'
      AND (o.handed_over_at <= now() - interval '14 days'
           OR (SELECT count(*) FROM public.declutter_reviews d2 WHERE d2.order_id = dr.order_id) = 2)
      -- Test data never counts (b62; replaces Q552's switch-gated clause).
      AND dr.is_seed IS NOT TRUE
      AND o.is_seed IS NOT TRUE
      AND NOT public.is_test_member(dr.reviewer_id)
      AND NOT public.is_test_member(dr.reviewee_id)
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
      -- Owner 10-31: a listing that expired with no Helpr (auto-expire-jobs'
      -- fixed reason) is NOT a cancellation, so it never counts here.
      COUNT(*) FILTER (WHERE j.status = 'cancelled'
        AND NOT (j.helper_id IS NULL AND COALESCE(j.cancellation_reason, '') LIKE 'Job listing expired%'))::integer AS cancelled_jobs
    FROM target t
    LEFT JOIN public.jobs j
      ON (j.customer_id = t.user_id OR j.helper_id = t.user_id
      -- Q728: a crew has no lead (Q407), so a crew member's jobs are found
      -- through the roster.
      OR (j.is_group_job IS TRUE AND EXISTS (
            SELECT 1 FROM public.group_job_helpers g WHERE g.job_id = j.id AND g.helper_id = t.user_id)))
      -- Test data never counts (b62). Inside the ON, so a member with no real
      -- jobs still gets their row.
      AND j.is_seed IS NOT TRUE
      AND NOT public.is_test_member(j.customer_id)
      AND NOT public.is_test_member(t.user_id)
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
      -- Test data never counts (b62).
      AND j.is_seed IS NOT TRUE AND NOT public.is_test_member(j.customer_id) AND NOT public.is_test_member(t.user_id)
    UNION ALL
    SELECT t.user_id, j.id, j.customer_id, j.revision_count, g.helper_arrived_at,
           j.date_needed, j.start_time
    FROM target t
    JOIN public.group_job_helpers g ON g.helper_id = t.user_id
    JOIN public.jobs j ON j.id = g.job_id AND j.is_group_job IS TRUE AND j.status = 'completed'
      AND j.is_seed IS NOT TRUE AND NOT public.is_test_member(j.customer_id) AND NOT public.is_test_member(t.user_id)
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
    -- The "ID verified" BADGE (owner 2026-10-21): Stripe Identity only, the
    -- same expression get_safe_profiles.is_id_verified uses. A badge, not a gate.
    (t.idv_status IS NOT DISTINCT FROM 'verified'),
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

