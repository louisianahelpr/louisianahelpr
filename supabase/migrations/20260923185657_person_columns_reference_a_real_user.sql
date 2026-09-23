-- A PREFERENCE ROW, AND A MESSAGE'S SENDER, MUST NAME SOMEONE WHO EXISTS.
-- (docs/OPEN.md Q282 and Q262.)
--
-- Q282 — MEASURED on prod 2026-09-23: 255 notification_preferences rows whose
-- user_id has no auth.users row, and pg_constraint showed 0 foreign keys on
-- the table. purge_user_data() deletes the row on a normal account deletion,
-- but any other path that removes an auth user (the admin API, which is how
-- the Q205(d) fixtures were deleted; a support-side delete) leaves it behind,
-- because nothing cascades from a column with no FK.
--
-- WHICH TARGET: auth.users(id). The column means the auth user id: every
-- writer puts an auth id there (handle_new_user inserts NEW.id from the
-- auth.users trigger; the client upserts auth.uid(); the fan-out self-heal
-- uses notifications.user_id, which already references profiles.user_id,
-- which itself CASCADEs from auth.users). The orphan count above was measured
-- against auth.users, so that is the anchor that makes those rows impossible.
--
-- WHY CASCADE: a preference row means nothing without the person, and
-- purge_user_data() already deletes it (4c), so the cascade only ever acts on
-- the paths that skip the purge. It cannot break the self-heal insert in
-- fan_out_push_on_notification(): that runs for a notifications row, whose
-- user_id must exist in profiles and therefore in auth.users.
--
-- Q262 — messages.sender_id / receiver_id had no FK (none in any migration).
--
--   sender_id -> auth.users(id) ON DELETE CASCADE. purge_user_data() 4c
--   deletes exactly `messages WHERE sender_id = p_user_id` before the auth
--   user is deleted, so on the normal deletion path the cascade finds nothing
--   left to do; on a path that skips the purge it does what the purge would
--   have (the departed person's own words go). It is added NOT VALID and
--   validated only when no existing row violates it: existing orphans may
--   carry attachment_url, the ONLY pointer to their storage object
--   (accountPurge.ts collectMessageAttachments), so this migration does not
--   delete them blind. The NOTICE says how many; NOT VALID still enforces the
--   FK on every new row and still cascades.
--
--   receiver_id: NO foreign key, on purpose. Account deletion ANONYMISES
--   (CLAUDE.md "A job can outlive its poster"): purge_user_data() 4c keeps the
--   messages the COUNTERPARTY wrote to the departed user, because they are the
--   counterparty's record. Every ON DELETE action breaks that: CASCADE deletes
--   them, SET NULL fails (receiver_id is NOT NULL, and threads are keyed on
--   the other party's id), NO ACTION/RESTRICT makes the auth delete itself
--   fail, i.e. breaks account deletion. What an FK would still buy — no NEW
--   message to someone who does not exist — is enforced here at insert time
--   instead (messages_receiver_exists). Today that is only true by accident:
--   the new-message notification's insert fails on notifications_user_id_fkey,
--   and that notification is skipped for flagged messages.
--
-- REPLAY-SAFE: guarded on pg_constraint / to_regclass, CREATE OR REPLACE,
-- DROP TRIGGER IF EXISTS. Applied 3x in PGlite
-- (src/test/pglite/personColumnsReferenceARealUser.pglite.mjs).

-- ── Q282: notification_preferences.user_id -> auth.users(id) ──────────────
-- NOT VALID first, so a user deleted while this runs is cascaded rather than
-- becoming a new orphan between the DELETE and the validation.
DO $do$
DECLARE
  v_orphans int;
BEGIN
  IF to_regclass('public.notification_preferences') IS NULL OR to_regclass('auth.users') IS NULL THEN
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'notification_preferences_user_id_fkey'
       AND conrelid = 'public.notification_preferences'::regclass
  ) THEN
    ALTER TABLE public.notification_preferences
      ADD CONSTRAINT notification_preferences_user_id_fkey
      FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE NOT VALID;
  END IF;

  WITH del AS (
    DELETE FROM public.notification_preferences np
     WHERE NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = np.user_id)
    RETURNING 1
  ) SELECT count(*) INTO v_orphans FROM del;
  RAISE NOTICE 'Q282: deleted % notification_preferences row(s) whose user no longer exists', v_orphans;

  ALTER TABLE public.notification_preferences VALIDATE CONSTRAINT notification_preferences_user_id_fkey;
END
$do$;

-- ── Q262: messages.sender_id -> auth.users(id) ────────────────────────────
DO $do$
DECLARE
  v_orphans int;
BEGIN
  IF to_regclass('public.messages') IS NULL OR to_regclass('auth.users') IS NULL THEN
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'messages_sender_id_fkey'
       AND conrelid = 'public.messages'::regclass
  ) THEN
    ALTER TABLE public.messages
      ADD CONSTRAINT messages_sender_id_fkey
      FOREIGN KEY (sender_id) REFERENCES auth.users(id) ON DELETE CASCADE NOT VALID;
  END IF;

  SELECT count(*) INTO v_orphans
    FROM public.messages m
   WHERE NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = m.sender_id);

  IF v_orphans = 0 THEN
    ALTER TABLE public.messages VALIDATE CONSTRAINT messages_sender_id_fkey;
  ELSE
    RAISE NOTICE 'Q262: % messages row(s) name a sender who no longer exists; messages_sender_id_fkey left NOT VALID (enforced for new rows). Erase them with their attachments, then VALIDATE.', v_orphans;
  END IF;
END
$do$;

-- The cascade looks rows up by sender_id; without an index each deleted user
-- is a sequential scan of messages.
CREATE INDEX IF NOT EXISTS messages_sender_id_idx ON public.messages (sender_id);

-- ── Q262: messages.receiver_id must exist when a message is written ───────
CREATE OR REPLACE FUNCTION public.messages_receiver_must_exist()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = NEW.receiver_id) THEN
    RAISE EXCEPTION 'messages.receiver_id % does not name an existing user', NEW.receiver_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;
  RETURN NEW;
END;
$fn$;

REVOKE ALL ON FUNCTION public.messages_receiver_must_exist() FROM PUBLIC, anon, authenticated;

DO $do$
BEGIN
  IF to_regclass('public.messages') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS messages_receiver_exists ON public.messages;
    CREATE TRIGGER messages_receiver_exists BEFORE INSERT OR UPDATE OF receiver_id ON public.messages
      FOR EACH ROW EXECUTE FUNCTION public.messages_receiver_must_exist();
  END IF;
END
$do$;
