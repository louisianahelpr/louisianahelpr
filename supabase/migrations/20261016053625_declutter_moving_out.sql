-- Declutter moving-out mode (owner 2026-10-16; spec docs/specs/declutter-moving-out.md).
--
-- A seller who is moving photographs each room; the photo tool proposes one
-- listing per item it sees; the seller reviews them, adds each item's own
-- photos, and lists them together. Their profile then shows a "moving sale"
-- banner with the move-out date over those listings.
--
-- The risk this file is built around: a bulk path that skips a rule the
-- single-item path enforces. So nothing here re-implements a listing rule:
--   * declutter_create_move_drafts() creates each draft by CALLING
--     declutter_create_item() (the switch, ban, 3 strikes, under 18, the
--     $1,000 cap via the table constraint, the lowest-price rule, the
--     area-is-not-an-address rule, the contact-leak trigger), then only stamps
--     the move-out date on the row it made.
--   * Publishing stays one declutter_publish_item() call per item (photos 3-12,
--     payouts, the four tax confirmations, pickup times, the admin review
--     queue for a new seller's first 3 and for anything the AI flagged or did
--     not check). There is no bulk publish on the server at all.
--   * The room scan's AI cost is gated by declutter_assert_can_scan_room() (the
--     same member gates) inside the edge function, plus its own rate limit.
--
-- No new table: the move-out date is a column on the listing, so account
-- deletion (seller_id ON DELETE CASCADE) and Download My Data (to_jsonb of
-- every declutter_items row) already cover it.
--
-- Everything sits behind the hidden 'declutter_moving_out' switch, created at
-- 'testers', and every RPC also requires 'declutter'.
--
-- REPLAY-SAFE: ADD COLUMN / CREATE INDEX IF NOT EXISTS, CREATE OR REPLACE,
-- INSERT ... ON CONFLICT DO NOTHING. Applied 3x in PGlite
-- (src/test/pglite/declutterMovingOut.pglite.mjs).

-- 1. The hidden switch (testers only; going live is the owner's flip).
INSERT INTO public.feature_switches (key, audience, description)
VALUES ('declutter_moving_out', 'testers',
        'Declutter moving-out mode: list a whole home from room photos, a moving-sale banner on the seller''s profile.')
ON CONFLICT (key) DO NOTHING;

-- 2. The move-out date. NULL = an ordinary listing. Readable wherever the
--    listing is (the items read policy); written only by the RPCs below.
ALTER TABLE public.declutter_items ADD COLUMN IF NOT EXISTS move_out_on date;
CREATE INDEX IF NOT EXISTS declutter_items_moving_seller_idx
  ON public.declutter_items (seller_id) WHERE move_out_on IS NOT NULL;

-- 3. A move-out date the app accepts: today (Louisiana) to 180 days out.
CREATE OR REPLACE FUNCTION public.declutter_move_out_date_problem(p_move_out_on date)
RETURNS text
LANGUAGE sql
STABLE
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT CASE
    WHEN p_move_out_on IS NULL THEN 'invalid_move_out_date'
    WHEN p_move_out_on < (now() AT TIME ZONE 'America/Chicago')::date THEN 'invalid_move_out_date'
    WHEN p_move_out_on > (now() AT TIME ZONE 'America/Chicago')::date + 180 THEN 'invalid_move_out_date'
    ELSE NULL
  END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_move_out_date_problem(date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_move_out_date_problem(date) TO service_role;

-- 4. The room scan's gate (declutter-ai-draft mode 'room' calls it with the
--    caller's own token before spending on the model). Raises, or returns.
CREATE OR REPLACE FUNCTION public.declutter_assert_can_scan_room()
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
BEGIN
  PERFORM public.require_feature('declutter');
  PERFORM public.require_feature('declutter_moving_out');
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  -- Not signed in, 3 strikes, under 18: the selling gates.
  PERFORM public.declutter_assert_member(true);
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_assert_can_scan_room() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_assert_can_scan_room() TO authenticated, service_role;

-- 5. Several drafts at once, all with one move-out date and one pickup
--    address. p_items: [{title, description, category, condition_stars,
--    delivery_size, price_cents, floor_price_cents}, ...], 1 to 15 of them.
--    All or nothing: one refused item refuses the whole call (one
--    transaction), so the seller never ends up with half a room.
CREATE OR REPLACE FUNCTION public.declutter_create_move_drafts(
  p_move_out_on date,
  p_area_label text,
  p_pickup_address text,
  p_pickup_lat numeric,
  p_pickup_lng numeric,
  p_items jsonb
)
RETURNS uuid[]
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid;
  v_n integer;
  v_open integer;
  v_e jsonb;
  v_id uuid;
  v_ids uuid[] := ARRAY[]::uuid[];
BEGIN
  PERFORM public.require_feature('declutter');
  PERFORM public.require_feature('declutter_moving_out');
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  v_uid := public.declutter_assert_member(true);

  IF public.declutter_move_out_date_problem(p_move_out_on) IS NOT NULL THEN
    RAISE EXCEPTION 'invalid_move_out_date'
      USING ERRCODE = '22023', HINT = 'Pick a move-out date from today to 6 months from now.';
  END IF;

  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' THEN
    RAISE EXCEPTION 'invalid_items' USING ERRCODE = '22023';
  END IF;
  v_n := jsonb_array_length(p_items);
  IF v_n < 1 OR v_n > 15 THEN
    RAISE EXCEPTION 'too_many_items'
      USING ERRCODE = '22023', HINT = 'Save 1 to 15 items at a time.';
  END IF;

  -- Unfinished moving-sale drafts are capped (each one is a row and, once it
  -- has photos, storage): 60 is a full house; a 61st waits until some list.
  SELECT count(*)::integer INTO v_open
    FROM public.declutter_items
   WHERE seller_id = v_uid AND status = 'draft' AND move_out_on IS NOT NULL;
  IF v_open + v_n > 60 THEN
    RAISE EXCEPTION 'move_draft_limit'
      USING ERRCODE = '22023', HINT = 'List or delete some unfinished items first (60 at most).';
  END IF;

  -- Shape check of EVERY element before anything is written (a bad cast
  -- would otherwise surface as a raw 22P02).
  FOR v_e IN SELECT value FROM jsonb_array_elements(p_items) LOOP
    IF jsonb_typeof(v_e) <> 'object'
       OR jsonb_typeof(v_e->'title') IS DISTINCT FROM 'string'
       OR (v_e ? 'description' AND jsonb_typeof(v_e->'description') NOT IN ('string', 'null'))
       OR jsonb_typeof(v_e->'category') IS DISTINCT FROM 'string'
       OR jsonb_typeof(v_e->'delivery_size') IS DISTINCT FROM 'string'
       OR jsonb_typeof(v_e->'condition_stars') IS DISTINCT FROM 'number'
       OR jsonb_typeof(v_e->'price_cents') IS DISTINCT FROM 'number'
       OR jsonb_typeof(v_e->'floor_price_cents') IS DISTINCT FROM 'number'
       OR (v_e->>'condition_stars') !~ '^[0-9]{1,2}$'
       OR (v_e->>'price_cents') !~ '^[0-9]{1,9}$'
       OR (v_e->>'floor_price_cents') !~ '^[0-9]{1,9}$' THEN
      RAISE EXCEPTION 'invalid_items' USING ERRCODE = '22023';
    END IF;
  END LOOP;

  -- Each draft through the ONE create path, so every listing rule applies.
  FOR v_e IN SELECT value FROM jsonb_array_elements(p_items) LOOP
    v_id := public.declutter_create_item(
      v_e->>'title',
      COALESCE(v_e->>'description', ''),
      v_e->>'category',
      (v_e->>'condition_stars')::integer,
      v_e->>'delivery_size',
      (v_e->>'price_cents')::integer,
      (v_e->>'floor_price_cents')::integer,
      p_area_label,
      p_pickup_address,
      p_pickup_lat,
      p_pickup_lng);
    UPDATE public.declutter_items SET move_out_on = p_move_out_on
     WHERE id = v_id AND seller_id = v_uid AND status = 'draft';
    IF NOT FOUND THEN
      RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'P0002';
    END IF;
    v_ids := v_ids || v_id;
  END LOOP;

  RETURN v_ids;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_create_move_drafts(date, text, text, numeric, numeric, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_create_move_drafts(date, text, text, numeric, numeric, jsonb) TO authenticated, service_role;

-- 6. Move the date, or (NULL) end the moving sale: the banner goes, the
--    listings stay up as ordinary listings. Only the seller's own items that
--    are still in play (draft, waiting for review, for sale, reserved) change;
--    a sold or ended item keeps the date it sold under. Returns how many.
CREATE OR REPLACE FUNCTION public.declutter_set_move_out_date(p_move_out_on date)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid;
  v_n integer;
BEGIN
  PERFORM public.require_feature('declutter');
  PERFORM public.require_feature('declutter_moving_out');
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  v_uid := (SELECT auth.uid());
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF p_move_out_on IS NOT NULL AND public.declutter_move_out_date_problem(p_move_out_on) IS NOT NULL THEN
    RAISE EXCEPTION 'invalid_move_out_date'
      USING ERRCODE = '22023', HINT = 'Pick a move-out date from today to 6 months from now.';
  END IF;

  UPDATE public.declutter_items
     SET move_out_on = p_move_out_on, updated_at = now()
   WHERE seller_id = v_uid
     AND move_out_on IS NOT NULL
     AND status IN ('draft', 'pending_review', 'live', 'reserved');
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_set_move_out_date(date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_set_move_out_date(date) TO authenticated, service_role;
