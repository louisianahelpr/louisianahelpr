-- Q2794: 16 members still point at payout accounts Stripe no longer has.
--
-- On 2026-10-23 Stripe rejected Helpr's platform account (commit 3240d7f6f0,
-- Q2370) and rejected 45 of its 46 connected accounts (owner decision
-- 2026-10-25, src/test/edge/stripeConnectNeedsHire.test.ts). Measured read-only
-- on 2026-11-15: the live Stripe API answers "does not have access to account
-- ... or does not exist" for every one of the ids below, while it still
-- retrieves the one member account that survived; GET /v1/accounts lists 2.
-- These ids belong to real members (profiles.is_seed false, no test_accounts
-- row) with stripe_payouts_enabled already false. None of them has money in
-- flight here: no payout_transfers, tips, Declutter or Shops payouts and no
-- open job as Helpr (read-only SQL, 2026-11-15).
--
-- stripe-connect clears such a link one member at a time, the next time that
-- member opens payout settings (confirmAndClearUnusableAccount), and each
-- clear files a 'stale-clear' row that pages ops: 16 such pages came from the
-- same one-time cause (10-25 to 11-13, ops ledger acf4ea2ff283). This clears
-- the remaining 16 at once, the same way the function does (the id and the
-- three cached gate columns), scoped to these exact ids on non-seed profiles,
-- and records each clear as a record-only row ('connect-dead-account-close',
-- which public.error_log_is_record_only keeps out of Slack and the ops
-- ledger, 20261103203658). A cleared member sets up payouts again through the
-- normal flow: stripe-connect onboard creates a fresh account when none is on
-- file (src/test/edge/payoutAccountsGoneSweep.test.ts).
--
-- Only the Stripe account ids are named here (no member ids: the repo is
-- public). Replay-safe: a second run finds no profile on these ids and does
-- nothing. Lead decision 2026-11-14 (by recommendation); lh-money-escrow
-- PASS-WITH-NOTES 2026-11-14 (its notes are in: a record row only for a clear
-- that happened; the identity column explained below). Proof: src/test/pglite/payoutAccountsGoneSweep.pglite.mjs.

DO $sweep$
DECLARE
  v_gone constant text[] := ARRAY[
    'acct_1UOeBtKTx3gTAzYu', 'acct_1UOi0CKgdC1HTodC', 'acct_1UOqSD3mL7DbYZBA', 'acct_1UOTs1KKWa8qFOdE',
    'acct_1UOvsj3vfbVNqT3v', 'acct_1UTA2NQRl4lMGohm', 'acct_1UTB8u3CbxMI2eaB', 'acct_1UTD4nQLMGxm6zvb',
    'acct_1UTEHI4GWkjtZd1E', 'acct_1UTG803yKEo5g5By', 'acct_1UTOISKSqSLYpYTN', 'acct_1UTPia44MmAFrwOh',
    'acct_1UTPLE3xtNPwS7Vz', 'acct_1UTSJ63nbm6TJBgM', 'acct_1UTVmEKn7LOOvZ0r', 'acct_1UTWGr4EHn5lXHkp'
  ];
  r record;
  v_n int;
BEGIN
  FOR r IN
    SELECT p.user_id, p.stripe_account_id
      FROM public.profiles p
     WHERE p.stripe_account_id = ANY (v_gone)
       AND p.is_seed IS NOT TRUE
     ORDER BY p.stripe_account_id
  LOOP
    -- The same four columns stripe-connect's own clear sets
    -- (confirmAndClearUnusableAccount): stripe_identity_verified is computed
    -- from this account's requirements, so it goes with the account.
    UPDATE public.profiles
       SET stripe_account_id = NULL,
           stripe_payouts_enabled = false,
           stripe_charges_enabled = false,
           stripe_identity_verified = false
     WHERE user_id = r.user_id
       AND stripe_account_id = r.stripe_account_id;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    -- A record only for a clear that happened.
    CONTINUE WHEN v_n = 0;

    INSERT INTO public.error_logs (user_id, severity, message, tags, context)
    VALUES (
      r.user_id,
      'info',
      format('migration cleared the link to payout account %s, gone from Stripe since the 2026-10-23 platform rejection', r.stripe_account_id),
      jsonb_build_object('source', 'stripe-connect', 'kind', 'connect-dead-account-close'),
      jsonb_build_object('old_account_id', r.stripe_account_id, 'new_account_id', NULL,
                         'by', '20261115033601_clear_payout_accounts_gone_with_platform_rejection', 'docs', 'docs/OPEN.md Q2794'));
  END LOOP;
END
$sweep$;
