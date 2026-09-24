-- VC-008: 20260829031405 added claim_idv_attempt(uuid, integer, boolean) but
-- never dropped the (uuid, integer) version. Both default p_max_attempts, so a
-- 1- or 2-argument call matches both and fails with 42725 "function is not
-- unique". stripe-idv-start only works because it names p_skip_fee_gate.
-- The 2-argument version has no caller; drop it.
DROP FUNCTION IF EXISTS public.claim_idv_attempt(uuid, integer);
