-- Q1379 (docs/OPEN.md; finding: lh-money-escrow@d0933e1b3#3): one definition
-- of net in the Helpr earnings export, and a crew row that adds up.
--
-- 20261005171601 left two definitions side by side:
--   * a single job's net was RECOMPUTED as budget less the legacy 10% default
--     fee, whatever the payout actually sent;
--   * a crew member's net was the paid payout_transfers amount (their budget
--     share + urgent-bonus share, less fee, less any onboarding fee, rounded
--     down), while gross was the budget share alone, so gross - fee <> net and
--     the urgent income was missing from gross on a tax export.
--
-- Now every row with a ledger entry reads the ledger for all three money
-- columns: net = what the Helpr kept (paid rows, plus the unreversed part of a
-- reversed row), platform fee = the fee recorded on it, gross = net + fee. So
-- gross - fee = net on every such row, and urgent income (inside the paid
-- amount) is in gross. Only a single job with NO ledger row at all (released
-- before the ledger existed) keeps the old recomputation. Prod had 0 released
-- single jobs and 0 payout_transfers rows (read-only SQL 2026-10-07).
-- lh-money-escrow review of this file: partial reversals, the legacy fallback
-- only without any ledger row, and crews excluded from the single half.
--
-- NOT covered (the ledger does not record it): a first payout's one-time
-- onboarding fee and the sub-dollar remainder of rounding a payout down to
-- whole dollars are withheld but never written to payout_transfers, so gross
-- here is what was paid plus the recorded fee. Filed as its own item.
--
-- Same signature, same grants; CREATE OR REPLACE is replay-safe.

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
  SELECT x.* FROM (
    SELECT
      j.id AS job_id,
      COALESCE(j.poster_completed_at::date, j.helper_completed_at::date, j.updated_at::date) AS date_completed,
      j.title AS job_title,
      j.category::text AS category,
      COALESCE(j.parish, 'Unknown') AS parish,
      CASE WHEN public.is_category_taxable(j.category) THEN 'Taxable' ELSE 'Exempt' END AS tax_status,
      CASE WHEN pt.ledger_rows > 0
           THEN ROUND((COALESCE(pt.paid_cents, 0) + COALESCE(pt.fee_cents, 0)) / 100.0, 2)
           ELSE j.budget END AS gross_budget,
      CASE WHEN pt.ledger_rows > 0
           THEN ROUND(COALESCE(pt.fee_cents, 0) / 100.0, 2)
           ELSE ROUND(j.budget * COALESCE(j.helper_fee_percent, 10) / 100.0, 2) END AS platform_fee,
      COALESCE(j.sales_tax_amount, 0) AS parish_tax_collected,
      CASE WHEN pt.ledger_rows > 0
           THEN ROUND(COALESCE(pt.paid_cents, 0) / 100.0, 2)
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
        SUM(CASE WHEN p.status = 'paid' THEN COALESCE(p.platform_fee_cents, 0)
                 WHEN p.status = 'reversed' AND p.amount_cents > 0 THEN ROUND(COALESCE(p.platform_fee_cents, 0)::numeric
                      * GREATEST(0, p.amount_cents - COALESCE((p.metadata->>'amount_reversed_cents')::bigint, p.amount_cents))
                      / p.amount_cents) END) AS fee_cents,
        COUNT(*) AS ledger_rows
      FROM public.payout_transfers p
      WHERE p.job_id = j.id AND p.helper_id = _helper_id
    ) pt ON true
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
      CASE WHEN public.is_category_taxable(j.category) THEN 'Taxable' ELSE 'Exempt' END,
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
        SUM(CASE WHEN p.status = 'paid' THEN COALESCE(p.platform_fee_cents, 0)
                 WHEN p.status = 'reversed' AND p.amount_cents > 0 THEN ROUND(COALESCE(p.platform_fee_cents, 0)::numeric
                      * GREATEST(0, p.amount_cents - COALESCE((p.metadata->>'amount_reversed_cents')::bigint, p.amount_cents))
                      / p.amount_cents) END) AS fee_cents,
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
