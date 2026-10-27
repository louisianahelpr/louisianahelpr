-- Q1937: the card-fee debt a Declutter order's linked "Add a Helpr" setup jobs put on the seller is
-- capped at the ORDER TOTAL, summed over every job linked to that order (owner 2026-10-21, pop-up via
-- the lead: "CAPPED AT THE ORDER TOTAL"; 2026-10-27: Add a Helpr launches with Declutter).
--
-- Measured on prod 2026-10-27 (pg_get_functiondef, md5(prosrc) b90402b6575c83c66db16dcf8409ad57):
-- declutter_setup_job_fee_debt caps each job at that job's own charge only, so one order with many
-- linked jobs billed the seller the card fees of all of them (a $5 sale with five $500 setup jobs:
-- about $74), and a buyer's no-show report alone can trigger it.
--
-- HOW: the rewrite mechanism of 20261025203540 / 20260925143327: take pg_get_functiondef() (what
-- Postgres actually has, so the fee-free notice wording of 20261027172503, if it is already in, is
-- kept), substitute the named code, EXECUTE the result. Three code edits, no literal changes:
--   10 three new locals;
--   20 before the link row is locked, the ORDER row is locked (FOR UPDATE), so two jobs of one order
--      billed at the same time cannot both read the old sum (the order row, then the link row);
--   30 after the per-job cap, the per-order cap: what the order's OTHER jobs were already billed,
--      subtracted from the order total, never below 0.
-- Replay-safe by construction: each pattern names text the edit removes or separates, so a second
-- run matches nothing and executes nothing; a function that does not exist is skipped with a WARNING.
-- Grants are untouched (CREATE OR REPLACE keeps them: postgres, service_role).
-- Proof: src/test/pglite/declutterSetupJobFeeOrderCap.pglite.mjs. Guard: src/test/declutterSetupJobFeeOrderCap.test.ts.

DO $migrate$
DECLARE
  r        record;
  v_oid    oid;
  v_def    text;
  v_new    text;
  v_any    boolean;
  v_hit    boolean;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      (10, 'declutter_setup_job_fee_debt',
           $p$  v_seed boolean;\nBEGIN$p$,
           $q$  v_seed boolean;
  v_order_id uuid;
  v_order_total integer;
  v_billed integer;
BEGIN$q$, ''),
      (20, 'declutter_setup_job_fee_debt',
           $p$  END IF;\n  SELECT x\.job_id, x\.seller_fault_refund_id, x\.seller_fee_billed_cents INTO l$p$,
           $q$  END IF;
  -- Q1937: the order row first, so the per-order sum below is read by one biller at a time.
  SELECT o.id, o.total_cents INTO v_order_id, v_order_total
    FROM public.declutter_orders o
   WHERE o.id = (SELECT x0.order_id FROM public.declutter_order_jobs x0 WHERE x0.job_id = p_job_id)
   FOR UPDATE;
  SELECT x.job_id, x.seller_fault_refund_id, x.seller_fee_billed_cents INTO l$q$, ''),
      (30, 'declutter_setup_job_fee_debt',
           $p$  v_fee := least\(p_card_fee_cents, COALESCE\(v_cap, 0\)\);\n  SELECT o\.seller_id INTO v_seller$p$,
           $q$  v_fee := least(p_card_fee_cents, COALESCE(v_cap, 0));
  -- Q1937: every job linked to one order together never bills the seller more than the order total.
  SELECT COALESCE(sum(y.seller_fee_billed_cents), 0)::integer INTO v_billed
    FROM public.declutter_order_jobs y
   WHERE y.order_id = v_order_id AND y.job_id <> p_job_id;
  v_fee := least(v_fee, greatest(COALESCE(v_order_total, 0) - v_billed, 0));
  SELECT o.seller_id INTO v_seller$q$, '')
    ) AS t(ord, fn, pat, rep, flags)
    ORDER BY ord
  LOOP
    v_any := false;
    v_hit := false;

    FOR v_oid IN
      SELECT p.oid
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public'
         AND p.proname = r.fn
         AND p.prokind IN ('f', 'p')
    LOOP
      v_any := true;
      v_def := pg_get_functiondef(v_oid);
      v_new := regexp_replace(v_def, r.pat, r.rep, r.flags);
      IF v_new IS DISTINCT FROM v_def THEN
        EXECUTE v_new;
        v_hit := true;
      END IF;
    END LOOP;

    IF NOT v_any THEN
      RAISE WARNING 'Q1937 order cap %: public.% does not exist — skipped', r.ord, r.fn;
    ELSIF NOT v_hit THEN
      RAISE WARNING 'Q1937 order cap %: pattern did not match in public.% — nothing changed', r.ord, r.fn;
    END IF;
  END LOOP;
END
$migrate$;
