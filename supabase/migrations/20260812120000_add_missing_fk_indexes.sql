-- Add covering indexes for unindexed foreign keys flagged by the Supabase
-- performance advisor on 2026-08-12.
--
-- public.message_reactions(user_id)
--   The PK is (message_id, user_id). ON DELETE CASCADE from auth.users
--   must find all rows where user_id = X; the PK starts with message_id
--   and cannot satisfy that scan efficiently.
--
-- public.thread_pins(job_id)
--   The PK is (user_id, job_id, other_user_id) and an existing index covers
--   user_id. ON DELETE CASCADE from public.jobs scans by job_id alone --
--   neither the PK nor the user_id index covers that scan.
--
-- public.thread_pins(other_user_id)
--   Same table; FK to auth.users for the non-owner participant. ON DELETE
--   CASCADE scans by other_user_id alone -- no index covers it.
--
-- All statements use IF NOT EXISTS for replay-safety.

CREATE INDEX IF NOT EXISTS message_reactions_user_id_idx
  ON public.message_reactions (user_id);

CREATE INDEX IF NOT EXISTS thread_pins_job_id_idx
  ON public.thread_pins (job_id);

CREATE INDEX IF NOT EXISTS thread_pins_other_user_id_idx
  ON public.thread_pins (other_user_id);
