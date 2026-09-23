-- Q304: authenticated loses column UPDATE on profiles.ban_status and
-- profiles.auto_suspended_until.
--
-- WHY
-- Measured live 2026-09-23 (pg_attribute.attacl): both columns carried
-- `authenticated=w/postgres`. prevent_self_escalation pins both for every
-- non-admin, non-server write, so a member could not change them; the grant
-- was the missing second line. The five admin UI writers that needed it
-- (BanDialog x3, AutoRestrictedRail, useAdminUserActions.unbanUser) now go
-- through the admin-user-actions edge function's `set_ban_status` action,
-- which checks has_role(admin) and writes as service_role.
--
-- WHY NOT A BARE REVOKE
-- sync_profiles_update_grants() (cron `sync-profiles-update-grants`, every 10
-- minutes) re-derives authenticated's column grants as the complement of
-- profiles_locked_update_columns() and would silently re-grant a hand-revoked
-- column within ten minutes. So the two columns join that list, and the
-- REVOKE below is the belt beside it.
--
-- REPLAY-SAFE: the locked-columns function is replaced wholesale from its LIVE
-- body (pg_get_functiondef, 2026-09-23) with two entries added; REVOKE is
-- idempotent; the re-sync no-ops when grants already match, and is guarded on
-- the function existing. Same shape as 20260915043201's lock.

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
    'auto_suspended_until'
  ]::text[];
$function$;

REVOKE ALL ON FUNCTION public.profiles_locked_update_columns() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.profiles_locked_update_columns() TO service_role;

REVOKE UPDATE (ban_status, auto_suspended_until) ON public.profiles FROM PUBLIC, anon, authenticated;

DO $q304$
BEGIN
  IF to_regprocedure('public.sync_profiles_update_grants()') IS NOT NULL THEN
    PERFORM public.sync_profiles_update_grants();
  END IF;
END
$q304$;
