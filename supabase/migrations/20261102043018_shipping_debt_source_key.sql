-- Shipping S6 part 2a (Q2259; docs/specs/shipping-draft.md 5.3 "Debts" and section 11 money-review fix 4):
-- the seller fee-debt ledger gets ONE key, (source_kind, source_ref), so it can hold a shipping debt.
--
-- What was wrong: declutter_seller_fee_debts can only say where a debt came from through one nullable
-- column per source (refund_id, shop_refund_id, raise_id), each UNIQUE, with a CHECK that exactly one is
-- set. A shipping debt (a label the seller must pay for after a seller-fault refund, a postage adjustment,
-- the HAZMAT fee, a void EasyPost rejected) has none of those columns, so it could not be booked at all,
-- and a second debt for the same shipment could not be told apart from the first.
--
-- What this does:
--   1. Adds source_kind and source_ref. Every existing row is backfilled from the column it already uses:
--      refund_id -> 'refund_card_fee', shop_refund_id -> 'shop_refund_card_fee', raise_id -> 'raise_card_fee'.
--   2. A BEFORE INSERT/UPDATE trigger fills the pair from that column when the caller did not set it, so
--      every existing writer (declutter_record_refund, declutter_setup_job_fee_debt, the Shops refund, the
--      delivery raise) keeps working unchanged. Their `ON CONFLICT (refund_id | shop_refund_id | raise_id)`
--      stays valid because those UNIQUE constraints stay: they are the same rule as the new pair for their
--      kind (one debt per refund / raise). New shipping writers use ON CONFLICT (source_kind, source_ref).
--   3. UNIQUE (source_kind, source_ref): one debt per source, for every kind, a replay never bills twice.
--   4. The one-source CHECK becomes: a refund/raise kind names exactly its own column and source_ref equals
--      it; a shipping kind ('ship_label', 'ship_adjustment', 'ship_hazmat_fee', 'ship_void_rejected') names
--      none of them (source_ref is the shipment or adjustment id; no FK, the debt outlives the shipment).
--   5. The pair cannot be changed after insert (a debt never moves to another source).
--
-- Not changed, on purpose: the seller FK stays ON DELETE CASCADE. The spec's "an open debt blocks deletion"
-- is already enforced where the member deletes their own account (Q2171: delete-own-account ->
-- findFeeDebtOwed reads remaining_cents > 0 and answers 409). A database-level RESTRICT would also block the
-- under-13 deletion the law requires and the admin delete, which findFeeDebtOwed deliberately exempts, and it
-- would fail AFTER purgeAccount has already stripped the account.
--
-- No money moves: no amount, remaining or deduction is touched; the backfill only labels existing rows.
-- Test mode only (shipping is behind declutter_shipping = testers). Replay-safe; applied 3x in PGlite.

ALTER TABLE public.declutter_seller_fee_debts ADD COLUMN IF NOT EXISTS source_kind text;
ALTER TABLE public.declutter_seller_fee_debts ADD COLUMN IF NOT EXISTS source_ref uuid;

-- The trigger: fill the pair from the source column; refuse a pair that disagrees with it; refuse a change.
CREATE OR REPLACE FUNCTION public.declutter_fee_debt_source()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_row jsonb := to_jsonb(NEW);
  v_kind text;
  v_ref uuid;
BEGIN
  IF v_row->>'refund_id' IS NOT NULL THEN
    v_kind := 'refund_card_fee'; v_ref := (v_row->>'refund_id')::uuid;
  ELSIF v_row->>'shop_refund_id' IS NOT NULL THEN
    v_kind := 'shop_refund_card_fee'; v_ref := (v_row->>'shop_refund_id')::uuid;
  ELSIF v_row->>'raise_id' IS NOT NULL THEN
    v_kind := 'raise_card_fee'; v_ref := (v_row->>'raise_id')::uuid;
  END IF;
  IF v_kind IS NOT NULL THEN
    IF NEW.source_kind IS NULL THEN NEW.source_kind := v_kind; END IF;
    IF NEW.source_ref IS NULL THEN NEW.source_ref := v_ref; END IF;
    IF NEW.source_kind IS DISTINCT FROM v_kind OR NEW.source_ref IS DISTINCT FROM v_ref THEN
      RAISE EXCEPTION 'debt_source_mismatch' USING ERRCODE = '23514';
    END IF;
  END IF;
  IF TG_OP = 'UPDATE' AND (NEW.source_kind IS DISTINCT FROM OLD.source_kind
                           OR NEW.source_ref IS DISTINCT FROM OLD.source_ref) THEN
    RAISE EXCEPTION 'debt_source_is_fixed' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_fee_debt_source() FROM PUBLIC, anon, authenticated;

-- Backfill before the trigger exists (a plain UPDATE, labels only).
DO $do$
DECLARE
  v_shops boolean := EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public'
                               AND table_name = 'declutter_seller_fee_debts' AND column_name = 'shop_refund_id');
  v_raise boolean := EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public'
                               AND table_name = 'declutter_seller_fee_debts' AND column_name = 'raise_id');
BEGIN
  DROP TRIGGER IF EXISTS trg_declutter_fee_debt_source ON public.declutter_seller_fee_debts;
  UPDATE public.declutter_seller_fee_debts SET source_kind = 'refund_card_fee', source_ref = refund_id
    WHERE source_kind IS NULL AND refund_id IS NOT NULL;
  IF v_shops THEN
    EXECUTE $q$UPDATE public.declutter_seller_fee_debts SET source_kind = 'shop_refund_card_fee', source_ref = shop_refund_id
      WHERE source_kind IS NULL AND shop_refund_id IS NOT NULL$q$;
  END IF;
  IF v_raise THEN
    EXECUTE $q$UPDATE public.declutter_seller_fee_debts SET source_kind = 'raise_card_fee', source_ref = raise_id
      WHERE source_kind IS NULL AND raise_id IS NOT NULL$q$;
  END IF;

  ALTER TABLE public.declutter_seller_fee_debts ALTER COLUMN source_kind SET NOT NULL;
  ALTER TABLE public.declutter_seller_fee_debts ALTER COLUMN source_ref SET NOT NULL;
  -- refund_id was NOT NULL at birth (20261014224914); Shops / the raise already dropped it, a database
  -- built without either has not.
  ALTER TABLE public.declutter_seller_fee_debts ALTER COLUMN refund_id DROP NOT NULL;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'declutter_fee_debts_source_once') THEN
    ALTER TABLE public.declutter_seller_fee_debts ADD CONSTRAINT declutter_fee_debts_source_once
      UNIQUE (source_kind, source_ref);
  END IF;

  -- The one-source rule, restated over the pair (always rebuilt, so a replay reads the newest).
  ALTER TABLE public.declutter_seller_fee_debts DROP CONSTRAINT IF EXISTS declutter_fee_debts_one_source;
  EXECUTE format($c$ALTER TABLE public.declutter_seller_fee_debts ADD CONSTRAINT declutter_fee_debts_one_source CHECK (
      (source_kind = 'refund_card_fee' AND refund_id = source_ref AND num_nonnulls(%1$s) = 1)
      %2$s
      %3$s
      OR (source_kind IN ('ship_label', 'ship_adjustment', 'ship_hazmat_fee', 'ship_void_rejected')
          AND num_nonnulls(%1$s) = 0)
    )$c$,
    concat_ws(', ', 'refund_id', CASE WHEN v_shops THEN 'shop_refund_id' END, CASE WHEN v_raise THEN 'raise_id' END),
    CASE WHEN v_shops THEN format('OR (source_kind = %L AND shop_refund_id = source_ref AND num_nonnulls(%s) = 1)',
      'shop_refund_card_fee', concat_ws(', ', 'refund_id', 'shop_refund_id', CASE WHEN v_raise THEN 'raise_id' END)) ELSE '' END,
    CASE WHEN v_raise THEN format('OR (source_kind = %L AND raise_id = source_ref AND num_nonnulls(%s) = 1)',
      'raise_card_fee', concat_ws(', ', 'refund_id', CASE WHEN v_shops THEN 'shop_refund_id' END, 'raise_id')) ELSE '' END);

  CREATE TRIGGER trg_declutter_fee_debt_source BEFORE INSERT OR UPDATE ON public.declutter_seller_fee_debts
    FOR EACH ROW EXECUTE FUNCTION public.declutter_fee_debt_source();
END
$do$;

-- Column grants unchanged: the seller still reads only (id, seller_id, amount_cents, remaining_cents, created_at).
REVOKE ALL ON TABLE public.declutter_seller_fee_debts FROM PUBLIC, anon, authenticated;
GRANT SELECT (id, seller_id, amount_cents, remaining_cents, created_at) ON TABLE public.declutter_seller_fee_debts TO authenticated;
GRANT ALL ON TABLE public.declutter_seller_fee_debts TO service_role;
