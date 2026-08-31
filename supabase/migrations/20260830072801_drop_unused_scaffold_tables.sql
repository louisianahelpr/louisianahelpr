-- Ten tables that were scaffolded (CREATE TABLE + RLS policies + indexes)
-- for features that never got wired to any code path. Verified for each,
-- not assumed from an empty row count: zero references in src/, zero in
-- supabase/functions/, zero in any public.* function body
-- (pg_get_functiondef ... ilike '%tablename%'), and zero in cron.job
-- commands. (owner, 2026-08-30: "ok delete all")
--
--   job_boosts               - a poster-triggered "notify nearby helpers
--                               about my stalled job" broadcast, distinct
--                               from the live paid boost on jobs.boosted_at.
--   helper_late_cancellations - meant to log late cancellations so a
--                               pattern could auto-shadowban; the live
--                               cancel-fee logic (jobs.late_cancellation /
--                               jobs.cancellation_fee) never writes here.
--   email_unsubscribe_tokens  - a token-based one-click unsubscribe link;
--                               superseded by notification_preferences,
--                               which is what send-marketing-blast actually
--                               checks.
--   helper_circles / helper_circle_members - never-built helper-grouping
--                               feature (member table FKs to the parent).
--   evacuation_pets           - never-built hurricane-evacuation pet
--                               tracking (FKs to pet_profiles, which is
--                               otherwise unaffected).
--   retainer_agreements       - never-built recurring-retainer contracts.
--   social_post_drafts        - never-built social-share drafting.
--   subscription_waitlist     - never-built paid-tier waitlist.
--   worker_protection_credits - never-built credit ledger (FKs to jobs,
--                               which is otherwise unaffected).
--
-- REPLAY-SAFETY: IF EXISTS on every drop, so this is a no-op on a database
-- that already had these removed, and safe regardless of replay order
-- relative to whichever migrations originally created them.

DROP TABLE IF EXISTS public.helper_circle_members;
DROP TABLE IF EXISTS public.helper_circles;
DROP TABLE IF EXISTS public.evacuation_pets;
DROP TABLE IF EXISTS public.job_boosts;
DROP TABLE IF EXISTS public.helper_late_cancellations;
DROP TABLE IF EXISTS public.email_unsubscribe_tokens;
DROP TABLE IF EXISTS public.retainer_agreements;
DROP TABLE IF EXISTS public.social_post_drafts;
DROP TABLE IF EXISTS public.subscription_waitlist;
DROP TABLE IF EXISTS public.worker_protection_credits;
