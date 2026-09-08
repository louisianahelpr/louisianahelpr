-- Eight columns are used as an RLS predicate and have no index that can serve
-- one, so every policy check on them is a sequential scan of the whole table.
--
-- An unindexed RLS qual is the specific kind of problem that is invisible until
-- it is expensive: the policy is CORRECT, the query returns the right rows, and
-- nothing anywhere reports a slow path. It only shows up as the table grows,
-- and it shows up on EVERY read, because the qual runs per candidate row rather
-- than once per query. On the free tier there is no headroom absorbing it.
--
-- This is prospective, not a live incident, and it is worth being precise about
-- that: all eight tables are effectively empty today (measured against prod
-- 2026-09-06 — `user_bans` holds 1 row, the other seven hold 0), so nothing is
-- slow right now and no user is affected. The reason to ship it before launch
-- rather than after is that two of the eight are written on a cadence, not per
-- user action, and they are the two that will grow fastest the moment real jobs
-- run:
--
--   * job_tracking.helper_id  — a location breadcrumb per ping while a helper
--                               is en route. One active job writes many rows.
--   * job_checkins.user_id    — an arrival record per check-in.
--
-- The other six (broadcast_dismissals, group_job_helpers, referrals,
-- subscription_cancel_reasons, tips, user_bans) grow per user action and are
-- included because the fix is the same one line and splitting the set would
-- leave a half-done job nobody comes back to.
--
-- HOW THE SET WAS DERIVED, so it can be re-derived rather than trusted: join
-- `pg_policies` quals against `pg_attribute` to find the user-shaped columns
-- each policy actually references, then LEFT JOIN `pg_index` on
-- `indkey[0] = attnum` and keep the misses. Leading key is the right test — a
-- composite index on (job_id, helper_id) does NOT serve a helper_id-only
-- predicate, so "the column appears in some index" would be the wrong question.
--
-- NOT CONCURRENTLY, deliberately. `supabase db push` runs each migration inside
-- a transaction and CREATE INDEX CONCURRENTLY cannot run in one. At these row
-- counts (max 1 row) a plain CREATE INDEX takes a lock measured in
-- microseconds, so the tradeoff CONCURRENTLY exists to manage does not arise.
-- If any of these tables is ever large when a similar index is added, that one
-- needs its own out-of-band CONCURRENTLY build instead.
--
-- REPLAY-SAFETY: every statement is CREATE INDEX IF NOT EXISTS, and each is
-- guarded on the table existing so a from-scratch rebuild that has not yet
-- reached a later migration cannot fail here. No ALTER, no DROP, no data
-- written — re-running this file is a no-op by construction.

DO $$
DECLARE
  -- table, column, index name. Kept as data rather than 8 near-identical
  -- blocks so the list reads as the derived set it is.
  targets CONSTANT text[][] := ARRAY[
    ['job_tracking',                'helper_id',   'idx_job_tracking_helper_id'],
    ['job_checkins',                'user_id',     'idx_job_checkins_user_id'],
    ['broadcast_dismissals',        'user_id',     'idx_broadcast_dismissals_user_id'],
    ['group_job_helpers',           'helper_id',   'idx_group_job_helpers_helper_id'],
    ['referrals',                   'referrer_id', 'idx_referrals_referrer_id'],
    ['subscription_cancel_reasons', 'user_id',     'idx_subscription_cancel_reasons_user_id'],
    ['tips',                        'tipper_id',   'idx_tips_tipper_id'],
    ['user_bans',                   'user_id',     'idx_user_bans_user_id']
  ];
  t text; c text; ix text;
BEGIN
  FOR i IN 1 .. array_length(targets, 1) LOOP
    t  := targets[i][1];
    c  := targets[i][2];
    ix := targets[i][3];

    -- The table guard is what makes this replay-safe against a rebuild in
    -- timestamp order. The column guard is the same idea one level down: a
    -- rename in a later migration should skip this, not abort the rebuild.
    --
    -- These are NESTED rather than ANDed, and that is not style. SQL's AND does
    -- NOT short-circuit — the planner may evaluate either operand first — so
    --   IF to_regclass('public.'||t) IS NOT NULL AND EXISTS (
    --        SELECT 1 FROM pg_attribute WHERE attrelid = ('public.'||t)::regclass ...)
    -- still raises `relation "public.<t>" does not exist` on a missing table,
    -- because the regclass CAST in the second operand throws before the first
    -- operand can rule it out. That is exactly the from-scratch-rebuild case
    -- this guard exists for, so the guard would have failed only in the
    -- situation it was written to survive. Proven in PGlite by dropping the
    -- table from the harness: ANDed => "relation does not exist"; nested =>
    -- skipped cleanly.
    IF to_regclass('public.' || t) IS NOT NULL THEN
      IF EXISTS (
        SELECT 1
        FROM pg_attribute a
        WHERE a.attrelid = ('public.' || t)::regclass
          AND a.attname  = c
          AND a.attnum   > 0
          AND NOT a.attisdropped
      ) THEN
        EXECUTE format(
          'CREATE INDEX IF NOT EXISTS %I ON public.%I (%I)', ix, t, c
        );
      END IF;
    END IF;
  END LOOP;
END $$;

-- Guarded for the same reason the CREATE is: in a from-scratch rebuild the DO
-- block above skips any table a later migration has not defined yet, and an
-- unguarded COMMENT on the index it therefore did not create would abort the
-- rebuild — turning a replay-safe migration into a replay-breaking one on the
-- last four lines. Caught by running the guard case in PGlite rather than by
-- reading it.
DO $$
BEGIN
  IF to_regclass('public.idx_job_tracking_helper_id') IS NOT NULL THEN
    EXECUTE $c$
      COMMENT ON INDEX public.idx_job_tracking_helper_id IS
        'Serves the RLS predicate on job_tracking.helper_id. Added '
        '20260907071400 with seven siblings: the qual ran as a sequential scan '
        'per candidate row. This table and job_checkins are the two in that '
        'set that grow per location ping rather than per user action.'$c$;
  END IF;
END $$;
