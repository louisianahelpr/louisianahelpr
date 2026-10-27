-- Q2416: anyone eligible may see and take a Declutter delivery WITHOUT payout setup (owner 2026-10-27,
-- issue #3675: "everyone signed up can take a delivery job. Even though their payout is not set up they
-- can still apply and pick up work; only once they are accepted for the job do they set it up").
--
-- Measured on prod 2026-10-27 (read-only): helpr_task_assert_helpr refused every member whose
-- helper_award_block_reason was not null (payout setup ONLY, no payout_after_hire carve-out), which
-- was 233 of 234 non-seed members, so "Deliver for pay" showed nothing to take and no delivery could
-- find a Helpr. Jobs already follow the owner's 2026-10-25 rule through helper_accept_missing (the
-- payout_after_hire switch, at everyone on prod): the accept waits on nothing, the pay waits for the
-- account.
--
-- The one edit: the readiness read is helper_accept_missing's payout step, so the delivery follows the
-- SAME switch as a job accept. With payout_after_hire on, payout setup no longer gates seeing, taking
-- or working a delivery; with it off, the old refusal comes back unchanged. The ID step stays where it
-- was (helpr_task_accept reads helper_accept_block_reason, which honours identity_check).
-- Money is unchanged: helpr_task_confirm already books the payout with or without an account and tells
-- a Helpr with none "Set up payouts in Settings to get your $N. We send it as soon as you do.", and
-- declutter-money defers a helpr_task payout with no account as 'no_account' (no try used) and reminds
-- the payee (payout_payee_wait_seen).
--
-- Body = 20261017055505's (md5(prosrc) 9ca10758ce71d18481ccbdab653e023b on prod, 2026-10-27) with only
-- the payout check replaced. Grants restated as live (postgres, service_role). Replay-safe.
CREATE OR REPLACE FUNCTION public.helpr_task_assert_helpr()
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_missing text[];
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  IF public.member_under_18(v_uid) THEN
    RAISE EXCEPTION 'under_18' USING ERRCODE = '42501', HINT = 'You must be 18 or older to deliver.';
  END IF;
  IF public.declutter_active_strike_count(v_uid) >= 3 THEN
    RAISE EXCEPTION 'declutter_strikes_blocked' USING ERRCODE = '42501';
  END IF;
  -- Payout setup gates a delivery only while the payout_after_hire switch is off for this member
  -- (helper_accept_missing, the one readiness read every accept uses); 'unknown' = no profile row.
  v_missing := public.helper_accept_missing(v_uid);
  IF 'unknown' = ANY (v_missing) OR 'payout_setup' = ANY (v_missing) THEN
    RAISE EXCEPTION 'payout_setup_incomplete' USING ERRCODE = '42501',
      HINT = 'Set up payouts in Settings before you take a delivery.';
  END IF;
  RETURN v_uid;
END;
$fn$;
REVOKE ALL ON FUNCTION public.helpr_task_assert_helpr() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.helpr_task_assert_helpr() TO service_role;
