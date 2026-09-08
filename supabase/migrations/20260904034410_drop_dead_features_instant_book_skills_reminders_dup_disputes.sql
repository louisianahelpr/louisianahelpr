-- Four fully dead objects, cut rather than left as accumulating dead
-- weight. Each was independently confirmed to have no path to ever be
-- populated, exercised, or read — not merely unused today.
--
-- 1. `jobs.instant_book` + `instant_book_claim()`. No caller in the entire
--    repo ever sets `instant_book: true` — the post-job form has no toggle
--    for it, `buildJobInsertPayload` only spreads the key when it is
--    already true, and nothing produces that true. 0 of every job ever
--    posted has this column set. The RPC that would claim an instant-book
--    job is consequently unreachable. Client code still reads
--    `job.instant_book` in a few display branches (JobCard's "Instant"
--    badge, JobDetailFooter, ApplyConfirmDialog) — left in place
--    deliberately: those branches are provably dead already (the column
--    read is always undefined/false) and removing them is pure
--    code-cleanup with no schema dependency, safe to do separately without
--    a migration.
--
-- 2. `helper_skills` + `skill_endorsements` + `endorse_skill()`. Zero rows
--    in both tables. `helper_skills` has exactly one reference anywhere in
--    src/ or supabase/functions/ (the read SkillEndorsements.tsx did) and
--    NO INSERT path at all — there was never a way for a helper to add a
--    skill, so the section this fed was structurally guaranteed to render
--    empty forever. Client component removed in the same commit as this
--    migration.
--
-- 3. `home_maintenance_reminders`. Exactly one writer
--    (useLifecycleHandlers.ts, on job completion) and zero readers
--    anywhere — no cron, no notification, no query. 5 rows accumulated
--    with `next_reminder_date` set and nothing ever going to act on them.
--    Write removed in the same commit as this migration.
--
-- 4. `job_disputes`. A duplicate of `disputes` (2 seed rows in each, same
--    job_ids, same timestamps) with zero readers — the one client query
--    against it was deleted 2026-08-31 because its own RLS policy made the
--    count always read 0 (UserProfile.tsx / useUserProfileData.ts both
--    carry the tombstone comment explaining why). `user_strikes.dispute_id`
--    has a nullable FK to this table with exactly 1 non-null row in prod;
--    CASCADE drops that FK constraint (not the user_strikes table or its
--    data) and the one existing value is left as an orphaned uuid with
--    nothing further pointing at it, which is the correct outcome for a
--    reference into a table being deliberately removed.
--
-- DESTRUCTIVE-DDL-ACK: DROP TABLE public.skill_endorsements
-- ACK-REASON: Zero rows ever; the table this depends on (helper_skills) has no insert path.
-- ACK-DATA-LOSS: Zero rows in the table's entire history — nothing has ever been written to it.
DROP TABLE IF EXISTS public.skill_endorsements CASCADE;

-- DESTRUCTIVE-DDL-ACK: DROP TABLE public.helper_skills
-- ACK-REASON: Zero rows ever; no INSERT path exists anywhere in the app to populate it.
-- ACK-DATA-LOSS: Zero rows in the table's entire history — nothing has ever been written to it.
DROP TABLE IF EXISTS public.helper_skills CASCADE;

-- DESTRUCTIVE-DDL-ACK: DROP FUNCTION public.endorse_skill(uuid)
-- ACK-REASON: Only writer of skill_endorsements, which is dropped above in the same migration.
-- ACK-DATA-LOSS: No data — this drops a function definition, not rows.
DROP FUNCTION IF EXISTS public.endorse_skill(p_skill_id uuid);

-- DESTRUCTIVE-DDL-ACK: DROP TABLE public.home_maintenance_reminders
-- ACK-REASON: 5 rows, zero readers anywhere in the app (no cron, no notification, no query) — a write nothing has ever acted on.
-- ACK-DATA-LOSS: 5 rows of reminder scheduling data for 3 real (non-seed) posters. No notification was ever going to fire from them.
DROP TABLE IF EXISTS public.home_maintenance_reminders CASCADE;

-- DESTRUCTIVE-DDL-ACK: DROP TABLE public.job_disputes
-- ACK-REASON: Duplicate of the real `disputes` table (same 2 rows, same job_ids); its only client reader was deleted 2026-08-31 because RLS made the count always read 0.
-- ACK-DATA-LOSS: 2 rows, both is_seed fixture data, both duplicated verbatim in `disputes`. user_strikes.dispute_id's one non-null reference (nullable column) becomes an orphaned value with the FK constraint removed.
DROP TABLE IF EXISTS public.job_disputes CASCADE;

-- DESTRUCTIVE-DDL-ACK: DROP COLUMN public.jobs.instant_book
-- ACK-REASON: 0 of every job ever posted has this column true — no code path in the app has ever set it, so it has never carried a real value.
-- ACK-DATA-LOSS: Zero rows carry a true value — every one of every job ever posted reads false, the column default.
ALTER TABLE public.jobs DROP COLUMN IF EXISTS instant_book;

-- DESTRUCTIVE-DDL-ACK: DROP FUNCTION public.instant_book_claim(uuid)
-- ACK-REASON: The only RPC that reads jobs.instant_book, dropped above in this same migration — this function can never be reached again.
-- ACK-DATA-LOSS: No data — this drops a function definition, not rows.
DROP FUNCTION IF EXISTS public.instant_book_claim(p_job_id uuid);
