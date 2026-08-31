-- Clients may no longer write to `tips`. Only the payment path may.
--
-- The INSERT policy was `WITH CHECK (auth.uid() = tipper_id)` and nothing
-- else — it constrained WHO the row claims to be from, but not the amount and
-- not the payment status. So any signed-in user could POST a tip row with
-- `payment_status: 'paid'` and any amount they liked, without a cent moving.
--
-- Reproduced against prod on 2026-08-31 with an ordinary user JWT and the
-- publishable key:
--
--   POST /rest/v1/tips
--   {"tipper_id":"<self>","helper_id":"<other>","amount":9999,
--    "payment_status":"paid","job_id":"<a real job>"}
--   -> 201 Created
--
-- The forged row fired a real "You got a $9999 tip!" notification to the
-- helper and counted toward the earnings figure that useProfileTabData.ts
-- reads. (Row and notification deleted; `tips?amount=eq.9999` -> [].)
--
-- The honest path already exists: `create-payment` writes the pending row and
-- `stripe-webhook` flips it to paid, both with the service role, which RLS
-- does not apply to. Client INSERT was never needed.

DROP POLICY IF EXISTS "Users can insert tips" ON public.tips;

-- Defence in depth: even a future service-role bug cannot store a negative,
-- zero, or absurd tip, and payment_status is constrained to the three states
-- the code actually uses. The server already rejects >$1000 (create-payment),
-- so this mirrors that ceiling at the storage layer rather than inventing one.
ALTER TABLE public.tips DROP CONSTRAINT IF EXISTS tips_amount_positive;
ALTER TABLE public.tips
  ADD CONSTRAINT tips_amount_positive
  CHECK (amount > 0 AND amount <= 1000) NOT VALID;

ALTER TABLE public.tips DROP CONSTRAINT IF EXISTS tips_payment_status_valid;
ALTER TABLE public.tips
  ADD CONSTRAINT tips_payment_status_valid
  CHECK (payment_status IN ('pending', 'paid', 'failed')) NOT VALID;

-- NOT VALID on both: they apply to every new row immediately but do not
-- re-check history, so a legacy row outside these bounds cannot block the
-- migration. Validate later once the existing data is confirmed clean:
--   ALTER TABLE public.tips VALIDATE CONSTRAINT tips_amount_positive;

-- Revoke the write grants themselves, not just the policy — belt and braces,
-- so re-adding a permissive policy by accident still cannot grant INSERT.
REVOKE INSERT, UPDATE, DELETE ON public.tips FROM authenticated, anon;
GRANT SELECT ON public.tips TO authenticated;
GRANT ALL ON public.tips TO service_role;

COMMENT ON TABLE public.tips IS
  'Written ONLY by create-payment (pending) and stripe-webhook (paid), both service-role. Clients have SELECT only — a client INSERT policy let anyone forge a paid tip (fixed 2026-08-31).';
