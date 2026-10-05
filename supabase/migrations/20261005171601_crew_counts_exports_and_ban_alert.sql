-- Q731 + Q729 (group crews, launch blockers; group jobs ON at launch, owner
-- 2026-10-05). A crew has no lead (Q407): jobs.helper_id is NULL on every group
-- job, so anything that finds "the Helpr" through jobs.helper_id misses every
-- crew member. Five readers still did:
--
--   get_public_profile_stats  (Q731 a) the on-time and repeat-client figures
--                             read jobs.helper_id only (the completed count was
--                             fixed in 20260927012241). Both now read one
--                             `worked` set: single jobs plus the member's crew
--                             jobs, with the member's OWN roster arrival stamp.
--   get_helper_earnings_export (Q729) a crew member's paid shares were missing.
--                             A crew row is the member's share (gross), and what
--                             the payout ledger actually paid them (fee, net).
--   get_helper_tiers          (Q729) admin tier list: crew-only Helprs missing,
--                             crew jobs uncounted.
--   get_neighbor_hire_count   (Q729) "hired by N neighbours" counted single jobs.
--   settle_one_off_jobs_for_banned_account (Q731 b) a crew member banned after
--                             the job finished, before their share paid out, was
--                             never found. Owner 2026-10-05: same as a banned
--                             single Helpr (admin_review: every admin alerted,
--                             payouts run on schedule).
--
-- Each function is its live definition with only the crew change. CREATE OR
-- REPLACE keeps owner and ACL; grants restated below. Replay-safe.
-- Guards: src/test/groupCrewReminders.test.ts (class inventory) and
-- src/test/pglite/crewCountsAndBanAlert.pglite.mjs (behaviour, red before).

CREATE OR REPLACE FUNCTION public.get_helper_earnings_export(
  _helper_id uuid,
  _start_date date,
  _end_date date
)
RETURNS TABLE (
  job_id uuid,
  date_completed date,
  job_title text,
  category text,
  parish text,
  tax_status text,
  gross_budget numeric,
  platform_fee numeric,
  parish_tax_collected numeric,
  net_payout numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  IF auth.uid() <> _helper_id AND NOT has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  RETURN QUERY
  SELECT x.* FROM (
    SELECT
      j.id AS job_id,
      COALESCE(j.poster_completed_at::date, j.helper_completed_at::date, j.updated_at::date) AS date_completed,
      j.title AS job_title,
      j.category::text AS category,
      COALESCE(j.parish, 'Unknown') AS parish,
      CASE WHEN public.is_category_taxable(j.category) THEN 'Taxable' ELSE 'Exempt' END AS tax_status,
      j.budget AS gross_budget,
      ROUND(j.budget * COALESCE(j.helper_fee_percent, 10) / 100.0, 2) AS platform_fee,
      COALESCE(j.sales_tax_amount, 0) AS parish_tax_collected,
      ROUND(j.budget - (j.budget * COALESCE(j.helper_fee_percent, 10) / 100.0), 2) AS net_payout
    FROM public.jobs j
    WHERE j.helper_id = _helper_id
      AND j.status = 'completed'
      AND j.payment_status = 'released'
    UNION ALL
    -- A crew member's share: only once the payout ledger shows it PAID to them
    -- (a crew pays member by member; a refunded member has no paid row).
    SELECT
      j.id,
      COALESCE(j.poster_completed_at::date, g.poster_confirmed_completion_at::date,
               g.helper_completed_at::date, j.updated_at::date),
      j.title,
      j.category::text,
      COALESCE(j.parish, 'Unknown'),
      CASE WHEN public.is_category_taxable(j.category) THEN 'Taxable' ELSE 'Exempt' END,
      ROUND(COALESCE(g.share_cents, 0) / 100.0, 2),
      ROUND(pt.fee_cents / 100.0, 2),
      -- The job's tax, in the same proportion as this member's share.
      COALESCE(ROUND(COALESCE(j.sales_tax_amount, 0) * COALESCE(g.share_cents, 0)
            / NULLIF(ROUND(COALESCE(j.budget, 0) * 100), 0), 2), 0),
      ROUND(pt.paid_cents / 100.0, 2)
    FROM public.group_job_helpers g
    JOIN public.jobs j ON j.id = g.job_id AND j.is_group_job IS TRUE AND j.status = 'completed'
    JOIN LATERAL (
      SELECT SUM(p.amount_cents) AS paid_cents, SUM(COALESCE(p.platform_fee_cents, 0)) AS fee_cents
      FROM public.payout_transfers p
      WHERE p.job_id = j.id AND p.helper_id = g.helper_id AND p.status = 'paid'
    ) pt ON pt.paid_cents IS NOT NULL
    WHERE g.helper_id = _helper_id
  ) x
  WHERE x.date_completed BETWEEN _start_date AND _end_date
  ORDER BY x.date_completed DESC;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.get_helper_tiers(p_limit integer DEFAULT 25)
 RETURNS TABLE(user_id uuid, full_name text, parish text, avatar_url text, total_reviews integer, recent_reviews integer, avg_rating numeric, recent_avg_rating numeric, completed_jobs integer, growth_score numeric, tier text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH visible_reviews AS (
    -- The reviews that count toward a public rating (Q321): the same three
    -- predicates as get_public_profile_stats.visible_reviews.
    SELECT r.id, r.reviewee_id, r.rating, r.created_at
    FROM public.reviews r
    JOIN public.jobs j ON j.id = r.job_id
    WHERE r.status = 'published'
      AND r.feedback_visible_at IS NOT NULL
      AND r.feedback_visible_at <= now()
      AND j.status <> 'cancelled'
  ),
  stats AS (
    SELECT p.user_id, p.full_name, p.parish, p.avatar_url,
      COUNT(DISTINCT r.id)::int AS total_reviews,
      COUNT(DISTINCT r.id) FILTER (WHERE r.created_at > now() - interval '30 days')::int AS recent_reviews,
      COALESCE(AVG(r.rating)::numeric(10,2), 0) AS avg_rating,
      COALESCE(AVG(r.rating) FILTER (WHERE r.created_at > now() - interval '30 days')::numeric(10,2), 0) AS recent_avg_rating,
      COUNT(DISTINCT j.id) FILTER (WHERE j.status = 'completed')::int AS completed_jobs
    FROM public.profiles p
    LEFT JOIN visible_reviews r ON r.reviewee_id = p.user_id
    -- Q729: the single Helpr's jobs and (a crew has no lead) the crew jobs this
    -- person is on.
    LEFT JOIN public.jobs j
      ON j.helper_id = p.user_id
      OR (j.is_group_job IS TRUE AND EXISTS (
            SELECT 1 FROM public.group_job_helpers g WHERE g.job_id = j.id AND g.helper_id = p.user_id))
    WHERE (EXISTS (SELECT 1 FROM public.jobs jj WHERE jj.helper_id = p.user_id)
           OR EXISTS (SELECT 1 FROM public.group_job_helpers gg WHERE gg.helper_id = p.user_id))
      AND p.email_verified
      AND COALESCE(p.ban_status, 'active') = 'active'
      -- server-side admin authorization: non-admins get zero rows, not the data
      AND public.has_role(auth.uid(), 'admin')
    GROUP BY p.user_id, p.full_name, p.parish, p.avatar_url
  )
  SELECT user_id, full_name, parish, avatar_url, total_reviews, recent_reviews, avg_rating, recent_avg_rating, completed_jobs,
    (recent_reviews * COALESCE(recent_avg_rating, 0))::numeric(10,2) AS growth_score,
    CASE
      WHEN total_reviews >= 25 AND avg_rating >= 4.7 THEN 'Elite'
      WHEN total_reviews >= 10 AND avg_rating >= 4.5 THEN 'Verified'
      WHEN recent_reviews >= 3 AND recent_avg_rating >= 4.5 THEN 'Rising Star'
      WHEN total_reviews >= 1 THEN 'Active'
      ELSE 'New'
    END AS tier
  FROM stats ORDER BY growth_score DESC, total_reviews DESC LIMIT p_limit;
$function$;

CREATE OR REPLACE FUNCTION public.get_neighbor_hire_count(p_helper_id uuid, p_job_id uuid)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH scope AS (
    SELECT a.job_latitude AS latitude, a.job_longitude AS longitude
    FROM public.applications a
    JOIN public.jobs j ON j.id = a.job_id
    WHERE a.job_id = p_job_id
      AND a.helper_id = p_helper_id
      AND j.customer_id = auth.uid()
      AND a.job_latitude  IS NOT NULL
      AND a.job_longitude IS NOT NULL
  ), hits AS (
    SELECT COUNT(DISTINCT j.customer_id)::integer AS n
    FROM public.jobs j
    JOIN public.profiles p ON p.user_id = j.customer_id
    CROSS JOIN scope s
    WHERE (j.helper_id = p_helper_id
           -- Q729: a crew member's completed crew jobs count too.
           OR (j.is_group_job IS TRUE AND EXISTS (
                 SELECT 1 FROM public.group_job_helpers g WHERE g.job_id = j.id AND g.helper_id = p_helper_id)))
      AND j.status = 'completed'
      AND p.latitude  IS NOT NULL
      AND p.longitude IS NOT NULL
      AND public.miles_between(p.latitude, p.longitude, s.latitude, s.longitude) <= 1
  )
  SELECT CASE WHEN COALESCE((SELECT n FROM hits), 0) >= 2
              THEN (SELECT n FROM hits)
              ELSE 0 END;
$$;

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
CREATE OR REPLACE FUNCTION public.settle_one_off_jobs_for_banned_account(p_user uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_job record;
  v_seat text;
  v_other uuid;
  v_action text;
  v_started boolean;
  v_series boolean;
  v_hours numeric;
  v_percent int;
  v_fee numeric;
  v_committed boolean;
  v_cut numeric;
  v_n int;
  v_title text;
  v_admin_note text;
  v_out jsonb := '[]'::jsonb;
  v_closed_apps int := 0;
  v_closed_offers int := 0;
  v_cancel_flag text := current_setting('app.sanctioned_cancel', true);
  v_ladder_flag text := current_setting('app.trusted_ladder_write', true);
  v_reason CONSTANT text := 'Cancelled because an account on this job was closed by Louisiana Helpr.';
  v_dispute_reason CONSTANT text := 'An account on this job was closed by Louisiana Helpr after work had started. An admin decides the payment.';
  v_gone CONSTANT text := 'the other person on it can no longer use Louisiana Helpr';
BEGIN
  IF p_user IS NULL THEN
    RETURN jsonb_build_object('settled', '[]'::jsonb, 'closed_applications', 0, 'closed_offers', 0);
  END IF;

  FOR v_job IN
    SELECT j.id, j.title, j.customer_id, j.helper_id, j.status::text AS status, j.payment_status,
           j.budget, j.date_needed, j.start_time, j.helper_confirmed_at, j.helper_fee_percent,
           j.helper_arrived_at, j.helper_completed_at, j.proof_before_urls, j.proof_after_urls,
           j.is_group_job, j.parent_job_id, j.recurrence_days,
           j.offered_to_helper_id, j.direct_offer_status
      FROM public.jobs j
     WHERE (
             (j.customer_id = p_user OR j.helper_id = p_user
              OR EXISTS (SELECT 1 FROM public.group_job_helpers g
                          WHERE g.job_id = j.id AND g.helper_id = p_user))
             AND j.status::text NOT IN ('completed', 'cancelled')
           )
        OR (j.helper_id = p_user
            AND j.status::text IN ('completed', 'cancelled')
            AND j.payment_status IN ('escrow', 'payout_pending'))
        -- Q731(b), owner 2026-10-05: a crew has no lead (Q407), so a banned
        -- crew MEMBER of a finished crew job is found through the roster, and
        -- is treated exactly as a banned single Helpr (ban_settlement_action:
        -- admin_review, every admin alerted, payouts run on schedule). A member
        -- whose own share already paid out has nothing left to decide.
        OR (j.is_group_job IS TRUE
            AND j.status::text IN ('completed', 'cancelled')
            AND j.payment_status IN ('escrow', 'payout_pending')
            AND EXISTS (SELECT 1 FROM public.group_job_helpers g
                         WHERE g.job_id = j.id AND g.helper_id = p_user)
            AND NOT EXISTS (SELECT 1 FROM public.payout_transfers pt
                             WHERE pt.job_id = j.id AND pt.helper_id = p_user AND pt.status = 'paid'))
     ORDER BY j.id
       FOR UPDATE
  LOOP
    v_seat := CASE WHEN v_job.customer_id = p_user THEN 'poster' ELSE 'helpr' END;
    v_other := CASE WHEN v_seat = 'poster' THEN v_job.helper_id ELSE v_job.customer_id END;
    v_series := v_job.parent_job_id IS NOT NULL OR v_job.recurrence_days IS NOT NULL;
    -- helper_abort_job's "work started" test, plus a requested revision (which
    -- only follows a Done).
    v_started := v_job.helper_arrived_at IS NOT NULL
              OR v_job.helper_completed_at IS NOT NULL
              OR COALESCE(array_length(v_job.proof_before_urls, 1), 0) > 0
              OR COALESCE(array_length(v_job.proof_after_urls, 1), 0) > 0
              OR v_job.status = 'revision_requested';
    v_action := public.ban_settlement_action(v_seat, v_job.status, v_job.payment_status,
                                             v_started, COALESCE(v_job.is_group_job, false), v_series);
    v_title := COALESCE(v_job.title, 'A job');
    v_admin_note := NULL;
    v_fee := 0;
    v_hours := NULL;

    BEGIN
      -- The sanctioned hatches this settlement is (trg_cancellation_requires_rpc,
      -- the helper column whitelist), transaction-local and restored below.
      PERFORM set_config('app.sanctioned_cancel', 'on', true);
      PERFORM set_config('app.trusted_ladder_write', 'on', true);

      IF v_action IN ('cancel_priced', 'cancel_no_money') THEN
        v_committed := v_job.helper_id IS NOT NULL AND v_job.helper_confirmed_at IS NOT NULL;
        IF v_action = 'cancel_priced' THEN
          -- poster_cancel_job's single-job pricing.
          v_hours := public.job_hours_until_start(v_job.date_needed, v_job.start_time, now());
          v_percent := public.cancellation_fee_percent(v_committed, v_hours);
          v_fee := CASE WHEN COALESCE(v_job.budget, 0) > 0 AND v_percent > 0
                        THEN round(v_job.budget * v_percent) / 100.0 ELSE 0 END;
        END IF;

        UPDATE public.jobs
           SET status = 'cancelled',
               cancelled_by = NULL,
               cancelled_at = now(),
               cancellation_reason = v_reason,
               late_cancellation = CASE WHEN v_action = 'cancel_priced'
                                        THEN public.is_late_cancellation(v_committed, v_hours) ELSE false END,
               cancellation_fee = v_fee,
               cancellation_fee_status = CASE WHEN v_fee > 0 THEN 'pending' ELSE NULL END,
               direct_offer_status = CASE WHEN direct_offer_status = 'pending' THEN 'declined' ELSE direct_offer_status END,
               direct_offer_expires_at = CASE WHEN direct_offer_status = 'pending' THEN NULL ELSE direct_offer_expires_at END
         WHERE id = v_job.id
           AND status::text = v_job.status;
        GET DIAGNOSTICS v_n = ROW_COUNT;
        IF v_n = 0 THEN
          RAISE EXCEPTION 'job moved while being settled';
        END IF;

        IF v_job.helper_id IS NOT NULL THEN
          v_cut := GREATEST(0, round((v_fee - round(v_fee * COALESCE(v_job.helper_fee_percent, 10)) / 100.0) * 100) / 100.0);
          INSERT INTO public.notifications (user_id, title, message, type, link, job_id)
          VALUES (
            v_job.helper_id,
            CASE WHEN v_fee > 0 THEN 'Job cancelled — you''ll be compensated' ELSE 'Job cancelled' END,
            CASE WHEN v_fee > 0 THEN
              format('"%s" was cancelled because %s. It was cancelled late, so you''ll receive about $%s as a cancellation fee, processed within the hour.',
                     v_title, v_gone, to_char(v_cut, 'FM999999990.00'))
            ELSE format('"%s" was cancelled because %s.', v_title, v_gone) END,
            CASE WHEN v_fee > 0 THEN 'payment' ELSE 'warning' END,
            '/jobs?job=' || v_job.id::text,
            v_job.id
          );
        ELSIF v_job.offered_to_helper_id IS NOT NULL AND v_job.direct_offer_status = 'pending' THEN
          INSERT INTO public.notifications (user_id, title, message, type, link, job_id)
          VALUES (
            v_job.offered_to_helper_id,
            'Offer closed',
            format('"%s" was cancelled because %s, so its offer is closed.', v_title, v_gone),
            'warning',
            '/jobs?job=' || v_job.id::text,
            v_job.id
          );
        END IF;

      ELSIF v_action = 'reopen' THEN
        UPDATE public.applications
           SET status = 'rejected',
               closed_reason = 'party_blocked'
         WHERE job_id = v_job.id AND helper_id = p_user AND status = 'accepted';

        UPDATE public.jobs
           SET status = 'open',
               helper_id = NULL,
               response_deadline = NULL,
               helper_confirmed_at = NULL,
               helper_dayof_confirmed_at = NULL,
               helper_on_the_way_at = NULL,
               helper_arrived_at = NULL,
               dayof_confirm_reminder_sent_at = NULL,
               dayof_unanswered_poster_alert_sent_at = NULL,
               start_reminder_sent_at = NULL
         WHERE id = v_job.id
           AND helper_id = p_user
           AND status::text = v_job.status;
        GET DIAGNOSTICS v_n = ROW_COUNT;
        IF v_n = 0 THEN
          RAISE EXCEPTION 'job moved while being settled';
        END IF;

        IF v_job.customer_id IS NOT NULL THEN
          INSERT INTO public.notifications (user_id, title, message, type, link, job_id)
          VALUES (
            v_job.customer_id,
            'Your job is open again',
            format('"%s" is open to everyone again because the person you hired can no longer use Louisiana Helpr. %s',
                   v_title,
                   CASE WHEN v_job.payment_status = 'escrow'
                        THEN 'Your payment stays protected in escrow for whoever you pick next.'
                        ELSE 'Pick someone new whenever you''re ready.' END),
            'warning',
            '/posts?job=' || v_job.id::text,
            v_job.id
          );
        END IF;

      ELSIF v_action = 'hold_dispute' THEN
        INSERT INTO public.disputes (job_id, opener_id, reason, evidence_urls)
        VALUES (v_job.id, NULL, v_dispute_reason, '{}'::text[]);

        -- One statement, so set_dispute_deadline sees disputed_at on the flip.
        -- ESCALATED from the start: the 72h timeout never settles it.
        UPDATE public.jobs
           SET status = 'disputed',
               disputed_by = NULL,
               disputed_at = now(),
               dispute_reason = v_dispute_reason,
               dispute_status = 'escalated'
         WHERE id = v_job.id
           AND status::text = v_job.status
           AND payment_status = 'escrow';
        GET DIAGNOSTICS v_n = ROW_COUNT;
        IF v_n = 0 THEN
          RAISE EXCEPTION 'job moved while being settled';
        END IF;

        IF v_other IS NOT NULL THEN
          INSERT INTO public.notifications (user_id, title, message, type, link, job_id)
          VALUES (
            v_other,
            'Job on hold for review',
            format('"%s" is on hold because %s. Work had already started, so a person at Louisiana Helpr will review it and decide the payment. The money stays in escrow until then, and you don''t need to do anything.',
                   v_title, v_gone),
            'warning',
            CASE WHEN v_seat = 'poster' THEN '/jobs?job=' ELSE '/posts?job=' END || v_job.id::text,
            v_job.id
          );
        END IF;
        v_admin_note := 'work had started when an account on it was banned, so the platform opened an ESCALATED dispute. Nothing pays out until an admin decides.';

      ELSIF v_action = 'escalate_dispute' THEN
        UPDATE public.jobs
           SET dispute_status = 'escalated'
         WHERE id = v_job.id
           AND status = 'disputed'
           AND dispute_status IS DISTINCT FROM 'escalated';
        GET DIAGNOSTICS v_n = ROW_COUNT;
        IF v_n > 0 THEN
          v_admin_note := 'an account on this disputed job was banned. The dispute is escalated so the 72h timeout cannot settle it.';
        ELSE
          v_action := 'none_already_held';  -- escalated already: a re-run says nothing
        END IF;

      ELSIF v_action = 'admin_review' THEN
        v_admin_note := format('an account on it was banned and it could not be settled automatically (status %s, payment %s%s). Nothing on the job was changed, and any scheduled payout or refund still runs on schedule unless an admin steps in.',
                               v_job.status, COALESCE(v_job.payment_status, 'none'),
                               CASE WHEN v_job.is_group_job THEN ', crew' ELSE '' END);
        IF v_job.status IN ('open', 'pending_approval', 'accepted', 'in_progress', 'revision_requested')
           AND v_other IS NOT NULL THEN
          INSERT INTO public.notifications (user_id, title, message, type, link, job_id)
          VALUES (
            v_other,
            'Job under review',
            format('"%s": %s. A person at Louisiana Helpr will review this job, and you don''t need to do anything.',
                   v_title, v_gone),
            'warning',
            CASE WHEN v_seat = 'poster' THEN '/jobs?job=' ELSE '/posts?job=' END || v_job.id::text,
            v_job.id
          );
        END IF;

      ELSIF v_action IN ('none_finished', 'none_settling', 'series_lane') THEN
        -- Nothing to do: finished, already cancelled with nothing owed to the
        -- banned account, or the recurring lane's.
        NULL;

      ELSE
        RAISE EXCEPTION 'unhandled ban settlement (seat %, status %, payment %)',
          v_seat, v_job.status, COALESCE(v_job.payment_status, 'none');
      END IF;

      PERFORM set_config('app.sanctioned_cancel', COALESCE(v_cancel_flag, 'off'), true);
      PERFORM set_config('app.trusted_ladder_write', COALESCE(v_ladder_flag, 'off'), true);
    EXCEPTION WHEN OTHERS THEN
      -- Only this job's writes roll back; the ban and every other job stand.
      PERFORM set_config('app.sanctioned_cancel', COALESCE(v_cancel_flag, 'off'), true);
      PERFORM set_config('app.trusted_ladder_write', COALESCE(v_ladder_flag, 'off'), true);
      v_admin_note := format('an account on it was banned but settling it failed (%s: %s). Nothing was changed; settle it by hand.',
                             v_action, SQLERRM);
      v_action := 'failed';
      v_fee := 0;
    END;

    IF v_admin_note IS NOT NULL THEN
      -- Its own subtransaction: a failed alert never rolls back the ban.
      BEGIN
        INSERT INTO public.notifications (user_id, title, message, type, link, job_id)
        SELECT r.user_id,
               'Banned account: job needs a decision',
               format('"%s": %s', v_title, v_admin_note),
               'admin_alert',
               '/admin?view=jobs&job=' || v_job.id::text,
               v_job.id
          FROM public.user_roles r
         WHERE r.role = 'admin';
      EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'ban settlement: admin alert for job % failed: %', v_job.id, SQLERRM;
      END;
    END IF;

    -- Only what this run did (or could not do) is reported; a job with
    -- nothing to settle is not, so a re-run reports nothing.
    IF v_action NOT LIKE 'none%' AND v_action <> 'series_lane' THEN
      v_out := v_out || jsonb_build_object('job_id', v_job.id, 'seat', v_seat, 'action', v_action, 'cancellation_fee', v_fee);
    END IF;
  END LOOP;

  -- Its own subtransaction: closing applications and offers can never roll
  -- back the ban or the jobs settled above.
  BEGIN
  PERFORM set_config('app.trusted_ladder_write', 'on', true);

  -- Pending applications FROM the banned account: closed silently.
  UPDATE public.applications a
     SET status = 'rejected',
         closed_reason = 'party_blocked'
   WHERE a.helper_id = p_user
     AND a.status = 'pending';
  GET DIAGNOSTICS v_closed_apps = ROW_COUNT;

  -- A pending direct offer TO the banned account: declined (the job reopens to
  -- everyone, as a declined offer does) and its poster told.
  FOR v_job IN
    SELECT j.id, j.title, j.customer_id
      FROM public.jobs j
     WHERE j.offered_to_helper_id = p_user
       AND j.direct_offer_status = 'pending'
       AND j.helper_id IS NULL
     ORDER BY j.id
       FOR UPDATE
  LOOP
    UPDATE public.jobs
       SET direct_offer_status = 'declined',
           direct_offer_expires_at = NULL
     WHERE id = v_job.id AND direct_offer_status = 'pending';
    GET DIAGNOSTICS v_n = ROW_COUNT;
    IF v_n > 0 THEN
      v_closed_offers := v_closed_offers + 1;
      IF v_job.customer_id IS NOT NULL AND v_job.customer_id <> p_user THEN
        INSERT INTO public.notifications (user_id, title, message, type, link, job_id)
        VALUES (
          v_job.customer_id,
          'Offer closed',
          format('The person you offered "%s" to can no longer use Louisiana Helpr, so the offer is closed and the job is open to everyone again.',
                 COALESCE(v_job.title, 'your job')),
          'warning',
          '/posts?job=' || v_job.id::text,
          v_job.id
        );
      END IF;
    END IF;
  END LOOP;

  PERFORM set_config('app.trusted_ladder_write', COALESCE(v_ladder_flag, 'off'), true);
  EXCEPTION WHEN OTHERS THEN
    PERFORM set_config('app.trusted_ladder_write', COALESCE(v_ladder_flag, 'off'), true);
    v_closed_apps := 0;
    v_closed_offers := 0;
    BEGIN
      INSERT INTO public.notifications (user_id, title, message, type, link)
      SELECT r.user_id,
             'Banned account: applications need a look',
             format('Closing the banned account''s pending applications and offers failed (%s). Nothing was changed; close them by hand.', SQLERRM),
             'admin_alert',
             '/admin?view=users&user=' || p_user::text
        FROM public.user_roles r
       WHERE r.role = 'admin';
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'ban settlement: application/offer close failed for %: %', p_user, SQLERRM;
    END;
  END;

  RETURN jsonb_build_object(
    'settled', v_out,
    'closed_applications', v_closed_apps,
    'closed_offers', v_closed_offers
  );
END;
$fn$;

-- Grants, restated (CREATE OR REPLACE keeps them; stated so a replay from
-- scratch lands the same ACL as live, read 2026-10-05).
REVOKE ALL ON FUNCTION public.get_helper_earnings_export(uuid, date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_helper_earnings_export(uuid, date, date) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.get_helper_tiers(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_helper_tiers(integer) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.get_neighbor_hire_count(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_neighbor_hire_count(uuid, uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.settle_one_off_jobs_for_banned_account(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.settle_one_off_jobs_for_banned_account(uuid) TO service_role;
