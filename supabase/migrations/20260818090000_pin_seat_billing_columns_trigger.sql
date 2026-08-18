-- SEC-001 (second attempt) — the first fix deployed green and changed nothing.
--
-- 20260818070000 tried to close the hole with
--   REVOKE UPDATE (seat_tier, ...) ON public.businesses FROM authenticated, anon;
-- That statement is valid SQL, it ran, and `supabase db push` reported success.
-- It is also a NO-OP, because in PostgreSQL column-level privileges cannot
-- subtract from a table-level grant: `authenticated` holds table-wide UPDATE on
-- this table (pg_class.relacl = "authenticated=arwdDxtm/postgres" — the `w`),
-- and a column REVOKE only removes entries from pg_attribute.attacl, which for
-- `seat_tier` was NULL to begin with. Measured on prod AFTER that migration
-- deployed:
--
--   has_column_privilege('authenticated','public.businesses','seat_tier','UPDATE') -> TRUE
--   has_table_privilege ('authenticated','public.businesses','UPDATE')             -> TRUE
--   pg_attribute.attacl for seat_tier                                              -> NULL
--
-- So the exploit it was written to stop was still live: a free-tier owner could
-- PATCH /rest/v1/businesses?id=eq.<their id> {"seat_tier":"enterprise"} with
-- only their own JWT, then invite three teammates and KEEP them, because the
-- seat cap is enforced on INSERT only. 20260817120000 is what made that column
-- load-bearing, so this is that change's hole to close.
--
-- WHY A TRIGGER AND NOT REVOKE + RE-GRANT. The privilege-level fix is
-- `REVOKE UPDATE ON public.businesses FROM authenticated` followed by
-- `GRANT UPDATE (<every column an owner may legitimately edit>)`. That requires
-- enumerating the owner-editable column set exactly; miss one and the business
-- settings page starts failing at runtime with a permission error. This table
-- already has the safer pattern in place for precisely this problem:
-- `enforce_business_verification_safety` (20260425235407) is a BEFORE UPDATE
-- trigger that pins `verification_status` and the reviewer columns back to OLD
-- for non-admins. This mirrors it for the seat-billing group, so no column
-- enumeration is needed and no unrelated write can break.
--
-- WHO MAY STILL WRITE THESE COLUMNS. Only the Stripe reconciler,
-- supabase/functions/check-business-seat-subscription, which builds its client
-- with SUPABASE_SERVICE_ROLE_KEY. Verified before writing this: no code under
-- src/ writes seat_tier or seat_subscription_* (they are read-only there via
-- useMyBusiness / useBusinessSeatTier), and the only other writer of
-- seat_subscription_status is the stripe-webhook edge function, also service
-- role. A request with no PostgREST JWT at all (a migration, psql, a direct
-- service connection) is likewise left alone so this file and any future
-- backfill keep working.
--
-- Replay-safe: `businesses` ships in 20260425233224 and the seat_tier /
-- seat_subscription_* columns in 20260426042619, both strictly earlier. The
-- trigger drop is IF EXISTS and the function is CREATE OR REPLACE.

CREATE OR REPLACE FUNCTION public.enforce_business_seat_billing_immutable()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_claims text := nullif(current_setting('request.jwt.claims', true), '');
  v_role   text;
BEGIN
  -- No PostgREST JWT: migration / psql / direct service connection. Trusted.
  IF v_claims IS NULL THEN
    RETURN NEW;
  END IF;

  BEGIN
    v_role := v_claims::jsonb ->> 'role';
  EXCEPTION WHEN others THEN
    v_role := NULL;  -- unparseable claims are treated as untrusted
  END;

  IF v_role = 'service_role' THEN
    RETURN NEW;
  END IF;

  -- Everyone else (including the business owner, and including an admin using
  -- the normal client) gets these columns pinned to their existing values.
  -- Billing state is Stripe's record of what was paid for; it is not settings.
  NEW.seat_tier                             := OLD.seat_tier;
  NEW.seat_subscription_id                  := OLD.seat_subscription_id;
  NEW.seat_subscription_status              := OLD.seat_subscription_status;
  NEW.seat_subscription_current_period_end  := OLD.seat_subscription_current_period_end;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_business_seat_billing_immutable ON public.businesses;
CREATE TRIGGER trg_enforce_business_seat_billing_immutable
BEFORE UPDATE ON public.businesses
FOR EACH ROW EXECUTE FUNCTION public.enforce_business_seat_billing_immutable();

-- Trigger functions fire via the row-change mechanism and need no EXECUTE
-- grant; revoking only removes the /rest/v1/rpc callable surface. Matches the
-- posture set by 20260505190000.
REVOKE ALL ON FUNCTION public.enforce_business_seat_billing_immutable() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.enforce_business_seat_billing_immutable() FROM anon;
REVOKE ALL ON FUNCTION public.enforce_business_seat_billing_immutable() FROM authenticated;
