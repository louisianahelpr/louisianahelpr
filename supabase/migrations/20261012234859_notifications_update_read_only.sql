-- A signed-in member may mark their own notifications read, and change nothing
-- else about them (lh-silent-failure review of the refund-email retry,
-- 2026-10-12; measured live the same day).
--
-- Live, 2026-10-12: authenticated (and anon) held table-level UPDATE on
-- public.notifications, and the only UPDATE policy, "Users can update their
-- own notifications", checks WHO (auth.uid() = user_id), not WHICH columns. So
-- a member could rewrite the title, words, link, type and created_at of their
-- own notices. Those words are not only shown to them: the refund-notice email
-- retry (void-cancelled-payments Part H) re-sends a notice's own title and
-- message by email, so a member could have a Louisiana Helpr email carry text
-- they wrote. Every client write measured (write-contract AST: NotificationPanel
-- x2, useMessagesRealtime, useMessagesData, useNavUnreadCount) and every e2e
-- write sends only { read: true }.
--
-- Why a trigger and not a column grant: narrowing authenticated's grant is a
-- schema break by this repo's rule (src/test/schemaBreakBumpsClientFloor.test.ts:
-- it must raise client_compat_floor(), which shows "Update Helpr" to every
-- installed app), though no shipped bundle writes anything but `read`. A row
-- trigger refuses the same writes for the client roles without narrowing a
-- privilege, the way enforce_hire_columns_rpc_only locks jobs columns.
--
-- notifications_member_updates_read_only (BEFORE UPDATE, named to fire before
-- any other row trigger, SECURITY INVOKER so current_user is the caller):
-- when the caller is authenticated or anon, any change to a column other than
-- `read` is refused with 42501. A definer function (link nulling, the
-- message-read triggers), service_role and postgres pass untouched.
--
-- Proof: src/test/pglite/notificationsUpdateReadOnly.pglite.mjs (applied 3x).
-- Replay-safe: CREATE OR REPLACE; DROP TRIGGER IF EXISTS; guarded on the table.

CREATE OR REPLACE FUNCTION public.notifications_member_updates_read_only()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $fn$
BEGIN
  -- A definer function (current_user = its owner), service_role, or postgres.
  IF current_user::text NOT IN ('authenticated', 'anon') THEN
    RETURN NEW;
  END IF;
  -- Every column but `read`, compared as a whole, so a column added later is
  -- locked too.
  IF (to_jsonb(NEW) - 'read') IS DISTINCT FROM (to_jsonb(OLD) - 'read') THEN
    RAISE EXCEPTION 'notifications_read_only: a member may only mark a notification read (id=%)', OLD.id
      USING ERRCODE = '42501',
            HINT = 'Send { read: true } only.';
  END IF;
  RETURN NEW;
END;
$fn$;

REVOKE ALL ON FUNCTION public.notifications_member_updates_read_only() FROM PUBLIC, anon, authenticated;

DO $$
BEGIN
  IF to_regclass('public.notifications') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS aa_notifications_member_updates_read_only ON public.notifications;
    CREATE TRIGGER aa_notifications_member_updates_read_only
      BEFORE UPDATE ON public.notifications
      FOR EACH ROW EXECUTE FUNCTION public.notifications_member_updates_read_only();
  END IF;
END
$$;
