-- Q1803 (OWNER RULING 2026-10-21, COPPA): a birthday that makes a member
-- UNDER 13 is BLOCKED and the account DELETED.
--
-- WHAT THIS DOES
--   * profiles.under_13_blocked_at: when an under-13 birthday was refused.
--     No member can UPDATE it (no column grant; only this trigger and the
--     service role set it). profiles' table-level INSERT is untouched: a
--     member's own profile row already exists, and stamping it would only
--     delete their own account. The member reads it (ProtectedRoute shows "You must be
--     13 or older to use Louisiana Helpr" and signs them out).
--   * block_under_13_birthday(), BEFORE INSERT OR UPDATE OF date_of_birth on
--     profiles, for the member's own write and the service role's
--     (complete-signup): an under-13 birthday is NEVER STORED (an INSERT
--     stores NULL, an UPDATE keeps the birthday already on the row, which is
--     never under 13), the row is stamped under_13_blocked_at, and the
--     under-13-delete edge function is called (pg_net, after commit) to delete
--     the account at once through the normal accountPurge path. That write is
--     not failed: a refused save that left no trace would leave nothing for
--     the deletion to act on. Two inputs ARE refused, never a deletion: another
--     member's session (an admin) typing an under-13 birthday
--     (under_13_birthday), and a birthday after today (birthday_in_future).
--   * cron under-13-delete every 5 minutes: the backstop for a call that never
--     arrived (no vault secret, a failed request); it deletes every stamped
--     account. MONEY IN FLIGHT (lead 2026-10-21): the account stays locked,
--     its personal fields are blanked, ONE admin alert is sent and stamped in
--     under_13_waiting_since, and later sweeps skip it quietly until the
--     money clears (no alert every 5 minutes).
--
-- RETAINED: nothing beyond what accountPurge already keeps for any deletion
-- (retained_bans only for an account that was banned; an under-13 account is
-- not banned by this). No birthday, no fingerprint, no flag survives.
--
-- Under 13 is decided on the America/Chicago calendar date, as
-- lock_under_18_birthday and refuse_under_18_member decide 18.
--
-- REPLAY-SAFE: ADD COLUMN IF NOT EXISTS, CREATE OR REPLACE, DROP TRIGGER IF
-- EXISTS, cron.schedule upserts by name; grants restated by role name.
-- Measured on prod 2026-10-21 (read-only): 0 profiles with a birthday under 13
-- (0 under 18); authenticated holds UPDATE (date_of_birth).

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS under_13_blocked_at timestamptz;
COMMENT ON COLUMN public.profiles.under_13_blocked_at IS
  'Q1803 (COPPA): when an under-13 birthday was refused on this account. Set only by block_under_13_birthday (the birthday itself is never stored); under-13-delete deletes every stamped account. Members read it, never write it.';
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS under_13_waiting_since timestamptz;
COMMENT ON COLUMN public.profiles.under_13_waiting_since IS
  'Q1803: when under-13-delete found money in flight on a stamped account, blanked its personal fields and sent the ONE admin alert ("under-13 account waiting on money: settle then delete"). Later sweeps skip it quietly until the money clears. Written by the service role only (no member UPDATE grant), readable by the owner and admins like the rest of the row.';
-- No member UPDATE grant on either column (column grants are explicit), so
-- nobody but the trigger and the service role sets or clears them. Both are
-- readable through profiles' table-level SELECT (owner and admin rows only).
REVOKE UPDATE (under_13_blocked_at, under_13_waiting_since) ON TABLE public.profiles FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.block_under_13_birthday()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_url text;
  v_key text;
BEGIN
  IF NEW.date_of_birth IS NULL THEN
    RETURN NEW;
  END IF;
  -- A birthday after today is a typo, never a child: refused, never a deletion.
  IF NEW.date_of_birth > (now() AT TIME ZONE 'America/Chicago')::date THEN
    RAISE EXCEPTION 'birthday_in_future'
      USING ERRCODE = '22007', HINT = 'A birthday cannot be after today.';
  END IF;
  IF (NEW.date_of_birth + interval '13 years') <= (now() AT TIME ZONE 'America/Chicago')::date THEN
    RETURN NEW;
  END IF;

  -- Someone else's session typing it (an admin correcting a birthday) is
  -- refused, never a deletion: the ruling is about a member's own birthday.
  IF auth.uid() IS NOT NULL AND auth.uid() IS DISTINCT FROM NEW.user_id THEN
    RAISE EXCEPTION 'under_13_birthday'
      USING ERRCODE = '22023', HINT = 'A birthday under 13 cannot be saved on another member''s account.';
  END IF;

  -- Never stored: actual knowledge of a child under 13 is not kept. An UPDATE
  -- keeps the birthday already on the row (never under 13: this trigger
  -- refuses to store one), so lock_under_18_birthday, which fires after this
  -- one, sees no change and a 13-17 member's under-13 claim is stamped and
  -- deleted exactly as complete-signup does, never refused instead.
  NEW.date_of_birth := CASE WHEN TG_OP = 'UPDATE' THEN OLD.date_of_birth ELSE NULL END;
  IF NEW.under_13_blocked_at IS NOT NULL THEN
    RETURN NEW;
  END IF;
  NEW.under_13_blocked_at := now();

  -- Delete at once (queued by pg_net, sent after this transaction commits).
  -- Any failure here is swallowed: the cron sweep deletes the stamped row.
  BEGIN
    SELECT decrypted_secret INTO v_url FROM vault.decrypted_secrets WHERE name = 'supabase_url' LIMIT 1;
    SELECT decrypted_secret INTO v_key FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1;
    IF v_url IS NOT NULL AND v_key IS NOT NULL THEN
      PERFORM net.http_post(
        url := v_url || '/functions/v1/under-13-delete',
        headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_key),
        body := jsonb_build_object('user_id', NEW.user_id)
      );
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'under-13 delete call not queued for %: %', NEW.user_id, SQLERRM;
  END;
  RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION public.block_under_13_birthday() FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.block_under_13_birthday() IS
  'Q1803 (COPPA): BEFORE INSERT OR UPDATE OF date_of_birth on profiles. An under-13 birthday (America/Chicago date) from the member or the service role is never stored (INSERT: NULL, UPDATE: the stored birthday is kept), under_13_blocked_at is stamped and under-13-delete called through pg_net to delete the account, and that write succeeds. Refused instead: another member''s session typing one (under_13_birthday) and a birthday after today (birthday_in_future).';

DO $do$
BEGIN
  IF to_regclass('public.profiles') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS trg_profiles_block_under_13 ON public.profiles;
    CREATE TRIGGER trg_profiles_block_under_13
      BEFORE INSERT OR UPDATE OF date_of_birth ON public.profiles
      FOR EACH ROW EXECUTE FUNCTION public.block_under_13_birthday();
  END IF;
END
$do$;

-- ── Kept locked on the SERVER (lh-authz-rls review of 49cbe2eb2c, must-fix 1) ──
-- An account waiting on money can stay stamped for days. is_caller_banned()
-- is what enforce_banned_profile_text_lock and the posting, applying and
-- messaging gates ask, so a stamped account is refused there too, from an old
-- build or a direct API call alike. ban_status is NOT set, so retain_ban_on_ban
-- never fires and nothing new is retained. Body restated from prod
-- (pg_get_functiondef, 2026-10-21) with the one added line; grants restated.
CREATE OR REPLACE FUNCTION public.is_caller_banned()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
     WHERE user_id = auth.uid()
       AND (
         (ban_status IN ('banned', 'temp_banned', 'permanently_banned')
          -- A lapsed suspension the sweeper hasn't lifted yet does not block:
          -- the sweep runs on a timer, rights come back on the clock.
          AND (ban_status <> 'temp_banned'
               OR auto_suspended_until IS NULL
               OR auto_suspended_until > now()))
         -- Q1803: an under-13 account waiting to be deleted.
         OR under_13_blocked_at IS NOT NULL
       )
  );
$function$;
REVOKE ALL ON FUNCTION public.is_caller_banned() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_caller_banned() TO authenticated, service_role;

-- ── Schedule + liveness registry ──────────────────────────────────────────
DO $do$
BEGIN
  IF to_regclass('public.cron_work_expectations') IS NOT NULL THEN
    INSERT INTO public.cron_work_expectations (jobname, expected_max_gap, note, work_visibility, work_exempt_reason)
    VALUES ('under-13-delete', interval '1 hour',
            'Q1803 (owner 2026-10-21, COPPA): every 5 minutes deletes any account stamped under_13_blocked_at (an under-13 birthday was refused) through accountPurge, the backstop for the trigger''s own call.',
            'exempt',
            'No stamped account is the healthy state, so a run that deletes nothing is not a silent failure. An account waiting on money in flight is skipped quietly after its one admin alert. A purge that fails answers 500 through cronResult.')
    ON CONFLICT (jobname) DO UPDATE SET expected_max_gap = EXCLUDED.expected_max_gap, note = EXCLUDED.note,
      work_visibility = EXCLUDED.work_visibility, work_exempt_reason = EXCLUDED.work_exempt_reason;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    PERFORM cron.schedule('under-13-delete', '3-59/5 * * * *', $c$SELECT public.cron_http_tag(q.request_id, 'under-13-delete')
  FROM (
      SELECT net.http_post(timeout_milliseconds := 90000,
        url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'supabase_url' LIMIT 1)
               || '/functions/v1/under-13-delete',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1)
        ),
        body := '{}'::jsonb
      )
) AS q(request_id);$c$);
  END IF;
END
$do$;
