-- Board 120 "Pause my account" (owner 2026-10-25: "build the gaps"). On for everyone, no switch
-- (owner rule 2026-10-25: these ship on for everyone).
--
-- WHAT A PAUSE DOES (and only this, so the screen can say it truthfully):
--   - the member's live Declutter listings come down (status 'paused', marked paused_by_account), open
--     offers on them close with the same notice the per-listing pause sends (board 158);
--   - their profile PAGE (/user/:id) shows others "This member has paused their account"
--     (account_is_paused); names in chats, reviews and job lists are unchanged;
--   - Resume puts those listings back live (only the ones the pause took down) and clears the flag.
-- WHEN IT IS REFUSED: the pause-own-account edge function first runs the SAME active-work check as
-- account deletion (_shared/accountPurge.ts findActiveWork: booked or disputed jobs, held or pending
-- money, a running series, a Declutter or Shops order underway, money owed to the member, a live
-- refund request) and also refuses while the member has an open job posted. Only then does it call
-- account_pause_apply() with the service role, which re-checks the races it can see in SQL under a
-- per-member advisory lock (an open job posted, a reserved or sold listing) and raises active_work,
-- so a booking made between the edge check and the apply cannot be hidden (authz review 2026-10-26).
--
-- Columns: profiles.paused_at (no UPDATE grant to authenticated: profiles uses column grants, so a
-- member cannot set it directly and skip the checks; the INSERT policy now also requires it NULL)
-- and declutter_items.paused_by_account.
-- Functions: account_pause_apply(uuid) service_role only; account_resume() and
-- account_is_paused(uuid) for authenticated. REVOKE FROM PUBLIC, anon throughout. Replay-safe.

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS paused_at timestamptz;
ALTER TABLE public.declutter_items ADD COLUMN IF NOT EXISTS paused_by_account boolean NOT NULL DEFAULT false;

-- A member's own first profile row cannot arrive paused (restated from prod's pg_policies
-- 2026-10-26 with one added clause, paused_at IS NULL).
DROP POLICY IF EXISTS "Users can insert their own profile" ON public.profiles;
CREATE POLICY "Users can insert their own profile" ON public.profiles
  FOR INSERT TO authenticated
  WITH CHECK (
    ((SELECT auth.uid() AS uid) = user_id)
    AND ((ban_status IS NULL) OR (ban_status = 'active'::text))
    AND (idv_status IS NULL)
    AND (subscription_tier IS NULL)
    AND (stripe_account_id IS NULL)
    AND (onboarding_fee_paid = false)
    AND (email_verified = false)
    AND (legacy_manual_review = false)
    AND (license_status = 'none'::text)
    AND (insurance_status = 'none'::text)
    AND (license_expires_at IS NULL)
    AND (insurance_expires_at IS NULL)
    AND (is_licensed = false)
    AND (is_insured = false)
    AND (background_check_status = 'none'::text)
    AND (stripe_identity_verified = false)
    AND (apple_original_transaction_id IS NULL)
    AND (is_seed = false)
    AND (paused_at IS NULL)
  );

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
  -- One pause at a time per member, and the races the edge check cannot see, re-checked here.
  PERFORM pg_advisory_xact_lock(hashtextextended('account_pause:' || p_user_id::text, 0));
  IF EXISTS (SELECT 1 FROM public.jobs j WHERE j.customer_id = p_user_id AND j.status = 'open')
     OR EXISTS (SELECT 1 FROM public.declutter_items i WHERE i.seller_id = p_user_id AND i.status IN ('reserved', 'sold')) THEN
    RAISE EXCEPTION 'active_work' USING ERRCODE = 'P0001';
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
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  -- The profile first, so nothing below can leave the member stuck paused.
  UPDATE public.profiles SET paused_at = NULL WHERE user_id = v_uid;
  -- Only what the account pause took down; a listing the member paused by hand stays paused. Only
  -- when the listing gate would pass (declutter_identity_gate's own rule), so the identity trigger
  -- can never roll the resume back; otherwise the listing stays paused for the member to relist.
  IF public.has_role(v_uid, 'admin') OR public.identity_check_exempt(v_uid) OR public.is_identity_verified(v_uid) THEN
    UPDATE public.declutter_items
       SET status = 'live', paused_by_account = false, updated_at = now()
     WHERE seller_id = v_uid AND status = 'paused' AND paused_by_account;
    GET DIAGNOSTICS v_n = ROW_COUNT;
  ELSE
    v_n := 0;
  END IF;
  -- No stale marks (a listing that left 'paused' some other way, or one kept paused above).
  UPDATE public.declutter_items SET paused_by_account = false WHERE seller_id = v_uid AND paused_by_account;
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
