-- A NULL auth.uid() is not the service role. 23 guard triggers said it was.
--
-- WHAT WAS BROKEN. Twenty-three trigger functions in public decided "this is a
-- trusted server write" from `auth.uid() IS NULL` alone, and skipped their
-- guard. A NULL uid is what service_role (edge functions), pg_cron and
-- migrations have — and ALSO what every anon PostgREST request has (role
-- anon, no sub). So anything that let an anon write reach one of these tables
-- got every guard waved through: the money-column locks on jobs, the
-- cancellation and award gates, the profile self-escalation lock, the
-- credential-status lock, the dispute column whitelist, the message read-only
-- and block checks. That is how the open_jobs_browse view (owner postgres,
-- RLS-bypassing, anon-writable until 20260915041247/20260915043245) let anon
-- rewrite payment_status + customer_id on a funded job with no guard firing:
-- proven on prod in a rolled-back transaction 2026-09-15. The view door is
-- shut; this closes the reason a door like it was fatal.
--
-- WHAT "SERVER" NOW MEANS. public.is_server_context(), defined below:
--   auth.uid() IS NULL
--   AND auth.role() (the JWT role claim) is not anon/authenticated
--   AND current_setting('role') (the SET ROLE PostgREST performs) is not
--       anon/authenticated
-- The same test stamp_job_completed_at (20260914201350) already inlines, plus
-- the SET ROLE half, so a session that switched to anon without a JWT claim
-- (a probe, a script, a future code path) is not trusted either.
--   service_role REST (edge functions)  uid NULL, role service_role  -> server
--   pg_cron / migrations / db query     uid NULL, no claims, role none -> server
--   GoTrue (handle_new_user etc.)       uid NULL, no claims          -> server
--   anon REST                           uid NULL, role anon          -> CLIENT
--   signed-in REST                      uid set                      -> CLIENT
--   SECURITY DEFINER RPC by a user      uid of the CALLER            -> CLIENT
-- current_user is deliberately NOT used: 19 of the 23 are SECURITY DEFINER, so
-- current_user inside them is always postgres. auth.role() and the role GUC
-- survive the definer switch. No anon-executable function writes any of these
-- tables (checked live: the 16 anon-executable non-trigger functions are all
-- reads), and no policy lets anon write them directly, so no legitimate path
-- loses anything; an anon write that does reach a guard is now judged like a
-- signed-in non-party's.
--
-- REBUILT FROM LIVE. Every body below is pg_get_functiondef() from prod
-- (fncmgoasalhdgfwzhsqa, read 2026-09-15; md5(prosrc) noted per function) with
-- ONLY the trust test (and the comments beside it) changed. Two carry one
-- extra NULL-safety change each, both needed because a NULL uid now reaches
-- code that never saw one:
--   enforce_dispute_opener_column_whitelist  _self_withdrawal COALESCEd to
--     false, else `AND NOT _self_withdrawal` is NULL and decided_at slips by.
--   enforce_audit_log_self_attribution  a client with no uid may not file an
--     audit row at all (it used to pass because the check needed a uid).
-- Reviewed and deliberately NOT changed (the NULL branch is already untrusted
-- or fail-safe): apply_message_scan_consequence (NULL uid escalates nobody;
-- the fraud_flags evidence row is still written), audit_admin_job_status_change
-- (a NULL uid is not an admin, so nothing to audit either way), enforce_ban_gate
-- (no account, nothing to be banned), auto_pending_credentials and
-- enforce_job_status_transition (NULL already takes the non-admin path),
-- enforce_open_job_limit (NULL is counted like any non-self insert),
-- audit_role_changes / audit_money_table_change / log_verification_change
-- (attribution labels, not gates), and the ~20 RPCs that RAISE on a NULL uid.
-- Already correct: stamp_job_completed_at, enforce_dispute_markers_server_owned,
-- stamp_error_log_origin, prevent_admin_role_self_grant, claim_marketing_content.
--
-- CLASS CHECK. scripts/ci/null-uid-trust.sql lists any public function where a
-- bare NULL-uid test decides an early RETURN (or gates a restriction) without
-- is_server_context(). Runs on the replayed schema (db-smoke) and live
-- (scripts/check-live-privileges.mjs, after deploy + nightly). PGlite proof:
-- scripts/probes/null-uid-guards.probe.mjs.
--
-- GRANTS. CREATE OR REPLACE keeps each function's ACL. Trigger functions need
-- no EXECUTE to fire; PUBLIC and anon are revoked on all 23 anyway (several
-- still carried both). is_server_context() is EXECUTE for anon and
-- authenticated because four of the 23 are SECURITY INVOKER triggers that run
-- as the client; it only reports the caller's own context.
--
-- REPLAY-SAFETY. CREATE OR REPLACE only, no table is touched, and a plpgsql
-- body is not resolved against tables at creation — so this runs on a database
-- where none of the guarded tables exist, and three times over.

CREATE OR REPLACE FUNCTION public.is_server_context()
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  SELECT auth.uid() IS NULL
     AND coalesce(auth.role(), '') NOT IN ('anon', 'authenticated')
     AND coalesce(current_setting('role', true), 'none') NOT IN ('anon', 'authenticated')
$function$;

COMMENT ON FUNCTION public.is_server_context() IS
  'True only for a trusted server write: no end-user uid AND neither the JWT role claim nor the SET ROLE is anon/authenticated. service_role, pg_cron, migrations: true. anon and signed-in requests: false. Use instead of a bare auth.uid() IS NULL (20260915051905).';

REVOKE ALL ON FUNCTION public.is_server_context() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_server_context() TO anon, authenticated, service_role;

-- enforce_application_credential_tier  (live md5(prosrc) before: c470e9e450897a45b92f2285c7121a43)
CREATE OR REPLACE FUNCTION public.enforce_application_credential_tier()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_required int;
  v_actual int;
BEGIN
  IF public.is_server_context() THEN
    RETURN NEW;  -- service-role writers (recurring visits, admin tooling); never anon
  END IF;

  SELECT COALESCE(j.credential_tier, 0) INTO v_required
    FROM public.jobs j WHERE j.id = NEW.job_id;

  IF v_required > 0 THEN
    v_actual := COALESCE(public.get_user_credential_tier(NEW.helper_id), 0);
    IF v_actual < v_required THEN
      RAISE EXCEPTION 'credential_tier_required'
        USING ERRCODE = '42501',
              HINT = CASE WHEN v_required >= 2
                          THEN 'This job requires a verified license and insurance.'
                          ELSE 'This job requires a verified license.' END;
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

-- enforce_application_job_state  (live md5(prosrc) before: d0f572510973c782e3e88f952cecdf99)
CREATE OR REPLACE FUNCTION public.enforce_application_job_state()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET "TimeZone" TO 'America/Chicago'
AS $function$
DECLARE
  v_job RECORD;
BEGIN
  -- Service-role writers run with no JWT. Same gate as the credential tier
  -- trigger beside this one: a cron spawning the next recurring visit, or an
  -- admin tool, is not a helper tapping Apply.
  --
  -- This early return is safe only because RLS excludes NULL-uid callers
  -- before the trigger fires: the sole INSERT policy on `applications` is
  -- TO authenticated with WITH CHECK (auth.uid() = helper_id), which is
  -- NULL -> false for an anon or sub-less token. If that policy is ever
  -- loosened, this line becomes a bypass.
  -- 20260915051905: no longer rests on that. An anon caller (NULL uid, role
  -- anon) is judged like any other client; only a server context passes.
  IF public.is_server_context() THEN
    RETURN NEW;
  END IF;

  -- FOR SHARE (added 2026-09-13): block behind any in-flight UPDATE of this
  -- job — poster_cancel_job's FOR UPDATE, accept_application, a status PATCH —
  -- and read the status THAT transaction committed, not the one before it.
  -- Without the lock, 14 of 20 applications fired alongside a cancel landed on
  -- the cancelled job (the FK's KEY SHARE made the INSERT wait, but only after
  -- this SELECT had already said 'open').
  SELECT j.status,
         j.customer_id,
         j.offered_to_helper_id,
         j.direct_offer_status,
         j.created_at,
         j.is_seed,
         j.date_needed,
         j.expires_at
    INTO v_job
    FROM public.jobs j
   WHERE j.id = NEW.job_id
   FOR SHARE;

  -- No row is the FK's problem, not ours; let it raise its own error.
  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  -- C2. A job outlives the person who posted it: account deletion anonymises
  -- rather than deletes and deliberately preserves `status`, so an ownerless
  -- job stays 'open' forever. Until now this was refused only because the
  -- notification trigger downstream could not address a NULL poster — a
  -- protection that would evaporate the moment that path was made
  -- null-tolerant, and which meanwhile showed the helper a raw NOT NULL
  -- constraint violation.
  IF v_job.customer_id IS NULL THEN
    RAISE EXCEPTION 'job_has_no_owner'
      USING ERRCODE = '42501',
            HINT = 'The person who posted this job has closed their account.';
  END IF;

  -- C1. Every discovery surface requires status = 'open'.
  IF v_job.status <> 'open' THEN
    RAISE EXCEPTION 'job_not_open'
      USING ERRCODE = '42501',
            HINT = 'This job is no longer accepting applications.';
  END IF;

  -- C4. A job under a live direct offer is private to the helper it was
  -- offered to. The feed withholds it; so must the write path.
  IF v_job.offered_to_helper_id IS NOT NULL
     AND v_job.direct_offer_status = 'pending'
     AND v_job.offered_to_helper_id IS DISTINCT FROM NEW.helper_id THEN
    RAISE EXCEPTION 'job_reserved_for_another_helper'
      USING ERRCODE = '42501',
            HINT = 'This job has been offered directly to someone else.';
  END IF;

  -- C5. The Early Access perk. The targeted helper of a direct offer keeps the
  -- same escape hatch the four surfaces give them, so a person who was invited
  -- to a job can always answer it immediately.
  IF v_job.created_at > public.early_access_cutoff()
     AND v_job.offered_to_helper_id IS DISTINCT FROM NEW.helper_id THEN
    RAISE EXCEPTION 'job_in_early_access_window'
      USING ERRCODE = '42501',
            HINT = 'This job is in its Early Access window. Pro and Elite members can apply first.';
  END IF;

  -- C6. Fixture rows, on the shared switch — so when the flag is flipped at
  -- launch the seed jobs go quiet in the feed AND stop accruing real
  -- applications, instead of only the former.
  IF COALESCE(v_job.is_seed, false) AND public.seed_jobs_hidden_publicly() THEN
    RAISE EXCEPTION 'job_not_available'
      USING ERRCODE = '42501',
            HINT = 'This job is no longer available.';
  END IF;

  -- C8. A job whose day has passed is not workable. This IS a feed filter —
  -- `date_needed >= CURRENT_DATE` appears in get_ranked_open_jobs,
  -- get_public_open_jobs and get_open_jobs_for_map (not in open_jobs_browse) —
  -- which is why the TimeZone above has to match theirs exactly.
  IF v_job.date_needed IS NOT NULL AND v_job.date_needed < CURRENT_DATE THEN
    RAISE EXCEPTION 'job_date_has_passed'
      USING ERRCODE = '42501',
            HINT = 'The date this job was needed has already passed.';
  END IF;

  -- C9. Likewise an expired one. This is filtered on only ONE surface today
  -- (get_open_jobs_for_map), so enforcing it here is deliberately stricter
  -- than any feed currently implies — confirmed with the owner before shipping.
  IF v_job.expires_at IS NOT NULL AND v_job.expires_at <= now() THEN
    RAISE EXCEPTION 'job_expired'
      USING ERRCODE = '42501',
            HINT = 'This job posting has expired.';
  END IF;

  RETURN NEW;
END;
$function$;

-- enforce_audit_log_self_attribution  (live md5(prosrc) before: 13cb2eed65fcab5e4c9182c5ed9230fe)
CREATE OR REPLACE FUNCTION public.enforce_audit_log_self_attribution()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- A server context (service_role, cron, migration) may file under any id.
  -- Every client, anon included, files under its own uid or not at all.
  IF NOT public.is_server_context()
     AND (auth.uid() IS NULL OR NEW.admin_id IS DISTINCT FROM auth.uid()) THEN
    RAISE EXCEPTION 'audit_log_actor_mismatch'
      USING ERRCODE = '42501',
            HINT = 'An audit row must be filed under the acting admin''s own id.';
  END IF;
  RETURN NEW;
END;
$function$;

-- enforce_banned_profile_text_lock  (live md5(prosrc) before: 23f0e58795282f823f1f42a10527de4c)
CREATE OR REPLACE FUNCTION public.enforce_banned_profile_text_lock()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF public.is_server_context() OR has_role(auth.uid(), 'admin') THEN
    RETURN NEW;
  END IF;

  IF current_setting('app.trusted_ladder_write', true) = 'on' THEN
    RETURN NEW;
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

-- enforce_block_on_message_insert  (live md5(prosrc) before: 1243aa7e88ed4ceac76e7fc95849f47e)
CREATE OR REPLACE FUNCTION public.enforce_block_on_message_insert()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  -- Server contexts only; an anon write (NULL uid, role anon) is checked.
  IF public.is_server_context() THEN
    RETURN NEW;
  END IF;

  IF public.are_users_blocked(NEW.sender_id, NEW.receiver_id) THEN
    RAISE EXCEPTION 'You can''t message this user.'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$function$;

-- enforce_cancellation_requires_rpc  (live md5(prosrc) before: c0a942f29691ec99c875710a5f2008f4)
CREATE OR REPLACE FUNCTION public.enforce_cancellation_requires_rpc()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  changed_col text;
  guarded CONSTANT text[] := ARRAY[
    'cancelled_by',
    'cancelled_at',
    'cancellation_reason',
    'late_cancellation',
    'cancellation_fee',
    'cancellation_fee_status'
  ];
BEGIN
  -- Service role (edge functions / cron) and admins keep their existing reach;
  -- their access is governed by RLS and the admin audit trail as before.
  -- "Service role" means a server context, never merely a NULL uid (anon).
  IF public.is_server_context() THEN
    RETURN NEW;
  END IF;
  IF public.has_role(auth.uid(), 'admin'::app_role) THEN
    RETURN NEW;
  END IF;

  -- Inside a sanctioned SECURITY DEFINER exit. The GUC is transaction-local
  -- and each entry point clears it again immediately after its own statement.
  IF COALESCE(current_setting('app.sanctioned_cancel', true), '') = 'on' THEN
    RETURN NEW;
  END IF;

  IF NEW.status::text = 'cancelled' AND OLD.status IS DISTINCT FROM NEW.status THEN
    RAISE EXCEPTION
      'Jobs may only be cancelled through a cancellation RPC (job_id=%)', OLD.id
      USING ERRCODE = '42501',
            HINT = 'Posters call poster_cancel_job(); Helprs call helper_cancel_booking() or helper_abort_job(). Those apply the reliability ladder in the same transaction.';
  END IF;

  FOR changed_col IN
    SELECT n.key
    FROM jsonb_each(to_jsonb(NEW)) AS n
    JOIN jsonb_each(to_jsonb(OLD)) AS o ON o.key = n.key
    WHERE n.value IS DISTINCT FROM o.value
  LOOP
    IF changed_col = ANY (guarded) THEN
      RAISE EXCEPTION 'jobs.% is set by the cancellation RPC, not by the client', changed_col
        USING ERRCODE = '42501';
    END IF;
  END LOOP;

  RETURN NEW;
END;
$function$;

-- enforce_confirm_on_live_job  (live md5(prosrc) before: 326f179467f418498c839def3672af05)
CREATE OR REPLACE FUNCTION public.enforce_confirm_on_live_job()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- Only real end-user sessions are judged, exactly as enforce_helper_award_gate
  -- and enforce_job_funded_before_award beside this one. No service-role path
  -- confirms on a helper's behalf. An anon caller is judged too.
  IF public.is_server_context() THEN
    RETURN NEW;
  END IF;

  -- Only the stamping transition. Clearing it, or a re-save that leaves it as
  -- it was, is not a confirmation.
  IF NEW.helper_confirmed_at IS NULL OR OLD.helper_confirmed_at IS NOT NULL THEN
    RETURN NEW;
  END IF;

  -- OLD is the row version this UPDATE locked — the one the concurrent cancel
  -- committed, if there was one. 'open' covers respond_to_direct_offer, which
  -- stamps the confirmation in the same UPDATE that awards the job.
  IF OLD.status::text NOT IN ('open', 'accepted') THEN
    RAISE EXCEPTION 'job_not_confirmable'
      USING ERRCODE = '42501',
            HINT = 'This job is no longer open or awaiting your confirmation (status=' || OLD.status::text || ').';
  END IF;

  RETURN NEW;
END;
$function$;

-- enforce_credential_status_server_owned  (live md5(prosrc) before: c6535b74d6d56a26091eb4c9f9a29e91)
CREATE OR REPLACE FUNCTION public.enforce_credential_status_server_owned()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF public.is_server_context() OR has_role(auth.uid(), 'admin') THEN
    RETURN NEW;
  END IF;

  IF current_setting('app.trusted_ladder_write', true) = 'on' THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    -- A member may submit a credential for review. That is all a submission
    -- is: a claim plus a document. 'submitted' rather than the 'unverified'
    -- column default is what the reviewer queue and the profile's amber
    -- "Verification in progress" chip already look for.
    NEW.user_id          := auth.uid();
    NEW.status           := 'submitted';
    NEW.verified_at      := NULL;
    NEW.rejection_reason := NULL;
    NEW.vendor_check_id  := NULL;
    RETURN NEW;
  END IF;

  -- UPDATE. A credential that has already been accepted is immutable to its
  -- owner: letting them edit the license number or push out the expiry of a
  -- row a reviewer already signed off would launder an unreviewed claim
  -- through a reviewed row.
  IF OLD.status = 'verified' THEN
    RETURN OLD;
  END IF;

  NEW.user_id          := OLD.user_id;
  NEW.status           := OLD.status;
  NEW.verified_at      := OLD.verified_at;
  NEW.rejection_reason := OLD.rejection_reason;
  NEW.vendor_check_id  := OLD.vendor_check_id;
  NEW.created_at       := OLD.created_at;

  RETURN NEW;
END;
$function$;

-- enforce_dispute_opener_column_whitelist  (live md5(prosrc) before: 8ff39ea1dd9ec343a5893eccaee7eea1)
CREATE OR REPLACE FUNCTION public.enforce_dispute_opener_column_whitelist()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  -- Is THIS update the opener closing their own open dispute? The one
  -- user-driven settlement move the flow sanctions, and the only context in
  -- which a party may stamp `decided_at`.
  _self_withdrawal boolean;
BEGIN
  -- Service role / cron / edge functions: not a user write. A NULL uid alone
  -- is NOT that — an anon request has one too (20260915051905).
  IF public.is_server_context() THEN
    RETURN NEW;
  END IF;

  -- Admins resolve disputes; that is the whole point of the admin policy.
  IF public.has_role(_uid, 'admin') THEN
    RETURN NEW;
  END IF;

  -- COALESCE: with a NULL _uid (anon) the comparison is NULL, and a NULL here
  -- would make `AND NOT _self_withdrawal` NULL and let decided_at through.
  _self_withdrawal := COALESCE(
        OLD.status = 'open'
    AND NEW.status = 'withdrawn'
    AND _uid = OLD.opener_id
    AND OLD.decided_at IS NULL, false);

  -- A party may append evidence and nothing else. Every other column is
  -- pinned to its old value, so a forged `execution_status`, `payout_split`,
  -- `decided_by` or ledger figure is rejected rather than silently kept.
  --
  -- `decided_at` is the ONE exception, and only inside `_self_withdrawal`:
  -- `rpc_withdraw_dispute` stamps it in the same statement that flips the
  -- status, so pinning it unconditionally killed the withdrawal outright (see
  -- the header). Outside that transition it is pinned exactly as before —
  -- including a second stamp on an already-decided row, which is why
  -- `_self_withdrawal` requires the old value to be NULL.
  IF NEW.id             IS DISTINCT FROM OLD.id
  OR NEW.job_id         IS DISTINCT FROM OLD.job_id
  OR NEW.opener_id      IS DISTINCT FROM OLD.opener_id
  OR NEW.reason         IS DISTINCT FROM OLD.reason
  OR NEW.created_at     IS DISTINCT FROM OLD.created_at
  OR (NEW.decided_at    IS DISTINCT FROM OLD.decided_at AND NOT _self_withdrawal)
  OR NEW.decided_by     IS DISTINCT FROM OLD.decided_by
  OR NEW.decision_text  IS DISTINCT FROM OLD.decision_text
  OR NEW.payout_split   IS DISTINCT FROM OLD.payout_split
  THEN
    RAISE EXCEPTION 'only the evidence on a dispute may be changed'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- `status` is handled separately because ONE user-driven move is
  -- legitimate: withdrawing your own open dispute, which is the opener's only
  -- sanctioned exit (`rpc_withdraw_dispute`, 20260825190000). That RPC is
  -- SECURITY DEFINER but `auth.uid()` inside it is still the CALLER, so a
  -- blanket pin on `status` would have made this trigger block the one
  -- self-service escape hatch the flow has — caught by the PGlite suite
  -- before this shipped. Every other status move (notably `decided`, which
  -- is what unlocks execute-dispute-split) stays admin-only.
  IF NEW.status IS DISTINCT FROM OLD.status
     AND NOT (OLD.status = 'open' AND NEW.status = 'withdrawn')
  THEN
    RAISE EXCEPTION 'a dispute''s status is decided by an admin, not by a party to it'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- The execution/settlement columns are guarded separately only so the
  -- error names them — forging these is the denial-of-service case, not a
  -- typo. Guarded by column existence so this migration stays replayable
  -- against a database that predates 20260824230000.
  IF to_regclass('public.disputes') IS NOT NULL
     AND EXISTS (
       SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'disputes'
          AND column_name = 'execution_status'
     )
  THEN
    IF NEW.execution_status       IS DISTINCT FROM OLD.execution_status
    OR NEW.execution_started_at   IS DISTINCT FROM OLD.execution_started_at
    OR NEW.executed_at            IS DISTINCT FROM OLD.executed_at
    OR NEW.execution_transfer_id  IS DISTINCT FROM OLD.execution_transfer_id
    OR NEW.execution_refund_id    IS DISTINCT FROM OLD.execution_refund_id
    OR NEW.execution_helper_cents IS DISTINCT FROM OLD.execution_helper_cents
    OR NEW.execution_refund_cents IS DISTINCT FROM OLD.execution_refund_cents
    OR NEW.execution_error        IS DISTINCT FROM OLD.execution_error
    THEN
      RAISE EXCEPTION 'the settlement state of a dispute is not yours to set'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

-- enforce_group_roster_award_gate  (live md5(prosrc) before: 35c9a300f1f9dbf037eeb5fe8f1e2db7)
CREATE OR REPLACE FUNCTION public.enforce_group_roster_award_gate()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_reason text;
BEGIN
  IF public.is_server_context() THEN
    RETURN NEW;
  END IF;
  v_reason := public.helper_award_block_reason(NEW.helper_id);
  IF v_reason IS NOT NULL THEN
    RAISE EXCEPTION '%', v_reason;
  END IF;
  RETURN NEW;
END;
$function$;

-- enforce_helper_award_gate  (live md5(prosrc) before: bf76dac3d351c321b36efbacb7a6b125)
CREATE OR REPLACE FUNCTION public.enforce_helper_award_gate()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_reason   text;
  v_awarding boolean;
BEGIN
  -- Only real end-user sessions are judged; see the header for why. An anon
  -- request is an end-user session with no uid, not a server write.
  IF public.is_server_context() THEN
    RETURN NEW;
  END IF;

  -- The two transitions that mean "this job is now theirs". A re-save that
  -- leaves both columns as they were is not an award and must not be blocked —
  -- otherwise an already-hired helper whose Stripe state later lapsed could not
  -- have their job completed, cancelled or reassigned.
  v_awarding :=
    (NEW.helper_id IS NOT NULL
       AND (TG_OP = 'INSERT' OR OLD.helper_id IS DISTINCT FROM NEW.helper_id))
    OR (NEW.helper_confirmed_at IS NOT NULL
       AND (TG_OP = 'INSERT' OR OLD.helper_confirmed_at IS NULL));

  IF NOT v_awarding THEN
    RETURN NEW;
  END IF;

  v_reason := public.helper_award_block_reason(NEW.helper_id);
  IF v_reason IS NOT NULL THEN
    RAISE EXCEPTION '%', v_reason;
  END IF;

  RETURN NEW;
END;
$function$;

-- enforce_helper_completion_gates  (live md5(prosrc) before: c988ef9309994b2f39fe39d37f5bb182)
CREATE OR REPLACE FUNCTION public.enforce_helper_completion_gates()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF public.is_server_context()
     OR auth.uid() IS DISTINCT FROM OLD.helper_id
     OR auth.uid() = OLD.customer_id THEN
    RETURN NEW;
  END IF;

  IF NEW.helper_completed_at IS NOT NULL AND OLD.helper_completed_at IS NULL THEN
    -- ARRIVAL MUST BE ESTABLISHED. Either the server verified the helper was
    -- within 500ft when they marked arrived, or the poster vouched for them.
    -- Grandfathered for jobs that were already underway when this shipped —
    -- those helpers marked arrival under the old rules and must not be
    -- stranded mid-job by a deploy.
    IF OLD.helper_arrival_verified_at IS NULL
       AND OLD.poster_confirmed_arrival_at IS NULL
       AND NOT (OLD.helper_arrived_at IS NOT NULL
                AND OLD.helper_arrived_at < timestamptz '2026-08-28 00:00:00+00') THEN
      RAISE EXCEPTION 'completion_requires_confirmed_arrival'
        USING ERRCODE = '23514',
              HINT = 'Mark arrival at the job site, or ask the poster to confirm you arrived.';
    END IF;

    -- Photo proof is now the POSTER'S call, per job. COALESCE to true so a row
    -- written by a client that predates the column (or by any path that omits
    -- it) still gets the historic always-on behaviour rather than a silent
    -- opt-out. Read off NEW so a poster who turns the requirement off while the
    -- job is in flight releases the helper immediately.
    IF COALESCE(NEW.require_photo_proof, true)
       AND (COALESCE(array_length(NEW.proof_before_urls, 1), 0) = 0
            OR COALESCE(array_length(NEW.proof_after_urls, 1), 0) = 0) THEN
      RAISE EXCEPTION 'completion_requires_proof_photos'
        USING ERRCODE = '23514',
              HINT = 'Add before and after photos before marking the job done.';
    END IF;

    IF COALESCE(OLD.poster_confirmed_working_at, OLD.helper_arrived_at) IS NOT NULL
       AND now() - COALESCE(OLD.poster_confirmed_working_at, OLD.helper_arrived_at) < interval '30 minutes' THEN
      RAISE EXCEPTION 'completion_min_work_time'
        USING ERRCODE = '23514',
              HINT = 'A job cannot be marked done within 30 minutes of starting.';
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

-- enforce_helper_jobs_column_whitelist  (live md5(prosrc) before: 75de6087f63b61837a3f134bd5adc11b)
CREATE OR REPLACE FUNCTION public.enforce_helper_jobs_column_whitelist()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  changed_col text;
  allowed CONSTANT text[] := ARRAY[
    'status',
    'helper_confirmed_at',
    'helper_dayof_confirmed_at',
    'helper_on_the_way_at',
    'helper_arrived_at',
    'helper_completed_at',
    'proof_before_urls',
    'proof_after_urls',
    'dispute_reason',
    'dispute_evidence_urls',
    'disputed_at',
    -- Added 2026-09-05. Without this a helper cannot open a dispute at all:
    -- rpc_open_dispute stamps it in the same UPDATE as disputed_at/dispute_status.
    'disputed_by',
    'dispute_status',
    'dispute_helper_response',
    'cancelled_by',
    'cancelled_at',
    'cancellation_reason',
    'late_cancellation',
    'cancellation_fee',
    'cancellation_fee_status',
    'helper_id',
    'response_deadline',
    'updated_at'
  ];
BEGIN
  -- Only constrain the assigned helper acting on their own job. Everyone
  -- else (a server context; poster; admin) passes through — their
  -- access is governed by RLS as before. A NULL uid alone is not a server
  -- context: anon has one too (20260915051905).
  IF public.is_server_context()
     OR auth.uid() IS DISTINCT FROM OLD.helper_id
     OR auth.uid() = OLD.customer_id THEN
    RETURN NEW;
  END IF;

  FOR changed_col IN
    SELECT n.key
    FROM jsonb_each(to_jsonb(NEW)) AS n
    JOIN jsonb_each(to_jsonb(OLD)) AS o ON o.key = n.key
    WHERE n.value IS DISTINCT FROM o.value
  LOOP
    IF NOT (changed_col = ANY (allowed)) THEN
      -- The verified-arrival stamp is deliberately NOT in `allowed`: the only
      -- writer is public.mark_helper_arrival(), which computes the proximity
      -- verdict server-side and sets this transaction-local flag. A direct
      -- PATCH from the client still hits the RAISE below.
      IF changed_col = 'helper_arrival_verified_at'
         AND current_setting('app.arrival_rpc', true) = '1' THEN
        CONTINUE;
      END IF;
      -- The dispute-resolution stamp, same pattern and for the same reason.
      -- Its only writer is public.rpc_withdraw_dispute(), which sets this flag
      -- transaction-locally only AFTER establishing that auth.uid() is the
      -- opener_id of a live dispute on this job. Listing the column in
      -- `allowed` instead would let a helper stamp their own job resolved with
      -- a plain PATCH and skip that check entirely — which is the whole reason
      -- the RPC exists.
      IF changed_col = 'dispute_resolved_at'
         AND current_setting('app.dispute_withdraw_rpc', true) = '1' THEN
        CONTINUE;
      END IF;
      RAISE EXCEPTION 'Helpers may not modify jobs.% ', changed_col
        USING ERRCODE = '42501';
    END IF;
  END LOOP;

  -- A helper may un-assign themselves (decline fallback sets helper_id NULL)
  -- but never reassign the job to another account.
  IF NEW.helper_id IS DISTINCT FROM OLD.helper_id AND NEW.helper_id IS NOT NULL THEN
    RAISE EXCEPTION 'Helpers may only clear jobs.helper_id, not reassign it'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$function$;

-- enforce_job_funded_before_award  (live md5(prosrc) before: e09cf063e20f589ede1832d2c709da83)
CREATE OR REPLACE FUNCTION public.enforce_job_funded_before_award()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_awarding boolean;
BEGIN
  -- Only real end-user sessions are judged, exactly as enforce_helper_award_gate
  -- does. The stripe webhook, the payout crons, str-ical-sync and
  -- charge-recurring-visits all run as service role with a NULL auth.uid() and
  -- must keep being able to write these columns. They are a server context;
  -- an anon request (NULL uid, role anon) is not, and is judged.
  IF public.is_server_context() THEN
    RETURN NEW;
  END IF;

  -- The two transitions that mean "this job is now theirs" -- same definition
  -- as enforce_helper_award_gate, deliberately. A re-save that leaves both
  -- columns as they were is not an award: an already-hired helper on a job
  -- whose escrow has since been refunded must still be able to have that job
  -- completed, cancelled or disputed.
  v_awarding :=
    (NEW.helper_id IS NOT NULL
       AND (TG_OP = 'INSERT' OR OLD.helper_id IS DISTINCT FROM NEW.helper_id))
    OR (NEW.helper_confirmed_at IS NOT NULL
       AND (TG_OP = 'INSERT' OR OLD.helper_confirmed_at IS NULL));

  IF NOT v_awarding THEN
    RETURN NEW;
  END IF;

  -- Judge the funding state the row is LANDING in, not the one it left. The
  -- webhook sets payment_status and helper_id in separate statements, but a
  -- service-role session is already exempt above, so NEW is the honest read
  -- for every session this gate actually judges.
  IF NOT public.job_payment_is_funded(NEW.payment_status) THEN
    RAISE EXCEPTION
      'This job is not funded yet, so it cannot be assigned to a helper. The poster needs to complete checkout first.'
      USING
        ERRCODE = 'check_violation',
        HINT = 'jobs.payment_status must be escrow, payout_pending or released before jobs.helper_id / helper_confirmed_at may be set. See enforce_job_funded_before_award().';
  END IF;

  RETURN NEW;
END;
$function$;

-- enforce_jobs_insert_column_lock  (live md5(prosrc) before: 2a08f7b27410b54d5b5fc392e60708f8)
CREATE OR REPLACE FUNCTION public.enforce_jobs_insert_column_lock()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- A server context and anyone not inserting their own job pass through
  -- untouched. Same gate as the UPDATE money lock.
  IF public.is_server_context()
     OR auth.uid() IS DISTINCT FROM NEW.customer_id THEN
    RETURN NEW;
  END IF;

  -- Escrow state is the webhook's to set, never the poster's.
  NEW.payment_status           := 'unpaid';
  NEW.stripe_payment_intent_id := NULL;
  NEW.stripe_session_id        := NULL;

  -- Paid placement is create-boost-payment's to grant.
  NEW.boosted_at               := NULL;
  NEW.boost_expires_at         := NULL;

  -- Fixture flag: still not the poster's to set — whatever they sent is
  -- discarded — but the answer is now DERIVED from the posting account
  -- rather than hardcoded false. A fixture account's jobs are fixture jobs;
  -- a real account's jobs cannot be hidden, because profiles.is_seed is
  -- itself locked by prevent_self_escalation.
  NEW.is_seed                  := EXISTS (
    SELECT 1 FROM public.profiles p
     WHERE p.user_id = NEW.customer_id
       AND p.is_seed
  );

  -- A new job is open and unassigned. Assignment happens on UPDATE, through
  -- accept_application / the direct-offer flow; a direct offer at post time
  -- uses offered_to_helper_id, which is deliberately left writable.
  NEW.status                   := 'open';
  NEW.helper_id                := NULL;

  -- A brand-new job has lived through none of its own lifecycle. Every one
  -- of these can only be set legitimately by the corresponding server-side
  -- action AFTER a helper is actually hired (accept_application,
  -- mark_helper_arrival, the on-my-way/arrived RPCs, the completion RPCs) —
  -- none of that can have happened yet to a row that does not exist until
  -- this statement returns.
  NEW.helper_confirmed_at         := NULL;
  NEW.helper_on_the_way_at        := NULL;
  NEW.helper_arrived_at           := NULL;
  NEW.helper_arrival_verified_at  := NULL;
  NEW.poster_confirmed_at         := NULL;
  NEW.helper_completed_at         := NULL;
  NEW.poster_completed_at         := NULL;
  NEW.payout_scheduled_at         := NULL;

  RETURN NEW;
END;
$function$;

-- enforce_message_non_sender_read_only  (live md5(prosrc) before: 158aa8fee611777317427be75a61fece)
CREATE OR REPLACE FUNCTION public.enforce_message_non_sender_read_only()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- Service role / cron / edge functions: not a user write. anon is.
  IF public.is_server_context() THEN
    RETURN NEW;
  END IF;

  -- The sender's own edit is governed by the 15-minute window in the edit
  -- policy, which is where that rule belongs. This trigger has no opinion
  -- about it.
  IF auth.uid() = OLD.sender_id THEN
    RETURN NEW;
  END IF;

  IF NEW.content              IS DISTINCT FROM OLD.content
  OR NEW.edited_at            IS DISTINCT FROM OLD.edited_at
  OR NEW.id                   IS DISTINCT FROM OLD.id
  OR NEW.job_id               IS DISTINCT FROM OLD.job_id
  OR NEW.sender_id            IS DISTINCT FROM OLD.sender_id
  OR NEW.receiver_id          IS DISTINCT FROM OLD.receiver_id
  OR NEW.created_at           IS DISTINCT FROM OLD.created_at
  OR NEW.is_system            IS DISTINCT FROM OLD.is_system
  OR NEW.reply_to_id          IS DISTINCT FROM OLD.reply_to_id
  OR NEW.attachment_url       IS DISTINCT FROM OLD.attachment_url
  OR NEW.attachment_mime      IS DISTINCT FROM OLD.attachment_mime
  OR NEW.attachment_size      IS DISTINCT FROM OLD.attachment_size
  OR NEW.attachment_duration  IS DISTINCT FROM OLD.attachment_duration
  THEN
    RAISE EXCEPTION 'a message may only be edited by the person who sent it'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN NEW;
END;
$function$;

-- enforce_poster_jobs_money_lock  (live md5(prosrc) before: 3727688fcc4e055f35cb105e52f1ee08)
CREATE OR REPLACE FUNCTION public.enforce_poster_jobs_money_lock()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  changed_col text;
  locked_always CONSTANT text[] := ARRAY[
    'payment_status',
    'stripe_payment_intent_id',
    'boosted_at',
    'boost_expires_at',
    'boost_auto_extended',
    'is_urgent',
    'is_seed'
  ];
  locked_when_funded CONSTANT text[] := ARRAY[
    'budget',
    'urgent_fee',
    'platform_fee_amount',
    'platform_fee_percent',
    'helper_fee_percent',
    'customer_fee_amount',
    'commission_tax_amount',
    'sales_tax_amount',
    'protection_fee',
    'payment_status',
    'stripe_payment_intent_id',
    'helper_id',
    'poster_completed_at'
  ];
BEGIN
  IF public.is_server_context()
     OR auth.uid() IS DISTINCT FROM OLD.customer_id THEN
    RETURN NEW;
  END IF;

  IF NEW.customer_id IS DISTINCT FROM OLD.customer_id THEN
    RAISE EXCEPTION 'Posters may not reassign jobs.customer_id'
      USING ERRCODE = '42501';
  END IF;

  FOR changed_col IN
    SELECT n.key
    FROM jsonb_each(to_jsonb(NEW)) AS n
    JOIN jsonb_each(to_jsonb(OLD)) AS o ON o.key = n.key
    WHERE n.value IS DISTINCT FROM o.value
  LOOP
    IF changed_col = ANY (locked_always) THEN
      RAISE EXCEPTION 'Posters may not modify jobs.%', changed_col
        USING ERRCODE = '42501';
    END IF;
  END LOOP;

  IF OLD.payment_status IS DISTINCT FROM 'unpaid'
     OR OLD.stripe_session_id IS NOT NULL THEN
    FOR changed_col IN
      SELECT n.key
      FROM jsonb_each(to_jsonb(NEW)) AS n
      JOIN jsonb_each(to_jsonb(OLD)) AS o ON o.key = n.key
      WHERE n.value IS DISTINCT FROM o.value
    LOOP
      IF changed_col = ANY (locked_when_funded) THEN
        IF changed_col = 'helper_id'
           AND OLD.helper_id IS NULL
           AND NEW.helper_id IS NOT NULL
           AND OLD.status = 'open' THEN
          CONTINUE;
        END IF;
        -- ADDED 2026-09-05 — the server-owned UNASSIGN.
        -- `report_helper_no_show` reopens the job by clearing helper_id, and
        -- announces itself with the same transaction-local flag four other
        -- triggers already honour. Narrow on purpose: trusted ladder write,
        -- this column, and NULL specifically. Re-pointing helper_id at another
        -- person stays blocked even here.
        IF changed_col = 'helper_id'
           AND NEW.helper_id IS NULL
           AND current_setting('app.trusted_ladder_write', true) = 'on' THEN
          CONTINUE;
        END IF;
        RAISE EXCEPTION 'Posters may not modify jobs.% once checkout has opened', changed_col
          USING ERRCODE = '42501';
      END IF;
    END LOOP;
  END IF;

  RETURN NEW;
END;
$function$;

-- enforce_review_validity  (live md5(prosrc) before: 71c164dccae4769c1ea6a5117fab27ff)
CREATE OR REPLACE FUNCTION public.enforce_review_validity()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_job RECORD;
BEGIN
  IF NEW.reviewer_id = NEW.reviewee_id THEN
    RAISE EXCEPTION 'You cannot review yourself.' USING ERRCODE = 'check_violation';
  END IF;
  SELECT customer_id, helper_id, status INTO v_job FROM public.jobs WHERE id = NEW.job_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Job % not found.', NEW.job_id USING ERRCODE = 'foreign_key_violation';
  END IF;
  IF v_job.status <> 'completed' THEN
    RAISE EXCEPTION 'Reviews can only be left after the job is marked completed.'
      USING ERRCODE = 'check_violation', HINT = 'Current status: ' || v_job.status::text;
  END IF;
  IF NEW.reviewer_id NOT IN (v_job.customer_id, v_job.helper_id) THEN
    RAISE EXCEPTION 'Only the job poster or assigned helper can submit a review.'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.reviewer_id = v_job.customer_id AND NEW.reviewee_id <> v_job.helper_id THEN
    RAISE EXCEPTION 'Customer must review the assigned helper.' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.reviewer_id = v_job.helper_id AND NEW.reviewee_id <> v_job.customer_id THEN
    RAISE EXCEPTION 'Helper must review the customer who hired them.' USING ERRCODE = 'check_violation';
  END IF;

  -- ADDED 2026-09-04 — server owns these four columns on a client insert.
  -- A server context is the service_role/trigger path (backfills, seeds);
  -- an admin keeps the deliberate override. Everyone else, anon included,
  -- gets them reset, whatever they sent:
  --   feedback_visible_at -> NULL so set_review_visibility() actually runs
  --     (it early-returns when the column arrives pre-set, which is precisely
  --     how a reviewer could publish instantly and read the reply first).
  --   response_text/at    -> NULL; the reviewee's reply belongs to
  --     respond_to_review(), not to the person being reviewed BY.
  --   status              -> the 'published' default.
  IF NOT public.is_server_context() AND NOT has_role(auth.uid(), 'admin') THEN
    NEW.feedback_visible_at := NULL;
    NEW.response_text       := NULL;
    NEW.response_at         := NULL;
    NEW.status              := 'published';
  END IF;

  RETURN NEW;
END;
$function$;

-- prevent_job_field_escalation  (live md5(prosrc) before: 9fd5ee0db90596b49981399b5a59fbf8)
CREATE OR REPLACE FUNCTION public.prevent_job_field_escalation()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  changed_col text;
  -- Tier 1 — no authenticated client writes these through ANY path. The only
  -- writers are rpc_decide_dispute (admin-only, exempt above) and the
  -- escrow/payout edge functions, which run as service_role and return at the
  -- is_server_context() gate (a NULL uid alone no longer passes: anon has one).
  locked_everyone CONSTANT text[] := ARRAY[
    'platform_fee_amount',
    'platform_fee_percent',
    'helper_fee_percent',
    'customer_fee_amount',
    'commission_tax_amount',
    'sales_tax_amount',
    'sales_tax_rate',
    'protection_fee',
    'urgent_fee',
    'payout_scheduled_at',
    'has_active_dispute'
  ];
  poster_locked_always CONSTANT text[] := ARRAY[
    'payment_status',
    'stripe_payment_intent_id',
    'stripe_session_id',
    'boosted_at',
    'boost_expires_at',
    -- ADDED 2026-09-04. Without it, a pending-direct-offer helper could clear
    -- or set the once-only auto-extension latch: clearing it re-arms a free
    -- +12h featured placement every hour off a single $3 boost; setting it
    -- denies a paying subscriber the extension they bought.
    'boost_auto_extended',
    'is_urgent',
    'is_seed',
    'customer_id'
  ];
  poster_locked_when_funded CONSTANT text[] := ARRAY[
    'budget',
    'urgent_fee',
    'payment_status',
    'stripe_payment_intent_id',
    'helper_id',
    'poster_completed_at'
  ];
  v_is_target boolean;
BEGIN
  IF public.is_server_context() THEN
    RETURN NEW;
  END IF;
  IF current_setting('app.trusted_ladder_write', true) = 'on' THEN
    RETURN NEW;
  END IF;
  IF has_role(auth.uid(), 'admin') THEN
    RETURN NEW;
  END IF;

  FOR changed_col IN
    SELECT n.key
    FROM jsonb_each(to_jsonb(NEW)) AS n
    JOIN jsonb_each(to_jsonb(OLD)) AS o ON o.key = n.key
    WHERE n.value IS DISTINCT FROM o.value
  LOOP
    IF changed_col = ANY (locked_everyone) THEN
      RAISE EXCEPTION 'jobs.% is set by the platform, not by a client', changed_col
        USING ERRCODE = '42501';
    END IF;
  END LOOP;

  -- The poster and the assigned helper have a column-lock trigger each
  -- (enforce_poster_jobs_money_lock / enforce_helper_jobs_column_whitelist).
  -- Leave them to those, so there is exactly one place to read per role.
  IF auth.uid() = OLD.customer_id OR auth.uid() = OLD.helper_id THEN
    RETURN NEW;
  END IF;

  -- The business-member branch used to sit here. Business accounts are gone,
  -- so the targeted helper is the only remaining third party with any UPDATE
  -- grant on a job row.
  v_is_target := OLD.offered_to_helper_id IS NOT NULL
                 AND auth.uid() = OLD.offered_to_helper_id;

  IF NOT v_is_target THEN
    -- No policy grants anyone else UPDATE on this row; RLS decides, as before.
    RETURN NEW;
  END IF;

  -- A deny-list rather than an allow-list, on purpose: the sibling BEFORE
  -- triggers (stamp_job_accepted_at, set_revision_deadline,
  -- track_revision_scope_creep) sort ahead of this one and legitimately mutate
  -- NEW, and their writes are indistinguishable from the client's here.
  FOR changed_col IN
    SELECT n.key
    FROM jsonb_each(to_jsonb(NEW)) AS n
    JOIN jsonb_each(to_jsonb(OLD)) AS o ON o.key = n.key
    WHERE n.value IS DISTINCT FROM o.value
  LOOP
    IF changed_col = ANY (poster_locked_always) THEN
      RAISE EXCEPTION 'jobs.% is not writable from this seat', changed_col
        USING ERRCODE = '42501';
    END IF;
    IF OLD.payment_status IS DISTINCT FROM 'unpaid'
       AND changed_col = ANY (poster_locked_when_funded) THEN
      -- The one sanctioned write to helper_id: the targeted helper taking a
      -- still-open funded job (respond_to_direct_offer). Identical carve-out
      -- to the poster trigger's.
      IF changed_col = 'helper_id'
         AND OLD.helper_id IS NULL
         AND NEW.helper_id IS NOT NULL
         AND OLD.status = 'open' THEN
        CONTINUE;
      END IF;
      RAISE EXCEPTION 'jobs.% is not writable from this seat after escrow is funded', changed_col
        USING ERRCODE = '42501';
    END IF;
  END LOOP;

  -- A targeted helper may TAKE the offer; they may not hand the job to
  -- somebody else.
  IF NEW.helper_id IS DISTINCT FROM OLD.helper_id
     AND NEW.helper_id IS NOT NULL
     AND NEW.helper_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'An offered Helpr may only assign the job to themselves'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$function$;

-- prevent_self_escalation  (live md5(prosrc) before: ae55b3f310e5d1a8541db0ff03a041bc)
CREATE OR REPLACE FUNCTION public.prevent_self_escalation()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_billing_attempt boolean;
  v_attempted_tier text;
BEGIN
  IF public.is_server_context() OR has_role(auth.uid(), 'admin') THEN
    RETURN NEW;
  END IF;

  IF current_setting('app.trusted_ladder_write', true) = 'on' THEN
    RETURN NEW;
  END IF;

  v_billing_attempt :=
       NEW.subscription_tier                 IS DISTINCT FROM OLD.subscription_tier
    OR NEW.subscription_expires_at           IS DISTINCT FROM OLD.subscription_expires_at
    OR NEW.stripe_customer_id                IS DISTINCT FROM OLD.stripe_customer_id
    OR NEW.stripe_subscription_id            IS DISTINCT FROM OLD.stripe_subscription_id
    OR NEW.subscription_billing_cycle        IS DISTINCT FROM OLD.subscription_billing_cycle
    OR NEW.subscription_cancel_at_period_end IS DISTINCT FROM OLD.subscription_cancel_at_period_end
    OR NEW.apple_original_transaction_id     IS DISTINCT FROM OLD.apple_original_transaction_id;
  v_attempted_tier := NEW.subscription_tier;

  NEW.approval_status := OLD.approval_status;
  NEW.ban_status := OLD.ban_status;
  NEW.stripe_account_id := OLD.stripe_account_id;
  NEW.subscription_tier := OLD.subscription_tier;
  NEW.subscription_expires_at := OLD.subscription_expires_at;
  NEW.denial_reason := OLD.denial_reason;
  NEW.denial_email_count := OLD.denial_email_count;
  NEW.last_denial_email_at := OLD.last_denial_email_at;
  NEW.approval_email_count := OLD.approval_email_count;
  NEW.last_approval_email_at := OLD.last_approval_email_at;
  NEW.drip_step := OLD.drip_step;
  NEW.last_drip_at := OLD.last_drip_at;

  NEW.idv_status := OLD.idv_status;
  NEW.idv_session_id := OLD.idv_session_id;
  NEW.idv_attempted_at := OLD.idv_attempted_at;
  NEW.idv_attempt_count := OLD.idv_attempt_count;
  NEW.idv_confidence := OLD.idv_confidence;
  NEW.idv_failure_reason := OLD.idv_failure_reason;
  NEW.legacy_manual_review := OLD.legacy_manual_review;

  NEW.id_verification_status := OLD.id_verification_status;
  NEW.has_applied_before := OLD.has_applied_before;

  NEW.background_check_status := OLD.background_check_status;
  NEW.is_legacy_user := OLD.is_legacy_user;

  NEW.onboarding_fee_paid := OLD.onboarding_fee_paid;
  NEW.onboarding_fee_charged_at := OLD.onboarding_fee_charged_at;
  NEW.email_verified := OLD.email_verified;
  NEW.verification_email_count := OLD.verification_email_count;
  NEW.last_verification_email_at := OLD.last_verification_email_at;

  NEW.application_count := OLD.application_count;
  NEW.auto_suspended_until := OLD.auto_suspended_until;

  NEW.license_status := OLD.license_status;
  NEW.insurance_status := OLD.insurance_status;
  NEW.license_reviewed_at := OLD.license_reviewed_at;
  NEW.insurance_reviewed_at := OLD.insurance_reviewed_at;
  NEW.license_reviewed_by := OLD.license_reviewed_by;
  NEW.insurance_reviewed_by := OLD.insurance_reviewed_by;
  NEW.license_rejection_reason := OLD.license_rejection_reason;
  NEW.insurance_rejection_reason := OLD.insurance_rejection_reason;

  -- ADDED 20260903012612. An expiry the member can push out is not an expiry;
  -- with step 3 reading these to decide the credential tier, writing your own
  -- would be the profiles-side version of the helper_credentials self-grant.
  NEW.license_expires_at := OLD.license_expires_at;
  NEW.insurance_expires_at := OLD.insurance_expires_at;

  NEW.is_licensed := OLD.is_licensed;
  NEW.is_insured := OLD.is_insured;

  NEW.stripe_identity_verified := OLD.stripe_identity_verified;
  NEW.stripe_identity_verified_at := OLD.stripe_identity_verified_at;
  NEW.stripe_charges_enabled := OLD.stripe_charges_enabled;
  NEW.stripe_payouts_enabled := OLD.stripe_payouts_enabled;
  NEW.is_seed := OLD.is_seed;

  NEW.stripe_customer_id := OLD.stripe_customer_id;
  NEW.stripe_subscription_id := OLD.stripe_subscription_id;
  NEW.subscription_billing_cycle := OLD.subscription_billing_cycle;
  NEW.subscription_cancel_at_period_end := OLD.subscription_cancel_at_period_end;

  -- ADDED 20260903022948. The Apple IAP receipt anchor, for the same reason as
  -- the Stripe linkage directly above: it is what the verifier trusts to decide
  -- whether a tier was paid for.
  NEW.apple_original_transaction_id := OLD.apple_original_transaction_id;

  IF v_billing_attempt THEN
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM public.error_logs e
         WHERE e.tags->>'source' = 'rls-escalation-refused'
           AND e.tags->>'user_id' = auth.uid()::text
           AND e.created_at > now() - interval '1 hour'
      ) THEN
        INSERT INTO public.error_logs (severity, message, tags, context)
        VALUES (
          'warning',
          'Refused a non-admin write to the profiles billing columns',
          jsonb_build_object('source', 'rls-escalation-refused',
                             'area', 'security',
                             'user_id', auth.uid()::text),
          jsonb_build_object(
            'current_tier',   OLD.subscription_tier,
            'attempted_tier', v_attempted_tier,
            'row_user_id',    OLD.user_id::text));
      END IF;
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
  END IF;

  RETURN NEW;
END;
$function$;

-- reject_new_group_jobs  (live md5(prosrc) before: f4fc88ab61e0c30140bfcd0997fbaffa)
CREATE OR REPLACE FUNCTION public.reject_new_group_jobs()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  -- Only a real end-user request. Service role / cron / edge functions are a
  -- server context and unaffected; anon is an end-user request.
  IF public.is_server_context() THEN
    RETURN NEW;
  END IF;

  IF NEW.is_group_job IS TRUE
     AND (TG_OP = 'INSERT' OR OLD.is_group_job IS DISTINCT FROM TRUE) THEN
    RAISE EXCEPTION 'Group jobs are temporarily unavailable. Post this as a one-time job and we''ll get it staffed.'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$function$;

-- snapshot_application_job_point  (live md5(prosrc) before: 0204c215c2c71110431c43752cc04ad1)
CREATE OR REPLACE FUNCTION public.snapshot_application_job_point()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- Whatever the client sent for these is ignored; the job row is the only
    -- source. SECURITY DEFINER because the applying helper has no SELECT on
    -- the job's raw coordinates.
    SELECT round(j.latitude, 2), round(j.longitude, 2)
      INTO NEW.job_latitude, NEW.job_longitude
      FROM public.jobs j
     WHERE j.id = NEW.job_id;
    RETURN NEW;
  END IF;

  -- UPDATE. A server context may repair; an end user (either party — the
  -- poster has UPDATE on this row — or anon) may not touch the point.
  IF NOT public.is_server_context()
     AND current_setting('app.first_geocode_fill', true) IS DISTINCT FROM 'on' THEN
    NEW.job_latitude  := OLD.job_latitude;
    NEW.job_longitude := OLD.job_longitude;
  END IF;
  RETURN NEW;
END;
$function$;

-- stamp_message_read_at  (live md5(prosrc) before: a046d7d4842f087f7b6812e539d82464)
CREATE OR REPLACE FUNCTION public.stamp_message_read_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  -- Server context: service_role / cron / edge function / migration. Trusted
  -- to write read_at directly (it holds the column grant); pass through
  -- untouched. anon (NULL uid, role anon) is not one.
  if public.is_server_context() then
    return NEW;
  end if;

  if coalesce(NEW.read, false) and not coalesce(OLD.read, false) then
    NEW.read_at := now();
  else
    -- Re-opening a thread must not bump the receipt, and true->false keeps the
    -- evidence of a read that demonstrably happened rather than clearing it.
    NEW.read_at := OLD.read_at;
  end if;
  return NEW;
end;
$function$;

-- Trigger functions are never called by a client role.
REVOKE ALL ON FUNCTION public.enforce_application_credential_tier() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.enforce_application_job_state() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.enforce_audit_log_self_attribution() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.enforce_banned_profile_text_lock() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.enforce_block_on_message_insert() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.enforce_cancellation_requires_rpc() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.enforce_confirm_on_live_job() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.enforce_credential_status_server_owned() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.enforce_dispute_opener_column_whitelist() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.enforce_group_roster_award_gate() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.enforce_helper_award_gate() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.enforce_helper_completion_gates() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.enforce_helper_jobs_column_whitelist() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.enforce_job_funded_before_award() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.enforce_jobs_insert_column_lock() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.enforce_message_non_sender_read_only() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.enforce_poster_jobs_money_lock() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.enforce_review_validity() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.prevent_job_field_escalation() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.prevent_self_escalation() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.reject_new_group_jobs() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.snapshot_application_job_point() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.stamp_message_read_at() FROM PUBLIC, anon;
