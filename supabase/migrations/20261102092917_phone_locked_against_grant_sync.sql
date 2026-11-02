-- Q1805 follow-up: the direct profiles.phone write comes back unless phone is a LOCKED column.
--
-- 20261102082018 moved the phone save to save_my_phone (rate-limited, counts the
-- "already on another account" answer) and REVOKEd UPDATE (phone) from
-- authenticated. Measured on prod right after its db-deploy (2026-11-02, read
-- only): the migration was applied, INSERT was gone, but authenticated held
-- UPDATE (phone) again (pg_attribute.attacl {authenticated=w/postgres}). Cause:
-- sync_profiles_update_grants() (20260901011254), run by the
-- sync-profiles-update-grants cron, re-derives authenticated's column UPDATE
-- grants as the complement of profiles_locked_update_columns(), and phone was
-- not in that list. So a member could still write their phone directly and
-- probe the duplicate-number refusal with no limit, the hole Q1586(a) closes.
--
-- Fix: restate profiles_locked_update_columns() from its newest definition
-- (20261019010447) with 'phone' added, and run the sync, which revokes
-- UPDATE on profiles and grants back every column except the locked ones.
-- save_my_phone is SECURITY DEFINER (runs as the owner), so it is unaffected;
-- service_role keeps its own grants (the sync never touches them). The locked
-- list only drives grants (no trigger reads it; measured by grep 2026-11-02).
--
-- Replay-safe: CREATE OR REPLACE; the sync is idempotent and guarded by
-- to_regprocedure.

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
    -- ADDED 20261019010447 (Q2092). What an email
    -- unsubscribe link turned off; its resubscribe restores exactly this, so a
    -- member who could write it could restore consent through the link that
    -- they never gave. Written only by the email-unsubscribe function.
    'promotions_before_unsubscribe',
    -- ADDED 20261102092917 (Q1805, Q1586(a)). A member's phone is written only
    -- by save_my_phone (SECURITY DEFINER, rate-limited, 20261102082018). That
    -- migration revoked UPDATE (phone) from authenticated, but the
    -- sync-profiles-update-grants cron re-grants every column NOT in this list,
    -- so it put the grant straight back (measured live 2026-11-02 after
    -- db-deploy: attacl {authenticated=w/postgres}).
    'phone'
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
