-- The LAST client-side ban ladder moves server-side, and `jobs` stops trusting
-- the two writer classes no column-lock trigger ever covered.
--
-- Four things, all of the same shape: a consequence, a money column, or a
-- state transition that the CLIENT was deciding.
--
-- ── 1. The cancellation ladder (HIGH) ──────────────────────────────────────
-- src/components/CancellationDialog.tsx counted prior `cancel_with_helper`
-- violations IN THE BROWSER and, on the third cancel, inserted
--   user_bans { ban_type: 'permanent', banned_by: THE OFFENDER THEMSELVES }
-- and set profiles.ban_status='permanently_banned', then redirected to
-- /account-banned. This is the exact bug 20260825183000 removed from the
-- message scanner, still live in the cancellation path — and worse here,
-- because RLS REJECTS both of those writes for a non-admin. The ban never
-- landed. The user was shown a ban screen anyway while the database said
-- `active`: a punishment that is theatre for the person receiving it and
-- invisible to the admins who are supposed to review it.
--
-- apply_cancellation_violation_consequence is the same ladder the message
-- scanner got, on the same rungs, ending in a REVERSIBLE 7-day restriction
-- plus an admin case at /admin?view=banreview rather than a self-issued
-- permanent ban.
--
-- ── 2. jobs field escalation (HIGH leverage) ───────────────────────────────
-- All four non-admin `jobs` UPDATE policies are column-unrestricted
-- (with_check NULL, no column list). Two triggers already narrow that in
-- practice — enforce_helper_jobs_column_whitelist (the assigned helper) and
-- enforce_poster_jobs_money_lock (the poster) — but BOTH return early for any
-- writer who is neither OLD.helper_id nor OLD.customer_id. That leaves two
-- policy-granted writer classes with a completely unrestricted UPDATE:
--   * "Business members can update team jobs"      (is_business_member)
--   * "Targeted helper can respond to direct offer" (offered_to_helper_id —
--     not yet helper_id, so the helper whitelist's early return fires)
-- A modified client in either seat could write payment_status, the fee
-- columns, payout_scheduled_at, helper_id or has_active_dispute directly.
-- prevent_job_field_escalation covers exactly those two, plus one thin
-- everyone-tier for the handful of columns NO authenticated client writes
-- through any path (verified against the codebase and every SECURITY DEFINER
-- function that updates jobs).
--
-- ── 3./4. see the sections below.

-- ───────────────────────────────────────────────────────────────────────────
-- 0. The trusted-write hatch
-- ───────────────────────────────────────────────────────────────────────────
-- prevent_self_escalation() exempts exactly two callers: service_role /
-- pg_cron (auth.uid() IS NULL) and admins. A SECURITY DEFINER RPC does NOT
-- qualify — SECURITY DEFINER changes the executing ROLE, not the JWT, so
-- auth.uid() inside the RPC is still the calling user and the trigger pins
-- ban_status right back to OLD. The ladder RPCs therefore need a third,
-- explicit hatch, or their consequence writes are silently discarded.
--
-- A transaction-local GUC is that hatch. It cannot be set from a client:
-- PostgREST exposes RPCs, never arbitrary SQL, and `is_local => true` scopes
-- it to the statement's own transaction (one request = one transaction), so
-- it cannot leak into a later client write.
--
-- KNOWN, NOT FIXED HERE: several PRE-EXISTING ladders write ban_status from a
-- user's session and are therefore already being reverted by this trigger —
-- apply_message_violation_consequence, apply_job_denial_consequence (via
-- decline_job_offer / helper_cancel_booking), report_helper_no_show,
-- auto_restrict_repeat_violators, review_credential, sync_credential_from_check.
-- Retrofitting six live functions blind is a separate, testable change; this
-- migration only builds the hatch and uses it for the new RPC.

-- ───────────────────────────────────────────────────────────────────────────
-- 1. The cancellation ladder, server-side
-- ───────────────────────────────────────────────────────────────────────────
-- Acts on auth.uid() only: the caller cannot escalate (or absolve) anyone but
-- themselves, so a modified client gains nothing by lying about a user id.
CREATE OR REPLACE FUNCTION public.apply_cancellation_violation_consequence(
  p_job_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_job record;
  v_desc text;
  v_prior_count int;
  v_action text;
  v_status text;
  v_dupe uuid;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  SELECT j.id, j.title, j.customer_id, j.helper_id, j.status, j.cancelled_by
    INTO v_job
    FROM public.jobs j
   WHERE j.id = p_job_id;

  IF v_job.id IS NULL THEN
    RAISE EXCEPTION 'job_not_found';
  END IF;

  -- Only the poster of the job, and only for a job that has actually been
  -- cancelled. The client cancels the job row first and reports afterwards;
  -- checking the row means a caller cannot invent strikes against themselves
  -- (harmless) or, more importantly, spend someone else's.
  IF v_job.customer_id IS DISTINCT FROM v_user THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;
  IF v_job.status IS DISTINCT FROM 'cancelled' THEN
    RAISE EXCEPTION 'job_not_cancelled';
  END IF;

  -- No helper was committed → no strike. Cancelling a job nobody accepted
  -- costs nobody anything, which is why the ladder only counts these.
  IF v_job.helper_id IS NULL THEN
    RETURN jsonb_build_object('action', 'none', 'prior_count', 0);
  END IF;

  v_desc := 'Cancelled job with Helpr assigned: "' || COALESCE(v_job.title, 'Unknown') || '"';

  -- IDEMPOTENCE. One cancelled job is ONE offence however many times the
  -- dialog retries or the tab reloads — the strike is keyed to the job.
  SELECT id INTO v_dupe
    FROM public.user_violations
   WHERE user_id = v_user
     AND violation_type = 'cancel_with_helper'
     AND job_id = p_job_id
   LIMIT 1;

  IF v_dupe IS NOT NULL THEN
    RETURN jsonb_build_object('action', 'duplicate', 'violation_id', v_dupe);
  END IF;

  SELECT count(*) INTO v_prior_count
    FROM public.user_violations
   WHERE user_id = v_user AND violation_type = 'cancel_with_helper';

  v_action := CASE
    WHEN v_prior_count >= 2 THEN 'pending_ban_review'
    WHEN v_prior_count = 1 THEN 'final_warning'
    ELSE 'warning'
  END;

  INSERT INTO public.user_violations (user_id, violation_type, description, job_id, action_taken)
  VALUES (v_user, 'cancel_with_helper', v_desc, p_job_id, v_action);

  SELECT ban_status INTO v_status FROM public.profiles WHERE user_id = v_user;

  -- Everything below writes profiles columns prevent_self_escalation() pins.
  PERFORM set_config('app.trusted_ladder_write', 'on', true);

  IF v_action = 'warning' THEN
    INSERT INTO public.notifications (user_id, title, message, type, link)
    VALUES (v_user, 'Cancellation warning (1 of 2)',
            'You cancelled a job after a Helpr had already committed to it. This is a warning; a second one is a final warning.',
            'warning', '/warnings');

  ELSIF v_action = 'final_warning' THEN
    -- Never downgrade a harsher standing status into 'final_warning'.
    UPDATE public.profiles
       SET ban_status = 'final_warning'
     WHERE user_id = v_user
       AND COALESCE(ban_status, 'active') NOT IN ('temp_banned', 'permanently_banned');
    INSERT INTO public.notifications (user_id, title, message, type, link)
    VALUES (v_user, 'Final warning',
            'That is your second cancellation after a Helpr committed. One more and your account is restricted for 7 days while an admin reviews it.',
            'warning', '/warnings');

  ELSIF v_action = 'pending_ban_review' THEN
    -- A REVERSIBLE restriction, not a ban: 7 days, lifted on schedule by
    -- sweep_expired_auto_bans, while a human looks at the case. If the admin
    -- confirms, the permanent ban replaces it; if the admin dismisses,
    -- nothing irreversible ever happened.
    IF COALESCE(v_status, 'active') <> 'permanently_banned' THEN
      UPDATE public.profiles
         SET ban_status = 'temp_banned',
             auto_suspended_until = GREATEST(
               COALESCE(auto_suspended_until, now()), now() + interval '7 days')
       WHERE user_id = v_user;

      INSERT INTO public.notifications (user_id, title, message, type, link)
      VALUES (v_user, 'Account restricted for 7 days',
              'Third cancellation after a Helpr committed — your account is restricted for 7 days and an admin is reviewing it. If you think this is wrong, email admin@louisianahelpr.com.',
              'warning', '/warnings');
    END IF;

    -- Put the case where a person will actually see it. Same admin fan-out
    -- apply_message_violation_consequence uses.
    INSERT INTO public.notifications (user_id, type, title, message, link, read)
    SELECT ur.user_id,
           'system_alert',
           'Ban review needed',
           format('%s has cancelled %s jobs with a Helpr committed and is restricted for 7 days pending your decision.',
                  COALESCE(NULLIF(p.full_name, ''), p.email, 'A user'), v_prior_count + 1),
           '/admin?view=banreview',
           false
      FROM public.user_roles ur
      CROSS JOIN LATERAL (
        SELECT full_name, email FROM public.profiles WHERE user_id = v_user
      ) p
     WHERE ur.role = 'admin';
  END IF;

  RETURN jsonb_build_object('action', v_action, 'prior_count', v_prior_count);
END;
$$;

REVOKE ALL ON FUNCTION public.apply_cancellation_violation_consequence(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.apply_cancellation_violation_consequence(uuid) TO authenticated;

-- The Ban Review queue reads user_violations by action_taken; it now carries
-- two violation types, so index the second one's history lookup too.
CREATE INDEX IF NOT EXISTS idx_user_violations_user_type
  ON public.user_violations (user_id, violation_type, created_at DESC);

-- ───────────────────────────────────────────────────────────────────────────
-- 2. prevent_self_escalation: the trusted-write hatch, and the two forgeable
--    credential booleans (item 3)
-- ───────────────────────────────────────────────────────────────────────────
-- is_licensed / is_insured were the only credential columns NOT pinned, so a
-- modified client could set is_licensed = true with no document attached. No
-- badge can be forged TODAY — CredentialBadge requires license_status =
-- 'verified' as well — but that is one careless `||` away from mattering, and
-- the pair is meant to be server-derived either way.
--
-- Pinning them alone would break the real flow, because the only thing that
-- set them true was the client (CredentialsTab sends is_licensed:true beside
-- license_url). So auto_pending_credentials — which already clears them to
-- false when a document is REMOVED — is extended below to set them true when
-- one is attached. Trigger order makes this work: 'tr_prevent_self_escalation'
-- sorts before 'trg_auto_pending_credentials' ('_' < 'g'), so the pin runs
-- first and the derivation runs second, on the same NEW row.
CREATE OR REPLACE FUNCTION public.prevent_self_escalation()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NULL OR has_role(auth.uid(), 'admin') THEN
    RETURN NEW;
  END IF;

  -- A server-owned ladder running inside a SECURITY DEFINER RPC. See the
  -- hatch note at the top of this migration: SECURITY DEFINER does not change
  -- auth.uid(), so without this the RPC's own consequence writes are reverted.
  IF current_setting('app.trusted_ladder_write', true) = 'on' THEN
    RETURN NEW;
  END IF;

  NEW.approval_status := OLD.approval_status;
  NEW.ban_status := OLD.ban_status;
  -- profiles.role removed; role escalation prevention is on user_roles
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
  NEW.idv_confidence := OLD.idv_confidence;
  NEW.idv_failure_reason := OLD.idv_failure_reason;
  NEW.legacy_manual_review := OLD.legacy_manual_review;

  -- SEC-003: the two later-added IDV/apply columns.
  NEW.id_verification_status := OLD.id_verification_status;
  NEW.has_applied_before := OLD.has_applied_before;

  -- SEC-004: forgeable trust / onboarding-gate columns.
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

  -- Defense in depth: the credential BOOLEANS are derived from the document
  -- URL by trg_auto_pending_credentials, which runs immediately after this.
  NEW.is_licensed := OLD.is_licensed;
  NEW.is_insured := OLD.is_insured;

  RETURN NEW;
END;
$function$;

-- The derivation half: a document attached now sets its boolean server-side,
-- exactly where the removal case was already handled.
CREATE OR REPLACE FUNCTION public.auto_pending_credentials()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- License document changed (and user is not admin doing the change)
  IF NEW.license_url IS DISTINCT FROM OLD.license_url THEN
    IF NEW.license_url IS NOT NULL AND NEW.license_url <> '' THEN
      NEW.is_licensed := true;
      IF NOT (auth.uid() IS NOT NULL AND has_role(auth.uid(), 'admin')) THEN
        NEW.license_status := 'pending';
        NEW.license_reviewed_at := NULL;
        NEW.license_reviewed_by := NULL;
        NEW.license_rejection_reason := NULL;
      END IF;
    ELSE
      NEW.license_status := 'none';
      NEW.is_licensed := false;
    END IF;
  END IF;

  -- Insurance document changed
  IF NEW.insurance_url IS DISTINCT FROM OLD.insurance_url THEN
    IF NEW.insurance_url IS NOT NULL AND NEW.insurance_url <> '' THEN
      NEW.is_insured := true;
      IF NOT (auth.uid() IS NOT NULL AND has_role(auth.uid(), 'admin')) THEN
        NEW.insurance_status := 'pending';
        NEW.insurance_reviewed_at := NULL;
        NEW.insurance_reviewed_by := NULL;
        NEW.insurance_rejection_reason := NULL;
      END IF;
    ELSE
      NEW.insurance_status := 'none';
      NEW.is_insured := false;
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

-- ───────────────────────────────────────────────────────────────────────────
-- 3. jobs: the writer classes no column-lock trigger covered
-- ───────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.prevent_job_field_escalation()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  changed_col text;
  -- Tier 1 — no authenticated client writes these through ANY path. Verified
  -- against src/ (zero UPDATE call sites) and against every SECURITY DEFINER
  -- function that updates jobs: the only writers are rpc_decide_dispute
  -- (admin-only, exempt above) and the escrow/payout edge functions, which run
  -- as service_role and return at the auth.uid() IS NULL gate.
  -- NOTE the deliberate omissions: cancellation_fee / cancellation_fee_status
  -- (the poster's cancel flow writes them client-side, and the helper
  -- whitelist permits them), dispute_resolved_at (PostedJobActions lets the
  -- poster accept a resolution), and helper_id (every hire path writes it).
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
  -- Tier 2a — a business member is a poster by proxy, so they get the poster's
  -- rules from enforce_poster_jobs_money_lock, which never sees them.
  poster_locked_always CONSTANT text[] := ARRAY[
    'payment_status',
    'stripe_payment_intent_id',
    'stripe_session_id',
    'boosted_at',
    'boost_expires_at',
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
  v_is_member boolean;
  v_is_target boolean;
BEGIN
  -- service_role / pg_cron (void-cancelled-payments, auto-* sweeps, the
  -- payout pipeline) and admins pass through, same gate the sibling triggers
  -- and prevent_self_escalation use.
  IF auth.uid() IS NULL THEN
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

  -- The poster and the assigned helper already have a column-lock trigger
  -- each (enforce_poster_jobs_money_lock / enforce_helper_jobs_column_whitelist).
  -- Leave them to those, so there is exactly one place to read per role.
  IF auth.uid() = OLD.customer_id OR auth.uid() = OLD.helper_id THEN
    RETURN NEW;
  END IF;

  v_is_member := OLD.business_id IS NOT NULL AND is_business_member(OLD.business_id, auth.uid());
  v_is_target := OLD.offered_to_helper_id IS NOT NULL AND auth.uid() = OLD.offered_to_helper_id;

  IF NOT (v_is_member OR v_is_target) THEN
    -- No policy grants anyone else UPDATE on this row; RLS decides, as before.
    RETURN NEW;
  END IF;

  -- Both classes get the POSTER'S rules rather than an allow-list, on purpose.
  -- An allow-list here would be wrong twice over: it would have to enumerate
  -- every ordinary editable field of a team job, and it would trip over the
  -- sibling BEFORE triggers that legitimately mutate NEW on the way past
  -- (stamp_job_accepted_at, set_revision_deadline, track_revision_scope_creep
  -- all sort ahead of this one and their writes are indistinguishable from the
  -- client's here). A deny-list only has to name the columns that matter.
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
      -- The one sanctioned write to helper_id: taking a still-open funded job
      -- (accept_application for a business member, respond_to_direct_offer for
      -- the targeted helper). Identical carve-out to the poster trigger's.
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
  -- somebody else. (A business member hiring on behalf of the team can.)
  IF v_is_target AND NOT v_is_member
     AND NEW.helper_id IS DISTINCT FROM OLD.helper_id
     AND NEW.helper_id IS NOT NULL
     AND NEW.helper_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'An offered Helpr may only assign the job to themselves'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_prevent_job_field_escalation ON public.jobs;
CREATE TRIGGER trg_prevent_job_field_escalation
  BEFORE UPDATE ON public.jobs
  FOR EACH ROW EXECUTE FUNCTION public.prevent_job_field_escalation();

-- ───────────────────────────────────────────────────────────────────────────
-- 4. The business invite claim was a dead write
-- ───────────────────────────────────────────────────────────────────────────
-- "Owner can update members; invitee can accept own invite" had a USING
-- clause and NO WITH CHECK. Postgres then reuses USING as the check, so the
-- POST-image is tested against `status = 'pending' AND lower(invited_email) =
-- lower(auth.email())` — and the whole point of accepting an invite is that
-- the post-image says 'active'. Every invite claim at signup
-- (src/pages/Signup.tsx) failed the check and silently did nothing: the
-- invitee got an account and no team.
--
-- The explicit WITH CHECK below permits the owner's writes unchanged and
-- allows the invitee exactly the pending → active transition on their own
-- invite, with user_id pinned to themselves so a claim cannot enroll somebody
-- else.
DROP POLICY IF EXISTS "Owner can update members; invitee can accept own invite" ON public.business_members;
CREATE POLICY "Owner can update members; invitee can accept own invite"
  ON public.business_members
  FOR UPDATE
  USING (
    is_business_owner(business_id, (SELECT auth.uid()))
    OR (
      status = 'pending'::business_member_status
      AND invited_email IS NOT NULL
      AND lower(invited_email) = lower((SELECT auth.email()))
    )
  )
  WITH CHECK (
    is_business_owner(business_id, (SELECT auth.uid()))
    OR (
      status = 'active'::business_member_status
      AND invited_email IS NOT NULL
      AND lower(invited_email) = lower((SELECT auth.email()))
      AND user_id = (SELECT auth.uid())
    )
  );
