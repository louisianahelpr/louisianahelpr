-- Q1938 (owner 11-03: "whatever the rule is for jobs is the same for declutter").
-- A Helpr setup job a Declutter seller's backing out cancelled (A10) pays its committed Helpr the same
-- late-cancel fee a poster's own cancel would. The buyer is still refunded in full; void-cancelled-payments
-- pays the Helpr from the platform balance and bills the SELLER for that fee beside the card fee.
--
-- declutter_setup_job_fee_debt gains p_helpr_fee_cents (DEFAULT 0, so a caller that sends only the card
-- fee keeps working). The debt is card fee + Helpr fee, under the same caps as before (the job's own charge,
-- then Q1937's per-order total) and still billed once per job (seller_fee_billed_cents). The seller's notice
-- says the Helpr was paid for their time when part of the amount is that pay. Restated from prod's live body
-- (md5(prosrc) 6958e804b787b7fd8cf387d455aa0b73, md5(pg_get_functiondef) 2a46e996ae5a65ab02d5a851ccb7d4b7,
-- read 11-03); only the parameter, the sum and the notice change.
--
-- The old 2-argument function is dropped first: beside a 3-argument one with a default, a 2-argument call
-- would be ambiguous. Replay-safe (DROP IF EXISTS, CREATE OR REPLACE); service role only.

DROP FUNCTION IF EXISTS public.declutter_setup_job_fee_debt(uuid, integer);

CREATE OR REPLACE FUNCTION public.declutter_setup_job_fee_debt(p_job_id uuid, p_card_fee_cents integer, p_helpr_fee_cents integer DEFAULT 0)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  l record;
  v_seller uuid;
  v_cap integer;
  v_fee integer;
  v_seed boolean;
  v_order_id uuid;
  v_order_total integer;
  v_billed integer;
BEGIN
  IF p_card_fee_cents IS NULL OR p_card_fee_cents < 0 THEN
    RAISE EXCEPTION 'invalid_fee' USING ERRCODE = '22023';
  END IF;
  IF p_helpr_fee_cents IS NULL OR p_helpr_fee_cents < 0 THEN
    RAISE EXCEPTION 'invalid_fee' USING ERRCODE = '22023';
  END IF;
  -- Q1937: the order row first, so the per-order sum below is read by one biller at a time.
  SELECT o.id, o.total_cents INTO v_order_id, v_order_total
    FROM public.declutter_orders o
   WHERE o.id = (SELECT x0.order_id FROM public.declutter_order_jobs x0 WHERE x0.job_id = p_job_id)
   FOR UPDATE;
  SELECT x.job_id, x.seller_fault_refund_id, x.seller_fee_billed_cents INTO l
    FROM public.declutter_order_jobs x WHERE x.job_id = p_job_id FOR UPDATE;
  IF NOT FOUND OR l.seller_fault_refund_id IS NULL THEN
    RAISE EXCEPTION 'not_seller_fault' USING ERRCODE = 'P0002';
  END IF;
  IF l.seller_fee_billed_cents IS NOT NULL THEN
    RETURN 0;
  END IF;
  SELECT ceil((COALESCE(jb.budget, 0) + COALESCE(jb.customer_fee_amount, 0) + COALESCE(jb.sales_tax_amount, 0)
               + COALESCE(jb.urgent_fee, 0) + COALESCE(jb.onboarding_fee_amount, 0)) * 100)::integer
    INTO v_cap FROM public.jobs jb WHERE jb.id = p_job_id FOR SHARE;
  -- Q1938: the Helpr's late-cancel fee is the seller's too, under the same caps.
  v_fee := least(p_card_fee_cents + p_helpr_fee_cents, COALESCE(v_cap, 0));
  -- Q1937: every job linked to one order together never bills the seller more than the order total.
  SELECT COALESCE(sum(y.seller_fee_billed_cents), 0)::integer INTO v_billed
    FROM public.declutter_order_jobs y
   WHERE y.order_id = v_order_id AND y.job_id <> p_job_id;
  v_fee := least(v_fee, greatest(COALESCE(v_order_total, 0) - v_billed, 0));
  SELECT o.seller_id INTO v_seller
    FROM public.declutter_refunds r JOIN public.declutter_orders o ON o.id = r.order_id
   WHERE r.id = l.seller_fault_refund_id;
  SELECT r.is_seed INTO v_seed FROM public.declutter_refunds r WHERE r.id = l.seller_fault_refund_id;
  IF v_seller IS NULL AND v_fee > 0 THEN
    -- The seller (and their order) is gone: nothing to bill, so the platform
    -- keeps the cost; said out loud, never silent (lh-silent-failure review #8).
    PERFORM public.log_cron_defect('declutter_setup_job_fee_debt' || CASE WHEN v_seed THEN '-seed' ELSE '' END, p_job_id::text,
      format('setup job %s: the seller of seller-fault Declutter refund %s is gone, so its %s-cent card fee could not be billed (the platform absorbs it)',
             p_job_id, l.seller_fault_refund_id, v_fee));
    v_fee := 0;
  END IF;
  IF v_fee > 0 THEN
    INSERT INTO public.declutter_seller_fee_debts AS d (seller_id, refund_id, amount_cents, remaining_cents)
    VALUES (v_seller, l.seller_fault_refund_id, v_fee, v_fee)
    ON CONFLICT (refund_id) DO UPDATE
      SET amount_cents = d.amount_cents + EXCLUDED.amount_cents,
          remaining_cents = d.remaining_cents + EXCLUDED.remaining_cents;
    PERFORM public.declutter_notify(v_seller, 'info', 'Amount owed added',
      format('The buyer''s Helpr setup job for a Declutter order refunded on you was refunded in full%s. $%s is added to what you owe; it comes out of your next Declutter payout.',
             CASE WHEN p_helpr_fee_cents > 0 THEN ', and the booked Helpr was paid for their time' ELSE '' END,
             to_char(v_fee / 100.0, 'FM999999990.00')),
      '/declutter?view=mine');
  END IF;
  UPDATE public.declutter_order_jobs SET seller_fee_billed_cents = v_fee WHERE job_id = p_job_id;
  RETURN v_fee;
END;
$function$;

REVOKE ALL ON FUNCTION public.declutter_setup_job_fee_debt(uuid, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_setup_job_fee_debt(uuid, integer, integer) TO service_role;
