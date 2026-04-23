-- 1. Remove profiles from Realtime publication (stops broadcast of sensitive PII)
ALTER PUBLICATION supabase_realtime DROP TABLE public.profiles;

-- 2. Make open_jobs_browse view run with caller's permissions instead of definer's
ALTER VIEW public.open_jobs_browse SET (security_invoker = on);

-- 3. Extend prevent_self_escalation trigger to lock internal fields
CREATE OR REPLACE FUNCTION public.prevent_self_escalation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  -- Allow service role (auth.uid() is null) and admin users to change anything
  IF auth.uid() IS NULL OR has_role(auth.uid(), 'admin') THEN
    RETURN NEW;
  END IF;

  -- Privilege / status fields (existing)
  NEW.approval_status := OLD.approval_status;
  NEW.ban_status := OLD.ban_status;
  NEW.role := OLD.role;
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

  -- Identity verification — only the backend may write these
  NEW.idv_status := OLD.idv_status;
  NEW.idv_session_id := OLD.idv_session_id;
  NEW.idv_attempted_at := OLD.idv_attempted_at;
  NEW.idv_confidence := OLD.idv_confidence;
  NEW.idv_failure_reason := OLD.idv_failure_reason;
  NEW.legacy_manual_review := OLD.legacy_manual_review;

  -- Onboarding fee + verification flags
  NEW.onboarding_fee_paid := OLD.onboarding_fee_paid;
  NEW.onboarding_fee_charged_at := OLD.onboarding_fee_charged_at;
  NEW.email_verified := OLD.email_verified;
  NEW.verification_email_count := OLD.verification_email_count;
  NEW.last_verification_email_at := OLD.last_verification_email_at;

  -- Counters managed by triggers
  NEW.application_count := OLD.application_count;
  NEW.auto_suspended_until := OLD.auto_suspended_until;

  RETURN NEW;
END;
$function$;