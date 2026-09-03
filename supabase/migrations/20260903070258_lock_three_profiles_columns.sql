-- Three `profiles` columns that were defended by NOTHING.
--
-- Not by the grant wall (they carry a column-level UPDATE grant), not by
-- `prevent_self_escalation` (its 52 pins do not include them), and not by RLS,
-- which only asks `auth.uid() = user_id` — true, by construction, for the
-- person attacking their own row. The authz lane proved all three live as a
-- non-admin, each written and then restored inside a rolled-back transaction.
--
--   boost_credit_used_month   The Pro plan's free monthly boost is metered by
--                             this column and nothing else:
--                             `create-boost-payment/index.ts:143` stamps it
--                             'YYYY-MM' after granting the free boost, and
--                             :145 refuses a second grant with
--                             `.or(is.null, neq.<thisMonth>)`. A member who can
--                             clear it has UNLIMITED free boosts — the meter and
--                             the thing it meters are the same field, writable
--                             by the person being metered.
--
--   created_at                Rewritten to 2019. "Member since" is a trust
--                             signal on a marketplace where strangers meet: it
--                             is shown to the other party precisely so they can
--                             weigh how long an account has existed. Forging it
--                             is cheap and reads as legitimate.
--
--   email                     Rewritten to any address, diverging from
--                             `auth.users`. Every admin surface reads THIS
--                             copy — AdminExport, AdminSubscriptions,
--                             AutoRestrictedRail all select `profiles.email` —
--                             so the address an admin sees while acting on an
--                             account need not be the address that account can
--                             actually sign in with.
--
-- ─── WHY THIS EDITS ONE FUNCTION AND WRITES NO GRANT STATEMENT ─────────────
--
-- `profiles_locked_update_columns()` is the single source of truth, and
-- `sync_profiles_update_grants()` derives the real grants from it on a cron. A
-- hand-written REVOKE elsewhere is not merely redundant — it is UNDONE, on a
-- schedule, silently. That happened today: the IAP revoke landed, bit
-- correctly, and was handed back by the next cron run, leaving a migration that
-- had applied cleanly and a hole that was open again. The file said so three
-- lines from its top. So the column list is the only thing edited here, and the
-- sync is called at the end so the grants change now rather than at the next
-- cron tick.
--
-- ─── CHECKED BEFORE LOCKING, because a lock that breaks a real write is worse
--
-- Every reference to these columns from `src/` was read. All are SELECTs — the
-- three admin views above, plus `AdminExport`'s `created_at` ordering. There
-- are ZERO client `.update()` calls naming any of the three (matched across
-- every .ts/.tsx in src/, excluding tests). `boost_credit_used_month` is
-- written only by `create-boost-payment`, and `email` only by
-- `admin-update-email`; both are edge functions running as service_role, which
-- is unaffected by a column grant to `authenticated`.
--
-- A METHOD NOTE WORTH KEEPING, from the lane that found this. The column grant
-- wall refuses per STATEMENT, so a probe that names a granted column and an
-- ungranted one in the same UPDATE returns a flat `permission denied` — and the
-- granted hole looks defended. Testing these one column per statement is what
-- surfaced them. A combined probe would have reported the whole table safe.

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
    -- The meter for the Pro free monthly boost. Clearing it re-grants the
    -- boost, so leaving it writable by the metered party is unlimited free
    -- paid-placement.
    'boost_credit_used_month',
    -- "Member since", a trust signal shown to the other side of a deal.
    'created_at',
    -- Every admin surface reads profiles.email rather than auth.users, so a
    -- writable copy lets the address an admin acts on diverge from the one
    -- that can actually sign in.
    'email'
  ]::text[];
$function$;

COMMENT ON FUNCTION public.profiles_locked_update_columns() IS
  'The single source of truth for which profiles columns `authenticated` may not '
  'update. Consumed by sync_profiles_update_grants(), which a cron re-runs — so a '
  'column added here is enforced automatically, and a REVOKE hand-written '
  'anywhere else is silently undone by that cron. Do not hand-write GRANT or '
  'REVOKE statements for this table elsewhere.';

-- Apply now rather than at the next cron tick.
SELECT public.sync_profiles_update_grants();
