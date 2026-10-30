-- DECLUTTER: "IF IT DOESN'T SELL, MAKE IT FREE AFTER __ DAYS" (owner request via the lead, finding OWN-FREE;
-- lead decisions 2026-10-30, ~/.lh-shots/b52-handoff/HANDOFF.md section F).
--
-- Replaces the fixed "Free on day 12" switch (20261027205327, Q2430) with a per-listing choice:
-- Never (the default for every new listing), 7, 14, 21 or 30 days.
--
-- - declutter_item_private.auto_free_days smallint, NULL = Never. The only values are 7, 14, 21, 30.
-- - Backfill (lead decision 1): a listing with "Free on day 12" ON moves to 14 days; OFF stays Never.
--   The backfill clears auto_free_day12 as it moves the row, so a replay never re-moves a row the seller
--   later set to Never. Nothing reads or writes auto_free_day12 after this migration (it stays false).
-- - declutter_set_auto_free_days(item, days) / declutter_auto_free_days_state(item): the seller's own
--   listing (draft, in review, live or paused), behind the 'declutter' switch, not for a banned caller;
--   choosing a day count is a selling choice (the member gate), choosing Never is not (as switching the
--   day-12 switch off was not, review #2 of 20261027205327); a free item has nothing to choose.
-- - declutter_set_auto_free / declutter_auto_free_state stay for app builds already installed (their
--   "Free on day 12" switch): ON keeps a chosen day count or picks 14, OFF is Never; the state reads
--   "a day count is chosen".
-- - declutter_auto_free_due() (the evening price-drop sweep's first step) restated from its EFFECTIVE prod
--   definition (read 2026-10-30 ~03:00Z with read-only SQL: md5(prosrc) ee4af95bb8e1d9212940f17ecefd0570,
--   md5(pg_get_functiondef) 9aafea7b5af0cd42004f771dac562447, equal to 20261027205327's body). Changes:
--     * the listing's own day count (make_interval(days => auto_free_days)) instead of 12 days;
--     * EVERY sale mode, not only 'offers' (lead decision 3);
--     * the claim re-reads the day count under the item lock: a seller who chose Never, or a later day,
--       while the sweep waited on the lock is respected;
--     * the seller's notice says the listing's own day count; "One more chance before haul-away" only
--       when that is still true (14 days or fewer: the haul-away offer comes on day 14; lead decision 2,
--       21 and 30 days are fine, the offer is separate).
--   Everything else is as it was: price and current price 0, a 0 floor, the stop cleared, open offers
--   closed and each buyer told once, the seller told, one failing item logged and the rest still done.
-- - declutter_price_drop_sweep is NOT restated: it calls declutter_auto_free_due() by name, unchanged.
--
-- Replay-safe: ADD COLUMN IF NOT EXISTS, a CHECK added only when missing, a backfill that clears its own
-- trigger, CREATE OR REPLACE. Grants by role name (REVOKE ... FROM PUBLIC, anon).
-- Proof: src/test/pglite/declutterAutoFreeDays.pglite.mjs (3x replay; NEW_MIGRATION=skip is red).
-- Guard: src/test/declutterAutoFreeDays.test.ts.

ALTER TABLE public.declutter_item_private ADD COLUMN IF NOT EXISTS auto_free_days smallint;
DO $do$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'declutter_item_private_auto_free_days_choice'
                   AND conrelid = 'public.declutter_item_private'::regclass) THEN
    ALTER TABLE public.declutter_item_private ADD CONSTRAINT declutter_item_private_auto_free_days_choice
      CHECK (auto_free_days IS NULL OR auto_free_days IN (7, 14, 21, 30));
  END IF;
END
$do$;
COMMENT ON COLUMN public.declutter_item_private.auto_free_days IS
  'OWN-FREE: the seller''s "If it doesn''t sell, make it free after N days" (7, 14, 21 or 30; NULL = Never, the default). Set only by declutter_set_auto_free_days (and the old declutter_set_auto_free); acted on by declutter_auto_free_due (the evening sweep).';
COMMENT ON COLUMN public.declutter_item_private.auto_free_day12 IS
  'Retired by 20261030030408 (moved to auto_free_days = 14). Always false; nothing reads it.';

-- Lead decision 1: day 12 ON -> 14 days. Clearing auto_free_day12 makes a replay a no-op.
UPDATE public.declutter_item_private
   SET auto_free_days = COALESCE(auto_free_days, 14), auto_free_day12 = false, updated_at = now()
 WHERE auto_free_day12;

-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.declutter_set_auto_free_days(p_item_id uuid, p_days integer)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid;
  v_item public.declutter_items%ROWTYPE;
BEGIN
  PERFORM public.require_feature('declutter');
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  IF p_days IS NOT NULL AND p_days NOT IN (7, 14, 21, 30) THEN
    RAISE EXCEPTION 'invalid_choice' USING ERRCODE = '22023';
  END IF;
  -- Choosing a day count is a selling choice (the member gate); choosing Never never is, so a seller who
  -- can no longer sell (3 strikes, under 18) can still stop it.
  IF p_days IS NOT NULL THEN
    v_uid := public.declutter_assert_member(true);
  ELSE
    v_uid := (SELECT auth.uid());
    IF v_uid IS NULL THEN
      RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
    END IF;
  END IF;
  SELECT * INTO v_item FROM public.declutter_items WHERE id = p_item_id AND seller_id = v_uid FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_item.status NOT IN ('draft', 'pending_review', 'live', 'paused') THEN
    RAISE EXCEPTION 'item_not_editable' USING ERRCODE = '22023';
  END IF;
  IF v_item.current_price_cents = 0 THEN
    RAISE EXCEPTION 'already_free' USING ERRCODE = '22023', HINT = 'This item is already free.';
  END IF;
  UPDATE public.declutter_item_private SET auto_free_days = p_days, auto_free_day12 = false, updated_at = now()
   WHERE item_id = p_item_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'P0002';
  END IF;
  RETURN p_days;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_set_auto_free_days(uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_set_auto_free_days(uuid, integer) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.declutter_auto_free_days_state(p_item_id uuid)
RETURNS integer
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_days integer;
BEGIN
  PERFORM public.require_feature('declutter');
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  SELECT p.auto_free_days INTO v_days
    FROM public.declutter_item_private p JOIN public.declutter_items i ON i.id = p.item_id
   WHERE p.item_id = p_item_id AND i.seller_id = v_uid;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'P0002';
  END IF;
  RETURN v_days; -- NULL = Never
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_auto_free_days_state(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_auto_free_days_state(uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- The old switch, for app builds already installed. Restated from 20261027205327 (prod md5(prosrc)
-- faca696bfedc06dd683e5aeaad4ed31d / 17c51b93dc8a92da19a415ffa508b2ea, read 2026-10-30): only the column changes.
CREATE OR REPLACE FUNCTION public.declutter_set_auto_free(p_item_id uuid, p_on boolean)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid;
  v_item public.declutter_items%ROWTYPE;
BEGIN
  PERFORM public.require_feature('declutter');
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  IF p_on IS NULL THEN
    RAISE EXCEPTION 'invalid_choice' USING ERRCODE = '22023';
  END IF;
  -- Turning it ON is a selling choice (the member gate); turning it OFF never is, so a seller who can
  -- no longer sell (3 strikes, under 18) can still stop it, as pausing a listing works (review #2).
  IF p_on THEN
    v_uid := public.declutter_assert_member(true);
  ELSE
    v_uid := (SELECT auth.uid());
    IF v_uid IS NULL THEN
      RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
    END IF;
  END IF;
  SELECT * INTO v_item FROM public.declutter_items WHERE id = p_item_id AND seller_id = v_uid FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_item.status NOT IN ('draft', 'pending_review', 'live', 'paused') THEN
    RAISE EXCEPTION 'item_not_editable' USING ERRCODE = '22023';
  END IF;
  IF v_item.current_price_cents = 0 THEN
    RAISE EXCEPTION 'already_free' USING ERRCODE = '22023', HINT = 'This item is already free.';
  END IF;
  -- ON keeps a day count already chosen, else 14 (lead decision 1); OFF is Never.
  UPDATE public.declutter_item_private
     SET auto_free_days = CASE WHEN p_on THEN COALESCE(auto_free_days, 14) END, auto_free_day12 = false, updated_at = now()
   WHERE item_id = p_item_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'P0002';
  END IF;
  RETURN p_on;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_set_auto_free(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_set_auto_free(uuid, boolean) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.declutter_auto_free_state(p_item_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_on boolean;
BEGIN
  PERFORM public.require_feature('declutter');
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  SELECT p.auto_free_days IS NOT NULL INTO v_on
    FROM public.declutter_item_private p JOIN public.declutter_items i ON i.id = p.item_id
   WHERE p.item_id = p_item_id AND i.seller_id = v_uid;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'P0002';
  END IF;
  RETURN v_on;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_auto_free_state(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_auto_free_state(uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.declutter_auto_free_due()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_n integer := 0;
  it record;
  o record;
  v_days integer;
  v_buyers uuid[];
  b uuid;
BEGIN
  FOR it IN
    SELECT i.id, i.title, i.seller_id, COALESCE(i.live_at, i.submitted_at, i.created_at) AS started
      FROM public.declutter_items i
      JOIN public.declutter_item_private p ON p.item_id = i.id
     WHERE p.auto_free_days IS NOT NULL
       AND i.status = 'live'
       AND NOT i.seller_hidden
       AND i.current_price_cents > 0
       AND COALESCE(i.live_at, i.submitted_at, i.created_at) + make_interval(days => p.auto_free_days) <= now()
     ORDER BY i.id
       FOR UPDATE OF i
  LOOP
    -- One item at a time: a failure frees nothing for that item and never undoes the evening's other
    -- work (review #4); it is logged where ops sees it.
    BEGIN
      -- Claim with a fresh read of the day count, under the item lock: a seller who chose Never, or a
      -- later day, while the sweep waited on the lock is respected (review #3).
      SELECT p.auto_free_days INTO v_days FROM public.declutter_item_private p WHERE p.item_id = it.id FOR UPDATE;
      CONTINUE WHEN v_days IS NULL OR it.started + make_interval(days => v_days) > now();
      UPDATE public.declutter_item_private
         SET floor_price_cents = 0, drop_stop_cents = NULL, auto_free_days = NULL, auto_free_day12 = false, updated_at = now()
       WHERE item_id = it.id;
      -- Open offers close: an offer must be below the price, and the item is now free to claim.
      v_buyers := '{}';
      FOR o IN
        UPDATE public.declutter_offers
           SET status = 'voided', closed_at = now(), updated_at = now()
         WHERE item_id = it.id AND status = 'open'
        RETURNING id, buyer_id
      LOOP
        INSERT INTO public.declutter_offer_events (offer_id, actor_side, action) VALUES (o.id, 'system', 'void');
        v_buyers := v_buyers || o.buyer_id;
      END LOOP;
      -- The watchers' "now free" notice: trg_declutter_items_price_drop_alert (Q2429).
      UPDATE public.declutter_items
         SET price_cents = 0, current_price_cents = 0, updated_at = now()
       WHERE id = it.id;
      -- Each buyer whose offer closed is told, unless the watchers' alert just told them (one notice,
      -- not two; and never none, e.g. a watcher over the daily alert cap: review #1).
      FOREACH b IN ARRAY v_buyers LOOP
        CONTINUE WHEN EXISTS (SELECT 1 FROM public.declutter_price_alerts a
                               WHERE a.item_id = it.id AND a.user_id = b AND a.sent_at = now());
        PERFORM public.declutter_notify(b, 'new_offers', 'Now free',
          format('"%s" is now free, so your offer is closed. Nothing was charged. You can claim it.', it.title),
          '/declutter/item/' || it.id::text, it.seller_id);
      END LOOP;
      PERFORM public.declutter_notify(it.seller_id, 'info', 'Your item is now free',
        format('"%s" didn''t sell in %s days, so it is now free, as you asked.%s', it.title, v_days,
          CASE WHEN v_days <= 14 THEN ' One more chance before haul-away.' ELSE '' END),
        '/declutter/item/' || it.id::text);
      v_n := v_n + 1;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'declutter_auto_free_due: item % not made free: %', it.id, SQLERRM;
      PERFORM public.log_cron_defect('declutter_auto_free_due', it.id::text, SQLERRM, '{}'::jsonb);
    END;
  END LOOP;
  RETURN v_n;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_auto_free_due() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_auto_free_due() TO service_role;
