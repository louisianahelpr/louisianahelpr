-- Q1831 + Q1833 (owner decision 2026-10-17): the twelve trade categories are
-- TAXED LIKE HANDYMAN. The taxable list is now assembly, handyman and the
-- twelve trades, in all three layers at once:
--   1. supabase/functions/_shared/salesTax.ts TAXABLE_CATEGORIES (what Stripe
--      charges) and its client mirror src/lib/salesTax.ts (what checkout quotes);
--   2. enforce_funded_category_tax_class (a paid job cannot cross the line);
--   3. is_category_taxable (the "Taxable"/"Exempt" column of the Helpr earnings
--      export). Until now it said Taxable for cleaning, yard_work, moving,
--      painting and delivery, which were never taxed (Q1833), and Exempt for
--      the trades.
-- src/lib/salesTax.parity.test.ts reads the NEWEST definition of both
-- functions and fails if either list differs from TAXABLE_CATEGORIES.
-- Prod held 0 jobs in any trade category when this was written (2026-10-17).
--
-- ALSO FIXED (found by this migration's PGlite proof, 2026-10-17): the trigger
-- wrote COALESCE(OLD.category, '') on a job_category ENUM column, so the ''
-- literal was cast to the enum and every poster edit that changed a job's
-- category, paid or not, raised 22P02 "invalid input value for enum
-- job_category" (the plpgsql IF is prepared whole; prod raises the same error
-- for `select coalesce('cleaning'::public.job_category, '')`). EditJobDialog
-- saves with a direct jobs update as the poster, so the trigger always ran.
-- Comparing as ::text fixes it; src/lib/salesTax.parity.test.ts refuses the
-- pattern in any newest function definition.
--
-- Bodies copied from main's newest definitions (20260924082243 and
-- 20260418080453, both identical to pg_get_functiondef on prod 2026-10-17),
-- with the list changed and the ::text fix above. Replay-safe: CREATE OR REPLACE, grants restated.

CREATE OR REPLACE FUNCTION public.enforce_funded_category_tax_class()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE
  taxable CONSTANT text[] := ARRAY['assembly', 'handyman', 'electrical', 'plumbing', 'hvac', 'roofing', 'welding', 'carpentry', 'auto_repair', 'appliance_repair', 'flooring', 'concrete_masonry', 'fencing', 'pressure_washing'];
BEGIN
  IF public.is_server_context()
     OR auth.uid() IS DISTINCT FROM OLD.customer_id THEN
    RETURN NEW;
  END IF;
  IF NEW.category IS NOT DISTINCT FROM OLD.category THEN
    RETURN NEW;
  END IF;
  IF (OLD.payment_status IS DISTINCT FROM 'unpaid' OR OLD.stripe_session_id IS NOT NULL)
     AND (COALESCE(OLD.category::text, '') = ANY (taxable)) IS DISTINCT FROM (COALESCE(NEW.category::text, '') = ANY (taxable)) THEN
    RAISE EXCEPTION 'A paid job cannot switch between taxed and untaxed categories'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_funded_category_tax_class() FROM PUBLIC, anon, authenticated;

-- Compared as text so the body never depends on an enum value existing when
-- the function is created (a replay in an older schema stays valid).
CREATE OR REPLACE FUNCTION public.is_category_taxable(_category public.job_category)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT COALESCE(_category::text = ANY (ARRAY['assembly', 'handyman', 'electrical', 'plumbing', 'hvac', 'roofing', 'welding', 'carpentry', 'auto_repair', 'appliance_repair', 'flooring', 'concrete_masonry', 'fencing', 'pressure_washing']), false);
$$;

COMMENT ON FUNCTION public.is_category_taxable(public.job_category) IS
'True exactly for the categories whose labor line is charged LA sales tax: supabase/functions/_shared/salesTax.ts TAXABLE_CATEGORIES (assembly, handyman and the twelve trades, owner 2026-10-17). Read by get_helper_earnings_export''s tax_status column.';

REVOKE ALL ON FUNCTION public.is_category_taxable(public.job_category) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_category_taxable(public.job_category) TO service_role;
