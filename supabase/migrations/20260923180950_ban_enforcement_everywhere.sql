-- Q281: a banned account kept a live session and could still write to most of
-- the app.
--
-- MEASURED on prod 2026-09-23 (Q205(d) probe, throwaway users banned exactly as
-- apply_consequence_ladder's suspend rung does): the refresh_token grant after
-- the ban issued a NEW JWT and a fresh password sign-in returned 200, because
-- nothing ever set auth.users.banned_until. With that JWT the account was
-- refused on 8 table actions only (enforce_ban_gate) and went through on ~20
-- tables (edit/delete own messages, withdraw applications, push_tokens,
-- referral_codes, favorites, ...), 5 storage buckets and 10 RPCs
-- (set_available_now advertised a banned account as Available now).
--
-- Two layers, each checked live by scripts/ci/ban-gate-coverage.sql. The
-- session is deliberately LEFT ALIVE (owner decision, Q281/Q298, 2026-09-23:
-- "Let them sign in"): a banned account still signs in and refreshes, lands
-- only on /account-banned (ProtectedRoute isLockedOut), and can delete its
-- account or contact support from there (App Store 5.1.1(v)). Setting
-- auth.users.banned_until would lock it out of that screen, so no ban writer
-- may ever set it; the check's auth-ban:writer and auth-ban:set rules enforce
-- that. Everything else a banned session tries is refused by the database:
--
-- 2. TABLES. enforce_ban_gate is extended to every authenticated-writable
--    table/command a banned account has no business touching (list below), and
--    now returns OLD for DELETE (a BEFORE DELETE trigger that returns NEW,
--    which is NULL there, silently skips the delete for EVERYONE). The profiles
--    lock stops pinning only bio/full_name: a banned owner's UPDATE is refused
--    unless it touches only terms acceptance, marketing consent, senior mode,
--    or clears available_until. RPCs need no body change: the table triggers
--    fire inside SECURITY DEFINER functions too (auth.uid() is still the
--    caller), and every writing RPC is classified in the check's rpc_exempt.
--
-- 3. STORAGE. One RESTRICTIVE policy per command on storage.objects,
--    WITH CHECK (NOT is_caller_banned()), ANDs onto every bucket's own
--    INSERT/UPDATE policy, current and future. DELETE stays open (removing own
--    files only shrinks the footprint).
--
-- Deliberately NOT gated (the reasons are in the check's table_exempt): report,
-- block/unblock, mute, archive, notification preferences and read-state,
-- deleting own curation rows (favorites, saved jobs/searches, pets, hours,
-- calendar feeds), push token registration and removal (a banned account still
-- signs in and must get account notices), legal acceptances, login history,
-- telemetry, and admin-only tables.
--
-- REPLAY-SAFETY: every trigger is created only when its table exists, the
-- storage policies only when storage.objects exists; DROP ... IF EXISTS
-- before each CREATE. Runs 3x clean.

-- ── 2a. enforce_ban_gate: DELETE-safe ──────────────────────────────────────
CREATE OR REPLACE FUNCTION public.enforce_ban_gate()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- A ban that THIS transaction started does not refuse the rest of it (see
  -- 2d): the 3rd reliability strike inside helper_cancel_booking bans the
  -- caller and then writes jobs/applications; refusing those rolled the whole
  -- transaction back, ban included, so the ladder could never suspend.
  IF auth.uid() IS NOT NULL AND public.is_caller_banned()
     AND current_setting('app.ban_started_in_txn', true) IS DISTINCT FROM auth.uid()::text THEN
    RAISE EXCEPTION 'account_restricted'
      USING ERRCODE = '42501',
            HINT = 'This account is suspended or banned. See /account-banned for details.';
  END IF;
  -- A BEFORE DELETE row trigger must return OLD: NEW is NULL there, and
  -- returning NULL silently cancels the delete for every caller.
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.enforce_ban_gate() FROM PUBLIC, anon, authenticated;

-- ── 2b. the gate on every table/command a banned account must not write ───
DO $do$
DECLARE
  v_pair text;
  v_tbl  text;
  v_op   text;
  v_name text;
BEGIN
  FOREACH v_pair IN ARRAY ARRAY[
    'applications:UPDATE', 'applications:DELETE',
    'messages:UPDATE', 'messages:DELETE',
    'message_reactions:UPDATE', 'message_reactions:DELETE',
    'job_revisions:UPDATE', 'job_revisions:DELETE',
    'jobs:DELETE',
    'disputes:INSERT', 'disputes:UPDATE', 'disputes:DELETE',
    'group_job_helpers:INSERT', 'group_job_helpers:UPDATE', 'group_job_helpers:DELETE',
    'job_pets:INSERT', 'job_pets:UPDATE', 'job_pets:DELETE',
    'job_tracking:INSERT', 'job_tracking:UPDATE',
    'job_checkins:INSERT',
    'recurring_visit_releases:INSERT', 'recurring_visit_releases:DELETE',
    'helper_credentials:INSERT', 'helper_credentials:UPDATE',
    'helper_w9_records:INSERT',
    'helper_availability:INSERT', 'helper_availability:UPDATE',
    'favorite_helpers:INSERT', 'favorite_helpers:UPDATE',
    'saved_jobs:INSERT',
    'saved_searches:INSERT', 'saved_searches:UPDATE',
    'pet_profiles:INSERT', 'pet_profiles:UPDATE',
    'str_calendar_connections:INSERT', 'str_calendar_connections:UPDATE',
        'referral_codes:INSERT',
    'nps_responses:INSERT',
    'thread_pins:INSERT',
    'job_views:INSERT',
    'profile_views:INSERT'
  ] LOOP
    v_tbl  := split_part(v_pair, ':', 1);
    v_op   := split_part(v_pair, ':', 2);
    v_name := 'trg_ban_gate_' || v_tbl || '_' || lower(v_op);
    IF to_regclass('public.' || v_tbl) IS NOT NULL THEN
      EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.%I', v_name, v_tbl);
      EXECUTE format(
        'CREATE TRIGGER %I BEFORE %s ON public.%I FOR EACH ROW EXECUTE FUNCTION public.enforce_ban_gate()',
        v_name, v_op, v_tbl);
    END IF;
  END LOOP;
END
$do$;

-- ── 2c. profiles: a banned owner may change almost nothing ────────────────
-- Restated from its newest definition (20260915101102_null_uid_is_not_server);
-- the bio/full_name pin for non-owner writes is kept as it was.
CREATE OR REPLACE FUNCTION public.enforce_banned_profile_text_lock()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_changed text[];
BEGIN
  IF public.is_server_context() OR has_role(auth.uid(), 'admin') THEN
    RETURN NEW;
  END IF;

  IF current_setting('app.trusted_ladder_write', true) = 'on' THEN
    RETURN NEW;
  END IF;

  -- Q281: the banned owner's own writes. Everything they can still legitimately
  -- change: accepting terms (a legal record), withdrawing marketing consent,
  -- the Senior Mode accessibility switch, and clearing Available now. Anything
  -- else is refused outright rather than silently pinned, so the caller sees
  -- account_restricted instead of a 200 that changed nothing.
  IF auth.uid() = OLD.user_id AND public.is_caller_banned()
     AND current_setting('app.ban_started_in_txn', true) IS DISTINCT FROM auth.uid()::text THEN
    SELECT array_agg(n.key ORDER BY n.key)
      INTO v_changed
      FROM jsonb_each(to_jsonb(NEW)) n
      JOIN jsonb_each(to_jsonb(OLD)) o USING (key)
     WHERE n.value IS DISTINCT FROM o.value
       AND n.key NOT IN ('updated_at', 'terms_version_accepted', 'terms_accepted_at',
                         'accepted_terms_at', 'marketing_consent', 'senior_mode')
       AND NOT (n.key = 'available_until' AND n.value = 'null'::jsonb);
    IF v_changed IS NOT NULL THEN
      RAISE EXCEPTION 'account_restricted'
        USING ERRCODE = '42501',
              DETAIL = 'A suspended or banned account cannot change: ' || array_to_string(v_changed, ', '),
              HINT = 'This account is suspended or banned. See /account-banned for details.';
    END IF;
  END IF;

  -- OLD, not NEW: the question is whether they are banned RIGHT NOW, and
  -- prevent_self_escalation already pins ban_status so NEW cannot differ for a
  -- member anyway. Reading OLD makes that independent of trigger order.
  IF OLD.ban_status IN ('banned', 'temp_banned', 'permanently_banned') THEN
    NEW.full_name := OLD.full_name;
    NEW.bio       := OLD.bio;
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.enforce_banned_profile_text_lock() FROM PUBLIC, anon, authenticated;

-- ── 2d. a ban started in this transaction does not refuse the rest of it ──
-- Found by the lh-authz-rls review of Q281 (reproduced on prod in an aborted
-- transaction): helper_cancel_booking, decline_job_offer and helper_abort_job
-- call apply_job_denial_consequence(auth.uid(), ...) BEFORE their own jobs /
-- applications writes. On the 3rd strike that sets the CALLER temp_banned, the
-- gate then saw the in-transaction ban, raised 42501, and the whole
-- transaction rolled back, ban included. So the ladder could never suspend a
-- Helpr, and on that strike they could not cancel.
--
-- The fix is generic rather than per-RPC: when a profile goes from not
-- effectively banned to effectively banned, this trigger records the user in
-- a transaction-local setting, and the gate and the profile lock let THAT
-- user's remaining writes in THIS transaction through. The caller is judged as
-- they stood when their request began. A client cannot set app.* settings
-- through PostgREST (it sets only request.*), and every set_config in public
-- uses a literal name. An account ALREADY banned when the request began gets
-- no marker (its ban is not new), so it is refused exactly as before.
CREATE OR REPLACE FUNCTION public.mark_ban_started_in_txn()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  IF NEW.ban_status IN ('banned', 'temp_banned', 'permanently_banned')
     AND (NEW.ban_status <> 'temp_banned' OR NEW.auto_suspended_until IS NULL OR NEW.auto_suspended_until > now())
     AND NOT (
       COALESCE(OLD.ban_status, 'active') IN ('banned', 'temp_banned', 'permanently_banned')
       AND (OLD.ban_status <> 'temp_banned' OR OLD.auto_suspended_until IS NULL OR OLD.auto_suspended_until > now())
     )
  THEN
    PERFORM set_config('app.ban_started_in_txn', NEW.user_id::text, true);
  END IF;
  RETURN NULL;
END;
$function$;

REVOKE ALL ON FUNCTION public.mark_ban_started_in_txn() FROM PUBLIC, anon, authenticated;

DO $do$
BEGIN
  IF to_regclass('public.profiles') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS trg_mark_ban_started_in_txn ON public.profiles;
    CREATE TRIGGER trg_mark_ban_started_in_txn
      AFTER UPDATE OF ban_status, auto_suspended_until ON public.profiles
      FOR EACH ROW EXECUTE FUNCTION public.mark_ban_started_in_txn();
  END IF;
END
$do$;

-- ── 3. storage: no upload or overwrite while banned ───────────────────────
DO $do$
BEGIN
  IF to_regclass('storage.objects') IS NOT NULL THEN
    DROP POLICY IF EXISTS "ban gate: no uploads while banned" ON storage.objects;
    CREATE POLICY "ban gate: no uploads while banned" ON storage.objects
      AS RESTRICTIVE FOR INSERT TO authenticated
      WITH CHECK (NOT public.is_caller_banned());

    DROP POLICY IF EXISTS "ban gate: no overwrites while banned" ON storage.objects;
    CREATE POLICY "ban gate: no overwrites while banned" ON storage.objects
      AS RESTRICTIVE FOR UPDATE TO authenticated
      USING (NOT public.is_caller_banned())
      WITH CHECK (NOT public.is_caller_banned());
  END IF;
END
$do$;
