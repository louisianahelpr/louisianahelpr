-- Declutter trades prompt (owner decision 2026-11-08). Trades (20261106163703) are live, but 0 of 265 live listings
-- took trades, because "Open to trades" is OFF by default on every listing and in the seller's listing defaults.
--
-- The owner asked for a one-time card on the seller's Selling tab: "Turn on trades for all your listings?" with
-- [Turn on] and [Not now]. Either answer is remembered on the account (not on one phone), so the card never comes back.
--
--   declutter_seller_defaults.trades_prompt_answered_at   when the member answered the card (NULL = not yet).
--   declutter_trades_prompt_answer(p_turn_on)             the card's two buttons, for the CALLER only:
--     true  -> every one of the caller's LIVE, PRICED listings that is not open to trades turns on, and the caller's
--              listing default turns on (so a new listing starts open to trades too). Returns how many listings changed.
--     false -> nothing changes but the answer (an "on" default stays on). Returns 0.
--
-- Turning trades ON never touches open trade offers or money offers (only OFF voids trade offers, in
-- declutter_set_trade_rules); free listings are claimed, never traded, so they are skipped, as are drafts, paused,
-- reserved and sold listings.
--
-- AUTHZ: SECURITY DEFINER, the caller only: require_feature('declutter'), the ban gate, then
-- declutter_assert_member(true), which refuses a NULL caller (so there is no NULL-uid branch here), and every write is
-- WHERE seller_id / member_id = that caller. No id comes from the client. REVOKE ... FROM PUBLIC, anon.
-- Replay-safe: ADD COLUMN IF NOT EXISTS, CREATE OR REPLACE, grants restated.
-- Proof: src/test/pglite/declutterTradesPrompt.pglite.mjs. Guard: src/test/declutterTradesPrompt.test.ts.

ALTER TABLE public.declutter_seller_defaults ADD COLUMN IF NOT EXISTS trades_prompt_answered_at timestamptz;

CREATE OR REPLACE FUNCTION public.declutter_trades_prompt_answer(p_turn_on boolean)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid;
  v_n integer := 0;
BEGIN
  PERFORM public.require_feature('declutter');
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  v_uid := public.declutter_assert_member(true);
  IF p_turn_on IS NULL THEN
    RAISE EXCEPTION 'invalid_trade_rules' USING ERRCODE = '22023';
  END IF;
  IF p_turn_on THEN
    UPDATE public.declutter_items i
       SET accepts_trades = true, updated_at = now()
     WHERE i.seller_id = v_uid
       AND i.status = 'live'
       AND i.price_cents > 0
       AND i.current_price_cents > 0
       AND NOT i.accepts_trades;
    GET DIAGNOSTICS v_n = ROW_COUNT;
  END IF;
  INSERT INTO public.declutter_seller_defaults AS d (member_id, accepts_trades, trades_prompt_answered_at, updated_at)
  VALUES (v_uid, p_turn_on, now(), now())
  ON CONFLICT (member_id) DO UPDATE
    SET accepts_trades = d.accepts_trades OR p_turn_on,
        trades_prompt_answered_at = now(),
        updated_at = now();
  RETURN v_n;
END;
$fn$;

REVOKE ALL ON FUNCTION public.declutter_trades_prompt_answer(boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_trades_prompt_answer(boolean) TO authenticated, service_role;
