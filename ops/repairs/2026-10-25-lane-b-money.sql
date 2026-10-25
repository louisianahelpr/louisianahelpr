-- Lane B (money and live test traffic) production repairs, 2026-10-25.
--
-- WHO RUNS IT: the lead, ONLY after the owner approves, against prod
-- (fncmgoasalhdgfwzhsqa) in the Supabase SQL editor. Nothing here has been run.
-- Each section is its own transaction: run the PRECONDITION select first, and
-- run the section only when it returns exactly what is written beside it.
-- Every write sits in a DO block that checks its own row count and RAISES
-- (rolling the whole block back) on anything but the expected number, so
-- pasting a section whole can never commit a partial repair.
-- Every UPDATE is pinned to the exact ids and to the state measured on
-- 2026-10-25, so a row that has moved since matches nothing.
--
-- Section 3 is a Stripe write (one live API call), not SQL. It is written out
-- here so it is reviewed in the same place.
--
-- Item 1 (fees rewritten on 11f8b084 / 9c6ff2de): NO DATA REPAIR. The rewrite
-- was migration 20261021142508, an owner decision (2026-10-21) the lead kept
-- on 2026-10-25. The poster side (customer_fee_amount) was left as charged on
-- purpose. New guard: migration 20261025161802.
-- Item 2 (28f8cff5, $8.00 sent): NO REPAIR. Owner whole-dollar payout rule
-- (Q236): payout_transfers 45a186b8 records amount_cents 800,
-- platform_fee_cents 120, metadata.rounding_remainder_cents 80 (= 1000).
-- Item 3 (expiry refunds): NO MONEY REPAIR. Both refunds follow the owner's
-- rules (card fee kept; on 1251173a the 49c is the sales tax on the kept
-- $4.33, Q2082 (a)). Only the ledger text was wrong; section 4 corrects it.

-- ─────────────────────────────────────────────────────────────────────────
-- 1. Job 2c8480ae stuck mid-cancel (item 4). A test-account job (is_seed,
--    helpr-e2e-poster-0902) paid in Stripe TEST mode: $4.11 on card
--    (pi_3UTeAbKp2H4b7tEC197EOvkI, amount_refunded 0, Stripe GET test mode
--    2026-10-25) plus gift aae90f0b ($40.89, redeemed on this job).
--    cancel_escrow claimed it 2026-10-23 08:50Z, Stripe answered 400 "This
--    account is not currently able to refund charges", and the claim stayed
--    'cancelling' (fixed in create-payment: a refused refund hands its claim
--    back). The expiry cron then set status 'cancelled' (2026-10-24 05:00Z).
--    Nothing settles cancelled/cancelling. Put it back to cancelled/escrow:
--    the hourly void-cancelled-payments sweep then refunds the card part less
--    the card fee and gives the gift back, as for any cancelled funded job.
--    BEFORE running: confirm in Stripe TEST mode that
--    pi_3UTeAbKp2H4b7tEC197EOvkI still shows amount_refunded 0.
-- PRECONDITION (expect exactly 1 row: cancelled | cancelling | cancel_escrow):
SELECT j.status, j.payment_status, c.claimed_by
  FROM public.jobs j
  LEFT JOIN public.job_refund_claims c ON c.job_id = j.id
 WHERE j.id = '2c8480ae-b1c6-4820-b5e1-c081c708b85f';

DO $repair$
DECLARE n int;
BEGIN
  UPDATE public.jobs
     SET payment_status = 'escrow'
   WHERE id = '2c8480ae-b1c6-4820-b5e1-c081c708b85f'
     AND status = 'cancelled'
     AND payment_status = 'cancelling'
     AND stripe_payment_intent_id = 'pi_3UTeAbKp2H4b7tEC197EOvkI';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'repair 1: jobs UPDATE matched % rows, expected 1 (nothing written)', n; END IF;
  DELETE FROM public.job_refund_claims
   WHERE job_id = '2c8480ae-b1c6-4820-b5e1-c081c708b85f'
     AND claimed_by = 'cancel_escrow';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'repair 1: job_refund_claims DELETE matched % rows, expected 1 (nothing written)', n; END IF;
END
$repair$;
-- AFTER the next hourly sweep: payment_status 'refunded', a payment_refunds
-- row (source void_cancelled_payments), gift aae90f0b back to 'sent'.

-- ─────────────────────────────────────────────────────────────────────────
-- 2. Gift purchases left 'pending' after their checkout expired (item 6).
--    REQUIRES migration 20261025161801_gift_purchase_expiry_settles (it
--    allows payment_status 'abandoned'); run only after db-deploy applied it:
--      SELECT pg_get_constraintdef(oid) FROM pg_constraint
--       WHERE conname = 'gift_cards_payment_status_check';  -- must list 'abandoned'
--    The 20 rows were marked status 'expired' by the checkout.session.expired
--    webhook itself (Stripe said the session expired); no money moved on any
--    (stripe_payment_intent_id NULL on all 20; Stripe GET of the newest,
--    cs_live_a1T41VGw...: status expired, payment_status unpaid).
-- PRECONDITION (expect 20):
SELECT count(*) FROM public.gift_cards
 WHERE payment_status = 'pending' AND status = 'expired' AND stripe_payment_intent_id IS NULL
   AND id IN (
     '4dc47e4b-073f-47e0-b2e7-92b22aca79a3', 'b939f931-a062-405d-a557-3fe2bcc15a1d',
     '11df3423-d4ed-4fc6-a7cc-32542859578c', '7cbf6e33-6c3f-4b98-b33e-fb93e7fb00f5',
     '356136d0-21ac-4ae9-b8b3-afe61fe4045c', '5d585517-45dd-4584-97b7-2a5c66e36c4f',
     'ed6047ce-d69c-4905-8acf-44c55670ac50', '0a8d2cf4-9b01-4336-97b1-5715ca22199a',
     '52c71966-a947-4a08-83dd-730f772b46db', '171038d5-88a8-4ebd-acf1-e5d486472702',
     'e688a854-8ef6-4058-9657-c17ec3563fe2', 'a1fb2460-c72c-438b-a711-3c387dff5c59',
     'f5335556-0eac-4241-8ee0-e299d2e27410', '90adbded-f1cb-4e77-964e-0e6a6bfa4cf6',
     'd9f9b2bd-e81a-47a1-bec0-511ae328ac22', 'e9fc8898-7170-46fe-b52c-c80aa78f569e',
     '8fc1c826-9100-4df7-96dd-8020041b0d4c', '2cbffa82-2f38-4c6f-aa75-9ccd98a43288',
     'ffed548d-ed32-4039-8029-a5f45fc835fa', '54354c8e-8493-475d-94d0-8335d0cf44ce'
   );

DO $repair$
DECLARE n int;
BEGIN
UPDATE public.gift_cards
   SET payment_status = 'abandoned'
 WHERE payment_status = 'pending' AND status = 'expired' AND stripe_payment_intent_id IS NULL
   AND id IN (
     '4dc47e4b-073f-47e0-b2e7-92b22aca79a3', 'b939f931-a062-405d-a557-3fe2bcc15a1d',
     '11df3423-d4ed-4fc6-a7cc-32542859578c', '7cbf6e33-6c3f-4b98-b33e-fb93e7fb00f5',
     '356136d0-21ac-4ae9-b8b3-afe61fe4045c', '5d585517-45dd-4584-97b7-2a5c66e36c4f',
     'ed6047ce-d69c-4905-8acf-44c55670ac50', '0a8d2cf4-9b01-4336-97b1-5715ca22199a',
     '52c71966-a947-4a08-83dd-730f772b46db', '171038d5-88a8-4ebd-acf1-e5d486472702',
     'e688a854-8ef6-4058-9657-c17ec3563fe2', 'a1fb2460-c72c-438b-a711-3c387dff5c59',
     'f5335556-0eac-4241-8ee0-e299d2e27410', '90adbded-f1cb-4e77-964e-0e6a6bfa4cf6',
     'd9f9b2bd-e81a-47a1-bec0-511ae328ac22', 'e9fc8898-7170-46fe-b52c-c80aa78f569e',
     '8fc1c826-9100-4df7-96dd-8020041b0d4c', '2cbffa82-2f38-4c6f-aa75-9ccd98a43288',
     'ffed548d-ed32-4039-8029-a5f45fc835fa', '54354c8e-8493-475d-94d0-8335d0cf44ce'
   );
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 20 THEN RAISE EXCEPTION 'repair 2: gift_cards UPDATE matched % rows, expected 20 (nothing written)', n; END IF;
END
$repair$;

-- ─────────────────────────────────────────────────────────────────────────
-- 3. The failed ACH payment on job 7440a72d (item 5). STRIPE WRITE, live mode.
--    pi_3UPmYCKp2H4b7tEC07QmgrHJ: us_bank_account debit failed
--    insufficient_funds (R01), status requires_payment_method,
--    amount_received 0 (Stripe GET live, 2026-10-25). The job is already
--    cancelled / payment_status 'failed' (no DB change). Cancelling the
--    PaymentIntent moves no money; it only closes it. The webhook now does
--    this itself for new failures (paymentIntentPaymentFailed.ts).
--    Run once, with the live secret key, from a shell (never commit the key):
--      curl https://api.stripe.com/v1/payment_intents/pi_3UPmYCKp2H4b7tEC07QmgrHJ/cancel \
--        -u "$STRIPE_SECRET_KEY:" \
--        -H "Idempotency-Key: cancel-failed-bank-payment-pi_3UPmYCKp2H4b7tEC07QmgrHJ" \
--        -d cancellation_reason=abandoned
--    expect: "status": "canceled".
-- PRECONDITION (expect 1 row: cancelled | failed | pi_3UPmYCKp2H4b7tEC07QmgrHJ):
SELECT status, payment_status, stripe_payment_intent_id
  FROM public.jobs WHERE id = '7440a72d-50a9-4a70-a877-c73f02db71d7';

-- ─────────────────────────────────────────────────────────────────────────
-- 4. The two expiry refunds' ledger text (item 3). The amounts are right;
--    the reason named a cancellation fee and a service fee that were never
--    kept. Rewritten to what the fixed code now writes.
-- PRECONDITION (expect 2 rows, both 'cancellation refund (minus cancellation + service fee)'):
SELECT id, job_id, amount_cents, reason FROM public.payment_refunds
 WHERE id IN ('6b4bcb5a-46a9-4d17-8ef2-334c7c896768', 'c703b10e-2cf2-4f43-8f3f-988245422ed3');

DO $repair$
DECLARE n int;
BEGIN
UPDATE public.payment_refunds
   SET reason = 'cancellation refund (minus $2.48 card processing fee)'
 WHERE id = '6b4bcb5a-46a9-4d17-8ef2-334c7c896768'
   AND job_id = '375000de-81ae-48fd-810c-362d33e60f3b'
   AND amount_cents = 7252
   AND reason = 'cancellation refund (minus cancellation + service fee)';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'repair 4: 375000de refund reason matched % rows, expected 1 (nothing written)', n; END IF;
UPDATE public.payment_refunds
   SET reason = 'cancellation refund (minus $4.33 card processing fee and $0.49 sales tax on what was kept)'
 WHERE id = 'c703b10e-2cf2-4f43-8f3f-988245422ed3'
   AND job_id = '1251173a-e30c-498c-891f-cf5c2d705bdf'
   AND amount_cents = 13424
   AND reason = 'cancellation refund (minus cancellation + service fee)';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'repair 4: 1251173a refund reason matched % rows, expected 1 (nothing written)', n; END IF;
END
$repair$;
