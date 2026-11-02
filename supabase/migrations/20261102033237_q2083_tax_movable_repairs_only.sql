-- Q2083 (owner Option 1, 2026-10-25): Louisiana sales tax on a job's labor only
-- where the published law taxes it: repairs and maintenance of MOVABLE
-- property, La. R.S. 47:301.3(7). By category that is auto_repair (item 7(a)
-- names "the repair and servicing of automobiles, vehicles") and
-- appliance_repair (item 7(b): "tangible personal property includes machinery,
-- appliances, and equipment"). Work on a building and its component parts
-- (Civil Code art. 466) is outside item 7, so handyman on a house and the
-- real-property trades (electrical, plumbing, hvac, roofing, carpentry,
-- flooring, concrete_masonry, fencing, pressure_washing) stop being taxed;
-- assembly (memo: probably not, MEDIUM) and welding (movable or not depends on
-- the job) stop being taxed by category too. The tax memo's Q4 table, which the
-- owner adopted in place of a CPA, is carried in docs/OPEN.md Q2083. Statute
-- text read on legis.la.gov (Law.aspx?d=1392324) 2026-11-01.
--
-- Reverses the "covered either way" list of 20261017055441 (Q1831). Measured
-- read-only on prod 2026-10-25 (Q2083 lane B): every job taxed in a category
-- this drops was is_seed (38 handyman jobs, $99.94); real customers: $0.00.
--
-- Same three layers as 20261017055441, all at once:
--   1. supabase/functions/_shared/salesTax.ts TAXABLE_CATEGORIES (what Stripe
--      charges) and src/lib/salesTax.ts (what checkout quotes);
--   2. enforce_funded_category_tax_class (a paid job cannot cross the line);
--   3. is_category_taxable (the "Taxable"/"Exempt" column of the Helpr export).
-- src/lib/salesTax.parity.test.ts reads the NEWEST definition of both functions.
--
-- Bodies copied from 20261017055441 (their newest definitions) with only the
-- list changed. Replay-safe: CREATE OR REPLACE, grants restated.

CREATE OR REPLACE FUNCTION public.enforce_funded_category_tax_class()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE
  taxable CONSTANT text[] := ARRAY['auto_repair', 'appliance_repair'];
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

CREATE OR REPLACE FUNCTION public.is_category_taxable(_category public.job_category)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT COALESCE(_category::text = ANY (ARRAY['auto_repair', 'appliance_repair']), false);
$$;

COMMENT ON FUNCTION public.is_category_taxable(public.job_category) IS
'True exactly for the categories whose labor line is charged LA sales tax: supabase/functions/_shared/salesTax.ts TAXABLE_CATEGORIES (auto_repair and appliance_repair, repairs of movable property under La. R.S. 47:301.3(7); owner Option 1, docs/OPEN.md Q2083). Read by get_helper_earnings_export''s tax_status column.';

REVOKE ALL ON FUNCTION public.is_category_taxable(public.job_category) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_category_taxable(public.job_category) TO service_role;
