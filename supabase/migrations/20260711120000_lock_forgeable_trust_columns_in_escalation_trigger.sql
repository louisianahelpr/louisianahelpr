-- SEC-004: pin two more self-forgeable trust columns in prevent_self_escalation().
--
-- The profiles self-update RLS policy is `auth.uid() = user_id` for ALL columns
-- (the per-column WITH CHECK guards were dropped to fix a recursion 500), so the
-- BEFORE UPDATE trigger prevent_self_escalation() is the SOLE guard pinning every
-- privileged column to its OLD value on a non-admin write. A live audit of the
-- deployed function against information_schema.columns found two trust-bearing
-- columns still outside its coverage:
--   * background_check_status  (CHECK IN none/pending/verified/failed)
--       Legit write path is Stripe bgc payment -> checkoutSessionCompleted sets
--       'pending' -> the background-check result trigger sets 'verified'/'failed'.
--       A non-admin could otherwise `update({ background_check_status:'verified' })`
--       directly via PostgREST and FORGE the "Background verified" badge rendered
--       to posters in ProfileHeaderCard.tsx — a trust signal they never paid for
--       or passed. Directly influences who wins jobs.
--   * is_legacy_user  (boolean)
--       Read in ProtectedRoute.tsx / CompleteProfile.tsx to BYPASS the
--       complete-profile onboarding gate. Self-granting it skips onboarding.
--
-- is_licensed / is_insured were reviewed and deliberately left writable: the
-- credential BADGE requires license_status/insurance_status = 'verified' (both
-- already pinned here, admin-only), so the user-owned intent booleans gate
-- nothing on their own. apple_original_transaction_id is unused in app code
-- (types.ts only) and subscription_tier is already pinned, so it gates nothing.
--
-- Additive: two more OLD pins, no existing behavior changes. Replay-safe via
-- CREATE OR REPLACE reproducing the full current body (the SEC-003 pins for
-- id_verification_status + has_applied_before ship in 20260710150000, earlier)
-- plus the two new lines. Depends only on columns present by this timestamp.

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

  RETURN NEW;
END;
$function$;
