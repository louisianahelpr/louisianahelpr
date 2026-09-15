-- Renaming a verified business sends its license/insurance back to review
-- (owner decision, 2026-09-15 pop-up: "Restore the rule").
--
-- WHAT WAS BROKEN. 20260827180000 added the rule: an admin approved a document
-- issued to THAT business name, so renaming a live badge re-enters review, the
-- same way swapping the document does. The trigger's WHEN clause from that
-- migration is live (it fires on business_name changes), but the FUNCTION it
-- runs is 20260826040000's older body — applied after 20260827180000 and
-- replacing it (found 2026-09-15 by scripts/audit/function-body-drift.mjs;
-- live md5 482f4e…). So on prod a Helpr with a verified license can rename
-- their business to anything and keep the verified badge, and
-- get_safe_profiles publishes the new, never-reviewed name beside it. 0
-- profiles are in that state today.
--
-- WHY THE PROFILE COLUMNS. license_status / insurance_status on profiles are
-- still the gate: review_credential() writes them, get_safe_profiles and
-- get_user_credential_tier() read them, prevent_self_escalation pins them
-- (20260903012612, 20260903203751, 20260907195145).
--
-- This restates 20260827180000's body with ONE change: the rename block also
-- requires NEW.*_status to still be 'verified'. 20260827180000 checked OLD only,
-- so a single UPDATE that clears the document (the block above sets 'none') and
-- renames — the shape purge_user_data's anonymisation writes — ended 'pending'
-- with no document, and an anonymised profile could land in the admin credential
-- queue (authz review 2026-09-15, reproduced live in a rolled-back transaction).
-- For a user's own edit nothing differs: prevent_self_escalation runs first and
-- pins NEW to OLD. The trigger is unchanged.
-- Proof: scripts/probes/business-rename-rereview.probe.mjs.
--
-- REPLAY-SAFETY: CREATE OR REPLACE; ACL untouched (no REVOKE/GRANT needed —
-- trigger function, grants unchanged by OR REPLACE).

CREATE OR REPLACE FUNCTION public.auto_pending_credentials()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  is_admin_writer boolean := (auth.uid() IS NOT NULL AND has_role(auth.uid(), 'admin'));
BEGIN
  -- License document changed (and user is not admin doing the change)
  IF NEW.license_url IS DISTINCT FROM OLD.license_url THEN
    IF NEW.license_url IS NOT NULL AND NEW.license_url <> '' THEN
      NEW.is_licensed := true;
      IF NOT is_admin_writer THEN
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
      IF NOT is_admin_writer THEN
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

  -- The business name is part of the verified claim: the admin approved a
  -- document issued to THAT name. Renaming a live badge therefore re-enters
  -- review, the same way swapping the document does. Only 'verified' is
  -- affected — editing the name while 'none'/'pending'/'rejected' costs
  -- nothing, so there is nothing to protect and no reason to nag.
  IF NEW.business_name IS DISTINCT FROM OLD.business_name AND NOT is_admin_writer THEN
    IF OLD.license_status = 'verified' AND NEW.license_status = 'verified' THEN
      NEW.license_status := 'pending';
      NEW.license_reviewed_at := NULL;
      NEW.license_reviewed_by := NULL;
      NEW.license_rejection_reason := NULL;
    END IF;
    IF OLD.insurance_status = 'verified' AND NEW.insurance_status = 'verified' THEN
      NEW.insurance_status := 'pending';
      NEW.insurance_reviewed_at := NULL;
      NEW.insurance_reviewed_by := NULL;
      NEW.insurance_rejection_reason := NULL;
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;
