-- A reply time that is actually the member's reply time.
--
-- ── THE BUG, MEASURED ──────────────────────────────────────────────────────
-- src/pages/userProfile/AtAGlanceCard.tsx rendered a cell labelled
-- "Avg. reply time" whose value came from
--
--     avg( applications.updated_at - applications.created_at )
--
-- over the ACCEPTED applications this member had SUBMITTED
-- (`applications … .eq("helper_id", userId)`). Both ends of that subtraction
-- belong to somebody else:
--
--   * `created_at` is the moment the helper applied — the only helper action
--     on the row, and it is the START of the interval, not the end.
--   * `updated_at` is stamped by `update_applications_updated_at`
--     (20260311000404), a BEFORE UPDATE trigger that fires on ANY write. RLS
--     ("Job owners can update application status", same file) means the only
--     member who can write that row is the POSTER. So the interval measured
--     how long the poster took to act — published under the helper's name as
--     their reply speed.
--
-- And `updated_at` is worse than "the poster's decision time", because it is a
-- last-touch column, not a decision clock. Measured on prod 2026-09-01
-- (fncmgoasalhdgfwzhsqa, service role, read-only):
--
--   helper              application created_at        applications.updated_at
--   Camille Robicheaux  2026-08-05T16:50:00+00        2026-08-27T20:54:31.931481+00
--   Tre Boudreaux       2026-08-10T18:20:00+00        2026-08-27T20:54:31.931481+00
--   Lexi Lombas         2026-08-24T20:10:00+00        2026-08-27T20:54:31.931481+00
--
-- Three different helpers, three different jobs, two different posters — one
-- identical `updated_at` to the microsecond. That is a single bulk maintenance
-- write, and the card was rendering the distance from each helper's
-- application to that write as that helper's "Avg. reply time": 22d, 17d and
-- 3d respectively. Nobody replied to anything.
--
-- ── WHAT A REPLY TIME ACTUALLY IS ──────────────────────────────────────────
-- The one place this platform records a member choosing to answer another
-- member is `public.messages`. So: within each (job, pair) thread, whenever the
-- other party speaks and this member speaks next, the gap between the FIRST
-- message of the other party's turn and this member's reply is one observation.
-- Median over those observations. Both endpoints are real timestamps of real
-- human actions, and the second one is this member's.
--
-- MEDIAN, not mean. Prod again: Lexi Lombas has 29 observed replies with a
-- median of 47 minutes and a mean of 396 — a single overnight gap drags the
-- mean by a factor of eight. "Typically replies in about 45m" is the honest
-- claim; the mean is a claim about their worst night.
--
-- FLOOR OF 5, NULL BELOW IT. Same floor `get_public_profile_stats`
-- (20260901002325) puts on cancellation, on-time and revision rates, for the
-- same stated reason: a rate off one or two data points is a lie of precision.
-- Below five replies this returns NULL and the card says "not enough history
-- yet" rather than rendering a number. It never returns 0.
--
-- ── SCOPE: THE OWNER, AND ONLY THE OWNER ───────────────────────────────────
-- This function takes NO argument and reads `auth.uid()` directly, so it
-- cannot be pointed at another member. That is deliberate and it preserves
-- exactly the visibility the broken stat had: `applications` is party-scoped by
-- RLS, so a visitor already measured this as zero rows and the cell never
-- rendered for them. Publishing a reply time to strangers would be a NEW
-- disclosure decision — a defensible one now that the number is true — and it
-- belongs in `get_public_profile_stats` alongside the other public aggregates,
-- not smuggled in by the migration that fixes the arithmetic.
--
-- `is_system = false`: the lifecycle system messages ("Helpr is on the way")
-- are written by a trigger, not by a person, and counting one as somebody's
-- prompt-and-reply would reintroduce the exact defect this file removes.
--
-- ── SECURITY ───────────────────────────────────────────────────────────────
-- SECURITY DEFINER + `SET search_path TO 'public'`, matching get_safe_profiles
-- and get_public_profile_stats. DEFINER is not what grants the read here —
-- the caller could read their own messages under RLS anyway; it is so the
-- aggregation happens in one round trip on the server instead of shipping an
-- unbounded message history to the client to be averaged in JavaScript.
-- Nothing about another member leaves the function: the only outputs are a
-- count and a median of intervals, both computed over rows where the caller is
-- a party. Granted to `authenticated` only — anon has no `auth.uid()` and would
-- get an empty set regardless.
--
-- Replay-safe: DROP … IF EXISTS before CREATE, writes no data, applying it
-- three times in a row is a no-op after the first.

DROP FUNCTION IF EXISTS public.get_my_reply_latency();

CREATE FUNCTION public.get_my_reply_latency()
RETURNS TABLE(
  -- How many prompt→reply pairs the median was computed from. Returned even
  -- when the median is NULL, so the caller can tell "not enough history yet"
  -- from "this stat is broken" and say which, out loud.
  reply_sample integer,
  -- Median minutes from the other party's message to this member's reply.
  -- NULL below the sample floor. Never 0.
  median_reply_minutes numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH me AS (
    SELECT auth.uid() AS uid
  ),
  -- Every non-system message in a thread the caller is a party to, tagged with
  -- whether the caller sent it. A thread is one (job, unordered pair) — the
  -- same key the Messages list uses — so a reply is never matched across two
  -- different conversations that happen to share a job.
  thread_msgs AS (
    SELECT
      m.job_id,
      LEAST(m.sender_id, m.receiver_id)    AS p1,
      GREATEST(m.sender_id, m.receiver_id) AS p2,
      (m.sender_id = me.uid)               AS mine,
      m.created_at
    FROM public.messages m
    CROSS JOIN me
    WHERE me.uid IS NOT NULL
      AND m.is_system = false
      AND (m.sender_id = me.uid OR m.receiver_id = me.uid)
  ),
  -- Gaps-and-islands: collapse each consecutive run by the same speaker into
  -- one "turn". Without this, a poster who sends four messages in a row would
  -- produce four observations, three of which measure nothing but how fast
  -- they typed.
  flagged AS (
    SELECT
      tm.*,
      LAG(tm.mine) OVER (PARTITION BY tm.job_id, tm.p1, tm.p2 ORDER BY tm.created_at) AS prev_mine
    FROM thread_msgs tm
  ),
  islands AS (
    SELECT
      f.*,
      SUM(CASE WHEN f.prev_mine IS NULL OR f.prev_mine <> f.mine THEN 1 ELSE 0 END)
        OVER (PARTITION BY f.job_id, f.p1, f.p2 ORDER BY f.created_at
              ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS turn
    FROM flagged f
  ),
  turn_starts AS (
    SELECT job_id, p1, p2, turn, mine, MIN(created_at) AS started_at
    FROM islands
    GROUP BY job_id, p1, p2, turn, mine
  ),
  -- One observation per turn of ours that answers a turn of theirs. Measured
  -- from the START of their turn (the moment they were first waiting on us),
  -- not its end.
  replies AS (
    SELECT (mine.started_at - theirs.started_at) AS latency
    FROM turn_starts mine
    JOIN turn_starts theirs
      ON  theirs.job_id = mine.job_id
      AND theirs.p1     = mine.p1
      AND theirs.p2     = mine.p2
      AND theirs.turn   = mine.turn - 1
    WHERE mine.mine
      AND NOT theirs.mine
      AND mine.started_at > theirs.started_at
  )
  SELECT
    COUNT(*)::integer,
    CASE WHEN COUNT(*) >= 5 THEN
      ROUND(
        (EXTRACT(EPOCH FROM percentile_cont(0.5) WITHIN GROUP (ORDER BY latency)) / 60.0)::numeric,
        1
      )
    END
  FROM replies;
$function$;

COMMENT ON FUNCTION public.get_my_reply_latency() IS
  'Median minutes the CALLER takes to reply to the other party in a job '
  'message thread, plus the sample it was computed from. Replaces the profile '
  'card''s "Avg. reply time", which was avg(applications.updated_at - '
  'created_at) over applications the member SUBMITTED — i.e. how long the '
  'POSTER took to act on them, published under the helper''s name. Takes no '
  'argument and reads auth.uid(), so it is self-only. NULL below 5 replies, '
  'never 0.';

REVOKE ALL ON FUNCTION public.get_my_reply_latency() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_my_reply_latency()
  TO authenticated, service_role;
