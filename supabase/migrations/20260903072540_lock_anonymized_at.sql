-- `profiles.anonymized_at` is the idempotency guard on account deletion's
-- PII-stripping step — and the person it guards against could write it.
--
-- `purge_user_data` step 4e nulls the whole PII set on `profiles` — avatar,
-- id_document_url, insurance_url, license_url, date_of_birth, location,
-- latitude, longitude, zip_code, bio, business_name, both emergency contacts,
-- portfolio_urls, extra_comments, hear_about_us, tools_equipment, email — and
-- stamps `anonymized_at = now()`, under:
--
--     WHERE user_id = p_user_id AND anonymized_at IS NULL
--
-- Verified against prod: `authenticated` holds a column-level UPDATE grant on
-- `anonymized_at`, RLS on profiles is only `auth.uid() = user_id`, the column
-- is not in `profiles_locked_update_columns()`, and `prevent_self_escalation`
-- does not pin it. So a user could stamp their own `anonymized_at`, and that
-- one UPDATE would then match zero rows.
--
-- ─── WHAT THIS IS AND IS NOT, because the honest severity is LOW ───────────
--
-- It is NOT "deletion silently no-ops". Two measured reasons:
--
--   1. `purge_user_data` does not branch on the row count — confirmed, the
--      function has no `v_profile = 0` test anywhere. It records the count in
--      its returned jsonb and every later step still runs. So a zero match here
--      does not abort the purge and does not refuse the deletion.
--   2. `profiles_user_id_fkey` is ON DELETE CASCADE from `auth.users`, so the
--      whole profile row is deleted moments later by
--      `auth.admin.deleteUser()` anyway. The PII does not survive a SUCCESSFUL
--      deletion whether this step ran or not.
--
-- What it actually costs is the DEFENCE IN DEPTH that step exists for, which
-- `delete-own-account/index.ts` states in as many words: erase first "so that if
-- anything below fails, the account is already stripped of its PII rather than
-- left fully intact behind an error message". Pre-stamping the column removes
-- exactly that property — if `deleteUser` then fails (an FK violation, a Stripe
-- error, a transient), the account is left fully intact, which is the outcome
-- the ordering was designed to prevent.
--
-- And it is self-inflicted: RLS scopes the write to the attacker's OWN row, so
-- nobody can degrade anyone else's deletion. That is why this is a lock and not
-- an incident.
--
-- ─── WHY LOCK IT ANYWAY ────────────────────────────────────────────────────
--
-- A column whose entire job is to record "the server has already done this"
-- should never be writable by the party the server is doing it to. That is the
-- same shape as `boost_credit_used_month` locked one migration earlier — the
-- meter and the thing it meters must not be the same field under the same
-- hand — and it costs nothing here: no client code reads or writes
-- `anonymized_at` (the only references in src/ are the three generated lines in
-- types.ts), and `purge_user_data` is SECURITY DEFINER so it is unaffected by a
-- grant to `authenticated`.
--
-- Added to `profiles_locked_update_columns()`, the single source of truth, NOT
-- as a hand-written REVOKE — the `sync_profiles_update_grants` cron re-derives
-- the grants from that function and silently undoes anything written elsewhere.

CREATE OR REPLACE FUNCTION public.profiles_locked_update_columns()
RETURNS text[]
LANGUAGE sql
IMMUTABLE
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
    'anonymized_at'
  ]::text[];
$function$;

SELECT public.sync_profiles_update_grants();
