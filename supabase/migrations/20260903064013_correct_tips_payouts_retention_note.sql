-- Correct the retention note on `tips` and `instant_payouts`.
--
-- THE DECISION IS UNCHANGED. Those user columns are still retained through
-- account deletion. What was wrong is the REASON written on the tables, and a
-- wrong reason on a money table is worth a migration of its own: the next
-- person to touch account deletion reads that comment as the finding of an
-- investigation and does not repeat it.
--
-- WHAT THE COMMENT CLAIMED: that giving these tables "the payout_transfers
-- treatment (SET NULL plus a helper_redacted_at stamp)" would require dropping
-- NOT NULL constraints.
--
-- WHY THAT IS WRONG: the payout_transfers treatment is an FK with
-- ON DELETE SET NULL. There is no FK on any of these columns to SET NULL.
-- Measured against prod:
--
--     public.tips              1 foreign key   — job_id, and only job_id
--     public.instant_payouts   0 foreign keys
--
-- `tips.tipper_id`, `tips.helper_id` and `instant_payouts.helper_id` are bare
-- uuid columns. They do not reference auth.users or profiles at all, so account
-- deletion was never going to cascade or null them by itself, and the mechanism
-- the comment named cannot be applied here for a reason simpler than the one it
-- gave. The NOT NULLs are real and would block a plain UPDATE to NULL — but
-- that is a different obstacle than the one recorded, and the comment presented
-- the harder-sounding one as settled fact.
--
-- THE ACTUAL REASON TO RETAIN, which is the better one and is what should have
-- been written: a financial record that cannot say who was paid is a worse
-- artifact than one holding a uuid whose account is gone. These rows carry
-- Stripe transfer and payout ids; reconciling a Stripe payout against a row
-- with a NULL recipient is not possible, and "who received this money" is
-- exactly the question a chargeback, a tax query or a dispute asks. Retention
-- here is a deliberate choice, not a constraint we failed to work around.
--
-- Found by the money lane re-auditing the account-deletion census (20260903035008).
-- Comments only — no schema change, no data change. Replay-safe by nature.

COMMENT ON TABLE public.tips IS
  'tipper_id and helper_id are RETAINED through account deletion, deliberately. '
  'A financial record that cannot say who was paid is a worse artifact than one '
  'holding a uuid whose account is gone: these rows carry Stripe ids, and '
  '"who received this money" is what a chargeback, a tax query or a dispute '
  'asks. NOTE, because the previous version of this comment got it wrong: there '
  'is no FK on either column (this table has exactly one FK, job_id), so the '
  'payout_transfers ON DELETE SET NULL treatment does not apply here at all — '
  'the obstacle is the NOT NULL, not a foreign key. Census: 20260903035008.';

COMMENT ON TABLE public.instant_payouts IS
  'helper_id is RETAINED through account deletion, deliberately, for the same '
  'reason as public.tips: a payout row that cannot name its recipient cannot be '
  'reconciled against Stripe. NOTE: this table has ZERO foreign keys, so the '
  'payout_transfers ON DELETE SET NULL treatment does not apply — the previous '
  'version of this comment cited a constraint that does not exist. '
  'Census: 20260903035008.';
