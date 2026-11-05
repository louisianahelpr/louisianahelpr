-- The Supabase PERFORMANCE advisor's exact baseline (scripts/ci/performance-advisor-baseline.json,
-- Q1321; Q1816, nightly-red #3743 db-drift-detect). get_advisors (performance) on prod read
-- 2026-11-05 ~02:58Z, two classes off the baseline besides the 26 unindexed foreign keys
-- (20261105025801):
--
-- (A) multiple_permissive_policies 32 (baseline 31). The new pair is public.helpr_card_fee_debts
--     (20261102072106): two PERMISSIVE SELECT policies TO authenticated, "the Helpr reads own"
--     (helper_id = uid) and "admins read" (has_role(uid, 'admin')). pg_policies read the same
--     minute: those two and no RESTRICTIVE policy. Postgres ORs permissive policies, so ONE policy
--     whose USING is the OR of the two gives the same rows to the same role, and the planner runs
--     one qual instead of two. Dropped and created inside this migration's one transaction, so no
--     moment exists with no read policy. Same precedent: 20261020225414, 20261012193325.
--     Column grants (SELECT on 7 columns to authenticated) and the service_role grant are untouched.
--
-- (B) no_primary_key 1: public.declutter_item_price_drops (20261031224850) has no primary key
--     (item_id, at, from_cents, to_cents; 2 rows on prod). An identity column is the key: its one
--     writer, saved_search_on_item_price_drop, inserts (item_id, from_cents, to_cents) and leaves
--     it out, and its reader, declutter_dropped_into_budget, never names it. NOT (item_id, at): two
--     drops of one item in one transaction share now(), so that key would fail a real write.
--     Existing rows get ids when the column is added.
--
-- DATE NOTE: 20261105025801's header says "2026-11-04 ~02:58Z"; that read was 2026-11-05 ~02:58Z
-- (8:58 PM CT on 11-04), the same read as this one.
--
-- REPLAY-SAFE: the policy DROPs are IF EXISTS and the CREATE is preceded by its own DROP IF EXISTS;
-- ADD COLUMN IF NOT EXISTS, and the primary key is added only when the table has none.
-- Proof: src/test/pglite/foldFeeDebtReadsPricePk.pglite.mjs (3 runs).

DROP POLICY IF EXISTS "helpr card fee debts: the Helpr reads own" ON public.helpr_card_fee_debts;
DROP POLICY IF EXISTS "helpr card fee debts: admins read" ON public.helpr_card_fee_debts;
DROP POLICY IF EXISTS "helpr card fee debts: own or admin read" ON public.helpr_card_fee_debts;
CREATE POLICY "helpr card fee debts: own or admin read" ON public.helpr_card_fee_debts
  FOR SELECT TO authenticated
  USING (helper_id = (SELECT auth.uid()) OR public.has_role((SELECT auth.uid()), 'admin'::app_role));

ALTER TABLE public.declutter_item_price_drops ADD COLUMN IF NOT EXISTS id bigint GENERATED ALWAYS AS IDENTITY;
DO $do$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.declutter_item_price_drops'::regclass AND contype = 'p'
  ) THEN
    ALTER TABLE public.declutter_item_price_drops ADD CONSTRAINT declutter_item_price_drops_pkey PRIMARY KEY (id);
  END IF;
END
$do$;
