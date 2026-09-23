-- Class check (Q281, 2026-09-23): a banned account is refused EVERYWHERE it
-- can write, except where an explicit, reasoned exemption below says a banned
-- user must still be able to act. Returns one row per offender; ZERO ROWS =
-- CLEAN.
--
-- Found by the Q205(d) live probe on prod: a banned JWT was refused by
-- enforce_ban_gate on exactly 8 table actions and went through on ~20 tables,
-- 5 storage buckets and 10 RPCs, and auth.users.banned_until was never set, so
-- the account kept refreshing its session (which the owner then chose to keep:
-- see auth-ban below). Each rule below is DERIVED FROM THE
-- CATALOG (grants x policies, pg_proc, pg_trigger, pg_policies), so a table,
-- RPC or bucket added tomorrow is inspected with no list to update.
--
--   table:ungated        a public table + command the `authenticated` role can
--                        write (privilege, table or column level, AND an
--                        RLS policy TO authenticated/public for that command, or
--                        RLS off) with no BEFORE trigger for that command whose
--                        function calls is_caller_banned(), and no exemption.
--   rpc:ungated          a VOLATILE, non-trigger function in public that
--                        `authenticated` may EXECUTE, whose body never calls
--                        is_caller_banned(), and no exemption. Every VOLATILE
--                        function counts, not just ones a regex thinks write:
--                        a reader marked VOLATILE takes an exemption that says so.
--   storage:ungated      storage.objects has no RESTRICTIVE policy for INSERT
--                        (resp. UPDATE) applying to authenticated whose check
--                        calls is_caller_banned(). Restrictive, so it ANDs onto
--                        every bucket's own policy, current and future.
--   auth-ban:writer      a function in public that writes auth.users.banned_until.
--   auth-ban:set         an auth.users row whose banned_until is in the future.
--                        Owner decision (Q300, 2026-09-23): a banned account
--                        still SIGNS IN, lands on /account-banned and can delete
--                        itself there (App Store 5.1.1(v)); an auth-level ban
--                        would lock it out of that screen, so nothing may set one.
--   gate:no-same-txn-carveout
--                        enforce_ban_gate or enforce_banned_profile_text_lock no
--                        longer lets a ban started in this transaction finish
--                        it, or no profiles trigger ON UPDATE OF ban_status sets
--                        the marker transaction-local (set_config(..., true)).
--                        Without it the 3rd reliability strike inside
--                        helper_cancel_booking rolls itself back (the
--                        lh-authz-rls finding on Q281).
--   stale-exempt:table / stale-exempt:rpc
--                        an exemption that no longer describes an ungated
--                        writable object (now gated, no longer writable, gone).
--                        This is what keeps the lists EXACT in both directions.
--
-- The exemption lists are the product decisions. Principle: a banned account
-- may only (a) reduce what it sees, receives or stores (block, mute, archive,
-- unsubscribe, delete its own curation rows, sign out), (b) leave safety and
-- legal records (report, accept terms), (c) emit telemetry. Everything that
-- creates or changes something another person or the marketplace can see, or
-- sets up future activity, is refused.
--
-- Shared by:
--   scripts/check-ban-gate-coverage.mjs          live prod (db-deploy after push, db-drift-detect nightly)
--   scripts/probes/ban-gate-coverage.probe.mjs   PGlite red/green proof
-- Keep it a single SELECT.
WITH table_exempt(tbl, op, why) AS (
  VALUES
  -- (c) telemetry: nobody else sees it; a banned session's errors still need debugging.
  ('analytics_events', 'INSERT', 'telemetry only; no other user sees it'),
  ('error_logs', 'INSERT', 'telemetry only; a banned session errors still need debugging'),
  ('login_history', 'INSERT', 'security audit trail about the banned account itself; more of it helps enforcement'),
  -- (b) safety and legal records.
  ('reports', 'INSERT', 'a banned user can still be a victim; admins see the reporter is banned when triaging'),
  ('legal_acceptances', 'INSERT', 'accepting updated terms is a legal record, needed to appeal or delete'),
  -- (a) reduce what the account sees, receives or stores.
  ('user_blocks', 'INSERT', 'blocking is protective and only reduces contact'),
  ('user_blocks', 'DELETE', 'unblocking re-opens nothing while every contact path is ban-gated'),
  ('thread_mutes', 'INSERT', 'muting only reduces what the account is sent'),
  ('thread_mutes', 'DELETE', 'unmuting an unusable thread changes nothing another person sees'),
  ('thread_archives', 'INSERT', 'archiving only hides a thread from the account itself'),
  ('thread_archives', 'UPDATE', 'archiving only hides a thread from the account itself'),
  ('thread_archives', 'DELETE', 'own inbox organisation; invisible to others'),
  ('thread_pins', 'DELETE', 'removing an own pin; invisible to others'),
  ('notification_preferences', 'INSERT', 'opting out of notifications must work for everyone, banned or not'),
  ('notification_preferences', 'UPDATE', 'opting out of notifications must work for everyone, banned or not'),
  ('notifications', 'UPDATE', 'marking an own notification read; invisible to others'),
  ('notifications', 'DELETE', 'clearing own read notifications; invisible to others'),
  ('broadcast_dismissals', 'INSERT', 'dismissing an admin banner only hides it from the account'),
  ('push_tokens', 'DELETE', 'sign-out removes the device token; a banned account must be able to stop pushes'),
  ('push_tokens', 'INSERT', 'a banned account still signs in (Q300) and must get account notices such as Restriction lifted; app boot registers the device'),
  ('push_tokens', 'UPDATE', 'the same device registration, re-saved on every app boot'),
  ('favorite_helpers', 'DELETE', 'removing an own saved Helpr shrinks the account footprint'),
  ('saved_jobs', 'DELETE', 'removing an own saved job shrinks the account footprint'),
  ('saved_searches', 'DELETE', 'removing an own saved search stops alert emails to a banned account'),
  ('pet_profiles', 'DELETE', 'removing own pet data shrinks the account footprint'),
  ('helper_availability', 'DELETE', 'clearing own weekly hours removes the account from availability, never adds it'),
  ('str_calendar_connections', 'DELETE', 'disconnecting an own calendar feed shrinks the account footprint'),
  -- Refused by another rule already.
  ('profiles', 'INSERT', 'policy WITH CHECK requires ban_status active, and a banned account already has its row'),
  ('stripe_webhook_events', 'INSERT', 'only policy is false: no client write exists'),
  ('stripe_webhook_events', 'UPDATE', 'only policy is false: no client write exists'),
  ('stripe_webhook_events', 'DELETE', 'only policy is false: no client write exists'),
  ('user_roles', 'UPDATE', 'only policy is false: no client write exists'),
  -- Admin-only by RLS (policy requires has_role admin). The admin role, not the
  -- member ban ladder, is the control for an admin; and these tables are also
  -- written by consequence code running in the violator's own session, which a
  -- ban gate would break (a banned user could dodge escalation).
  ('admin_audit_log', 'INSERT', 'admin-only by RLS'),
  ('admin_user_notes', 'INSERT', 'admin-only by RLS'),
  ('admin_user_notes', 'UPDATE', 'admin-only by RLS'),
  ('admin_user_notes', 'DELETE', 'admin-only by RLS'),
  ('broadcast_messages', 'INSERT', 'admin-only by RLS'),
  ('broadcast_messages', 'UPDATE', 'admin-only by RLS'),
  ('broadcast_messages', 'DELETE', 'admin-only by RLS'),
  ('fraud_flags', 'INSERT', 'admin-only by RLS; also written by consequence code'),
  ('fraud_flags', 'UPDATE', 'admin-only by RLS'),
  ('fraud_flags', 'DELETE', 'admin-only by RLS'),
  ('helper_shadowbans', 'INSERT', 'admin-only by RLS'),
  ('helper_shadowbans', 'UPDATE', 'admin-only by RLS'),
  ('helper_shadowbans', 'DELETE', 'admin-only by RLS'),
  ('louisiana_zip_parishes', 'INSERT', 'admin-only by RLS; reference data'),
  ('louisiana_zip_parishes', 'UPDATE', 'admin-only by RLS; reference data'),
  ('louisiana_zip_parishes', 'DELETE', 'admin-only by RLS; reference data'),
  ('marketing_content', 'INSERT', 'admin-only by RLS'),
  ('marketing_content', 'UPDATE', 'admin-only by RLS'),
  ('marketing_content', 'DELETE', 'admin-only by RLS'),
  ('marketing_settings', 'UPDATE', 'admin-only by RLS'),
  ('notifications', 'INSERT', 'admin-only by RLS; also written by consequence code in the violator session'),
  ('payment_refunds', 'INSERT', 'admin-only by RLS'),
  ('payout_transfers', 'INSERT', 'admin-only by RLS'),
  ('payout_transfers', 'UPDATE', 'admin-only by RLS'),
  ('platform_settings', 'INSERT', 'admin-only by RLS'),
  ('platform_settings', 'UPDATE', 'admin-only by RLS'),
  ('reports', 'UPDATE', 'admin-only by RLS'),
  ('user_bans', 'INSERT', 'admin-only by RLS'),
  ('user_bans', 'UPDATE', 'admin-only by RLS'),
  ('user_bans', 'DELETE', 'admin-only by RLS'),
  ('user_roles', 'INSERT', 'admin-only by RLS'),
  ('user_roles', 'DELETE', 'admin-only by RLS'),
  ('user_strikes', 'INSERT', 'admin-only by RLS; also written by consequence code'),
  ('user_strikes', 'UPDATE', 'admin-only by RLS'),
  ('user_strikes', 'DELETE', 'admin-only by RLS'),
  ('user_violations', 'INSERT', 'admin-only by RLS; also written by consequence code in the violator session'),
  ('user_violations', 'UPDATE', 'admin-only by RLS'),
  ('user_violations', 'DELETE', 'admin-only by RLS'),
  ('verification_exceptions', 'INSERT', 'admin-only by RLS'),
  ('verification_exceptions', 'UPDATE', 'admin-only by RLS'),
  ('verification_exceptions', 'DELETE', 'admin-only by RLS')
),
rpc_exempt(fn, why) AS (
  VALUES
  -- Refused by a ban-gated TABLE it writes (the trigger fires inside SECURITY
  -- DEFINER too: auth.uid() is still the caller).
  ('accept_application', 'writes applications + jobs UPDATE, both ban-gated'),
  ('accept_group_application', 'writes group_job_helpers, applications, jobs: all ban-gated'),
  ('apply_to_job', 'writes applications INSERT, ban-gated'),
  ('decline_job_offer', 'writes applications + jobs UPDATE, both ban-gated'),
  ('helper_abort_job', 'writes applications + jobs UPDATE, both ban-gated'),
  ('helper_cancel_booking', 'writes applications + jobs UPDATE, both ban-gated'),
  ('helper_mark_on_the_way', 'writes job_tracking + jobs, both ban-gated'),
  ('mark_applications_viewed', 'writes applications UPDATE, ban-gated'),
  ('mark_helper_arrival', 'writes jobs UPDATE, ban-gated'),
  ('poster_cancel_job', 'writes jobs UPDATE, ban-gated'),
  ('reject_other_applications_on_accept', 'writes applications UPDATE, ban-gated'),
  ('report_helper_no_show', 'writes jobs UPDATE, ban-gated'),
  ('respond_to_direct_offer', 'writes applications INSERT + jobs UPDATE, both ban-gated'),
  ('respond_to_review', 'writes reviews UPDATE, ban-gated'),
  ('rpc_open_dispute', 'open_dispute_as writes disputes + jobs, both ban-gated'),
  ('rpc_add_dispute_evidence', 'writes disputes + jobs UPDATE, both ban-gated'),
  ('rpc_escalate_dispute', 'writes jobs UPDATE, ban-gated'),
  ('rpc_withdraw_dispute', 'writes disputes + jobs UPDATE, both ban-gated'),
  ('rpc_helper_mark_done', 'writes jobs UPDATE, ban-gated'),
  ('rpc_group_member_confirm', 'writes group_job_helpers UPDATE, ban-gated'),
  ('rpc_group_member_mark_arrival', 'writes group_job_helpers + jobs, both ban-gated'),
  ('rpc_group_member_mark_done', 'writes group_job_helpers + jobs, both ban-gated'),
  ('rpc_group_member_on_the_way', 'writes group_job_helpers + job_tracking + jobs, all ban-gated'),
  ('rpc_group_member_set_proof', 'writes group_job_helpers UPDATE, ban-gated'),
  ('rpc_poster_confirm_member_arrival', 'writes group_job_helpers UPDATE, ban-gated'),
  ('record_job_view', 'writes job_views INSERT, ban-gated'),
  ('record_profile_view', 'writes profile_views INSERT, ban-gated (its handler turns the refusal into false, no row)'),
  ('set_available_now', 'writes profiles.available_until, refused by the banned-profile lock'),
  ('clear_available_now', 'clearing available_until only removes the account from Available now; the profile lock allows exactly that'),
  ('save_weekly_availability', 'SECURITY INVOKER: its INSERT is ban-gated; a delete-only call just clears own hours'),
  -- Admin-only: the body refuses anyone without has_role admin.
  ('admin_delete_review', 'admin-only (body checks has_role admin)'),
  ('admin_reverse_violation', 'admin-only (body checks has_role admin)'),
  ('resolve_stalled_job_flag', 'admin-only (body checks has_role admin)'),
  ('review_credential', 'admin-only (body checks has_role admin)'),
  ('rpc_decide_dispute', 'admin-only (body checks has_role admin)'),
  ('rpc_supersede_dispute_decision', 'admin-only (body checks has_role admin)'),
  -- No user-visible write.
  ('get_helper_earnings_export', 'read-only; VOLATILE only by default'),
  ('search_profiles_by_name', 'a read; its only write is its own rate-limit log'),
  ('rpc_record_application_attempt', 'writes only application_rate_log; the apply it precedes is ban-gated'),
  -- Allowed by product decision.
  ('block_user_and_settle', 'blocking is protective; its settle step writes jobs, which stays ban-gated'),
  ('toggle_thread_mute', 'muting is protective and only reduces what the account is sent'),
  ('set_thread_snooze', 'snoozing is muting with an end date'),
  ('clear_thread_mute', 'unmuting an unusable thread changes nothing another person sees'),
  ('apply_message_violation_consequence', 'only ever escalates the caller own ladder; refusing it would let a ban dodge escalation'),
  ('apply_cancellation_violation_consequence', 'only escalates the caller own ladder for their own cancelled job'),
  ('apply_low_rating_flag', 'derived from reviews that already exist; needs a prior review by the caller, which a ban cannot add'),
  ('process_referral', 'enrols the caller only; enforce_referral_credit_eligibility already refuses banned accounts')
),
ops(op, bit) AS (VALUES ('INSERT', 4), ('DELETE', 8), ('UPDATE', 16)),
tbls AS (
  SELECT c.oid, c.relname AS tbl, c.relrowsecurity AS rls
    FROM pg_class c
   WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'p')
),
writable AS (
  SELECT t.oid, t.tbl, o.op, o.bit
    FROM tbls t CROSS JOIN ops o
   WHERE (CASE WHEN o.op = 'DELETE' THEN has_table_privilege('authenticated', t.oid, 'DELETE')
               ELSE has_any_column_privilege('authenticated', t.oid, o.op) END)
     AND (NOT t.rls OR EXISTS (
           SELECT 1 FROM pg_policies pol
            WHERE pol.schemaname = 'public' AND pol.tablename = t.tbl
              AND pol.cmd IN (o.op, 'ALL')
              AND (pol.roles && ARRAY['authenticated', 'public']::name[])))
),
gated AS (
  SELECT DISTINCT tg.tgrelid AS oid, o.op
    FROM pg_trigger tg
    JOIN pg_proc p ON p.oid = tg.tgfoid
    CROSS JOIN ops o
   WHERE NOT tg.tgisinternal
     AND tg.tgenabled <> 'D'
     AND (tg.tgtype & 2) = 2            -- BEFORE
     AND (tg.tgtype & 1) = 1            -- FOR EACH ROW
     AND (tg.tgtype & o.bit) = o.bit
     AND p.prosrc ILIKE '%is_caller_banned()%'
),
table_offenders AS (
  SELECT 'table:ungated'::text AS rule, w.tbl AS object, w.op AS detail
    FROM writable w
   WHERE NOT EXISTS (SELECT 1 FROM gated g WHERE g.oid = w.oid AND g.op = w.op)
     AND NOT EXISTS (SELECT 1 FROM table_exempt e WHERE e.tbl = w.tbl AND e.op = w.op)
),
stale_table AS (
  SELECT 'stale-exempt:table'::text AS rule, e.tbl AS object, e.op AS detail
    FROM table_exempt e
   WHERE NOT EXISTS (
     SELECT 1 FROM writable w
      WHERE w.tbl = e.tbl AND w.op = e.op
        AND NOT EXISTS (SELECT 1 FROM gated g WHERE g.oid = w.oid AND g.op = w.op))
),
rpcs AS (
  SELECT p.oid, p.proname, p.prosrc
    FROM pg_proc p
   WHERE p.pronamespace = 'public'::regnamespace
     AND p.prokind = 'f'
     AND p.provolatile = 'v'
     AND p.prorettype NOT IN ('pg_catalog.trigger'::regtype, 'pg_catalog.event_trigger'::regtype)
     AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
     AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid = 'pg_proc'::regclass AND d.objid = p.oid AND d.deptype = 'e')
),
rpc_offenders AS (
  SELECT DISTINCT 'rpc:ungated'::text AS rule, r.proname::text AS object, 'EXECUTE'::text AS detail
    FROM rpcs r
   WHERE r.prosrc NOT ILIKE '%is_caller_banned()%'
     AND NOT EXISTS (SELECT 1 FROM rpc_exempt e WHERE e.fn = r.proname)
),
stale_rpc AS (
  SELECT 'stale-exempt:rpc'::text AS rule, e.fn AS object, 'EXECUTE'::text AS detail
    FROM rpc_exempt e
   WHERE NOT EXISTS (SELECT 1 FROM rpcs r WHERE r.proname = e.fn AND r.prosrc NOT ILIKE '%is_caller_banned()%')
),
storage_offenders AS (
  SELECT 'storage:ungated'::text AS rule, 'storage.objects'::text AS object, c.cmd AS detail
    FROM (VALUES ('INSERT'), ('UPDATE')) c(cmd)
   WHERE to_regclass('storage.objects') IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM pg_policies pol
        WHERE pol.schemaname = 'storage' AND pol.tablename = 'objects'
          AND pol.permissive = 'RESTRICTIVE'
          AND pol.cmd IN (c.cmd, 'ALL')
          AND (pol.roles && ARRAY['authenticated', 'public']::name[])
          AND coalesce(pol.with_check, '') ILIKE '%is_caller_banned()%'
          AND (c.cmd = 'INSERT' OR coalesce(pol.qual, '') ILIKE '%is_caller_banned()%'))
),
auth_ban_writers AS (
  SELECT 'auth-ban:writer'::text AS rule, p.proname::text AS object, 'banned_until'::text AS detail
    FROM pg_proc p
   WHERE p.pronamespace = 'public'::regnamespace
     AND p.prosrc ~* 'update\s+auth\.users'
     AND p.prosrc ILIKE '%banned_until%'
),
auth_ban_set AS (
  SELECT 'auth-ban:set'::text AS rule, u.id::text AS object, 'banned_until ' || u.banned_until::text AS detail
    FROM auth.users u
   WHERE u.banned_until IS NOT NULL AND u.banned_until > now()
),
carveout AS (
  -- Three parts, each reported on its own: both refusing functions honour the
  -- marker, and a profiles trigger that fires on UPDATE OF ban_status sets it
  -- TRANSACTION-LOCAL (is_local = true). A session-level marker would outlive
  -- the request on a pooled connection and wave a later banned request through.
  SELECT 'gate:no-same-txn-carveout'::text AS rule, f.fn AS object, 'does not honour app.ban_started_in_txn'::text AS detail
    FROM (VALUES ('public.enforce_ban_gate'), ('public.enforce_banned_profile_text_lock')) f(fn)
   WHERE NOT EXISTS (
           SELECT 1 FROM pg_proc p
            WHERE p.oid = to_regprocedure(f.fn || '()')
              AND p.prosrc ILIKE '%current_setting(''app.ban_started_in_txn'', true) IS DISTINCT FROM auth.uid()::text%')
  UNION ALL
  SELECT 'gate:no-same-txn-carveout'::text, 'public.profiles'::text,
         'no trigger ON UPDATE OF ban_status sets app.ban_started_in_txn transaction-local'::text
   WHERE NOT EXISTS (
           SELECT 1 FROM pg_trigger tg JOIN pg_proc p ON p.oid = tg.tgfoid
            WHERE tg.tgrelid = to_regclass('public.profiles')
              AND NOT tg.tgisinternal AND tg.tgenabled <> 'D'
              AND (tg.tgtype & 16) = 16
              AND (cardinality(tg.tgattr::int2[]) = 0
                   OR (SELECT a.attnum FROM pg_attribute a
                        WHERE a.attrelid = tg.tgrelid AND a.attname = 'ban_status') = ANY (tg.tgattr::int2[]))
              AND p.prosrc ~* 'set_config\(\s*''app\.ban_started_in_txn''\s*,[^;]*,\s*true\s*\)')
)
SELECT rule, object, detail FROM table_offenders
UNION ALL SELECT rule, object, detail FROM stale_table
UNION ALL SELECT rule, object, detail FROM rpc_offenders
UNION ALL SELECT rule, object, detail FROM stale_rpc
UNION ALL SELECT rule, object, detail FROM storage_offenders
UNION ALL SELECT rule, object, detail FROM auth_ban_writers
UNION ALL SELECT rule, object, detail FROM auth_ban_set
UNION ALL SELECT rule, object, detail FROM carveout
ORDER BY 1, 2, 3
