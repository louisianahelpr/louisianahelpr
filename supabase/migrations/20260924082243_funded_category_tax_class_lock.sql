-- ME-010: category is the sole input to Louisiana labor sales tax
-- (supabase/functions/_shared/salesTax.ts TAXABLE_CATEGORIES = assembly,
-- handyman). Tax is computed and charged at checkout, but a poster could still
-- edit the category of a funded, unassigned job: 'cleaning' (no tax charged)
-- to 'assembly' leaves taxable labor with no tax collected, and the reverse
-- leaves tax charged on exempt work with no refund path. Neither
-- enforce_poster_jobs_money_lock nor anything else covered category.
--
-- Narrow on purpose: only a move ACROSS the taxable boundary is refused, and
-- only once checkout has opened (the money lock's own funded predicate).
-- Moves within one tax class stay editable. The list mirrors salesTax.ts;
-- src/components/activity/EditJobDialog.taxClass.test.tsx fails if they drift.
CREATE OR REPLACE FUNCTION public.enforce_funded_category_tax_class()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE
  taxable CONSTANT text[] := ARRAY['assembly', 'handyman'];
BEGIN
  IF public.is_server_context()
     OR auth.uid() IS DISTINCT FROM OLD.customer_id THEN
    RETURN NEW;
  END IF;
  IF NEW.category IS NOT DISTINCT FROM OLD.category THEN
    RETURN NEW;
  END IF;
  IF (OLD.payment_status IS DISTINCT FROM 'unpaid' OR OLD.stripe_session_id IS NOT NULL)
     AND (COALESCE(OLD.category, '') = ANY (taxable)) IS DISTINCT FROM (COALESCE(NEW.category, '') = ANY (taxable)) THEN
    RAISE EXCEPTION 'A paid job cannot switch between taxed and untaxed categories'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_funded_category_tax_class() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_funded_category_tax_class ON public.jobs;
CREATE TRIGGER trg_funded_category_tax_class
  BEFORE UPDATE OF category ON public.jobs
  FOR EACH ROW EXECUTE FUNCTION public.enforce_funded_category_tax_class();
