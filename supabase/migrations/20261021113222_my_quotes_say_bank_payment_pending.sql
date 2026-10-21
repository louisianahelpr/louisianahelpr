-- Q1877 (owner, 2026-10-21): "show 'Bank payment pending' on the job while an ACH payment is settling (poster and
-- Helpr views), never shown as paid before it clears."
--
-- The poster's side already shows it (My Posts' PendingBankPayments card, 2026-10-17). The Helpr's side did not:
-- a quoter whose accepted quote was booked (book_accepted_quote stamps job_quote_requests.job_id BEFORE payment)
-- was told "It's booked. Open the job" while the poster had not paid, or while their bank payment was still
-- clearing. The quoter is only hired when the money lands (trg_quote_job_funded_hires_quoter, on payment_status).
--
-- get_my_job_quotes gains one column, job_payment, for an accepted quote with a job:
--   'paid'          the job's money is held or paid out (job_payment_is_funded, the same test the hire trigger uses);
--   'bank_pending'  the poster finished checkout by bank and it has not cleared (payment_status 'unpaid' with the
--                   PaymentIntent stored, stripe-webhook checkoutSessionCompleted's async branch);
--   'unpaid'        the money never landed (unpaid without a PaymentIntent, abandoned, failed): not booked yet;
--   'closed'        anything else (refunded, cancelled, chargeback, ...): the job is over, so it is not "paid for later".
-- NULL when there is no job. Nothing else in the body changes (prior md5 46492d733c5cd0e152ba176b414b2d66).
-- A new OUT column changes the return type, so the function is dropped and re-created with the same grants.
-- Proof: node src/test/pglite/myQuotesBankPaymentPending.pglite.mjs (red without the file, 3x apply).

DROP FUNCTION IF EXISTS public.get_my_job_quotes();

CREATE FUNCTION public.get_my_job_quotes()
 RETURNS TABLE(id uuid, request_id uuid, title text, parish text, date_needed date, price_cents integer, note text, available_note text, last_offer_side text, respond_until timestamp with time zone, status text, job_id uuid, offers jsonb, created_at timestamp with time zone, job_payment text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid;
BEGIN
  PERFORM public.require_feature('quotes');
  v_uid := (SELECT auth.uid());
  PERFORM public.quote_require_member();
  RETURN QUERY
    SELECT q.id, q.request_id, r.title, r.parish, r.date_needed, q.price_cents, q.note,
           q.available_note, q.last_offer_side, q.respond_until,
           public.quote_display_status(q.status, q.respond_until),
           CASE WHEN q.status = 'accepted' THEN r.job_id ELSE NULL END,
           COALESCE((SELECT jsonb_agg(jsonb_build_object('by', o.by_side, 'price_cents', o.price_cents,
                                                         'note', o.note, 'at', o.created_at)
                                      ORDER BY o.created_at)
                       FROM public.job_quote_offers o WHERE o.quote_id = q.id), '[]'::jsonb),
           q.created_at,
           CASE
             WHEN q.status <> 'accepted' OR r.job_id IS NULL THEN NULL
             WHEN public.job_payment_is_funded(j.payment_status) THEN 'paid'
             WHEN j.status::text = 'cancelled' THEN 'closed'
             WHEN j.payment_status = 'unpaid' AND j.stripe_payment_intent_id IS NOT NULL THEN 'bank_pending'
             WHEN j.payment_status IN ('unpaid', 'abandoned', 'failed') THEN 'unpaid'
             ELSE 'closed'
           END
      FROM public.job_quotes q
      JOIN public.job_quote_requests r ON r.id = q.request_id
      LEFT JOIN public.jobs j ON j.id = r.job_id
     WHERE q.quoter_id = v_uid
     ORDER BY q.updated_at DESC
     LIMIT 100;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_my_job_quotes() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_job_quotes() TO authenticated, service_role;
