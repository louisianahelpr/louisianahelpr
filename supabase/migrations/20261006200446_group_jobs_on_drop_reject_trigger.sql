-- Group jobs ON (owner, 2026-10-06: "on for everyone"; Q1079 the flip).
-- src/lib/groupJobs.ts GROUP_JOBS_ENABLED flips to true in the SAME commit,
-- as the flag's own comment requires (point 4): with the flag on and this
-- trigger installed, every crew post would be refused by the server.
--
-- Only the TRIGGER goes. public.reject_new_group_jobs() stays defined
-- (dormant): scripts/probes/null-uid-guards.probe.mjs exercises it from its
-- live-body fixture, and re-arming the refusal is one CREATE TRIGGER.
-- Replay-safe: IF EXISTS.
DROP TRIGGER IF EXISTS trg_reject_new_group_jobs ON public.jobs;
