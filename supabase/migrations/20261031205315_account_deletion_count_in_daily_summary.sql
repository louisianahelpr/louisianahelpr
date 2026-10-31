-- OPS-DEL (owner 10-29): nothing recorded that an account was deleted, so the owner could not tell how many members
-- left. A count-only log, and the daily member summary says how many.
--
-- 1. public.account_deletion_log: one row per deleted account, holding ONLY when it happened and when a summary
--    counted it. No user id, name, email or reason: it is a count, and a deleted member leaves nothing behind.
-- 2. A BEFORE DELETE trigger on auth.users writes that row for every deletion path at once (Delete account, the
--    admin's delete, under-13, the abandoned-signup sweep), because they all end in auth.admin.deleteUser. Counted:
--    a confirmed account (email_confirmed_at set) that is not a test account (profiles.is_seed or
--    public.is_test_subject, as the new-member summary skips them; owner: "test stuff should never be shown"). A
--    signup that never confirmed was never a member, so the abandoned-signup sweep adds nothing. BEFORE, so the
--    profile and the auth row are still there to read. The log write can never stop a deletion: an error is a
--    WARNING and the delete goes on.
-- 3. send_new_member_daily_summary (restated from its NEWEST CREATE, 20261031152136) also takes the deletions not yet
--    counted and adds "1 account was deleted." / "N accounts were deleted." to the one daily notice; a day with
--    deletions and no joins sends "No new members joined. ..."; a day with neither still sends nothing. Same title,
--    link, type and recipients; the deletions are marked counted with the same now() as the members.
-- 4. retract_new_member_notice_for_test_account (restated from 20261031152136) rebuilds a summary with the same
--    deletion sentence, and keeps a summary that still counts deletions after its last member is taken out.
-- The message text is one function, daily_member_summary_message, used by both.
-- Replay-safe: IF NOT EXISTS / CREATE OR REPLACE / DROP TRIGGER IF EXISTS. Grants as before (service_role only).
-- Proof: src/test/pglite/accountDeletionCount.pglite.mjs (NEW_MIGRATION=skip shows the [fix] checks red).

CREATE TABLE IF NOT EXISTS public.account_deletion_log (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  deleted_at timestamptz NOT NULL DEFAULT now(),
  summarized_at timestamptz
);
ALTER TABLE public.account_deletion_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.account_deletion_log FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.account_deletion_log TO service_role;
CREATE INDEX IF NOT EXISTS account_deletion_log_unsummarized_idx
  ON public.account_deletion_log (deleted_at) WHERE summarized_at IS NULL;

CREATE OR REPLACE FUNCTION public.log_account_deletion()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
BEGIN
  BEGIN
    IF OLD.email_confirmed_at IS NOT NULL
       AND NOT coalesce((SELECT p.is_seed FROM public.profiles p WHERE p.user_id = OLD.id), false)
       AND NOT public.is_test_subject(OLD.id) THEN
      INSERT INTO public.account_deletion_log DEFAULT VALUES;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    -- The count is never worth a refused deletion: say so in the log and let the delete go on.
    RAISE WARNING 'log_account_deletion: could not count a deletion: %', SQLERRM;
  END;
  RETURN OLD;
END;
$fn$;
REVOKE ALL ON FUNCTION public.log_account_deletion() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS zz_log_account_deletion ON auth.users;
CREATE TRIGGER zz_log_account_deletion
  BEFORE DELETE ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.log_account_deletion();

-- The daily notice's one message: who joined (new_member_summary_message), then how many accounts were deleted.
CREATE OR REPLACE FUNCTION public.daily_member_summary_message(p_ids uuid[], p_deleted integer)
 RETURNS text
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT concat_ws(' ',
           CASE WHEN coalesce(cardinality(p_ids), 0) > 0 THEN public.new_member_summary_message(p_ids)
                ELSE 'No new members joined.' END,
           CASE WHEN coalesce(p_deleted, 0) = 1 THEN '1 account was deleted.'
                WHEN coalesce(p_deleted, 0) > 1 THEN p_deleted || ' accounts were deleted.' END)
$function$;
REVOKE ALL ON FUNCTION public.daily_member_summary_message(uuid[], integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.daily_member_summary_message(uuid[], integer) TO service_role;

CREATE OR REPLACE FUNCTION public.send_new_member_daily_summary()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_ids     uuid[];
  v_skipped integer;
  v_count   integer;
  v_deleted integer;
  v_del_ids bigint[];
  v_message text;
  v_sent    integer;
BEGIN
  -- Marked a test account after confirming, or deleted since: never named, and
  -- never read again. The lock keeps two overlapping runs from sending twice.
  WITH pending AS (
    SELECT n.user_id FROM public.new_member_admin_notices n
     WHERE n.summarized_at IS NULL
     FOR UPDATE OF n
  ), skipped AS (
    UPDATE public.new_member_admin_notices n
       SET summarized_at = now()
      FROM pending
     WHERE n.user_id = pending.user_id
       AND (public.is_test_subject(n.user_id)
            OR NOT EXISTS (SELECT 1 FROM public.profiles p
                            WHERE p.user_id = n.user_id
                              AND NOT coalesce(p.is_seed, false)
                              AND p.anonymized_at IS NULL))
    RETURNING 1
  )
  SELECT count(*) INTO v_skipped FROM skipped;

  SELECT array_agg(x.user_id) INTO v_ids
    FROM (SELECT n.user_id FROM public.new_member_admin_notices n
           WHERE n.summarized_at IS NULL
           ORDER BY n.notified_at, n.user_id
           FOR UPDATE OF n) x;
  v_count := coalesce(array_length(v_ids, 1), 0);
  -- OPS-DEL: the deletions not yet counted (locked the same way).
  SELECT array_agg(x.id) INTO v_del_ids
    FROM (SELECT d.id FROM public.account_deletion_log d WHERE d.summarized_at IS NULL FOR UPDATE OF d) x;
  v_deleted := coalesce(array_length(v_del_ids, 1), 0);
  IF v_count = 0 AND v_deleted = 0 THEN
    RETURN jsonb_build_object('members', 0, 'skipped', v_skipped, 'deleted', 0, 'sent', 0);
  END IF;

  v_message := public.daily_member_summary_message(v_ids, v_deleted);

  INSERT INTO public.notifications (user_id, title, message, type, link)
  SELECT ur.user_id,
         'New member summary',
         v_message,
         'admin_alert',
         '/admin?view=people'
    FROM (SELECT DISTINCT r.user_id FROM public.user_roles r WHERE r.role = 'admin') ur;
  GET DIAGNOSTICS v_sent = ROW_COUNT;
  -- Nobody to tell: keep them queued for the next run.
  IF v_sent = 0 THEN
    RETURN jsonb_build_object('members', v_count, 'skipped', v_skipped, 'deleted', v_deleted, 'sent', 0);
  END IF;

  UPDATE public.new_member_admin_notices
     SET summarized_at = now()
   WHERE user_id = ANY (v_ids);
  UPDATE public.account_deletion_log
     SET summarized_at = now()
   WHERE id = ANY (v_del_ids);
  RETURN jsonb_build_object('members', v_count, 'skipped', v_skipped, 'deleted', v_deleted, 'sent', v_sent);
END;
$function$;

REVOKE ALL ON FUNCTION public.send_new_member_daily_summary() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.send_new_member_daily_summary() TO service_role;

-- Marked a test account: no admin notice keeps their name. Restated from 20261031152136; the rebuilt message keeps
-- the summary's deletion sentence, and a summary that still counts deletions stays when its last member goes.
CREATE OR REPLACE FUNCTION public.retract_new_member_notice_for_test_account()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_at      timestamptz;
  v_ids     uuid[];
  v_deleted integer;
BEGIN
  IF NEW.is_seed IS TRUE AND OLD.is_seed IS DISTINCT FROM TRUE THEN
    DELETE FROM public.notifications n
     WHERE n.user_id IN (SELECT r.user_id FROM public.user_roles r WHERE r.role = 'admin')
       AND n.title = 'New member joined'
       AND n.link = '/admin?view=people&user=' || NEW.user_id::text;

    -- A summary already sent that named them: rebuilt from the members still
    -- real, or deleted when nobody is left.
    SELECT n.summarized_at INTO v_at
      FROM public.new_member_admin_notices n WHERE n.user_id = NEW.user_id;
    IF v_at IS NOT NULL THEN
      SELECT array_agg(n.user_id ORDER BY n.notified_at, n.user_id) INTO v_ids
        FROM public.new_member_admin_notices n
        JOIN public.profiles p ON p.user_id = n.user_id
       WHERE n.summarized_at = v_at
         AND n.user_id <> NEW.user_id
         AND NOT coalesce(p.is_seed, false)
         AND p.anonymized_at IS NULL
         AND NOT public.is_test_subject(n.user_id);
      SELECT count(*) INTO v_deleted FROM public.account_deletion_log d WHERE d.summarized_at = v_at;
      IF v_ids IS NULL AND v_deleted = 0 THEN
        DELETE FROM public.notifications x
         WHERE x.user_id IN (SELECT r.user_id FROM public.user_roles r WHERE r.role = 'admin')
           AND x.title = 'New member summary'
           AND x.created_at = v_at;
      ELSE
        UPDATE public.notifications x
           SET message = public.daily_member_summary_message(v_ids, v_deleted)
         WHERE x.user_id IN (SELECT r.user_id FROM public.user_roles r WHERE r.role = 'admin')
           AND x.title = 'New member summary'
           AND x.created_at = v_at;
      END IF;
    END IF;

    -- Still waiting for the next summary: never named.
    UPDATE public.new_member_admin_notices
       SET summarized_at = now()
     WHERE user_id = NEW.user_id AND summarized_at IS NULL;
  END IF;
  RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION public.retract_new_member_notice_for_test_account() FROM PUBLIC, anon, authenticated;

-- Q807: every public table carries the unconfirmed-email statement gate (db-smoke's class check
-- scripts/ci/unconfirmed-email-gate.sql). account_deletion_log is written only by the BEFORE DELETE
-- trigger above, which swallows every error, so the gate can never block a delete.
DO $do$
BEGIN
  IF to_regprocedure('public.attach_unconfirmed_email_gate()') IS NOT NULL THEN
    PERFORM public.attach_unconfirmed_email_gate();
  END IF;
END
$do$;
