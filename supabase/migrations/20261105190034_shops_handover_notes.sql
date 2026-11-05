-- Shops H5 follow-ups (lh-money-escrow LOW notes on ready/b4-shops-h5, 11-05):
--   * The ready notice says the buyer's 48 hours (porch: the exact deadline, the later of the photo and the start of
--     the ready date, the same moment shop_handover_sweep (a) pays at; in person: from the shop's "Handed over").
--   * At 60 days with nobody tapping, the order also gets an open problem (problem_at + a system note), as Declutter's
--     sweep opens a system declutter_problems row, so it waits in admin > Shops orders' problems for a decision.
-- Restated from their NEWEST CREATE (only the lines marked "H5 review note" change):
--   shops_mark_ready     20261104175521_q2390_last_member_not_found_is_404.sql
--   shop_handover_sweep  20261105182903_shops_handover_rule.sql
-- Replay-safe: CREATE OR REPLACE with unchanged signatures, grants restated.
-- Proof: src/test/pglite/shopsHandoverRule.pglite.mjs. Guard: src/test/shopsHandoverRule.test.ts.

CREATE OR REPLACE FUNCTION public.shops_mark_ready(p_order_id uuid, p_photo_path text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  o public.shop_orders;
  v_was_ready timestamptz;
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
      HINT = 'The buyer''s card is not charged yet. Mark the order ready once it is.';
  END IF;
  IF p_photo_path IS NULL AND o.handover_mode = 'in_person' THEN
    NULL;  -- in person: the photo is optional
  ELSIF p_photo_path IS NULL
     OR split_part(p_photo_path, '/', 1) IS DISTINCT FROM v_uid::text
     OR split_part(p_photo_path, '/', 2) IS DISTINCT FROM 'shops'
     OR split_part(p_photo_path, '/', 3) IS DISTINCT FROM 'handover'
     OR split_part(p_photo_path, '/', 4) IS DISTINCT FROM o.id::text
     OR split_part(p_photo_path, '/', 5) = ''
     OR split_part(p_photo_path, '/', 6) <> ''
     OR NOT EXISTS (SELECT 1 FROM storage.objects so WHERE so.bucket_id = 'shop-handover' AND so.name = p_photo_path) THEN
    RAISE EXCEPTION 'photo_not_uploaded' USING ERRCODE = '22023', HINT = 'Take a photo of the order first.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.shop_handovers h WHERE h.order_id = o.id AND h.problem_at IS NOT NULL) THEN
    RAISE EXCEPTION 'problem_open' USING ERRCODE = '55000',
      HINT = 'The buyer reported a problem with this order. Louisiana Helpr looks at it before anyone is paid.';
  END IF;
  SELECT h.ready_at INTO v_was_ready FROM public.shop_handovers h WHERE h.order_id = o.id;
  -- A retake replaces the photo but keeps the first ready time (the clock never moves later) and tells nobody again.
  INSERT INTO public.shop_handovers (order_id, ready_photo_path, ready_at) VALUES (o.id, p_photo_path, now())
  ON CONFLICT (order_id) DO UPDATE
    SET ready_photo_path = COALESCE(EXCLUDED.ready_photo_path, public.shop_handovers.ready_photo_path),
        ready_at = COALESCE(public.shop_handovers.ready_at, EXCLUDED.ready_at)
   WHERE public.shop_handovers.confirmed_at IS NULL;
  IF v_was_ready IS NOT NULL THEN
    RETURN jsonb_build_object('result', 'ready', 'order_id', o.id);
  END IF;
  -- H5 review note: the ready notice says the buyer's 48 hours. Left out, they run from the later of this photo and
  -- the start of the ready date (shop_handover_sweep (a)), so the notice names that exact moment, Louisiana time.
  PERFORM public.declutter_notify(o.buyer_id, 'payment', 'Your order is ready',
    CASE WHEN o.handover_mode = 'porch'
      THEN format('Your order for %s is left out for you. Tap "I got it" when you have it. If it isn''t there, tap "I didn''t get it" by %s; after that the shop is paid.',
                  to_char(o.ready_date, 'FMMonth FMDD'),
                  to_char((greatest(now(), (o.ready_date::timestamp AT TIME ZONE 'America/Chicago')) + interval '48 hours') AT TIME ZONE 'America/Chicago',
                          'FMDay, FMMonth FMDD at FMHH12:MI AM'))
      ELSE format('Your order for %s is ready to pick up at the shop. Tap "I got it" when you have it. Once the shop marks it handed over, you have 48 hours to tap "I didn''t get it" if you don''t have it; after that the shop is paid.', to_char(o.ready_date, 'FMMonth FMDD'))
    END,
    '/shops/orders', o.seller_id);
  RETURN jsonb_build_object('result', 'ready', 'order_id', o.id);
END;
$fn$;
REVOKE ALL ON FUNCTION public.shops_mark_ready(p_order_id uuid, p_photo_path text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.shops_mark_ready(p_order_id uuid, p_photo_path text) TO authenticated, service_role;

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
     ORDER BY o.ready_date, o.id LIMIT 200
  LOOP
    BEGIN
      INSERT INTO public.shop_handovers (order_id) VALUES (r.id) ON CONFLICT (order_id) DO NOTHING;
      IF r.held_admin_at IS NULL AND r.held_from + interval '60 days' <= now() THEN
        -- H5 review note: like Declutter's system problem (20261102084222), the order gets an open problem, so it
        -- sits in admin > Shops orders' problems with the reason, and no tap pays or refunds it until an admin decides.
        UPDATE public.shop_handovers
           SET held_admin_at = now(), held_nudged_at = now(),
               problem_at = COALESCE(problem_at, now()),
               problem_note = COALESCE(problem_note,
                 'Nobody has said anything about this handover for 60 days, so the money is still held. Neither side confirmed it or reported a problem. Decide who gets the money.')
         WHERE order_id = r.id;
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
