-- Q1927 (lh-money-escrow review of 905501cb2 #3; lead 11-03): a Declutter refund that gives up still leaves the
-- seller's card-fee debt for it. That is right when the team refunds by hand, which the gave-up alert asks for
-- (20261017055500), and an admin can clear the debt when no refund will be made (Q1928's
-- declutter_admin_waive_fee_debt, 20261102065446, the "Clear what's left" button under the member's "Owed from Declutter refunds"). The
-- alert did not say so. Now its detail line does. Copy only: the function is otherwise byte-for-byte the
-- 20261017055500 body (prod md5 prosrc b901f02d..., functiondef 35189c1f...). The ledger fingerprint is the title
-- before ' — ', which is unchanged, so open items keep matching.
-- Replay-safe: CREATE OR REPLACE; grants restated (service_role only, as live).

CREATE OR REPLACE FUNCTION public.declutter_refund_gave_up_check(p_refund_id uuid DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  r record;
  v_n integer := 0;
BEGIN
  FOR r IN
    SELECT d.id, d.order_id, d.refund_cents, d.attempts, d.is_seed, d.last_error, d.gave_up_notified_at, o.buyer_id
      FROM public.declutter_refunds d
      LEFT JOIN public.declutter_orders o ON o.id = d.order_id
     WHERE d.status = 'failed' AND d.attempts >= 12
       AND (p_refund_id IS NULL OR d.id = p_refund_id)
     ORDER BY d.created_at
     LIMIT 200
  LOOP
    v_n := v_n + 1;
    IF to_regclass('public.error_logs') IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.error_logs e
       WHERE jsonb_typeof(e.tags) = 'object'
         -- A client-written row never mutes this alert (Q1159: anon/authenticated may INSERT error_logs).
         AND coalesce(e.tags ->> 'origin', '') <> 'client'
         AND e.tags ->> 'source' = 'declutter-refund-gave-up'
         AND e.tags ->> 'refund_id' = r.id::text
         AND e.created_at > date_trunc('day', now())
    ) THEN
      -- One ledger item for every gave-up refund (the title before ' — ' is
      -- the fingerprint); the detail names this row.
      INSERT INTO public.error_logs (severity, message, tags, context)
      VALUES ('error',
              -- CHANGED (Q1927): the detail also says how to clear the seller's card-fee debt when no refund will be made.
              format('Declutter refund gave up after 12 tries: refund it by hand in Stripe — refund row %s ($%s, order %s). Last error: %s. If you decide not to refund, clear the seller''s card-fee debt for it: Admin, the seller''s page, Owed from Declutter refunds, Clear what''s left.',
                     r.id, to_char(r.refund_cents / 100.0, 'FM999990.00'), coalesce(r.order_id::text, 'none'),
                     coalesce(left(r.last_error, 200), 'none recorded')),
              jsonb_strip_nulls(jsonb_build_object('source', 'declutter-refund-gave-up', 'area', 'declutter',
                                                   'refund_id', r.id::text,
                                                   'seed', CASE WHEN r.is_seed THEN 'true' END)),
              jsonb_build_object('refund_id', r.id, 'order_id', r.order_id, 'refund_cents', r.refund_cents,
                                 'attempts', r.attempts));
    END IF;
    IF r.gave_up_notified_at IS NULL THEN
      UPDATE public.declutter_refunds SET gave_up_notified_at = now()
       WHERE id = r.id AND gave_up_notified_at IS NULL;
      IF FOUND THEN
        PERFORM public.declutter_notify(r.buyer_id, 'payment', 'Your refund is being sent by hand',
          format('We could not send your $%s refund to your card automatically, so our team is sending it by hand. You do not need to do anything. We will tell you when it is on its way.',
                 to_char(r.refund_cents / 100.0, 'FM999990.00')),
          '/declutter?view=cart');
      END IF;
    END IF;
  END LOOP;
  RETURN v_n;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_refund_gave_up_check(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_refund_gave_up_check(uuid) TO service_role;
