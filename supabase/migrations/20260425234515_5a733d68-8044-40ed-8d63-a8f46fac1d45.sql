-- Add professional credentials fields to profiles
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS is_licensed boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_insured boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS license_url text,
  ADD COLUMN IF NOT EXISTS insurance_url text,
  ADD COLUMN IF NOT EXISTS license_status text NOT NULL DEFAULT 'none' CHECK (license_status IN ('none','pending','verified','rejected')),
  ADD COLUMN IF NOT EXISTS insurance_status text NOT NULL DEFAULT 'none' CHECK (insurance_status IN ('none','pending','verified','rejected')),
  ADD COLUMN IF NOT EXISTS license_reviewed_at timestamptz,
  ADD COLUMN IF NOT EXISTS insurance_reviewed_at timestamptz,
  ADD COLUMN IF NOT EXISTS license_reviewed_by uuid,
  ADD COLUMN IF NOT EXISTS insurance_reviewed_by uuid,
  ADD COLUMN IF NOT EXISTS license_rejection_reason text,
  ADD COLUMN IF NOT EXISTS insurance_rejection_reason text;

-- Update prevent_self_escalation to lock down credential verification fields
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

  -- Credential verification status fields — only admin/backend may write
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

-- Trigger: when a user uploads a license/insurance doc, auto-set status to pending
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

DROP TRIGGER IF EXISTS trg_auto_pending_credentials ON public.profiles;
CREATE TRIGGER trg_auto_pending_credentials
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  WHEN (OLD.license_url IS DISTINCT FROM NEW.license_url OR OLD.insurance_url IS DISTINCT FROM NEW.insurance_url)
  EXECUTE FUNCTION public.auto_pending_credentials();

-- Admin-callable RPC to approve/reject credentials
CREATE OR REPLACE FUNCTION public.review_credential(
  _user_id uuid,
  _credential text,         -- 'license' or 'insurance'
  _decision text,           -- 'verified' or 'rejected'
  _reason text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Only admins may review credentials';
  END IF;
  IF _credential NOT IN ('license','insurance') THEN
    RAISE EXCEPTION 'Invalid credential type';
  END IF;
  IF _decision NOT IN ('verified','rejected') THEN
    RAISE EXCEPTION 'Invalid decision';
  END IF;

  IF _credential = 'license' THEN
    UPDATE public.profiles
       SET license_status = _decision,
           license_reviewed_at = now(),
           license_reviewed_by = auth.uid(),
           license_rejection_reason = CASE WHEN _decision = 'rejected' THEN _reason ELSE NULL END
     WHERE user_id = _user_id;

    INSERT INTO public.notifications (user_id, title, message, type, link)
    VALUES (
      _user_id,
      CASE WHEN _decision = 'verified' THEN '✅ License verified' ELSE '❌ License needs attention' END,
      CASE WHEN _decision = 'verified'
        THEN 'Your professional license has been verified. The Licensed badge is now live on your profile.'
        ELSE 'Your license could not be verified' || COALESCE(': ' || _reason, '.') || ' Please re-upload a clearer document.'
      END,
      CASE WHEN _decision = 'verified' THEN 'success' ELSE 'warning' END,
      '/profile'
    );
  ELSE
    UPDATE public.profiles
       SET insurance_status = _decision,
           insurance_reviewed_at = now(),
           insurance_reviewed_by = auth.uid(),
           insurance_rejection_reason = CASE WHEN _decision = 'rejected' THEN _reason ELSE NULL END
     WHERE user_id = _user_id;

    INSERT INTO public.notifications (user_id, title, message, type, link)
    VALUES (
      _user_id,
      CASE WHEN _decision = 'verified' THEN '✅ Insurance verified' ELSE '❌ Insurance needs attention' END,
      CASE WHEN _decision = 'verified'
        THEN 'Your Certificate of Insurance has been verified. The Insured badge is now live on your profile.'
        ELSE 'Your insurance document could not be verified' || COALESCE(': ' || _reason, '.') || ' Please re-upload a clearer document.'
      END,
      CASE WHEN _decision = 'verified' THEN 'success' ELSE 'warning' END,
      '/profile'
    );
  END IF;

  INSERT INTO public.admin_audit_log (admin_id, action, target_id, target_type, details)
  VALUES (
    auth.uid(),
    'credential_' || _decision,
    _user_id::text,
    'profile',
    jsonb_build_object('credential', _credential, 'reason', _reason)
  );
END;
$$;

-- Admin-only view of pending credentials
CREATE OR REPLACE FUNCTION public.get_pending_credentials()
RETURNS TABLE (
  user_id uuid,
  full_name text,
  email text,
  avatar_url text,
  license_url text,
  insurance_url text,
  license_status text,
  insurance_status text,
  is_licensed boolean,
  is_insured boolean,
  submitted_at timestamptz
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT
    p.user_id,
    p.full_name,
    p.email,
    p.avatar_url,
    p.license_url,
    p.insurance_url,
    p.license_status,
    p.insurance_status,
    p.is_licensed,
    p.is_insured,
    p.updated_at AS submitted_at
  FROM public.profiles p
  WHERE has_role(auth.uid(), 'admin')
    AND (p.license_status = 'pending' OR p.insurance_status = 'pending')
  ORDER BY p.updated_at ASC;
$$;