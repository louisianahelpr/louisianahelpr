-- SEC-003: close a latent self-escalation gap in prevent_self_escalation().
--
-- The trigger (20260505234501) pins every privileged profiles column to its
-- OLD value on a non-admin UPDATE — approval_status, ban_status, idv_status,
-- subscription_tier, license/insurance state, etc. Two columns added later by
-- 20260612210000 were never added to that list:
--   * id_verification_status  (CHECK IN unverified/prompted/submitted/verified/failed)
--   * has_applied_before      (boolean)
-- so a non-admin can currently flip either via a direct profiles UPDATE.
--
-- Today these columns gate NOTHING (referenced only in types.ts + their
-- defining migration), so the practical blast radius is zero. But the escalation
-- trigger is the single choke point that lets future code TRUST any profiles
-- column as tamper-proof; a column silently outside its coverage is a trap for
-- whoever later wires gating onto id_verification_status. Adding the two OLD
-- pins is additive, changes no existing behavior, and closes the gap now rather
-- than after something depends on it. Dropping the columns was considered and
-- rejected: both are NOT NULL and id_verification_status carries a CHECK, so a
-- prod DROP is irreversible and higher-risk than two idempotent OLD assignments.
--
-- Replay-safe: CREATE OR REPLACE reproduces the full current function body plus
-- the two new lines. Depends only on columns that exist by this timestamp
-- (id_verification_status + has_applied_before ship in 20260612210000, earlier).

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

  -- SEC-003: pin the two later-added IDV/apply columns (previously writable).
  NEW.id_verification_status := OLD.id_verification_status;
  NEW.has_applied_before := OLD.has_applied_before;

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
