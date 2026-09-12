-- A SAVED HELPER, AND A NOTIFICATION, MUST POINT AT SOMEONE WHO EXISTS.
--
-- WHY THIS EXISTS. On 2026-09-11 one customer received the same "availability
-- updated" notification every six hours for five days — 40 identical rows —
-- because `saved-helper-availability-push` stores its "already notified" cursor
-- with `.update(...).eq("user_id", id)`, and for a customer with no `profiles`
-- row that UPDATE matches zero rows and PostgREST answers
-- `{ data: null, error: null }`. The cursor never advanced, so the send
-- repeated forever. The edge function now guards that write, but the guard
-- treats a symptom: the row should never have been able to name a customer who
-- does not exist. `favorite_helpers` had NO foreign key on either of its two
-- user columns, and `notifications.user_id` had none either — which is how rows
-- came to exist for a user id present in neither `profiles` nor `auth.users`.
--
-- WHY `profiles(user_id)` AND NOT `auth.users(id)`. `profiles.user_id` is the
-- app's identity everywhere (CLAUDE.md: `profiles.id` is NOT `auth.users.id` —
-- use `user_id`), it already carries a UNIQUE constraint so it is a valid
-- target, and every one of the 8 live profiles has a matching `auth.users` row,
-- so this is the narrower of two equivalent anchors.
--
-- WHY `ON DELETE CASCADE` IS SAFE HERE, given account deletion ANONYMISES.
-- Deleting an account does not delete the profile — `20260901033011` sets
-- `profiles.anonymized_at` and redacts in place, deliberately, so a job can
-- outlive the person who posted it. A cascade therefore never fires on an
-- ordinary account deletion. It fires only on a HARD delete of a profile row,
-- which is exactly what produced the orphans this migration is closing, and in
-- that case a saved-helper bookmark and an unread notification are precisely
-- the rows that should go with it: neither means anything without the person.
--
-- THE ORPHANS WERE CLEARED FIRST, and in that order on purpose — a constraint
-- added over existing violations fails outright. 11 `favorite_helpers` rows
-- (backed up to docs/backups/orphan-favorite-helpers-2026-09-12.json) and 1
-- `notifications` row, all created on or before 2026-09-01, i.e. all predating
-- `20260902051631`, the migration that made account deletion purge these
-- tables. That deletion path works: the only `favorite_helpers` row created
-- after it is clean on both sides. So this is not closing an active leak, it is
-- removing the class of bug that the leak's residue was still able to cause.
--
-- REPLAY-SAFE: every statement is guarded, so applying this file three times in
-- a row is a no-op after the first.

-- favorite_helpers.customer_id -> profiles.user_id
DO $$
BEGIN
  IF to_regclass('public.favorite_helpers') IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM pg_constraint
       WHERE conname = 'favorite_helpers_customer_id_fkey'
         AND conrelid = 'public.favorite_helpers'::regclass
     )
  THEN
    ALTER TABLE public.favorite_helpers
      ADD CONSTRAINT favorite_helpers_customer_id_fkey
      FOREIGN KEY (customer_id) REFERENCES public.profiles(user_id) ON DELETE CASCADE;
  END IF;
END $$;

-- favorite_helpers.helper_id -> profiles.user_id
DO $$
BEGIN
  IF to_regclass('public.favorite_helpers') IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM pg_constraint
       WHERE conname = 'favorite_helpers_helper_id_fkey'
         AND conrelid = 'public.favorite_helpers'::regclass
     )
  THEN
    ALTER TABLE public.favorite_helpers
      ADD CONSTRAINT favorite_helpers_helper_id_fkey
      FOREIGN KEY (helper_id) REFERENCES public.profiles(user_id) ON DELETE CASCADE;
  END IF;
END $$;

-- notifications.user_id -> profiles.user_id
DO $$
BEGIN
  IF to_regclass('public.notifications') IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM pg_constraint
       WHERE conname = 'notifications_user_id_fkey'
         AND conrelid = 'public.notifications'::regclass
     )
  THEN
    ALTER TABLE public.notifications
      ADD CONSTRAINT notifications_user_id_fkey
      FOREIGN KEY (user_id) REFERENCES public.profiles(user_id) ON DELETE CASCADE;
  END IF;
END $$;

-- A foreign key does NOT create an index on the referencing side, and both of
-- these columns are filtered on constantly (every saved-helpers list, every
-- notification fetch). Without them the cascade also degrades to a sequential
-- scan per deleted profile.
CREATE INDEX IF NOT EXISTS favorite_helpers_customer_id_idx ON public.favorite_helpers (customer_id);
CREATE INDEX IF NOT EXISTS favorite_helpers_helper_id_idx   ON public.favorite_helpers (helper_id);
CREATE INDEX IF NOT EXISTS notifications_user_id_idx        ON public.notifications (user_id);

COMMENT ON CONSTRAINT favorite_helpers_customer_id_fkey ON public.favorite_helpers IS
  'Added 2026-09-12. A saved-helper row pointing at a customer with no profile is what let the availability push re-send the same notification every 6h for five days.';
