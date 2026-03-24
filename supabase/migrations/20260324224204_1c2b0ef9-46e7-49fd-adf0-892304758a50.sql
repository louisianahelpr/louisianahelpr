-- Fix payment_status for the "testing" job (PI already captured/succeeded) — use 'released' since funds were captured
UPDATE jobs SET payment_status = 'released' WHERE id = '7a6d2a87-b5a6-4f03-9232-eff3251226ef' AND payment_status = 'escrow';

-- Fix cancelled job with no payment intent — use 'cancelled'
UPDATE jobs SET payment_status = 'cancelled' WHERE id = '7b4a13ce-56b4-4047-a945-cba2f1fd1a4f' AND status = 'cancelled' AND payment_status = 'escrow' AND stripe_payment_intent_id IS NULL;