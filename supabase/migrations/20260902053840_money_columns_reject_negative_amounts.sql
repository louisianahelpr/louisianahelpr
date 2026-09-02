-- Money columns that will accept a negative number (SI-009).
--
-- The house style is to constrain money at the column: payout_transfers.
-- amount_cents CHECK (> 0), payment_refunds.amount_cents CHECK (>= 0),
-- pif_credits.amount CHECK (> 0), tips.amount CHECK (> 0 AND <= 1000),
-- disputes CHECK on both execution columns. These tables are the gap in it.
-- Measured on prod 2026-09-02: `instant_payouts` carries ZERO check
-- constraints across gross_amount / fee_amount / net_amount, and
-- `referral_credits.amount` and `applications.stake_amount` have none either.
--
-- instant_payout is the one money system with a documented history of
-- stranding money — `reap_stranded_instant_payouts` exists because of it —
-- and it is the one with no arithmetic guard at all.
--
-- ── DELIBERATELY CONSERVATIVE ───────────────────────────────────────────────
--
-- A CHECK that is too tight is WORSE than the missing guard it replaces: the
-- unguarded column accepts a bad write, but an over-tight constraint rejects
-- a GOOD one, in prod, on a money path, with no way for the caller to
-- recover. So every bound below is one of:
--
--   * non-negativity, which is never a product judgement, or
--   * an identity that holds BY CONSTRUCTION in the code that does the write.
--
-- A NEGATIVE amount is never wanted anywhere here, and every column below
-- rejects one. There is no ledger in this product that records a reversal as
-- a negative row: a refund is `payment_refunds`, a dispute split is its own
-- pair of columns, and a cancelled job is voided rather than negated. So the
-- sign is not an open question and is not treated as one.
--
-- ZERO is the only place judgement was needed, and it splits by column:
--
--   `referral_credits.amount` is `> 0`, matching the house style for credit
--   ledgers exactly (`pif_credits.amount CHECK (> 0)`, `tips.amount CHECK
--   (> 0 AND <= 1000)`). A zero-value referral credit is not a credit; prod
--   holds two rows, 5 and 10, and none at zero.
--
--   Everything else is `>= 0`, because zero is genuinely meaningful there: a
--   job with no urgent fee, no cancellation fee and no protection fee is the
--   ordinary case, and an application with a zero stake is not a defect.
--
-- What is still NOT constrained, on purpose: any UPPER bound on a fee. That
-- is a product decision, not arithmetic, and a ceiling guessed wrong rejects
-- a legitimate write in prod — the failure mode described above.
--
-- ── EVERY CONSTRAINT VERIFIED AGAINST LIVE PROD BEFORE BEING WRITTEN ────────
--
-- Queried on fncmgoasalhdgfwzhsqa 2026-09-02, so none of these can fail
-- validation on deploy: instant_payouts 1 row, 0 negative, 0 violating the
-- net identity; referral_credits 2 rows, 0 negative; applications 0 rows with
-- a non-null stake_amount; jobs 64 rows, 0 with a negative fee, 0 with
-- sales_tax_rate outside [0,1], 0 with helper_fee_percent outside [0,100]
-- (max observed 15).
--
-- The net identity is safe because it is definitional at the only writer:
-- instant-payout/index.ts:145 computes `netCents = availableCents - feeCents`
-- and :177-179 divides all three by 100, so `net = gross - fee` exactly in
-- numeric(10,2). Compared with round(…,2) on both sides regardless.
--
-- Nullability was read from information_schema rather than assumed: the
-- instant_payouts trio and referral_credits.amount are NOT NULL; every jobs
-- fee column and applications.stake_amount are nullable, so those CHECKs are
-- written NULL-tolerantly (a CHECK evaluating to NULL passes, but stating it
-- keeps the intent legible).
--
-- Replay-safe: each ADD is guarded on pg_constraint by name, and the whole
-- file is inert for any table that does not exist.

DO $money$
DECLARE
  v_sql text;
  r record;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      ('instant_payouts', 'ck_instant_payouts_amounts_nonneg',
       'gross_amount >= 0 AND fee_amount >= 0 AND net_amount >= 0'),
      ('instant_payouts', 'ck_instant_payouts_net_is_gross_minus_fee',
       'round(net_amount, 2) = round(gross_amount - fee_amount, 2)'),
      ('referral_credits', 'ck_referral_credits_amount_positive',
       'amount > 0'),
      ('applications', 'ck_applications_stake_amount_nonneg',
       'stake_amount IS NULL OR stake_amount >= 0'),
      ('jobs', 'ck_jobs_fee_amounts_nonneg',
       'COALESCE(platform_fee_amount, 0) >= 0 AND COALESCE(customer_fee_amount, 0) >= 0 '
       'AND COALESCE(commission_tax_amount, 0) >= 0 AND COALESCE(sales_tax_amount, 0) >= 0 '
       'AND COALESCE(cancellation_fee, 0) >= 0 AND COALESCE(protection_fee, 0) >= 0'),
      ('jobs', 'ck_jobs_sales_tax_rate_range',
       'sales_tax_rate IS NULL OR (sales_tax_rate >= 0 AND sales_tax_rate <= 1)'),
      ('jobs', 'ck_jobs_helper_fee_percent_range',
       'helper_fee_percent IS NULL OR (helper_fee_percent >= 0 AND helper_fee_percent <= 100)')
    ) AS t(tbl, con, expr)
  LOOP
    IF to_regclass('public.' || r.tbl) IS NULL THEN
      RAISE WARNING 'public.% is missing — skipping %', r.tbl, r.con;
      CONTINUE;
    END IF;

    IF EXISTS (
      SELECT 1 FROM pg_constraint
       WHERE conrelid = ('public.' || r.tbl)::regclass
         AND conname = r.con
    ) THEN
      CONTINUE;  -- already applied; this file is replayed as-is
    END IF;

    v_sql := format('ALTER TABLE public.%I ADD CONSTRAINT %I CHECK (%s)', r.tbl, r.con, r.expr);
    EXECUTE v_sql;
  END LOOP;
END
$money$;

-- Verification. WARNs rather than raises so drift is visible in the deploy
-- log without aborting a deploy that has already applied.
DO $verify$
DECLARE
  v_missing text[] := ARRAY[]::text[];
  r record;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      ('instant_payouts', 'ck_instant_payouts_amounts_nonneg'),
      ('instant_payouts', 'ck_instant_payouts_net_is_gross_minus_fee'),
      ('referral_credits', 'ck_referral_credits_amount_positive'),
      ('applications',    'ck_applications_stake_amount_nonneg'),
      ('jobs',            'ck_jobs_fee_amounts_nonneg'),
      ('jobs',            'ck_jobs_sales_tax_rate_range'),
      ('jobs',            'ck_jobs_helper_fee_percent_range')
    ) AS t(tbl, con)
  LOOP
    IF to_regclass('public.' || r.tbl) IS NOT NULL
       AND NOT EXISTS (
         SELECT 1 FROM pg_constraint
          WHERE conrelid = ('public.' || r.tbl)::regclass AND conname = r.con
       )
    THEN
      v_missing := v_missing || (r.tbl || '.' || r.con);
    END IF;
  END LOOP;

  IF array_length(v_missing, 1) IS NOT NULL THEN
    RAISE WARNING 'money CHECK constraints missing after this migration: % — these columns will silently accept a negative amount', array_to_string(v_missing, ', ');
  END IF;
END
$verify$;
