-- Parish badges are removed entirely (owner decision, 2026-09-15 pop-up:
-- "remove parish badges entirely").
--
-- What was left of the feature is one function. get_helper_parish_badges, its
-- only caller, was dropped as dead in 20260913053041, and no screen, hook or
-- edge function has called get_top_helpers_by_parish since (checked on main and
-- in live pg_proc 2026-09-15: no function body references it). It still ran
-- live and still returned other users' ids, names, bio and ratings to any
-- signed-in caller (EXECUTE granted to authenticated). Prod also ran a stale
-- body without 20260701000000's review-visibility filter, which the
-- function-body drift check had baselined pending this decision.
--
-- REPLAY-SAFETY: IF EXISTS.

DROP FUNCTION IF EXISTS public.get_top_helpers_by_parish(text, integer);
