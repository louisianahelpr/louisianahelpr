-- The buyer's notice from declutter_delivery_gave_up_check (20261102033730, Q1931: "Your refund is being sent by hand")
-- linked '/declutter?view=cart', a NEW ?view= link after Declutter audit DC-17 moved every notice to ?tab=selling /
-- ?tab=buying; declutterNoticeLinksOneFormat and helprDeliveryNoticesNameTheItem (exact two-way lists that only shrink)
-- went red on it. The notice goes to the BUYER (a delivery-fee or pay-raise refund), so it opens ?tab=buying.
-- Restated verbatim from 20261102033730 with that one link changed; grants restated. Replay-safe: CREATE OR REPLACE.
-- Proof: src/test/pglite/declutterDeliveryGaveUpCheck.pglite.mjs (applies this file after 20261102033730; FOLLOW=skip red).

CREATE OR REPLACE FUNCTION public.declutter_delivery_gave_up_check()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  r record;
  v_n integer := 0;
  v_dollars text;
BEGIN
  FOR r IN
    SELECT x.* FROM (
      SELECT 'helpr_payout'::text AS kind, p.id, p.helpr_id, NULL::uuid AS buyer_id, p.amount_cents AS cents, p.last_error,
             p.gave_up_notified_at, p.is_seed, p.task_id AS ref_id, p.created_at
        FROM public.helpr_task_payouts p
       WHERE p.status = 'failed' AND p.attempts >= 12
      UNION ALL
      SELECT 'delivery_refund', d.id, NULL::uuid, o.buyer_id, d.refund_cents, d.last_error, d.gave_up_notified_at, d.is_seed,
             d.order_id, d.created_at
        FROM public.declutter_delivery_refunds d
        LEFT JOIN public.declutter_orders o ON o.id = d.order_id
       WHERE d.status = 'failed' AND d.attempts >= 12
      UNION ALL
      SELECT 'raise_refund', g.id, NULL::uuid, o.buyer_id, g.refund_cents, g.refund_last_error, g.gave_up_notified_at, g.is_seed,
             g.order_id, g.created_at
        FROM public.declutter_delivery_raises g
        LEFT JOIN public.declutter_orders o ON o.id = g.order_id
       WHERE g.status = 'refunding' AND g.refund_attempts >= 12
    ) x
    ORDER BY x.created_at
    LIMIT 500
  LOOP
    v_n := v_n + 1;
    v_dollars := to_char(r.cents / 100.0, 'FM999990.00');
    -- Nested (not AND): plpgsql plans the inner statements only when the table exists.
    IF to_regclass('public.error_logs') IS NOT NULL THEN
      IF NOT EXISTS (
        SELECT 1 FROM public.error_logs e
         WHERE jsonb_typeof(e.tags) = 'object'
           AND coalesce(e.tags ->> 'origin', '') <> 'client'
           AND e.tags ->> 'source' = 'declutter-delivery-gave-up'
           AND e.tags ->> 'row_id' = r.id::text
           AND e.created_at > date_trunc('day', now())
      ) THEN
        -- One ledger item for every gave-up row (the title before ' — ' is the fingerprint).
        INSERT INTO public.error_logs (severity, message, tags, context)
        VALUES ('error',
                format('Declutter delivery money gave up after 12 tries: send it by hand in Stripe — %s %s ($%s, %s %s). Last error: %s',
                       r.kind, r.id, v_dollars, CASE WHEN r.kind = 'helpr_payout' THEN 'task' ELSE 'order' END,
                       coalesce(r.ref_id::text, 'none'), coalesce(left(r.last_error, 200), 'none recorded')),
                jsonb_strip_nulls(jsonb_build_object('source', 'declutter-delivery-gave-up', 'area', 'declutter',
                                                     'row_kind', r.kind, 'row_id', r.id::text,
                                                     'seed', CASE WHEN r.is_seed THEN 'true' END)),
                jsonb_build_object('row_kind', r.kind, 'row_id', r.id, 'ref_id', r.ref_id, 'cents', r.cents));
      END IF;
    END IF;
    IF r.gave_up_notified_at IS NULL THEN
      IF r.kind = 'helpr_payout' THEN
        UPDATE public.helpr_task_payouts SET gave_up_notified_at = now() WHERE id = r.id AND gave_up_notified_at IS NULL;
      ELSIF r.kind = 'delivery_refund' THEN
        UPDATE public.declutter_delivery_refunds SET gave_up_notified_at = now() WHERE id = r.id AND gave_up_notified_at IS NULL;
      ELSE
        UPDATE public.declutter_delivery_raises SET gave_up_notified_at = now() WHERE id = r.id AND gave_up_notified_at IS NULL;
      END IF;
      IF FOUND THEN
        IF r.kind = 'helpr_payout' AND r.helpr_id IS NOT NULL THEN
          PERFORM public.declutter_notify(r.helpr_id, 'payment', 'Your delivery pay is being sent by our team',
            format('We could not send your $%s delivery pay automatically, so our team is sending it. You do not need to do anything. We will tell you when it is on its way.',
                   v_dollars),
            '/profile?tab=earnings');
        ELSIF r.kind <> 'helpr_payout' AND r.buyer_id IS NOT NULL THEN
          PERFORM public.declutter_notify(r.buyer_id, 'payment', 'Your refund is being sent by hand',
            format('We could not send your $%s %s back to your card automatically, so our team is sending it by hand. You do not need to do anything. We will tell you when it is on its way.',
                   v_dollars, CASE WHEN r.kind = 'delivery_refund' THEN 'delivery fee' ELSE 'delivery pay raise' END),
            '/declutter?tab=buying');  -- CHANGED (DC-17 format): the buyer's side, not ?view=cart
        END IF;
      END IF;
    END IF;
  END LOOP;
  RETURN v_n;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_delivery_gave_up_check() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_delivery_gave_up_check() TO service_role;
