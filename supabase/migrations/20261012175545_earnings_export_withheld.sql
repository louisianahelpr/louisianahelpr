-- Q1520 (docs/OPEN.md; found doing Q1379): the earnings export's gross and
-- platform fee include what a payout withheld and never sent.
--
-- release-payout and process-scheduled-payouts deduct a first payout's
-- one-time onboarding fee (platform_settings.onboarding_fee_cents) and every
-- payout path rounds the payout DOWN to whole dollars before the ledger row
-- is written. Those paths now record the two amounts on the row's metadata
-- (onboarding_fee_cents, rounding_remainder_cents); this export adds them to
-- the fee, so gross = what was paid + every cent kept back, and
-- gross - fee = net still holds on every ledger row.
--
-- Withheld counts IN FULL on a 'reversed' row too: a refund or lost
-- chargeback hands the poster the withheld part with the rest, but the
-- Helpr's export shows what the payout was computed from; a chargeback
-- re-pay row copies no withheld keys, so nothing is counted twice
-- (lh-money-escrow review of this file, finding 3: documented choice).
--
-- Existing rows (prod had ONE, a scheduled payout of 2026-10-11: $10 budget,
-- 12% fee, $8.00 paid, the 80c rounded off unrecorded; read-only SQL
-- 2026-10-12): backfilled below where the remainder can be recomputed
-- exactly in SQL (a non-crew job with no urgent fee, whose net-of-Stripe
-- urgent figure lives only in TypeScript) and lands in 0..99 cents.
-- Scheduled-payout rows already carried onboarding_fee_cents.
--
-- Also (same review, finding 6): the caller check refuses a NULL auth.uid()
-- (`IS DISTINCT FROM`); the grants already kept anon out.
--
-- Same signature, same grants; CREATE OR REPLACE and the guarded backfill
-- are replay-safe. Restated from 20261007145338.

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
                   ELSE 0 END) AS fee_cents,
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


-- Backfill the rounding remainder on rows written before the payout paths
-- recorded it, where SQL can recompute it exactly (see the header). Guarded:
-- a row that already has the key is never touched, so a replay is a no-op.
UPDATE public.payout_transfers p
   SET metadata = COALESCE(p.metadata, '{}'::jsonb)
                  || jsonb_build_object('rounding_remainder_cents', x.remainder)
  FROM (
    SELECT p2.id,
           ROUND(j.budget * 100)::bigint - COALESCE(p2.platform_fee_cents, 0) - p2.amount_cents
             - COALESCE((p2.metadata->>'onboarding_fee_cents')::bigint, 0) AS remainder
      FROM public.payout_transfers p2
      JOIN public.jobs j ON j.id = p2.job_id
     WHERE p2.status IN ('paid', 'reversed')
       AND COALESCE(p2.metadata->>'source', '') IN ('scheduled_payout', 'release-payout')
       AND NOT (COALESCE(p2.metadata, '{}'::jsonb) ? 'rounding_remainder_cents')
       AND COALESCE(j.is_group_job, false) = false
       AND COALESCE(j.urgent_fee, 0) = 0
       AND j.budget IS NOT NULL
  ) x
 WHERE p.id = x.id
   AND x.remainder BETWEEN 0 AND 99;
