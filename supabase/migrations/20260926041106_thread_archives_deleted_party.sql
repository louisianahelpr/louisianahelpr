-- Q335 (owner, 2026-09-26): "let people archive deleted-account threads".
--
-- A thread whose other party deleted their account has no other party
-- (messages.receiver_id ON DELETE SET NULL, 20260924013306). The inbox groups
-- it per job under otherUserId = null. thread_archives keyed a thread on
-- (user_id, job_id, other_user_id) as its PRIMARY KEY, so other_user_id could
-- not be NULL and that thread could never be archived: it sat in the inbox
-- for good.
--
-- Change: other_user_id becomes nullable. NULL = "this job's deleted-account
-- thread". The key moves to a surrogate `id` primary key plus
-- UNIQUE NULLS NOT DISTINCT (user_id, job_id, other_user_id), so there is at
-- most ONE such row per viewer per job and the client's
-- upsert(onConflict: "user_id,job_id,other_user_id") still finds it
-- (NULLS NOT DISTINCT: PostgreSQL 15+; the CI replay image is 15).
--
-- Unchanged on purpose:
--   * other_user_id keeps REFERENCES auth.users(id) ON DELETE CASCADE.
--     SET NULL would turn an archive of a live thread into a deleted-party
--     row when the person deletes, and collide with an existing one, failing
--     the account deletion. CASCADE drops it instead; the thread then shows
--     as the deleted-account thread and can be archived again.
--     Guard: src/test/threadPartyForeignKeys.test.ts.
--   * RLS: owner-only on user_id, all four verbs (20260831011232). A NULL
--     other party is the viewer's own inbox setting and grants nothing.
--   * Grants: table-level, unchanged.
--
-- Replay-safe: each step checks the catalog first; applied 3x in PGlite
-- (src/test/pglite/threadArchivesDeletedParty.pglite.mjs).

ALTER TABLE public.thread_archives
  ADD COLUMN IF NOT EXISTS id uuid NOT NULL DEFAULT gen_random_uuid();

DO $migration$
BEGIN
  -- 1. The new natural key first, so uniqueness never lapses.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.thread_archives'::regclass
       AND conname = 'thread_archives_user_job_other_key'
  ) THEN
    ALTER TABLE public.thread_archives
      ADD CONSTRAINT thread_archives_user_job_other_key
      UNIQUE NULLS NOT DISTINCT (user_id, job_id, other_user_id);
  END IF;

  -- 2. Drop the old composite primary key (only that one, by its columns).
  IF EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.thread_archives'::regclass
       AND contype = 'p'
       AND pg_get_constraintdef(oid) = 'PRIMARY KEY (user_id, job_id, other_user_id)'
  ) THEN
    EXECUTE (
      SELECT format('ALTER TABLE public.thread_archives DROP CONSTRAINT %I', conname)
        FROM pg_constraint
       WHERE conrelid = 'public.thread_archives'::regclass AND contype = 'p'
    );
  END IF;

  -- 3. Surrogate primary key.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.thread_archives'::regclass AND contype = 'p'
  ) THEN
    ALTER TABLE public.thread_archives
      ADD CONSTRAINT thread_archives_pkey PRIMARY KEY (id);
  END IF;
END
$migration$;

ALTER TABLE public.thread_archives ALTER COLUMN other_user_id DROP NOT NULL;

COMMENT ON COLUMN public.thread_archives.other_user_id IS
  'The thread''s other party. NULL = this job''s deleted-account thread (Q335); '
  'at most one per user per job (thread_archives_user_job_other_key, NULLS NOT DISTINCT).';
