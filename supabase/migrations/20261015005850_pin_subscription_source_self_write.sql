-- profiles.subscription_source could be written by its own member.
--
-- WHAT WAS BROKEN. `authenticated` holds a column-level UPDATE grant on
-- profiles.subscription_source (measured on prod 2026-10-15 in
-- information_schema.column_privileges), and the BEFORE UPDATE trigger
-- tr_prevent_self_escalation (public.prevent_self_escalation) pinned every
-- other billing column (tier, expiry, Stripe ids, cycle, cancel flag, the
-- Apple receipt anchor) but not this one. subscription-reconciliation
-- (supabase/functions/subscription-reconciliation/index.ts) skips every row
-- whose subscription_source is 'apple', because Apple's own notifications
-- grade those. So a Stripe member could PATCH their own row to 'apple' and
-- drop out of the daily Stripe reconciliation: a lapsed or refunded Stripe
-- subscription would keep its paid tier for as long as the webhook path
-- missed it, unchecked.
--
-- THE FIX. prevent_self_escalation now pins subscription_source like the
-- rest (NEW := OLD for a non-server, non-admin caller), and a changed value
-- counts as a billing attempt for the rls-escalation-refused log. Server
-- writers (stripe-webhook, verify-apple-iap, apple-app-store-notifications)
-- run as service_role and pass is_server_context(), so they are untouched.
-- No client writes the column (grep of src/: SubscriptionTab only reads it).
--
-- WHY THE GRANT IS NOT REVOKED. iOS 1.0.4 (7119) is in App Review under the
-- REVIEW FREEZE (release/app-review-freeze.json): no privilege a shipped
-- client holds is narrowed until Apple decides. A silent pin keeps every
-- PATCH that 7119 sends succeeding (it never sends this column anyway).
--
-- MEASURED BEFORE (prod, 2026-10-15): 94 profiles, every one with
-- subscription_source NULL and subscription_tier NULL, so no row needs
-- repair.
--
-- REPLAY-SAFETY: CREATE OR REPLACE of a function body only; the trigger
-- that runs it (tr_prevent_self_escalation) already exists, and the column
-- it reads was added by 20260905204037, earlier than this file. The body is
-- 20260923172405's definition (identical to prod's pg_get_functiondef on
-- 2026-10-15) plus the two subscription_source lines.

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
    OR NEW.apple_original_transaction_id     IS DISTINCT FROM OLD.apple_original_transaction_id
    OR NEW.subscription_source               IS DISTINCT FROM OLD.subscription_source;
  v_attempted_tier := NEW.subscription_tier;

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

  -- ADDED 20261015005850. Which billing system is the authority for the tier.
  -- subscription-reconciliation skips every 'apple' row (Apple is graded by
  -- apple-app-store-notifications, not by Stripe), so a member who wrote
  -- 'apple' on their own row took their Stripe tier out of reconciliation.
  -- Pinned silently like every column above: the column-level UPDATE grant
  -- stays (the 1.0.4 / 7119 build is in App Review and the review freeze
  -- forbids narrowing a grant a shipped client holds), the value just does
  -- not move for a non-server, non-admin caller.
  NEW.subscription_source := OLD.subscription_source;

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
REVOKE ALL ON FUNCTION public.prevent_self_escalation() FROM PUBLIC, anon;

