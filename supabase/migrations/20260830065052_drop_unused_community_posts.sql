-- community_posts / community_post_likes were a milestone-celebration feature
-- (auto-post "just completed their Nth job!" at 10/25/50/100/200/500
-- completions) whose write side shipped but whose read side never did — no
-- page, component, or admin view has ever queried these tables. Both are
-- empty in prod. Removing them along with the dead insert in
-- useLifecycleHandlers.ts (owner, 2026-08-30: "can be deleted its not used
-- at all") rather than leaving an inert write-only table + trigger around.
--
-- REPLAY-SAFETY: guarded with IF EXISTS so this is a no-op on a database
-- that already had these objects removed, and safe if a from-scratch replay
-- somehow runs this before 20260612240000_community_feed.sql is reached
-- (nothing to drop yet).

DROP TRIGGER IF EXISTS auto_approve_milestone_trigger ON public.community_posts;
DROP FUNCTION IF EXISTS public.auto_approve_milestone();

DROP TABLE IF EXISTS public.community_post_likes;
DROP TABLE IF EXISTS public.community_posts;
