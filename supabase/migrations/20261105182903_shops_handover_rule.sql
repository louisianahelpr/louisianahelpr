-- Shops H5 (audit ~/.lh-shots/audit-1105-shops.md H5; NOT-LAUNCHED, shops): a Shops handover follows Declutter's 10-30
-- rule (L23 "Handover same as Declutter"; owner and lead 10-30, declutter_handover_sweep in 20261102084222):
--   * The buyer's "I got it" pays the shop at once (shops_confirm_pickup, unchanged).
--   * The shop says it is done: in person, the new "Handed over" tap (shops_mark_handed_over, from the ready date on);
--     left out, the ready photo it already takes. The buyer then has 48 hours to say "I didn't get it"; silence after
--     that pays the shop (shop_handover_sweep). The shop still cannot finish its own order: its tap only starts the
--     buyer's 48 hours (owner 2026-10-18), and a report in those 48 hours stops the money for Louisiana Helpr.
--   * If NOBODY taps, nothing is paid automatically any more (before: shop_complete_handover(id, 'auto') 24 hours after
--     the ready date, 20261018211820:535-567). The money stays held. Both sides are nudged 24 hours after the ready
--     date, then weekly; at 60 days every admin is told once (shops_admin_pay_shop / shops_admin_refund_order decide
--     it). Test and seed orders are never nudged and never reach an admin (owner rule: test data never shows).
--
-- Restated from their NEWEST CREATE (only the lines marked H5 change):
--   shop_complete_handover  20261018211820_shops_handover_payout.sql (only the buyer's 'auto' notice words)
--   shop_handover_sweep     20261018211820_shops_handover_payout.sql (rewritten as above)
-- Replay-safe: ADD COLUMN IF NOT EXISTS, CREATE OR REPLACE with unchanged signatures, grants restated.
-- Proof: src/test/pglite/shopsHandoverRule.pglite.mjs (applied 3x; --before is red). Guard: src/test/shopsHandoverRule.test.ts.

ALTER TABLE public.shop_handovers
  ADD COLUMN IF NOT EXISTS shop_confirmed_at timestamptz,
  ADD COLUMN IF NOT EXISTS held_nudged_at timestamptz,
  ADD COLUMN IF NOT EXISTS held_admin_at timestamptz;
COMMENT ON COLUMN public.shop_handovers.shop_confirmed_at IS
  'H5: the shop''s "Handed over" tap (in person). The buyer has 48 hours from it to report a problem; then the shop is paid.';
COMMENT ON COLUMN public.shop_handovers.held_nudged_at IS
  'H5: the last "did the handover happen?" nudge to both sides, while nobody has tapped (24 hours after the ready date, then weekly).';
COMMENT ON COLUMN public.shop_handovers.held_admin_at IS
  'H5: when every admin was told a held order has gone 60 days with nobody tapping (once).';
GRANT SELECT (shop_confirmed_at) ON TABLE public.shop_handovers TO authenticated;

-- The shop's "Handed over" (in person). AS THE SHOP. Idempotent. Never finishes the order.
CREATE OR REPLACE FUNCTION public.shops_mark_handed_over(p_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  o public.shop_orders;
  h public.shop_handovers;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO o FROM public.shop_orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND OR o.seller_id IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'order_not_found' USING ERRCODE = 'PT404';
  END IF;
  IF o.status = 'handed_over' THEN
    RETURN jsonb_build_object('result', 'already_handed_over', 'order_id', o.id);
  END IF;
  IF o.status <> 'accepted' OR o.captured_at IS NULL THEN
    RAISE EXCEPTION 'order_not_charged_yet' USING ERRCODE = '55000',
      HINT = 'The buyer''s card is not charged yet, so this order cannot be handed over.';
  END IF;
  IF o.handover_mode = 'porch' THEN
    RAISE EXCEPTION 'porch_uses_photo' USING ERRCODE = '22023',
      HINT = 'This order is left out for pickup. Take the ready photo instead; it tells the buyer.';
  END IF;
  IF public.shop_local_today() < o.ready_date THEN
    RAISE EXCEPTION 'not_ready_date_yet' USING ERRCODE = '55000',
      HINT = 'You can mark it handed over from the ready date on.';
  END IF;
  SELECT * INTO h FROM public.shop_handovers WHERE order_id = o.id;
  IF h.problem_at IS NOT NULL THEN
    RAISE EXCEPTION 'problem_open' USING ERRCODE = '55000',
      HINT = 'The buyer reported a problem with this order. Louisiana Helpr looks at it before anyone is paid.';
  END IF;
  IF h.shop_confirmed_at IS NOT NULL THEN
    RETURN jsonb_build_object('result', 'already_marked', 'order_id', o.id);
  END IF;
  INSERT INTO public.shop_handovers (order_id, shop_confirmed_at) VALUES (o.id, now())
  ON CONFLICT (order_id) DO UPDATE SET shop_confirmed_at = now()
   WHERE public.shop_handovers.shop_confirmed_at IS NULL AND public.shop_handovers.confirmed_at IS NULL;
  PERFORM public.declutter_notify(o.buyer_id, 'payment', 'The shop says you have your order',
    format('The shop marked your order for %s as handed over. If you have it, tap "I got it". If you didn''t get it, tap "I didn''t get it" within 48 hours; after that the shop is paid.',
           to_char(o.ready_date, 'FMMonth FMDD')),
    '/shops/orders', o.seller_id);
  RETURN jsonb_build_object('result', 'marked', 'order_id', o.id);
END;
$fn$;
REVOKE ALL ON FUNCTION public.shops_mark_handed_over(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.shops_mark_handed_over(uuid) TO authenticated, service_role;

-- The one transition. Restated from 20261018211820 (newest CREATE); only the H5 line (the buyer's 'auto' words) changes.
CREATE OR REPLACE FUNCTION public.shop_complete_handover(p_order_id uuid, p_how text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  o public.shop_orders;
  v_debt integer;
  v_payout uuid;
BEGIN
  -- Never 'shop': the shop cannot complete its own order (owner 2026-10-18 ~21:00Z).
  IF p_how IS NULL OR p_how NOT IN ('buyer', 'auto', 'admin') THEN
    RAISE EXCEPTION 'invalid_method' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO o FROM public.shop_orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'order_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF o.status = 'handed_over' THEN
    RETURN jsonb_build_object('result', 'already_handed_over', 'order_id', o.id);
  END IF;
  IF o.status <> 'accepted' OR o.captured_at IS NULL THEN
    RAISE EXCEPTION 'order_not_charged_yet' USING ERRCODE = '55000',
      HINT = 'This order is not charged yet, so it cannot be handed over.';
  END IF;
  IF p_how <> 'admin' AND EXISTS (SELECT 1 FROM public.shop_handovers h WHERE h.order_id = o.id AND h.problem_at IS NOT NULL) THEN
    RAISE EXCEPTION 'problem_open' USING ERRCODE = '55000',
      HINT = 'A problem was reported on this order. Louisiana Helpr decides before anyone is paid.';
  END IF;
  INSERT INTO public.shop_handovers (order_id) VALUES (o.id) ON CONFLICT (order_id) DO NOTHING;
  UPDATE public.shop_handovers SET confirmed_at = now(), confirmed_how = p_how WHERE order_id = o.id AND confirmed_at IS NULL;
  UPDATE public.shop_orders
     SET status = 'handed_over', close_reason = 'handed_over', handed_over_at = now(), closed_at = now()
   WHERE id = o.id AND status = 'accepted';
  -- The seller's card-fee debt (Declutter and Shops share one ledger) comes out first.
  v_debt := public.declutter_consume_fee_debt(o.seller_id, 'shop_order_' || o.id::text, o.items_cents);
  INSERT INTO public.shop_payouts (order_id, items_cents, debt_cents, amount_cents, status, next_attempt_at)
  VALUES (o.id, o.items_cents, v_debt, o.items_cents - v_debt,
          CASE WHEN o.items_cents - v_debt = 0 THEN 'nothing_due' ELSE 'pending' END,
          now())
  ON CONFLICT (order_id) DO NOTHING
  RETURNING id INTO v_payout;
  -- The clock finishing an order is not a pickup anybody saw: say so (money review of 201265b4c).
  PERFORM public.declutter_notify(o.seller_id, 'payment', CASE WHEN p_how = 'buyer' THEN 'Order picked up' ELSE 'Order finished' END,
    CASE
      WHEN o.items_cents - v_debt = 0 THEN
        format('This order paid off the $%s card fee you owed, so there is nothing to send.', to_char(v_debt / 100.0, 'FM999990.00'))
      WHEN NOT EXISTS (SELECT 1 FROM public.profiles pr WHERE pr.user_id = o.seller_id AND pr.stripe_account_id IS NOT NULL) THEN
        format('Set up payouts in Settings to get your $%s. We send it as soon as you do.', to_char((o.items_cents - v_debt) / 100.0, 'FM999990.00'))
      WHEN v_debt > 0 THEN
        format('$%s is on its way to your payout account ($%s card fee you owed was taken out).',
               to_char((o.items_cents - v_debt) / 100.0, 'FM999990.00'), to_char(v_debt / 100.0, 'FM999990.00'))
      ELSE format('$%s is on its way to your payout account.', to_char((o.items_cents - v_debt) / 100.0, 'FM999990.00'))
    END,
    '/shops/dashboard', o.buyer_id);
  PERFORM public.declutter_notify(o.buyer_id, 'payment', CASE WHEN p_how = 'buyer' THEN 'Enjoy your order' ELSE 'Order finished' END,
    CASE p_how
      WHEN 'buyer' THEN 'The pickup is done and the order is final. Thank you for buying local.'
      -- H5: the clock only runs after the shop said it was handed over (or left out with a photo).
      WHEN 'auto' THEN 'Nobody reported a problem in the 48 hours after the shop said your order was handed over, so the order is final and the shop is paid.'
      ELSE 'Louisiana Helpr finished this order, and the shop is paid.'
    END,
    '/shops/orders', o.seller_id);
  RETURN jsonb_build_object('result', 'handed_over', 'order_id', o.id, 'payout_id', v_payout, 'by', p_how);
END;
$fn$;
REVOKE ALL ON FUNCTION public.shop_complete_handover(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.shop_complete_handover(uuid, text) TO service_role;

-- The clock (service only; declutter-money every 10 minutes). H5: rewritten to Declutter's 10-30 rule.
CREATE OR REPLACE FUNCTION public.shop_handover_sweep()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  r record;
  a record;
  v_auto integer := 0;
  v_nudged integer := 0;
  v_to_admin integer := 0;
  v_test boolean;
BEGIN
  -- (a) The shop said it is done and the buyer said nothing for 48 hours: the shop is paid. In person: the
  -- "Handed over" tap. Left out: the ready photo, counted from the later of the photo and the ready date's start.
  FOR r IN
    SELECT o.id FROM public.shop_orders o
      JOIN public.shop_handovers h ON h.order_id = o.id
     WHERE o.status = 'accepted' AND o.captured_at IS NOT NULL
       AND h.problem_at IS NULL AND h.confirmed_at IS NULL
       AND ((o.handover_mode = 'in_person' AND h.shop_confirmed_at IS NOT NULL
             AND h.shop_confirmed_at + interval '48 hours' <= now())
         OR (o.handover_mode = 'porch' AND h.ready_photo_path IS NOT NULL
             AND greatest(h.ready_at, (o.ready_date::timestamp AT TIME ZONE 'America/Chicago')) + interval '48 hours' <= now()))
     ORDER BY o.ready_date, o.id LIMIT 200
  LOOP
    BEGIN
      -- shop_complete_handover re-reads the row under its lock and refuses an open problem.
      IF (public.shop_complete_handover(r.id, 'auto') ->> 'result') = 'handed_over' THEN
        v_auto := v_auto + 1;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      -- One bad order never stops the rest; it is logged and retried next run.
      PERFORM public.log_cron_defect('shop_handover_sweep', r.id::text, SQLERRM);
    END;
  END LOOP;
  -- (b) Nobody has said anything 24 hours after the ready date: the money stays held. Both sides are nudged, then
  -- weekly; at 60 days every admin is told once. No money moves here.
  FOR r IN
    SELECT o.id, o.buyer_id, o.seller_id, o.handover_mode, o.ready_date, o.is_seed,
           h.held_nudged_at, h.held_admin_at,
           ((o.ready_date + 1)::timestamp AT TIME ZONE 'America/Chicago') AS held_from
      FROM public.shop_orders o
      LEFT JOIN public.shop_handovers h ON h.order_id = o.id
     WHERE o.status = 'accepted' AND o.captured_at IS NOT NULL
       AND h.problem_at IS NULL AND h.confirmed_at IS NULL
       AND ((o.handover_mode = 'in_person' AND h.shop_confirmed_at IS NULL)
         OR (o.handover_mode = 'porch' AND h.ready_photo_path IS NULL))
       AND ((o.ready_date + 1)::timestamp AT TIME ZONE 'America/Chicago') + interval '24 hours' <= now()
       AND (h.held_nudged_at IS NULL OR h.held_nudged_at + interval '7 days' <= now()
            OR (h.held_admin_at IS NULL
                AND ((o.ready_date + 1)::timestamp AT TIME ZONE 'America/Chicago') + interval '60 days' <= now()))
       -- Owner rule: test data never reaches a member or admin.
       AND o.is_seed IS NOT TRUE
       AND NOT EXISTS (SELECT 1 FROM public.test_accounts t WHERE t.user_id IN (o.buyer_id, o.seller_id))
       AND NOT EXISTS (SELECT 1 FROM public.profiles pr WHERE pr.user_id IN (o.buyer_id, o.seller_id) AND pr.is_seed)
       AND NOT public.is_test_subject(o.buyer_id) AND NOT public.is_test_subject(o.seller_id)
     ORDER BY o.ready_date, o.id LIMIT 200
  LOOP
    BEGIN
      INSERT INTO public.shop_handovers (order_id) VALUES (r.id) ON CONFLICT (order_id) DO NOTHING;
      IF r.held_admin_at IS NULL AND r.held_from + interval '60 days' <= now() THEN
        UPDATE public.shop_handovers SET held_admin_at = now(), held_nudged_at = now() WHERE order_id = r.id;
        PERFORM public.declutter_notify(r.buyer_id, 'payment', 'Louisiana Helpr is looking at this order',
          'Nobody has confirmed this handover for 60 days. The money stays held until Louisiana Helpr decides. You can add your side on the order.',
          '/shops/orders', r.seller_id);
        PERFORM public.declutter_notify(r.seller_id, 'payment', 'Louisiana Helpr is looking at this order',
          'Nobody has confirmed this handover for 60 days. The money stays held until Louisiana Helpr decides. You can add your side on the order.',
          '/shops/dashboard', r.buyer_id);
        v_test := public.is_test_subject(r.buyer_id) OR public.is_test_subject(r.seller_id);
        IF NOT v_test THEN
          FOR a IN SELECT DISTINCT ur.user_id FROM public.user_roles ur WHERE ur.role = 'admin' LOOP
            PERFORM public.declutter_notify(a.user_id, 'warning', 'Shops order held 60 days',
              'Nobody has confirmed a paid Shops handover for 60 days. The money is held until you decide it: pay the shop or refund the buyer.', '/admin');
          END LOOP;
        END IF;
        v_to_admin := v_to_admin + 1;
      ELSE
        UPDATE public.shop_handovers SET held_nudged_at = now() WHERE order_id = r.id;
        PERFORM public.declutter_notify(r.buyer_id, 'payment', 'Did you get your order?',
          'If you have it, tap "I got it" on the order in Shops. If not, report it there. Your money stays held until one of you says.',
          '/shops/orders', r.seller_id);
        PERFORM public.declutter_notify(r.seller_id, 'payment', 'Did the buyer get this order?',
          CASE WHEN r.handover_mode = 'porch'
            THEN 'If it''s out, take the ready photo on the order. You aren''t paid until one of you says.'
            ELSE 'If they have it, tap "Handed over" on the order. You aren''t paid until one of you says.' END,
          '/shops/dashboard', r.buyer_id);
        v_nudged := v_nudged + 1;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      PERFORM public.log_cron_defect('shop_handover_sweep', r.id::text, SQLERRM);
    END;
  END LOOP;
  RETURN jsonb_build_object('auto_handed_over', v_auto, 'held_nudged', v_nudged, 'held_to_admin', v_to_admin);
END;
$fn$;
REVOKE ALL ON FUNCTION public.shop_handover_sweep() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.shop_handover_sweep() TO service_role;
