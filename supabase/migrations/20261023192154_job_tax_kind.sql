-- Job sales tax follows BOTH rules (owner answer 2026-10-23 to #3555 / Q2083,
-- via the lead: "BOTH"). A job's labor is taxed when EITHER
--   1. its category is one of the 14 taxed today (assembly, handyman and the
--      twelve trades; owner Q374 / Q1831, unchanged), OR
--   2. the poster says, at posting, that the job fixes an item or cleans
--      carpet, rugs, furniture or clothes: the services R.S. 47:301.3 items 5
--      and 7 tax (tax memo ~/.lh-wt/handoffs-1017/tax-research-memo.md Q4).
--
-- The answer is jobs.tax_kind:
--   NULL               neither (or not asked: every job before this, every
--                      job in one of the 14, a quote-booked job);
--   'item_repair'      fixes an item (appliance, furniture, bike, electronics,
--                      small engine, vehicle): Stripe code txcd_20080005;
--   'fabric_cleaning'  cleans carpet, rugs, upholstery, furniture or clothes
--                      (laundry, pressing, alterations): txcd_20010003.
-- The same rule lives in supabase/functions/_shared/salesTax.ts
-- (isJobLaborTaxable / jobLaborTaxCode) and its client mirror; the parity test
-- holds the SQL below to it.
--
-- Layers changed here:
--   - the column, its CHECK, its SELECT grant (jobs has column-level SELECT);
--   - is_job_labor_taxable(category, tax_kind): the rule in SQL;
--   - enforce_funded_category_tax_class: a paid job can no longer cross the
--     taxed/untaxed line by changing its category OR its tax_kind (the trigger
--     now also fires on UPDATE OF tax_kind);
--   - get_helper_earnings_export: its Taxable/Exempt column reads the rule
--     (newest body, 20261019015304, with only that call changed).
-- Replay-safe: ADD COLUMN IF NOT EXISTS, a guarded constraint, CREATE OR
-- REPLACE, DROP/CREATE TRIGGER, grants restated.

ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS tax_kind text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.jobs'::regclass AND conname = 'jobs_tax_kind_valid'
  ) THEN
    ALTER TABLE public.jobs
      ADD CONSTRAINT jobs_tax_kind_valid CHECK (tax_kind IS NULL OR tax_kind IN ('item_repair', 'fabric_cleaning'));
  END IF;
END $$;

COMMENT ON COLUMN public.jobs.tax_kind IS
  'The poster''s answer at posting: item_repair (fixes an item) or fabric_cleaning (cleans carpet, rugs, furniture or clothes); NULL = neither. Taxes the labor line even outside the 14 taxed categories (owner 2026-10-23, #3555). is_job_labor_taxable.';

GRANT SELECT (tax_kind) ON public.jobs TO authenticated;
DO $$
BEGIN
  IF to_regprocedure('public.sync_jobs_select_grants()') IS NOT NULL THEN
    PERFORM public.sync_jobs_select_grants();
  END IF;
END $$;

-- The rule: one of the 14 categories, or a taxed kind. Compared as text so the
-- body never depends on an enum value existing (as is_category_taxable).
CREATE OR REPLACE FUNCTION public.is_job_labor_taxable(_category public.job_category, _tax_kind text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT COALESCE(_category::text = ANY (ARRAY['assembly', 'handyman', 'electrical', 'plumbing', 'hvac', 'roofing', 'welding', 'carpentry', 'auto_repair', 'appliance_repair', 'flooring', 'concrete_masonry', 'fencing', 'pressure_washing']), false)
      OR COALESCE(_tax_kind = ANY (ARRAY['item_repair', 'fabric_cleaning']), false);
$$;

COMMENT ON FUNCTION public.is_job_labor_taxable(public.job_category, text) IS
'True exactly when a job''s labor line is charged LA sales tax: its category is in supabase/functions/_shared/salesTax.ts TAXABLE_CATEGORIES, or its tax_kind is item_repair or fabric_cleaning (owner 2026-10-23, #3555). Read by get_helper_earnings_export; enforce_funded_category_tax_class writes the same rule out.';

REVOKE ALL ON FUNCTION public.is_job_labor_taxable(public.job_category, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_job_labor_taxable(public.job_category, text) TO service_role;

-- A poster's own edit of a paid job may not move it across the taxed/untaxed
-- line, by category or by tax_kind. Server writes pass (as before). The rule is
-- written out here, not called: this trigger runs as the poster, who has no
-- EXECUTE on is_job_labor_taxable (service_role only). The parity test holds
-- both lists to TAXABLE_CATEGORIES / TAXED_KINDS.
CREATE OR REPLACE FUNCTION public.enforce_funded_category_tax_class()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE
  taxable CONSTANT text[] := ARRAY['assembly', 'handyman', 'electrical', 'plumbing', 'hvac', 'roofing', 'welding', 'carpentry', 'auto_repair', 'appliance_repair', 'flooring', 'concrete_masonry', 'fencing', 'pressure_washing'];
  taxed_kinds CONSTANT text[] := ARRAY['item_repair', 'fabric_cleaning'];
BEGIN
  IF public.is_server_context()
     OR auth.uid() IS DISTINCT FROM OLD.customer_id THEN
    RETURN NEW;
  END IF;
  IF NEW.category IS NOT DISTINCT FROM OLD.category
     AND NEW.tax_kind IS NOT DISTINCT FROM OLD.tax_kind THEN
    RETURN NEW;
  END IF;
  IF (OLD.payment_status IS DISTINCT FROM 'unpaid' OR OLD.stripe_session_id IS NOT NULL)
     AND (COALESCE(OLD.category::text, '') = ANY (taxable) OR COALESCE(OLD.tax_kind, '') = ANY (taxed_kinds))
         IS DISTINCT FROM (COALESCE(NEW.category::text, '') = ANY (taxable) OR COALESCE(NEW.tax_kind, '') = ANY (taxed_kinds)) THEN
    RAISE EXCEPTION 'A paid job cannot switch between taxed and untaxed work'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_funded_category_tax_class() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_funded_category_tax_class ON public.jobs;
CREATE TRIGGER trg_funded_category_tax_class
  BEFORE UPDATE OF category, tax_kind ON public.jobs
  FOR EACH ROW EXECUTE FUNCTION public.enforce_funded_category_tax_class();

-- get_helper_earnings_export: the newest body (20261019015304) with its
-- Taxable/Exempt column reading is_job_labor_taxable(category, tax_kind).
CREATE OR REPLACE FUNCTION public.get_helper_earnings_export(
  _helper_id uuid,
  _start_date date,
  _end_date date
)
RETURNS TABLE (
  job_id uuid,
  date_completed date,
  job_title text,
  category text,
  parish text,
  tax_status text,
  gross_budget numeric,
  platform_fee numeric,
  parish_tax_collected numeric,
  net_payout numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  IF auth.uid() IS DISTINCT FROM _helper_id AND NOT COALESCE(has_role(auth.uid(), 'admin'::app_role), false) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  RETURN QUERY
  SELECT x.* FROM (
    SELECT
      j.id AS job_id,
      COALESCE(j.poster_completed_at::date, j.helper_completed_at::date, j.updated_at::date) AS date_completed,
      j.title AS job_title,
      j.category::text AS category,
      COALESCE(j.parish, 'Unknown') AS parish,
      CASE WHEN public.is_job_labor_taxable(j.category, j.tax_kind) THEN 'Taxable' ELSE 'Exempt' END AS tax_status,
      -- Q1840: a row with no ledger on a flat-model job (F3) is priced the
      -- way its payout is: 5% + 70c of budget + urgent bonus (the bonus is
      -- part of the job price, F3b). A legacy row is unchanged.
      CASE WHEN pt.ledger_rows > 0
           THEN ROUND((COALESCE(pt.paid_cents, 0) + COALESCE(pt.fee_cents, 0)) / 100.0, 2)
           WHEN j.helper_fee_flat_cents IS NOT NULL
           THEN ROUND(fl.gross_cents / 100.0, 2)
           ELSE j.budget END AS gross_budget,
      CASE WHEN pt.ledger_rows > 0
           THEN ROUND(COALESCE(pt.fee_cents, 0) / 100.0, 2)
           WHEN j.helper_fee_flat_cents IS NOT NULL
           THEN ROUND(fl.fee_cents / 100.0, 2)
           ELSE ROUND(j.budget * COALESCE(j.helper_fee_percent, 10) / 100.0, 2) END AS platform_fee,
      COALESCE(j.sales_tax_amount, 0) AS parish_tax_collected,
      CASE WHEN pt.ledger_rows > 0
           THEN ROUND(COALESCE(pt.paid_cents, 0) / 100.0, 2)
           WHEN j.helper_fee_flat_cents IS NOT NULL
           THEN ROUND((fl.gross_cents - fl.fee_cents) / 100.0, 2)
           ELSE ROUND(j.budget - (j.budget * COALESCE(j.helper_fee_percent, 10) / 100.0), 2) END AS net_payout
    FROM public.jobs j
    LEFT JOIN LATERAL (
      SELECT
        -- What the Helpr KEPT: a paid row in full; a reversed row less the
        -- part Stripe took back (transferReversed.ts flips the whole row to
        -- 'reversed' even for a partial reversal and records the amount in
        -- metadata.amount_reversed_cents; a won dispute re-pays that part as
        -- its own 'paid' row). No recorded amount reads as fully reversed.
        SUM(CASE WHEN p.status = 'paid' THEN p.amount_cents
                 WHEN p.status = 'reversed' THEN GREATEST(0, p.amount_cents
                      - COALESCE((p.metadata->>'amount_reversed_cents')::bigint, p.amount_cents)) END) AS paid_cents,
        -- The fee on what was kept: a reversed row's fee pro-rated the same way.
        -- Plus what the payout WITHHELD and never sent (Q1520): a first
        -- payout's one-time onboarding fee and the sub-dollar remainder of
        -- rounding the payout down to whole dollars, recorded on the row's
        -- metadata by the payout paths. Counted in full on a reversed row
        -- too (see the header: a re-pay row carries none, so no double count).
        SUM(CASE WHEN p.status = 'paid' THEN COALESCE(p.platform_fee_cents, 0)
                 WHEN p.status = 'reversed' AND p.amount_cents > 0 THEN ROUND(COALESCE(p.platform_fee_cents, 0)::numeric
                      * GREATEST(0, p.amount_cents - COALESCE((p.metadata->>'amount_reversed_cents')::bigint, p.amount_cents))
                      / p.amount_cents) ELSE 0 END
            + CASE WHEN p.status IN ('paid', 'reversed')
                   THEN GREATEST(0, COALESCE((p.metadata->>'onboarding_fee_cents')::bigint, 0))
                        + GREATEST(0, COALESCE((p.metadata->>'rounding_remainder_cents')::bigint, 0))
                        -- Q2082 (b): the Helpr-fault card fee this payout kept back.
                        + GREATEST(0, COALESCE((p.metadata->>'helpr_fault_fee_cents')::bigint, 0))
                   ELSE 0 END) AS fee_cents,
        COUNT(*) AS ledger_rows
      FROM public.payout_transfers p
      WHERE p.job_id = j.id AND p.helper_id = _helper_id
    ) pt ON true
    CROSS JOIN LATERAL (
      SELECT g0.gross_cents,
             public.helpr_flat_fee_cents(g0.gross_cents, j.helper_fee_percent, j.helper_fee_flat_cents) AS fee_cents
        FROM (SELECT round(COALESCE(j.budget, 0) * 100)
                     + GREATEST(0, round(COALESCE(j.urgent_fee, 0) * 100)) AS gross_cents) g0
    ) fl
    WHERE j.helper_id = _helper_id
      -- A crew's members are the half below (a legacy crew lead in helper_id
      -- would otherwise be listed twice off the same ledger rows).
      AND j.is_group_job IS NOT TRUE
      AND j.status = 'completed'
      AND j.payment_status = 'released'
    UNION ALL
    -- A crew member's share: only once the payout ledger shows it PAID to them
    -- (a crew pays member by member; a refunded member has no paid row).
    SELECT
      j.id,
      COALESCE(j.poster_completed_at::date, g.poster_confirmed_completion_at::date,
               g.helper_completed_at::date, j.updated_at::date),
      j.title,
      j.category::text,
      COALESCE(j.parish, 'Unknown'),
      CASE WHEN public.is_job_labor_taxable(j.category, j.tax_kind) THEN 'Taxable' ELSE 'Exempt' END,
      ROUND((pt.paid_cents + pt.fee_cents) / 100.0, 2),
      ROUND(pt.fee_cents / 100.0, 2),
      -- The job's tax, in the same proportion as this member's budget share.
      COALESCE(ROUND(COALESCE(j.sales_tax_amount, 0) * COALESCE(g.share_cents, 0)
            / NULLIF(ROUND(COALESCE(j.budget, 0) * 100), 0), 2), 0),
      ROUND(pt.paid_cents / 100.0, 2)
    FROM public.group_job_helpers g
    JOIN public.jobs j ON j.id = g.job_id AND j.is_group_job IS TRUE AND j.status = 'completed'
    JOIN LATERAL (
      SELECT
        -- What the Helpr KEPT: a paid row in full; a reversed row less the
        -- part Stripe took back (transferReversed.ts flips the whole row to
        -- 'reversed' even for a partial reversal and records the amount in
        -- metadata.amount_reversed_cents; a won dispute re-pays that part as
        -- its own 'paid' row). No recorded amount reads as fully reversed.
        SUM(CASE WHEN p.status = 'paid' THEN p.amount_cents
                 WHEN p.status = 'reversed' THEN GREATEST(0, p.amount_cents
                      - COALESCE((p.metadata->>'amount_reversed_cents')::bigint, p.amount_cents)) END) AS paid_cents,
        -- The fee on what was kept: a reversed row's fee pro-rated the same way.
        -- Plus what the payout WITHHELD and never sent (Q1520): a first
        -- payout's one-time onboarding fee and the sub-dollar remainder of
        -- rounding the payout down to whole dollars, recorded on the row's
        -- metadata by the payout paths. Counted in full on a reversed row
        -- too (see the header: a re-pay row carries none, so no double count).
        SUM(CASE WHEN p.status = 'paid' THEN COALESCE(p.platform_fee_cents, 0)
                 WHEN p.status = 'reversed' AND p.amount_cents > 0 THEN ROUND(COALESCE(p.platform_fee_cents, 0)::numeric
                      * GREATEST(0, p.amount_cents - COALESCE((p.metadata->>'amount_reversed_cents')::bigint, p.amount_cents))
                      / p.amount_cents) ELSE 0 END
            + CASE WHEN p.status IN ('paid', 'reversed')
                   THEN GREATEST(0, COALESCE((p.metadata->>'onboarding_fee_cents')::bigint, 0))
                        + GREATEST(0, COALESCE((p.metadata->>'rounding_remainder_cents')::bigint, 0))
                        -- Q2082 (b): the Helpr-fault card fee this crew payout kept back.
                        + GREATEST(0, COALESCE((p.metadata->>'helpr_fault_fee_cents')::bigint, 0))
                   ELSE 0 END) AS fee_cents,
        COUNT(*) AS ledger_rows
      FROM public.payout_transfers p
      WHERE p.job_id = j.id AND p.helper_id = g.helper_id
    ) pt ON pt.paid_cents > 0
    WHERE g.helper_id = _helper_id
  ) x
  WHERE x.date_completed BETWEEN _start_date AND _end_date
  ORDER BY x.date_completed DESC;
END;
$fn$;


REVOKE ALL ON FUNCTION public.get_helper_earnings_export(uuid, date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_helper_earnings_export(uuid, date, date) TO authenticated, service_role;
