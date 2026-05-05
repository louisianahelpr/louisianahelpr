-- Three MORE triggers still referenced profiles.role (dropped column).
-- Same class of bug as handle_new_user fixed in commit f7adfa8b.
-- Discovered while testing branded auth emails — admin signup test
-- failed with: column "role" does not exist (different from the earlier
-- profiles.role error because these write to profiles.role indirectly
-- via NEW.role := OLD.role or in WHERE clauses).
--
-- The 3 triggers that were broken:
--   1. prevent_self_escalation — fires on profiles UPDATE; was setting
--      NEW.role := OLD.role. Without this fix, ANY profile UPDATE by a
--      non-admin would error. Role escalation prevention now lives in
--      the prevent_admin_role_self_grant trigger on user_roles.
--   2. sync_email_verified — fires when auth.users.email_confirmed_at
--      flips. Was filtering with `role = 'customer'`. Replaced with
--      has_role(NEW.id, 'customer'::app_role) which queries user_roles.
--   3. sync_email_verified_on_insert — fires on auth.users INSERT.
--      Same has_role() fix as #2.
--
-- Verified end-to-end: admin signup with email_confirm:true now succeeds
-- (HTTP 200), creates profile + user_role, auto-approves customer per
-- the email-verified branch.

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

CREATE OR REPLACE FUNCTION public.sync_email_verified()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF (OLD.email_confirmed_at IS NULL) IS DISTINCT FROM (NEW.email_confirmed_at IS NULL) THEN
    UPDATE public.profiles
       SET email_verified = (NEW.email_confirmed_at IS NOT NULL),
           approval_status = CASE
             WHEN NEW.email_confirmed_at IS NOT NULL
              AND public.has_role(NEW.id, 'customer'::app_role)
              AND approval_status = 'pending'
             THEN 'approved'
             ELSE approval_status
           END
     WHERE user_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.sync_email_verified_on_insert()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.email_confirmed_at IS NOT NULL THEN
    UPDATE public.profiles
       SET email_verified = true,
           approval_status = CASE
             WHEN public.has_role(NEW.id, 'customer'::app_role)
              AND approval_status = 'pending'
             THEN 'approved'
             ELSE approval_status
           END
     WHERE user_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$function$;
