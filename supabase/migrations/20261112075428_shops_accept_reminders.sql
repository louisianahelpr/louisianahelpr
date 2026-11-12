-- S016 (Shops audit 11-12, Medium): nothing reminded a shop before its 24-hour answer deadline, so new orders dropped
-- silently. The needs-you reminder sweep (Declutter offers and refunds) now also reminds the shop about every order
-- waiting on its answer: about 12 hours before accept_by ("Answer the new order") and in the last 2 hours ("Order drops
-- soon"), with the sweep's own rules (quiet hours, at most 2 per order per Louisiana day, one per rung, test orders
-- skipped). Owner rule: reminders are never trimmed, on by default (the shop's Orders switch).
-- needs_you_reminder_sends.step CHECK (inline in 20261102002011) restated plus 'shop_order'.
-- sweep_needs_you_reminders RESTATED from 20261109224952_notices_card_fee_and_our_team.sql (newest CREATE); only the
-- S016 lines (one UNION ALL branch, its words, its notice) are new.
-- MONEY: none. AUTHZ: none new (service_role only, grants kept). REPLAY-SAFE: DROP/ADD CONSTRAINT, CREATE OR REPLACE.
-- Proof: src/test/pglite/shopsAcceptReminders.pglite.mjs (3x; NEW_MIGRATION=skip red; mutants).

ALTER TABLE public.needs_you_reminder_sends DROP CONSTRAINT IF EXISTS needs_you_reminder_sends_step_check;
ALTER TABLE public.needs_you_reminder_sends ADD CONSTRAINT needs_you_reminder_sends_step_check
  CHECK (step IN ('offer', 'refund_answer', 'refund_offer', 'shop_order'));

CREATE OR REPLACE FUNCTION public.sweep_needs_you_reminders(p_now timestamptz DEFAULT now())
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  r record;
  v_sent integer := 0;
  v_rung smallint;
  v_day_start timestamptz := date_trunc('day', p_now AT TIME ZONE 'America/Chicago') AT TIME ZONE 'America/Chicago';
  v_by text;
  v_title text;
  v_body text;
BEGIN
  IF public.needs_you_reminder_quiet(p_now) THEN
    RETURN 0;
  END IF;

  FOR r IN
    -- An open offer: the side it waits on answers by respond_by.
    SELECT 'offer'::text AS step, o.id AS ref_id, o.respond_by AS deadline,
           CASE WHEN o.awaiting = 'seller' THEN o.seller_id ELSE o.buyer_id END AS to_id,
           CASE WHEN o.awaiting = 'seller' THEN o.buyer_id ELSE o.seller_id END AS other_id,
           o.awaiting AS side,
           COALESCE(NULLIF(btrim(i.title), ''), 'your Declutter item') AS what
      FROM public.declutter_offers o
      LEFT JOIN public.declutter_items i ON i.id = o.item_id
     WHERE o.status = 'open' AND o.awaiting IN ('seller', 'buyer')
       AND o.respond_by IS NOT NULL AND o.respond_by > p_now AND o.respond_by <= p_now + interval '12 hours'
       AND COALESCE(o.is_seed, false) = false
    UNION ALL
    -- A refund request waiting on the seller's answer, or a refund offer waiting on the buyer's.
    SELECT CASE WHEN q.status = 'open' THEN 'refund_answer' ELSE 'refund_offer' END,
           q.id,
           CASE WHEN q.status = 'open' THEN q.answer_by ELSE q.offer_answer_by END,
           CASE WHEN q.status = 'open' THEN d.seller_id ELSE d.buyer_id END,
           CASE WHEN q.status = 'open' THEN d.buyer_id ELSE d.seller_id END,
           CASE WHEN q.status = 'open' THEN 'seller' ELSE 'buyer' END,
           COALESCE((SELECT NULLIF(btrim(i2.title), '') FROM public.declutter_cart_items c
                       JOIN public.declutter_items i2 ON i2.id = c.item_id
                      WHERE c.order_id = d.id ORDER BY c.created_at, c.id LIMIT 1), 'your Declutter item')
      FROM public.declutter_refund_requests q
      JOIN public.declutter_orders d ON d.id = q.order_id
     WHERE COALESCE(q.is_seed, false) = false
       AND ((q.status = 'open' AND q.answer_by > p_now AND q.answer_by <= p_now + interval '12 hours')
         OR (q.status = 'offered' AND q.offer_answer_by > p_now AND q.offer_answer_by <= p_now + interval '12 hours'))
    UNION ALL
    -- S016 (Shops audit 11-12): a Shops order waiting on the shop's answer by accept_by (24 h after the hold), or it drops.
    SELECT 'shop_order', so.id, so.accept_by, so.seller_id, so.buyer_id, 'seller',
           COALESCE(NULLIF(btrim(sh.name), ''), 'your shop')
      FROM public.shop_orders so
      JOIN public.shops sh ON sh.id = so.shop_id
     WHERE so.status = 'held' AND so.accept_by IS NOT NULL
       AND so.accept_by > p_now AND so.accept_by <= p_now + interval '12 hours'
       AND COALESCE(so.is_seed, false) = false
  LOOP
    CONTINUE WHEN r.to_id IS NULL;
    IF r.deadline <= p_now + interval '2 hours' THEN
      v_rung := 2;
    ELSE
      v_rung := 1;
    END IF;
    CONTINUE WHEN EXISTS (SELECT 1 FROM public.needs_you_reminder_sends s
                           WHERE s.user_id = r.to_id AND s.step = r.step AND s.ref_id = r.ref_id
                             AND s.deadline = r.deadline AND s.rung >= v_rung);
    -- At most 2 per member per item per Louisiana day (a reset deadline does not buy more).
    CONTINUE WHEN (SELECT count(*) FROM public.needs_you_reminder_sends s
                    WHERE s.user_id = r.to_id AND s.step = r.step AND s.ref_id = r.ref_id
                      AND s.sent_at >= v_day_start) >= 2;

    v_by := to_char(r.deadline AT TIME ZONE 'America/Chicago', 'FMHH12:MI AM')
            || CASE WHEN (r.deadline AT TIME ZONE 'America/Chicago')::date = (p_now AT TIME ZONE 'America/Chicago')::date
                    THEN ' today' ELSE ' tomorrow' END;
    IF r.step = 'offer' THEN
      v_title := CASE WHEN v_rung = 1 THEN 'Answer the offer' ELSE 'Offer closes soon' END;
      v_body := CASE WHEN r.side = 'seller'
        THEN format('An offer on "%s" is waiting on you. Next: accept, counter or decline by %s, or it expires.', r.what, v_by)
        ELSE format('The seller answered your offer on "%s". Next: accept, counter or decline by %s, or it expires.', r.what, v_by) END;
    ELSIF r.step = 'shop_order' THEN
      v_title := CASE WHEN v_rung = 1 THEN 'Answer the new order' ELSE 'Order drops soon' END;
      v_body := format('A new order at %s is waiting on you. Next: accept or decline it by %s, or it drops and the buyer''s hold is released.', r.what, v_by);
    ELSIF r.step = 'refund_answer' THEN
      v_title := CASE WHEN v_rung = 1 THEN 'Answer the refund request' ELSE 'Refund request closes soon' END;
      v_body := format('The buyer asked for a refund on "%s". Next: answer by %s, or our team decides.', r.what, v_by);
    ELSE
      v_title := CASE WHEN v_rung = 1 THEN 'Answer the refund offer' ELSE 'Refund offer closes soon' END;
      v_body := format('The seller offered part of a refund on "%s". Next: take it or ask our team to decide by %s, or our team decides.', r.what, v_by);
    END IF;

    BEGIN
      INSERT INTO public.needs_you_reminder_sends (user_id, step, ref_id, deadline, rung, sent_at)
      VALUES (r.to_id, r.step, r.ref_id, r.deadline, v_rung, p_now);
      IF r.step = 'offer' THEN
        PERFORM public.declutter_notify_strict(r.to_id, 'declutter_offers', v_title, v_body,
          CASE WHEN r.side = 'seller' THEN '/declutter?tab=selling' ELSE '/declutter?tab=buying' END, r.other_id);
      ELSIF r.step = 'shop_order' THEN
        -- Filed under the shop's Orders switch (declutter_notice_type: a /shops link is a Shops kind).
        PERFORM public.declutter_notify_strict(r.to_id, 'new_offers', v_title, v_body, '/shops/dashboard', r.other_id);
      ELSE
        PERFORM public.declutter_notify_strict(r.to_id, 'declutter_refunds', v_title, v_body,
          CASE WHEN r.side = 'seller' THEN '/declutter?tab=selling' ELSE '/declutter?tab=buying' END, r.other_id);
      END IF;
      v_sent := v_sent + 1;
    EXCEPTION WHEN OTHERS THEN
      -- The claim above rolls back with the notice, so the next run retries; recorded where ops reads.
      PERFORM public.log_cron_defect('sweep_needs_you_reminders', r.step || ':' || r.ref_id::text, SQLERRM,
        jsonb_build_object('user_id', r.to_id, 'step', r.step, 'ref_id', r.ref_id, 'rung', v_rung));
    END;
  END LOOP;
  RETURN v_sent;
END;
$function$;
