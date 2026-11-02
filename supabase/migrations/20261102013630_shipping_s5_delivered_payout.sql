-- Shipping S5 (Q2259; docs/specs/shipping-draft.md sections 7 and S5): a shipped order finishes after the USPS
-- delivered scan, and the seller is paid through the existing payout path.
--
-- Before: nothing finished a shipped order. declutter_handover_sweep skips handover 'ship' on purpose (S2: it must
-- never be auto-paid off a booking or closed as a no-show), and "I got it" (declutter_confirm_handover, S2) works only
-- after the delivered scan. A buyer who never tapped "I got it" left the order 'paid' forever, so the seller was never
-- paid.
--
-- Now: declutter_ship_sweep finishes a shipped order 24 hours after the delivered scan
-- (shipments.tracking_status = 'delivered', delivered_at + 24 h <= now()), with declutter_complete_handover(o, 'auto'),
-- the same call "I got it" and the other sweeps make. The existing rules then apply unchanged: the buyer may ask for a
-- refund in the 24 hours after the handover, and the payout (items only: complete_handover pays a delivery rate for
-- seller_delivery alone, never the shipping, which bought the label) waits until the sale is final, 24 hours after
-- the handover (declutter_payouts_due). So the buyer's window is the spec's 48 hours after "delivered", and the seller
-- is paid on FINAL, never on the first scan.
-- It acts only when ALL hold, re-checked under the order lock:
--   * the order is 'paid' with handover 'ship';
--   * the card hold was CAPTURED (ship_capture = 'captured'): a held or released hold has no money to pay out;
--   * the order's ONE shipment has the delivered scan (tracking_status 'delivered', delivered_at set). A delivered scan
--     at another ZIP never becomes 'delivered' (easypost-webhook's nextTracking: it is a problem, not a delivery);
--   * no problem is open on the order.
-- One bad order never stops the rest (log_cron_defect, retried next run), like declutter_handover_sweep.
--
-- Switch: shipping is testers-only (declutter_shipping). Ship orders exist only for testers, and the sweep is a cron
-- job (no member calls it: service_role only), so it needs no require_feature.
-- Schedule: its own cron job, 'declutter-ship-sweep', every 10 minutes from :02 (four minutes before
-- declutter-handovers, six before declutter-money; :04 put 11 jobs in one minute, cronStartsSpreadAcrossMinutes).
--
-- Proof: src/test/pglite/shippingS5DeliveredPayout.pglite.mjs (applied 3x; NEW_MIGRATION=skip is red).
-- REPLAY-SAFETY: CREATE OR REPLACE; cron and its expectations row only when those exist; cron.schedule by name.

CREATE OR REPLACE FUNCTION public.declutter_ship_sweep()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  r record;
  o public.declutter_orders;
  v_done integer := 0;
BEGIN
  FOR r IN
    SELECT o2.id FROM public.declutter_orders o2
      JOIN public.shipments s ON s.declutter_order_id = o2.id
     WHERE o2.status = 'paid' AND o2.handover = 'ship' AND o2.ship_capture = 'captured'
       AND s.tracking_status = 'delivered' AND s.delivered_at IS NOT NULL
       AND s.delivered_at + interval '24 hours' <= now()
       AND NOT EXISTS (SELECT 1 FROM public.declutter_problems p WHERE p.order_id = o2.id AND p.status = 'open')
     ORDER BY o2.id LIMIT 200
  LOOP
    BEGIN
      o := public.declutter_lock_order(r.id);
      IF o.status = 'paid' AND o.handover = 'ship' AND o.ship_capture = 'captured'
         AND EXISTS (SELECT 1 FROM public.shipments s
                      WHERE s.declutter_order_id = o.id AND s.tracking_status = 'delivered' AND s.delivered_at IS NOT NULL
                        AND s.delivered_at + interval '24 hours' <= now())
         AND NOT EXISTS (SELECT 1 FROM public.declutter_problems p WHERE p.order_id = o.id AND p.status = 'open') THEN
        PERFORM public.declutter_complete_handover(o.id, 'auto');
        v_done := v_done + 1;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      PERFORM public.log_cron_defect('declutter_ship_sweep', r.id::text, SQLERRM);
    END;
  END LOOP;
  RETURN jsonb_build_object('delivered_handed_over', v_done);
END;
$function$;
REVOKE ALL ON FUNCTION public.declutter_ship_sweep() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_ship_sweep() TO service_role;

DO $do$
BEGIN
  IF to_regclass('public.cron_work_expectations') IS NOT NULL THEN
    INSERT INTO public.cron_work_expectations (jobname, expected_max_gap, note, work_visibility, work_exempt_reason)
    VALUES ('declutter-ship-sweep', interval '30 minutes',
      'Declutter shipping: finishes a shipped order 24 h after the USPS delivered scan (captured hold, no open problem), so the seller is paid once the sale is final.',
      'exempt', 'While shipping is testers-only, a run that finishes nothing is the healthy state.')
    ON CONFLICT (jobname) DO UPDATE SET expected_max_gap = EXCLUDED.expected_max_gap, note = EXCLUDED.note,
      work_visibility = EXCLUDED.work_visibility, work_exempt_reason = EXCLUDED.work_exempt_reason;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    PERFORM cron.schedule('declutter-ship-sweep', '2-59/10 * * * *',
      $c$SELECT public.cron_record_work('declutter-ship-sweep', to_jsonb(public.declutter_ship_sweep()));$c$);
  END IF;
END
$do$;
