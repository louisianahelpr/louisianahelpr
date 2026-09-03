-- profiles.apple_original_transaction_id: stop being self-writable.
--
-- WHAT IT IS: the Apple In-App Purchase receipt anchor. The unmerged
-- `feat/apple-iap` branch's `verify-apple-iap` function keys `subscription_tier`
-- off it — i.e. it is the evidence that a subscription was paid for.
--
-- WHAT WAS WRONG (read from prod 2026-09-03, information_schema.column_privileges):
--
--     anon           INSERT, REFERENCES, SELECT
--     authenticated  INSERT, REFERENCES, SELECT, UPDATE   <-- both writes
--
-- So any signed-in user could write their own receipt anchor. It is INERT
-- TODAY — nothing in `src/` or in any deployed edge function writes or reads
-- it, and the branch that would is unmerged — which is exactly why this is
-- worth doing now: the fix costs nothing while the column is dead, and becomes
-- a forged-subscription path the moment that branch lands. Found during
-- verification, by no lane's sweep.
--
-- Same shape as the fix one migration earlier: `profiles` has NO table-level
-- UPDATE (revoked long ago, then re-granted per column — 91 of them), so unlike
-- `helper_credentials` a column-level REVOKE here is sufficient rather than a
-- silent no-op. Verified that difference before writing this.

REVOKE INSERT (apple_original_transaction_id), UPDATE (apple_original_transaction_id)
  ON public.profiles FROM authenticated;

REVOKE INSERT (apple_original_transaction_id)
  ON public.profiles FROM anon;

COMMENT ON COLUMN public.profiles.apple_original_transaction_id IS
  'Apple IAP receipt anchor. SERVER-OWNED: written only by the verify-apple-iap '
  'edge function as service_role. Client write grants revoked 2026-09-03 and the '
  'column is pinned by prevent_self_escalation(); a member who could write this '
  'could forge the evidence of their own subscription.';

-- BELT AND BRACES, matching what this repo already does for the Stripe linkage
-- columns four lines below the addition. The grant wall above makes PostgREST
-- reject the write with 42501 before the trigger is reached, so this branch
-- should be unreachable — which is the reason to keep it. If it ever fires, the
-- privilege wall has a hole and that is the thing worth being told about.
--
-- Reproduced from the LIVE definition (pg_get_functiondef, read after
-- 20260903012612 landed) with exactly one line added. The pinned-column set was
-- diffed before and after: 51 pins in, 52 out, zero dropped. Dropping one
-- silently is an escalation hole, and a 50-line function replaced by hand is
-- precisely where that happens.
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
  IF auth.uid() IS NULL OR has_role(auth.uid(), 'admin') THEN
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
