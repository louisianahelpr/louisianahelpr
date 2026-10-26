-- Board 120 "Pause my account" (owner 2026-10-25: "build the gaps"), behind the hidden switch
-- 'account_pause' (testers first; the owner flips it in Admin -> Settings).
--
-- WHAT A PAUSE DOES (and only this, so the screen can say it truthfully):
--   - the member's live Declutter listings come down (status 'paused', marked paused_by_account), open
--     offers on them close with the same notice the per-listing pause sends (board 158);
--   - their profile page shows others "This member has paused their account" (account_is_paused);
--   - Resume puts those listings back live (only the ones the pause took down) and clears the flag.
-- WHEN IT IS REFUSED: the pause-own-account edge function first runs the SAME active-work check as
-- account deletion (_shared/accountPurge.ts findActiveWork: booked or disputed jobs, held or pending
-- money, a running series, a Declutter or Shops order underway, money owed to the member, a live
-- refund request) and also refuses while the member has an open job posted. Only then does it call
-- account_pause_apply() with the service role. So a pause never hides someone mid-deal.
--
-- Columns: profiles.paused_at (no UPDATE grant to authenticated: profiles uses column grants, so a
-- member cannot set it directly and skip the checks) and declutter_items.paused_by_account.
-- Functions: account_pause_apply(uuid) service_role only; account_resume() and
-- account_is_paused(uuid) for authenticated. All require_feature('account_pause') except
-- account_is_paused, which is a read of one flag that must keep working (and reads false for
-- everyone) when the switch is off. REVOKE FROM PUBLIC, anon throughout. Replay-safe.

INSERT INTO public.feature_switches (key, audience, description)
VALUES ('account_pause', 'testers', 'You › Settings: Pause my account (board 120)')
ON CONFLICT (key) DO NOTHING;

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS paused_at timestamptz;
ALTER TABLE public.declutter_items ADD COLUMN IF NOT EXISTS paused_by_account boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.account_pause_apply(p_user_id uuid)
RETURNS integer
LANGUAGE plpgsql
VOLATILE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_item record;
  r record;
  v_n integer := 0;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'user_required' USING ERRCODE = '22023';
  END IF;
  -- The feature is decided for THE MEMBER, not the service caller.
  IF NOT public.feature_enabled_for_user('account_pause', p_user_id) THEN
    RAISE EXCEPTION 'feature_disabled' USING ERRCODE = '42501';
  END IF;
  FOR v_item IN
    SELECT id, title FROM public.declutter_items WHERE seller_id = p_user_id AND status = 'live' FOR UPDATE
  LOOP
    FOR r IN
      UPDATE public.declutter_offers
         SET status = 'voided', closed_at = now(), updated_at = now()
       WHERE item_id = v_item.id AND status = 'open'
      RETURNING id, buyer_id
    LOOP
      INSERT INTO public.declutter_offer_events (offer_id, actor_side, action) VALUES (r.id, 'system', 'void');
      PERFORM public.declutter_notify(r.buyer_id, 'new_offers', 'Item paused',
        format('The seller paused "%s", so your offer is closed. Nothing was charged.', v_item.title),
        '/declutter?view=offers', p_user_id);
    END LOOP;
    UPDATE public.declutter_items SET status = 'paused', paused_by_account = true, updated_at = now() WHERE id = v_item.id;
    v_n := v_n + 1;
  END LOOP;
  UPDATE public.profiles SET paused_at = now() WHERE user_id = p_user_id AND paused_at IS NULL;
  RETURN v_n;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.account_resume()
RETURNS integer
LANGUAGE plpgsql
VOLATILE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_n integer;
BEGIN
  PERFORM public.require_feature('account_pause');
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  -- Only what the account pause took down; a listing the member paused by hand stays paused.
  UPDATE public.declutter_items
     SET status = 'live', paused_by_account = false, updated_at = now()
   WHERE seller_id = v_uid AND status = 'paused' AND paused_by_account;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  -- A listing that left 'paused' some other way keeps no stale mark.
  UPDATE public.declutter_items SET paused_by_account = false WHERE seller_id = v_uid AND paused_by_account;
  UPDATE public.profiles SET paused_at = NULL WHERE user_id = v_uid;
  RETURN v_n;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.account_is_paused(p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
  SELECT coalesce((SELECT p.paused_at IS NOT NULL FROM public.profiles p WHERE p.user_id = p_user_id LIMIT 1), false)
     AND (SELECT auth.uid()) IS NOT NULL
$fn$;

REVOKE ALL ON FUNCTION public.account_pause_apply(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.account_resume() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.account_is_paused(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.account_pause_apply(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.account_resume() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.account_is_paused(uuid) TO authenticated, service_role;
