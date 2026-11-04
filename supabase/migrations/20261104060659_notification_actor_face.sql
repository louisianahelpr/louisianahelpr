-- Q2037 (faces): a job notice carries the person who caused it, so the bell can show their photo or initials
-- in place of the type icon (lead decision 2026-11-04, owner pre-approved).
--
-- notifications.actor_id uuid NULL REFERENCES profiles(user_id) ON DELETE SET NULL.
--
-- Who fills it: ONE BEFORE INSERT trigger, not each of the ~300 notify functions. Every job notice a member
-- causes is written inside that member's own request (the applicant's apply, the poster's hire, the sender's
-- message, the reviewer's review), so auth.uid() IS the actor. The trigger:
--   * only touches job notices (job_id IS NOT NULL; Declutter and account notices keep their type icon);
--   * sets actor_id := auth.uid() only when the caller is a signed-in member who is NOT the recipient and NOT
--     an admin (an admin's moderation notice must never show the admin's face);
--   * in a member session ALWAYS overwrites whatever actor_id the row carried, so no member can stamp another
--     person's face on a notice; a service-role / cron writer (auth.uid() NULL) may set it explicitly or leave
--     it NULL (no face: the type icon stays).
-- Members read it only on their own rows (the existing SELECT policy); the face itself comes from
-- get_safe_profiles (masked "First L." name + photo), the same source every job card already uses, so no new
-- member-readable PII. Members cannot UPDATE it: aa_notifications_member_updates_read_only lets a member change
-- only read.
--
-- Account deletion: purge_user_data keeps the profile row and anonymises it (anonymized_at), so ON DELETE SET
-- NULL alone would leave the departed member's id (and so their scrubbed face) on other people's notices. An
-- AFTER UPDATE OF anonymized_at trigger on profiles nulls actor_id at the purge, inside its transaction, the
-- same hook as scrub_departed_member_name_from_notifications (20261103022806).
--
-- No backfill: old rows keep their type icon. Proof: node src/test/pglite/notificationActorFace.pglite.mjs (3x).

ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS actor_id uuid NULL;

DO $do$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'notifications_actor_id_fkey'
                   AND conrelid = 'public.notifications'::regclass) THEN
    ALTER TABLE public.notifications
      ADD CONSTRAINT notifications_actor_id_fkey FOREIGN KEY (actor_id)
      REFERENCES public.profiles(user_id) ON DELETE SET NULL;
  END IF;
END
$do$;

CREATE INDEX IF NOT EXISTS notifications_actor_id_idx ON public.notifications (actor_id) WHERE actor_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.notifications_stamp_actor()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    -- service role / cron: keep what the writer set, but only on a job notice
    IF NEW.job_id IS NULL THEN NEW.actor_id := NULL; END IF;
    RETURN NEW;
  END IF;
  IF NEW.job_id IS NOT NULL
     AND v_uid IS DISTINCT FROM NEW.user_id
     AND NOT public.has_role(v_uid, 'admin') THEN
    NEW.actor_id := v_uid;
  ELSE
    NEW.actor_id := NULL;
  END IF;
  RETURN NEW;
END;
$fn$;

REVOKE ALL ON FUNCTION public.notifications_stamp_actor() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_notifications_stamp_actor ON public.notifications;
CREATE TRIGGER trg_notifications_stamp_actor
  BEFORE INSERT ON public.notifications
  FOR EACH ROW EXECUTE FUNCTION public.notifications_stamp_actor();

CREATE OR REPLACE FUNCTION public.clear_departed_member_notification_actor()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
BEGIN
  IF OLD.anonymized_at IS NOT NULL OR NEW.anonymized_at IS NULL THEN
    RETURN NEW;
  END IF;
  UPDATE public.notifications SET actor_id = NULL WHERE actor_id = OLD.user_id;
  RETURN NEW;
END;
$fn$;

REVOKE ALL ON FUNCTION public.clear_departed_member_notification_actor() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_profiles_clear_notification_actor ON public.profiles;
CREATE TRIGGER trg_profiles_clear_notification_actor
  AFTER UPDATE OF anonymized_at ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.clear_departed_member_notification_actor();
