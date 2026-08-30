-- Fix: get_helper_earnings_export() raised "function is_category_taxable(text)
-- does not exist" (42883) for every helper who actually had a completed +
-- released job in the requested range — i.e. the Earnings Export "Download
-- CSV"/"Download PDF" buttons failed for anyone with real data to export.
--
-- Root cause: is_category_taxable(_category public.job_category) only has an
-- enum overload (see 20260418080453_ce2b12ea-...sql). The originating
-- migration for this RPC (20260418081253_3e1d793f-...sql) called it with
-- j.category::text — an explicit cast to text with no matching overload and
-- no implicit text->enum cast, so Postgres can't resolve the call. Because
-- CASE WHEN is only evaluated per returned row, the bug was invisible when a
-- helper had zero matching rows (silently "worked"), and only surfaced once
-- a row needed classifying — which is every real export.
--
-- Fix: pass the native enum column instead of casting it away.
--
-- Guarded with to_regprocedure so this migration is a harmless no-op if it
-- ever replays before the function exists.

DO $$
BEGIN
  IF to_regprocedure('public.get_helper_earnings_export(uuid, date, date)') IS NOT NULL THEN
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
      IF auth.uid() <> _helper_id AND NOT has_role(auth.uid(), 'admin'::app_role) THEN
        RAISE EXCEPTION 'Not authorized';
      END IF;

      RETURN QUERY
      SELECT
        j.id AS job_id,
        COALESCE(j.poster_completed_at::date, j.helper_completed_at::date, j.updated_at::date) AS date_completed,
        j.title AS job_title,
        j.category::text AS category,
        COALESCE(j.parish, 'Unknown') AS parish,
        CASE WHEN public.is_category_taxable(j.category) THEN 'Taxable' ELSE 'Exempt' END AS tax_status,
        j.budget AS gross_budget,
        ROUND(j.budget * COALESCE(j.helper_fee_percent, 10) / 100.0, 2) AS platform_fee,
        COALESCE(j.sales_tax_amount, 0) AS parish_tax_collected,
        ROUND(j.budget - (j.budget * COALESCE(j.helper_fee_percent, 10) / 100.0), 2) AS net_payout
      FROM public.jobs j
      WHERE j.helper_id = _helper_id
        AND j.status = 'completed'
        AND j.payment_status = 'released'
        AND COALESCE(j.poster_completed_at::date, j.helper_completed_at::date, j.updated_at::date) BETWEEN _start_date AND _end_date
      ORDER BY date_completed DESC;
    END;
    $fn$;
  END IF;
END $$;
