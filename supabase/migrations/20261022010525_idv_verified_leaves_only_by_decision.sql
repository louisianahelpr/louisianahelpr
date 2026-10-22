-- A VERIFIED ID STAYS VERIFIED until a decision or an admin moves it.
--
-- What broke (member 7bb3a91e, measured on prod 2026-10-22): Stripe Identity
-- verified him at 2026-10-21 13:54:22Z, then delivered the OLDER
-- identity.verification_session.processing event 1.6 s later
-- (stripe_webhook_events: verified evt_1USzyDK... processed 13:54:22.273,
-- processing evt_1USzyBK... processed 13:54:23.876). The stripe-idv-webhook
-- deployed then wrote every event with an unguarded
-- `.update(...).eq("user_id")`, so the late 'processing' overwrote 'verified'
-- (helper_verifications: verified -> processing at 13:54:24.012Z). His paid
-- job's "On the way" step is ID-gated, so a verified member was blocked by an
-- event about a check that had already passed.
--
-- The webhook's own guard (077a2fd0fc: NOT IN (verified, failed) plus the
-- session match) closes that one writer. This closes the CLASS at the table:
-- whichever code path, edge function or RPC writes it, a profile whose
-- idv_status is 'verified' can move only to 'failed' (a decision: an admin's
-- idv_reject, or the webhook's retained-ban refusal). Any other value
-- ('processing', 'pending', 'manual_review', 'not_started', 'skipped', NULL)
-- raises 42501, unless the transaction set lh.idv_admin_reset = 'on', which
-- only admin_idv_request_reupload() below does (service_role only; called by
-- admin-user-actions request_id_reupload). Loud, not a silent pin: a writer
-- that tries it fails and alerts instead of reporting success.
--
-- The trigger is named zz_ so it fires after every other BEFORE UPDATE
-- trigger on profiles and judges the final NEW row.
--
-- REPLAY-SAFETY: CREATE OR REPLACE + DROP TRIGGER IF EXISTS; nothing here
-- depends on a later migration.

CREATE OR REPLACE FUNCTION public.profiles_idv_verified_is_final()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $fn$
BEGIN
  IF OLD.idv_status = 'verified'
     AND NEW.idv_status IS DISTINCT FROM 'verified'
     AND NEW.idv_status IS DISTINCT FROM 'failed'
     AND COALESCE(current_setting('lh.idv_admin_reset', true), '') <> 'on' THEN
    RAISE EXCEPTION 'idv_verified_is_final: a verified ID moves only to failed or by an admin (was verified, asked %)',
      COALESCE(NEW.idv_status, 'NULL')
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$fn$;

REVOKE ALL ON FUNCTION public.profiles_idv_verified_is_final() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS zz_profiles_idv_verified_is_final ON public.profiles;
CREATE TRIGGER zz_profiles_idv_verified_is_final
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  WHEN (OLD.idv_status = 'verified' AND NEW.idv_status IS DISTINCT FROM OLD.idv_status)
  EXECUTE FUNCTION public.profiles_idv_verified_is_final();

-- The one admin way back to "you may start a check": request_id_reupload.
-- Same write admin-user-actions made directly (status not_started, the attempt
-- count reset so the new check can be claimed, the admin's note as the
-- reason), plus the old session cleared so a late event from it can never be
-- matched to this member again (the webhook's session match, Q2323), with the reset flag set for this transaction only. Returns the
-- number of rows written (0 = no such profile). service_role only.
CREATE OR REPLACE FUNCTION public.admin_idv_request_reupload(p_user_id uuid, p_note text)
RETURNS integer
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_rows integer;
BEGIN
  IF p_user_id IS NULL THEN
    RETURN 0;
  END IF;
  PERFORM set_config('lh.idv_admin_reset', 'on', true);
  UPDATE public.profiles
     SET idv_status = 'not_started',
         idv_attempt_count = 0,
         idv_session_id = NULL,
         idv_failure_reason = COALESCE(NULLIF(p_note, ''), 'ID document was unclear. Please re-upload.')
   WHERE user_id = p_user_id;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  PERFORM set_config('lh.idv_admin_reset', '', true);
  RETURN v_rows;
END;
$fn$;

REVOKE ALL ON FUNCTION public.admin_idv_request_reupload(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_idv_request_reupload(uuid, text) TO service_role;
