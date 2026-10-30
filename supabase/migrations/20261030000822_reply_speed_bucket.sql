-- Public reply speed, as a rounded bucket only (Q2478, owner decision 2b, 2026-10-29 via lead):
-- "show reply speed publicly as a rounded bucket only (under 1 hr / a few hrs / within a day), after 5+
-- replies, through get_reply_speed(p_user_ids uuid[]) with no row data".
--
-- WHAT IS MEASURED: how fast a member first answers a POSTER. One observation per job thread where the
-- other party is that job's poster and the poster spoke first: from the poster's first message to this
-- member's first message after it. A poster who was never answered counts once 24 hours have passed (as
-- slower than a day), so ignoring people never makes the bucket faster. Threads still inside their first
-- 24 hours with no answer are not counted yet. Lifecycle system messages (is_system) and the
-- "Louisiana Helpr Team" thread (job_id NULL) are never counted; neither is a thread on the member's own
-- job (they are the poster there).
--
-- WHAT LEAVES THE FUNCTION: one text per member, 'under_1h' | 'few_hours' | 'within_day', or NULL. NULL
-- below 5 observations (the floor get_my_reply_latency, 20260901005108, and get_public_profile_stats use for
-- every rate) and NULL when the median is slower than a day (nothing is published to shame anyone). No
-- counts, no times, no message or job ids.
--
-- WHO IS VISIBLE: exactly the members get_public_profile_stats shows (its target gate verbatim: email
-- verified, not banned, Q552 seed clause; or your own row). Signed-in callers only: anon has no EXECUTE,
-- and auth.uid() IS NULL returns nothing even through service paths that forget to pass one. At most 100
-- ids are read per call (an applicant list is far smaller).
--
-- Median, not mean, for the reason 20260901005108 measured: one overnight gap drags a mean by 8x.
--
-- Replay-safe: CREATE OR REPLACE of a new function; grants restated.

CREATE OR REPLACE FUNCTION public.get_reply_speed(p_user_ids uuid[])
 RETURNS TABLE(user_id uuid, reply_bucket text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $fn$
  WITH target AS (
    SELECT p.user_id
    FROM public.profiles p
    WHERE auth.uid() IS NOT NULL
      AND p.user_id = ANY ((p_user_ids)[1:100])
      AND (
        (
          p.email_verified
          AND (p.ban_status IS NULL OR p.ban_status NOT IN ('temp_banned', 'permanently_banned'))
          AND (p.is_seed IS NOT TRUE OR NOT (SELECT public.seed_hidden_from_caller()))
        )
        OR p.user_id = auth.uid()
      )
  ),
  -- Every person-written message in a job thread between the member and that job's poster.
  thread_msgs AS (
    SELECT
      t.user_id,
      m.job_id,
      (m.sender_id = t.user_id) AS mine,
      m.created_at
    FROM target t
    JOIN public.messages m
      ON (m.sender_id = t.user_id OR m.receiver_id = t.user_id)
    JOIN public.jobs j
      ON j.id = m.job_id
    WHERE m.is_system = false
      AND m.job_id IS NOT NULL
      AND j.customer_id IS NOT NULL
      AND j.customer_id <> t.user_id
      AND j.customer_id = CASE WHEN m.sender_id = t.user_id THEN m.receiver_id ELSE m.sender_id END
  ),
  -- Per thread: when the poster first wrote, and when the member first wrote after that.
  per_thread AS (
    SELECT
      tm.user_id,
      tm.job_id,
      MIN(tm.created_at) FILTER (WHERE NOT tm.mine) AS poster_first_at,
      MIN(tm.created_at) AS thread_first_at
    FROM thread_msgs tm
    GROUP BY tm.user_id, tm.job_id
  ),
  observations AS (
    SELECT
      pt.user_id,
      (
        SELECT MIN(tm.created_at)
        FROM thread_msgs tm
        WHERE tm.user_id = pt.user_id
          AND tm.job_id = pt.job_id
          AND tm.mine
          AND tm.created_at > pt.poster_first_at
      ) - pt.poster_first_at AS latency,
      pt.poster_first_at
    FROM per_thread pt
    -- The poster opened the thread (a thread the member opened measures nothing about answering).
    WHERE pt.poster_first_at IS NOT NULL
      AND pt.poster_first_at = pt.thread_first_at
  ),
  counted AS (
    SELECT
      o.user_id,
      -- Unanswered for over a day: counted as slower than a day.
      COALESCE(o.latency, interval '100 years') AS latency
    FROM observations o
    WHERE o.latency IS NOT NULL
       OR o.poster_first_at <= now() - interval '24 hours'
  ),
  agg AS (
    SELECT
      c.user_id,
      COUNT(*) AS sample,
      percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM c.latency)) AS median_s
    FROM counted c
    GROUP BY c.user_id
  )
  SELECT
    t.user_id,
    CASE
      WHEN a.sample IS NULL OR a.sample < 5 THEN NULL
      WHEN a.median_s <= 3600 THEN 'under_1h'
      WHEN a.median_s <= 6 * 3600 THEN 'few_hours'
      WHEN a.median_s <= 24 * 3600 THEN 'within_day'
      ELSE NULL
    END
  FROM target t
  LEFT JOIN agg a ON a.user_id = t.user_id;
$fn$;

COMMENT ON FUNCTION public.get_reply_speed(uuid[]) IS
  'Q2478 (owner 2b): rounded public reply-speed bucket per member (under_1h | few_hours | within_day | NULL), median first reply to a poster, floor 5, signed-in only, no row data.';

REVOKE ALL ON FUNCTION public.get_reply_speed(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_reply_speed(uuid[]) TO authenticated, service_role;
