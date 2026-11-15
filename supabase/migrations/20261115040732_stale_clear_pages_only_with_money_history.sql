-- Q2794: a stale payout-account clear pages ops only when the member has money history.
--
-- stripe-connect clears a payout-account link Stripe no longer has
-- (confirmAndClearUnusableAccount) and files a 'stale-clear' error_logs row,
-- which the Slack trigger posts and the ops ledger records. After Stripe
-- rejected the platform on 2026-10-23, 16 such clears paged one by one
-- (2026-10-25 to 11-13, ops ledger acf4ea2ff283), every one the system doing
-- its job for a member with nothing owed. The lh-money-escrow review
-- (2026-11-14) recommended a record for those and a page only when the member
-- has money history; the lead and the owner agreed (2026-11-14).
--
-- stripe-connect now tags each clear money_history true|false
-- (memberHasMoneyHistory in supabase/functions/_shared/connectRecord.ts: a row
-- for the member in any of MONEY_HISTORY_SOURCES, the 17 money tables the
-- lh-money-escrow review named: job, crew, cancellation-fee, tip, instant,
-- referral, Declutter, shipping-claim, Shops, delivery and provider money,
-- payee waits and holds; any failed or throwing read answers true). Here error_log_is_record_only also
-- reads a server-written 'stale-clear' row with money_history exactly 'false'
-- as record-only. A row without the tag (an older function), with true, or
-- from a client is unchanged: it still posts and records. The breaker that
-- counts this hour's clears counts every row as before.
--
-- error_log_is_record_only is restated from 20261103203658 (live prosrc md5
-- 0a6190b5e00cecb7568bf748bd568810 read 2026-11-15, equal to that file) with only that branch added. The Slack and ledger
-- triggers call it by name and are unchanged. Replay-safe: CREATE OR REPLACE.
-- Grants restated: service_role only.
-- Proof: src/test/pglite/connectRecordOnlyRowsNeverPage.pglite.mjs (the
-- stale-clear cases). Guard: src/test/connectRecordOnlyRowsNeverPage.test.ts.

CREATE OR REPLACE FUNCTION public.error_log_is_record_only(p_tags jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $fn$
  SELECT jsonb_typeof(p_tags) = 'object'
     AND coalesce(p_tags ->> 'origin', '') = 'server'
     AND coalesce(p_tags ->> 'source', '') = 'stripe-connect'
     AND (
       (coalesce(p_tags ->> 'kind', '') = 'stale-clear' AND coalesce(p_tags ->> 'money_history', '') = 'false')
       OR coalesce(p_tags ->> 'kind', '') IN ('connect-reset', 'connect-dead-account-close'));
$fn$;

REVOKE ALL ON FUNCTION public.error_log_is_record_only(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.error_log_is_record_only(jsonb) TO service_role;
