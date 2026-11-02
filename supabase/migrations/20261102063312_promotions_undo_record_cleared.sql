-- Q2159 (lh-authz-rls review of resubscribe v3, 2026-10-15, and the v4
-- re-review). An email's unsubscribe link offers "Resubscribe" as an undo
-- (Q2092, owner 2026-10-15: "Only undo what they turned off"). The undo
-- record, profiles.promotions_before_unsubscribe, is written by the FIRST
-- unsubscribe through a link and was cleared only by a resubscribe or the
-- takeover wipe. Its 'untouched' check asked only whether both flags are off
-- NOW. So a member who unsubscribed through a link, then turned marketing
-- consent back ON in Settings and OFF again, still had the old record; a
-- Resubscribe from the old email (anyone holding it: the token never expires)
-- then re-granted the consent the member had just withdrawn in Settings.
--
-- THE FIX, three parts:
--   1. Any change to profiles.marketing_consent or
--      notification_preferences.email_promotions that is NOT the unsubscribe
--      link's own write clears the record. The member's later choice, from
--      Settings, sign-up or anywhere else, always wins over an old link: the
--      link may undo only the change it made itself. Clearing can only
--      under-restore (the safe direction). The link's own writes mark
--      themselves with the transaction-local setting app.promotions_undo_write
--      = '1' (set and cleared around each write, as wipe_pre_verification_account
--      does with app.pre_verification_wipe). No client can set it: PostgREST
--      runs each request in its own transaction and exposes no set_config.
--   2. promotions_unsubscribe(p_user_id): the link's opt-out, in ONE
--      transaction with the profile and preferences rows locked. It records
--      what it turns off (the first record while both flags stay off; a fresh
--      one when the member turned something back on since) and turns both off.
--      Two racing opt-outs serialise on the row lock, so neither records the
--      half-off state, and an old record never survives an opt-out whose read
--      succeeded (v4 note: "clear an old record in the opt-out UPDATE").
--   3. promotions_resubscribe(p_user_id): the undo, in ONE transaction
--      (SELECT ... FOR UPDATE): restores exactly the record and clears it, but
--      only while both flags are still what the opt-out left (off); otherwise
--      it clears the record and writes nothing else (v4 note: "make the
--      untouched check and the trailing email_promotions write atomic").
--
-- Both RPCs are for the email-unsubscribe edge function (service role) only:
-- REVOKE FROM PUBLIC, anon, authenticated.
--
-- REPLAY-SAFETY: CREATE OR REPLACE for every function; DROP TRIGGER IF EXISTS
-- before each CREATE TRIGGER; grants restated by role name. Every object this
-- reads exists since 20261019010447 (the column) and 20260312023604
-- (notification_preferences.user_id UNIQUE).

-- ── 1. The record is cleared by any other change ──────────────────────────
CREATE OR REPLACE FUNCTION public.clear_promotions_undo_on_consent_change()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $fn$
BEGIN
  IF NEW.marketing_consent IS DISTINCT FROM OLD.marketing_consent
     AND current_setting('app.promotions_undo_write', true) IS DISTINCT FROM '1' THEN
    NEW.promotions_before_unsubscribe := NULL;
  END IF;
  RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION public.clear_promotions_undo_on_consent_change() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_clear_promotions_undo_on_consent_change ON public.profiles;
CREATE TRIGGER trg_clear_promotions_undo_on_consent_change
  BEFORE UPDATE OF marketing_consent ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.clear_promotions_undo_on_consent_change();

-- SECURITY DEFINER: a member's own Settings write must be able to clear a
-- column no client may UPDATE (it is in profiles_locked_update_columns()).
CREATE OR REPLACE FUNCTION public.clear_promotions_undo_on_promotions_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
BEGIN
  IF current_setting('app.promotions_undo_write', true) IS DISTINCT FROM '1'
     AND (TG_OP = 'INSERT' OR NEW.email_promotions IS DISTINCT FROM OLD.email_promotions) THEN
    UPDATE public.profiles
       SET promotions_before_unsubscribe = NULL
     WHERE user_id = NEW.user_id
       AND promotions_before_unsubscribe IS NOT NULL;
  END IF;
  RETURN NULL;
END;
$fn$;
REVOKE ALL ON FUNCTION public.clear_promotions_undo_on_promotions_change() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_clear_promotions_undo_on_promotions_change ON public.notification_preferences;
CREATE TRIGGER trg_clear_promotions_undo_on_promotions_change
  AFTER INSERT OR UPDATE OF email_promotions ON public.notification_preferences
  FOR EACH ROW EXECUTE FUNCTION public.clear_promotions_undo_on_promotions_change();

-- ── 2. The link's opt-out ─────────────────────────────────────────────────
-- Returns the record it leaves. Raises profile_not_found (P0002) when the
-- user has no profile, so the caller never reports an opt-out that landed
-- nowhere. A missing preferences row is recorded as promotions ON: every
-- sender reads a missing row as on.
CREATE OR REPLACE FUNCTION public.promotions_unsubscribe(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_consent boolean;
  v_saved   jsonb;
  v_promo   boolean;
  v_has_row boolean;
  v_record  jsonb;
BEGIN
  SELECT p.marketing_consent, p.promotions_before_unsubscribe
    INTO v_consent, v_saved
    FROM public.profiles p
   WHERE p.user_id = p_user_id
     FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'profile_not_found' USING ERRCODE = 'P0002';
  END IF;

  SELECT np.email_promotions INTO v_promo
    FROM public.notification_preferences np
   WHERE np.user_id = p_user_id
     FOR UPDATE;
  v_has_row := FOUND;
  IF NOT v_has_row THEN
    v_promo := true;
  END IF;

  v_record := jsonb_build_object('marketing_consent', v_consent IS TRUE,
                                 'email_promotions', to_jsonb(v_promo));
  -- The first record stands while nothing commercial is on (a second link
  -- press, or one after the first). If the member turned something back on
  -- since, the record is what this opt-out turns off NOW.
  IF v_saved IS NOT NULL AND NOT (v_consent IS TRUE OR v_promo IS TRUE) THEN
    v_record := v_saved;
  END IF;

  PERFORM set_config('app.promotions_undo_write', '1', true);
  UPDATE public.profiles
     SET marketing_consent = false,
         promotions_before_unsubscribe = v_record
   WHERE user_id = p_user_id;
  INSERT INTO public.notification_preferences (user_id, email_promotions)
  VALUES (p_user_id, false)
  ON CONFLICT (user_id) DO UPDATE SET email_promotions = false;
  PERFORM set_config('app.promotions_undo_write', '0', true);

  RETURN v_record;
END;
$fn$;
REVOKE ALL ON FUNCTION public.promotions_unsubscribe(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.promotions_unsubscribe(uuid) TO service_role;

-- ── 3. The link's undo ────────────────────────────────────────────────────
-- Returns 'nothing_to_undo' (no record: the link never turned anything off,
-- so NOTHING is written and consent never given stays off), 'kept_later_choice'
-- (the member changed a flag since: the record is cleared, nothing else) or
-- 'restored'. Restores exactly: consent to the recorded value; promotions to
-- true, or back to NULL (never chosen) for a recorded NULL, never true; a
-- recorded false stays the false the opt-out left.
CREATE OR REPLACE FUNCTION public.promotions_resubscribe(p_user_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_consent   boolean;
  v_saved     jsonb;
  v_promo     boolean;
  v_untouched boolean;
BEGIN
  SELECT p.marketing_consent, p.promotions_before_unsubscribe
    INTO v_consent, v_saved
    FROM public.profiles p
   WHERE p.user_id = p_user_id
     FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'profile_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_saved IS NULL THEN
    RETURN 'nothing_to_undo';
  END IF;

  SELECT np.email_promotions INTO v_promo
    FROM public.notification_preferences np
   WHERE np.user_id = p_user_id
     FOR UPDATE;
  -- No row reads as promotions on: not what the opt-out left.
  v_untouched := FOUND AND v_consent IS FALSE AND v_promo IS FALSE;

  PERFORM set_config('app.promotions_undo_write', '1', true);
  IF v_untouched THEN
    UPDATE public.profiles
       SET marketing_consent = (v_saved ->> 'marketing_consent')::boolean IS TRUE,
           promotions_before_unsubscribe = NULL
     WHERE user_id = p_user_id;
    IF (v_saved ->> 'email_promotions')::boolean IS DISTINCT FROM false THEN
      UPDATE public.notification_preferences
         SET email_promotions = CASE WHEN (v_saved ->> 'email_promotions')::boolean THEN true END
       WHERE user_id = p_user_id;
    END IF;
  ELSE
    UPDATE public.profiles
       SET promotions_before_unsubscribe = NULL
     WHERE user_id = p_user_id;
  END IF;
  PERFORM set_config('app.promotions_undo_write', '0', true);

  RETURN CASE WHEN v_untouched THEN 'restored' ELSE 'kept_later_choice' END;
END;
$fn$;
REVOKE ALL ON FUNCTION public.promotions_resubscribe(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.promotions_resubscribe(uuid) TO service_role;
