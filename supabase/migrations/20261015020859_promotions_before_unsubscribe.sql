-- Q?unsub-resubscribe-consent (owner, 2026-10-15, pop-up: "Only undo what they
-- turned off"). An email's unsubscribe link offers "Resubscribe" as an undo.
-- It used to write profiles.marketing_consent = true and
-- notification_preferences.email_promotions = true whatever they had been, so
-- the holder of a promotions link could opt in an address that never agreed to
-- marketing, or switch on promotions a member had turned off in Settings
-- (measured 2026-10-15: all 24 members with consent on have email_promotions
-- off, 21 of them the untouched default).
--
-- The fix needs to remember what the unsubscribe turned off. This column holds
-- it: {"marketing_consent": bool, "email_promotions": bool}, written by the
-- email-unsubscribe function (service role) on the FIRST unsubscribe through a
-- link, read and cleared by its resubscribe. NULL means nothing to undo, and a
-- resubscribe then writes nothing.
--
-- Who can touch it. profiles has no table-level UPDATE for clients: the
-- `sync-profiles-update-grants` cron (every 10 minutes) grants authenticated
-- column UPDATE on every profiles column NOT in profiles_locked_update_columns()
-- (lh-authz-rls review, 2026-10-15: it would have granted this one within ten
-- minutes). So the column joins the locked list here and the sync runs at once:
-- only the service role writes it. SELECT on profiles is limited by RLS to the
-- member's own row and admins.
--
-- The pre-verification takeover wipe clears it too: a record made while a
-- squatter's ticked consent box stood would otherwise restore that consent for
-- the real owner (same review, note 3b).
--
-- REPLAY-SAFETY: ADD COLUMN IF NOT EXISTS; CREATE OR REPLACE for both functions
-- (each defined by an earlier migration, so present on a fresh replay); the
-- sync is called only when it exists; grants restated by role name.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS promotions_before_unsubscribe jsonb;

COMMENT ON COLUMN public.profiles.promotions_before_unsubscribe IS
  'What an email unsubscribe link turned off ({marketing_consent, email_promotions}); the link''s resubscribe restores exactly this and clears it. Written only by the email-unsubscribe function (service role). Q?unsub-resubscribe-consent.';

CREATE OR REPLACE FUNCTION public.profiles_locked_update_columns()
RETURNS text[]
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $function$
  SELECT ARRAY[
    'subscription_tier',
    'subscription_expires_at',
    'stripe_customer_id',
    'stripe_subscription_id',
    'subscription_billing_cycle',
    'subscription_cancel_at_period_end',
    -- ADDED 20260903030126. The Apple IAP receipt anchor — the Stripe
    -- linkage's twin on the other payment rail. `verify-apple-iap` keys
    -- subscription_tier off it, so a member who could write it could forge the
    -- evidence of their own subscription.
    'apple_original_transaction_id',
    -- ADDED 20260903070258, all three proven writable by a non-admin.
    'boost_credit_used_month',
    'created_at',
    'email',
    -- ADDED 20260903072540. The idempotency guard on account deletion's
    -- PII-stripping step. Writable by the person being deleted, which removes
    -- the "already stripped if deleteUser fails" property that the purge
    -- ordering exists to provide.
    'anonymized_at',
    -- ADDED 20260915043201. The count half of the free monthly boost meter;
    -- resetting it re-grants spent boosts, same as the month beside it.
    'boost_credit_used_count',
    -- ADDED Q304 (20260923212305). The moderation verdict and the instant a
    -- temp ban lifts. Written only by service_role (admin-user-actions
    -- set_ban_status) and SECURITY DEFINER functions (the ladder RPCs,
    -- sweep_expired_auto_bans, enforce_retained_ban).
    'ban_status',
    'auto_suspended_until',
    -- ADDED 20261015020859 (Q?unsub-resubscribe-consent). What an email
    -- unsubscribe link turned off; its resubscribe restores exactly this, so a
    -- member who could write it could restore consent through the link that
    -- they never gave. Written only by the email-unsubscribe function.
    'promotions_before_unsubscribe'
  ]::text[];
$function$;

REVOKE ALL ON FUNCTION public.profiles_locked_update_columns() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.profiles_locked_update_columns() TO service_role;

DO $sync$
BEGIN
  IF to_regprocedure('public.sync_profiles_update_grants()') IS NOT NULL THEN
    PERFORM public.sync_profiles_update_grants();
  END IF;
END
$sync$;

CREATE OR REPLACE FUNCTION public.wipe_pre_verification_account(p_user_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_objects jsonb;
  v_id      uuid;
BEGIN
  IF p_user_id IS NULL THEN
    RETURN NULL;
  END IF;

  -- What is stored under the account's own folder. Nothing could be uploaded
  -- there without a session before the confirm except by complete-signup.
  SELECT coalesce(jsonb_agg(jsonb_build_object('bucket', o.bucket_id, 'name', o.name) ORDER BY o.bucket_id, o.name), '[]'::jsonb)
    INTO v_objects
    FROM storage.objects o
   WHERE o.bucket_id IN ('avatars', 'user-documents')
     AND o.name LIKE p_user_id::text || '/%';

  PERFORM set_config('app.pre_verification_wipe', '1', true);
  UPDATE public.profiles
     SET full_name               = '',
         phone                   = NULL,
         date_of_birth           = NULL,
         avatar_url              = NULL,
         location                = NULL,
         zip_code                = NULL,
         parish                  = NULL,
         parish_source           = NULL,
         bio                     = NULL,
         skills                  = NULL,
         availability            = NULL,
         transportation          = NULL,
         hear_about_us           = NULL,
         experience_level        = NULL,
         tools_equipment         = NULL,
         emergency_contact_name  = NULL,
         emergency_contact_phone = NULL,
         extra_comments          = NULL,
         license_url             = NULL,
         insurance_url           = NULL,
         license_expires_at      = NULL,
         insurance_expires_at    = NULL,
         marketing_consent       = false,
         terms_version_accepted  = '',
         terms_accepted_at       = NULL,
         accepted_terms_at       = NULL,
         promotions_before_unsubscribe = NULL
   WHERE user_id = p_user_id;
  PERFORM set_config('app.pre_verification_wipe', '0', true);

  DELETE FROM public.legal_acceptances WHERE user_id = p_user_id;
  DELETE FROM public.referrals WHERE referred_id = p_user_id;

  INSERT INTO public.pre_verification_wipes (user_id, objects)
  VALUES (p_user_id, v_objects)
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$fn$;

REVOKE ALL ON FUNCTION public.wipe_pre_verification_account(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.wipe_pre_verification_account(uuid) TO service_role;
