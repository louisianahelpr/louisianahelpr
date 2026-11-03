-- Q2390 packet 39 (REGULAR packet: lead review): "not found" answers HTTP 404, not 500, for six Declutter functions
-- that still raised P0002 (owner rule 11-03: Jobs and Declutter first; no testers-only features):
--   declutter_create_move_drafts (2: an item in the list is not the seller's draft), declutter_link_haul_away (3: an
--   item is not the caller's; the job is not the caller's open unpaid job), declutter_pick_free_request (2: the ask is
--   missing or not on the giver's item), declutter_record_ai_check (service_role, declutter-ai-draft: the item is gone),
--   declutter_checkout_free (an item in the free cart is gone or hidden), declutter_start_checkout (an item in the cart
--   is gone or hidden; after the stale-line sweep in the same statement, which the raise rolls back as before).
-- An exception rolls back the whole statement, so the code change moves no write. The app, declutter-ai-draft and
-- declutter-checkout map by message, and declutter-checkout's rpcRefusal already answers 404 for PT404; no migration
-- catches P0002. No edge map changes, no deploy. PostgREST maps P0002 to 500; RAISE ... USING ERRCODE = 'PT404'
-- answers 404.
--
-- Each is restated VERBATIM from its newest migration copy, whose md5(prosrc) and md5(pg_get_functiondef) equal prod
-- (read 2026-11-03 by Builder 75; 1 overload each; grants as prod: authenticated + service_role, service_role only for
-- declutter_record_ai_check). The ONLY change: ERRCODE 'P0002' -> 'PT404'.
--   declutter_create_move_drafts  20261016053625 f887e5a7b2bc26de3c43764f84e6e7d9
--   declutter_link_haul_away      20261102050858 00ac80053f83f2ae499c3bf5b819f9e5
--   declutter_pick_free_request   20261102011547 0b1464f0dcdd090f79caded76dd040ab
--   declutter_record_ai_check     20261031152545 5895e9d8a524c77912ff3d1433d0d74d
--   declutter_checkout_free       20261031211922 d91507ed701c70b3a326369396323efa
--   declutter_start_checkout      20261101201500 1054a33d255aea937bb84884ad546dd5

-- declutter_create_move_drafts: restated from 20261016053625_declutter_moving_out.sql.
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
  -- One seller's calls are serialised so two at once cannot both pass.
  PERFORM pg_advisory_xact_lock(hashtext('declutter_move_drafts:' || v_uid::text));
  SELECT count(*)::integer INTO v_open
    FROM public.declutter_items
   WHERE seller_id = v_uid AND status = 'draft' AND in_moving_sale;
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
    UPDATE public.declutter_items SET in_moving_sale = true
     WHERE id = v_id AND seller_id = v_uid AND status = 'draft';
    IF NOT FOUND THEN
      RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'PT404';
    END IF;
    UPDATE public.declutter_item_private SET move_out_on = p_move_out_on
     WHERE item_id = v_id AND seller_id = v_uid;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'PT404';
    END IF;
    v_ids := v_ids || v_id;
  END LOOP;

  RETURN v_ids;
END;
$fn$;

REVOKE ALL ON FUNCTION public.declutter_create_move_drafts(date, text, text, numeric, numeric, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_create_move_drafts(date, text, text, numeric, numeric, jsonb) TO authenticated, service_role;

-- declutter_link_haul_away: restated from 20261102050858_declutter_haul_away_relink_touches_the_link.sql.
CREATE OR REPLACE FUNCTION public.declutter_link_haul_away(p_item_ids uuid[], p_job_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_ids uuid[];
  v_id uuid;
  v_item public.declutter_items%ROWTYPE;
  v_link public.declutter_haul_aways%ROWTYPE;
  v_hold text;
  v_addresses integer;
  r record;
BEGIN
  PERFORM public.require_feature('declutter');
  PERFORM public.require_feature('declutter_haul_away');
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  SELECT COALESCE(array_agg(DISTINCT x ORDER BY x), ARRAY[]::uuid[]) INTO v_ids
    FROM unnest(COALESCE(p_item_ids, ARRAY[]::uuid[])) x WHERE x IS NOT NULL;
  IF cardinality(v_ids) = 0 THEN
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'PT404';
  END IF;
  IF cardinality(v_ids) > 10 THEN
    RAISE EXCEPTION 'haul_away_too_many' USING ERRCODE = '22023';
  END IF;

  -- Lock order everywhere: items, then jobs, then link rows (undo and a job
  -- DELETE's SET NULL take the same order), so two tabs never deadlock.
  PERFORM 1 FROM public.declutter_items i WHERE i.id = ANY (v_ids) AND i.seller_id = v_uid ORDER BY i.id FOR UPDATE;

  -- Already done: every item is the caller's and already linked to this very
  -- job (Post a Job re-links before every retry of the payment hand-off).
  -- Answered as success BEFORE the job-state check, because by then the job
  -- may be funded (a gift card settles it inside create-payment, whose answer
  -- was lost): refusing would tell the app the booking failed for a job that
  -- holds money (re-review 2026-10-17, finding 1). Changes nothing; the job
  -- row is locked (items, then job: the lock order below), as the checks below lock it.
  -- '=' (never IS NOT DISTINCT FROM): a NULL job id, or a link whose job was
  -- deleted (job_id SET NULL), never counts as linked.
  IF p_job_id IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.jobs j WHERE j.id = p_job_id AND j.customer_id = v_uid FOR UPDATE)
     AND (SELECT count(*) FROM public.declutter_haul_aways h
            JOIN public.declutter_items i ON i.id = h.item_id AND i.seller_id = v_uid
           WHERE h.item_id = ANY (v_ids) AND h.job_id = p_job_id) = cardinality(v_ids)
     -- ... and the job hauls nothing else (else haul_away_job_taken below).
     AND NOT EXISTS (SELECT 1 FROM public.declutter_haul_aways h
                      WHERE h.job_id = p_job_id AND NOT (h.item_id = ANY (v_ids))) THEN
    -- Q2418: the re-link is recorded (link rows last, the lock order below), so the daily sweep, which undoes only
    -- a link untouched for 7 days, never puts the items back on sale under a retry that is about to pay.
    UPDATE public.declutter_haul_aways SET updated_at = now() WHERE item_id = ANY (v_ids) AND job_id = p_job_id;
    RETURN cardinality(v_ids);
  END IF;

  -- The caller's own OPEN, never-paid job (the link is made before payment;
  -- a funded job is never one), locked FOR UPDATE: it cannot be paid,
  -- cancelled or deleted under us, and two links to one job run one at a time
  -- (so "one job, one address" holds).
  IF NOT EXISTS (SELECT 1 FROM public.jobs j
                  WHERE j.id = p_job_id AND j.customer_id = v_uid AND j.status = 'open'
                    AND COALESCE(j.payment_status, 'unpaid') IN ('unpaid', 'abandoned', 'failed')
                  FOR UPDATE) THEN
    RAISE EXCEPTION 'haul_away_job_not_found' USING ERRCODE = 'PT404';
  END IF;
  -- One haul-away per job: a job already hauling OTHER items is refused.
  IF EXISTS (SELECT 1 FROM public.declutter_haul_aways h
              WHERE h.job_id = p_job_id AND NOT (h.item_id = ANY (v_ids))) THEN
    RAISE EXCEPTION 'haul_away_job_taken' USING ERRCODE = '22023';
  END IF;

  -- One trip, one address.
  SELECT count(DISTINCT lower(regexp_replace(p.pickup_address, '\s+', '', 'g')))::integer INTO v_addresses
    FROM public.declutter_item_private p WHERE p.item_id = ANY (v_ids) AND p.seller_id = v_uid;
  IF v_addresses > 1 THEN
    RAISE EXCEPTION 'haul_away_addresses_differ' USING ERRCODE = '22023';
  END IF;

  -- Items in id order (one lock order for every caller), each re-checked
  -- under its row lock: the screen's state is never trusted.
  FOREACH v_id IN ARRAY v_ids LOOP
    SELECT * INTO v_item FROM public.declutter_items i
     WHERE i.id = v_id AND i.seller_id = v_uid FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'PT404';
    END IF;

    -- Lock order: item, then job, then link row (as a job DELETE's ON DELETE
    -- SET NULL does: job, then link). The item lock already serializes every
    -- writer of this item's link; only that SET NULL can change it meanwhile.
    SELECT * INTO v_link FROM public.declutter_haul_aways h WHERE h.item_id = v_item.id;
    IF FOUND THEN
      IF v_link.job_id = p_job_id THEN
        -- Q2418: touched, as above.
        UPDATE public.declutter_haul_aways SET updated_at = now() WHERE item_id = v_item.id;
        CONTINUE;  -- this same post, linked again (retry)
      END IF;
      v_hold := public.declutter_haul_job_hold(v_link.job_id);
      IF v_hold = 'paying' THEN
        RAISE EXCEPTION 'haul_away_checkout_open' USING ERRCODE = '22023';
      ELSIF v_hold IN ('job_open', 'job_stuck') THEN
        RAISE EXCEPTION 'haul_away_job_open' USING ERRCODE = '22023';
      ELSIF v_hold <> 'none' THEN
        RAISE EXCEPTION 'haul_away_already_booked' USING ERRCODE = '22023';
      END IF;
      PERFORM 1 FROM public.declutter_haul_aways h WHERE h.item_id = v_item.id FOR UPDATE;
      -- The old job holds nothing: point the item at the new post. It stays
      -- off sale and keeps the status it had before.
      UPDATE public.declutter_haul_aways SET job_id = p_job_id, updated_at = now() WHERE item_id = v_item.id;
      CONTINUE;
    END IF;

    IF v_item.status IN ('reserved', 'sold', 'completed')
       OR EXISTS (SELECT 1 FROM public.declutter_cart_items c
                   WHERE c.item_id = v_item.id AND c.status IN ('in_cart', 'paid')) THEN
      RAISE EXCEPTION 'haul_away_in_sale' USING ERRCODE = '22023';
    END IF;
    IF v_item.status = 'live' THEN
      IF COALESCE(v_item.live_at, v_item.submitted_at, v_item.created_at) + interval '14 days' > now() THEN
        RAISE EXCEPTION 'haul_away_too_soon' USING ERRCODE = '22023';
      END IF;
    ELSIF v_item.status <> 'ended' THEN
      RAISE EXCEPTION 'haul_away_not_unsold' USING ERRCODE = '22023';
    END IF;

    -- Its open offers close now (buyers told, nothing charged), as when the
    -- seller takes an item down (B46).
    FOR r IN
      UPDATE public.declutter_offers
         SET status = 'voided', closed_at = now(), updated_at = now()
       WHERE item_id = v_item.id AND status = 'open'
      RETURNING id, buyer_id
    LOOP
      INSERT INTO public.declutter_offer_events (offer_id, actor_side, action) VALUES (r.id, 'system', 'void');
      PERFORM public.declutter_notify(r.buyer_id, 'new_offers', 'Item off sale',
        format('"%s" is off sale now, so your offer is closed. Nothing was charged.', v_item.title),
        '/declutter?tab=buying', v_uid);
    END LOOP;

    INSERT INTO public.declutter_haul_aways (item_id, job_id, prior_status)
    VALUES (v_item.id, p_job_id, v_item.status);
    UPDATE public.declutter_items SET status = 'ended', updated_at = now() WHERE id = v_item.id;
  END LOOP;

  RETURN cardinality(v_ids);
END;
$fn$;

REVOKE ALL ON FUNCTION public.declutter_link_haul_away(uuid[], uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_link_haul_away(uuid[], uuid) TO authenticated, service_role;

-- declutter_pick_free_request: restated from 20261102011547_free_asks_close_when_their_time_passes.sql.
CREATE OR REPLACE FUNCTION public.declutter_pick_free_request(p_request_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid;
  v_req record;
  v_item record;
  v_line uuid;
  r record;
  v_handover text;
  v_place public.declutter_porch_places%ROWTYPE;
  v_local timestamp;
  v_has_places boolean;
  v_order uuid;
  v_title text;
BEGIN
  PERFORM public.require_feature('declutter');
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  v_uid := public.declutter_assert_member(true);
  SELECT * INTO v_req FROM public.declutter_free_requests WHERE id = p_request_id;
  IF NOT FOUND OR v_req.seller_id <> v_uid THEN
    RAISE EXCEPTION 'request_not_found' USING ERRCODE = 'PT404';
  END IF;
  SELECT i.id, i.status, i.current_price_cents, i.title INTO v_item
    FROM public.declutter_items i WHERE i.id = v_req.item_id AND i.seller_id = v_uid FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'request_not_found' USING ERRCODE = 'PT404';
  END IF;
  -- Re-read under the item lock: a withdraw or a second pick may have landed first.
  SELECT * INTO v_req FROM public.declutter_free_requests WHERE id = p_request_id FOR UPDATE;
  IF v_req.status <> 'open' THEN
    RAISE EXCEPTION 'request_not_open' USING ERRCODE = '55000', HINT = 'That person took back their ask.';
  END IF;
  -- ── A3-57: an ask whose own pickup time has passed can't be picked (the sweep closes it and tells the asker). ──
  IF v_req.pickup_at IS NOT NULL AND v_req.pickup_at <= now() THEN
    RAISE EXCEPTION 'request_time_passed' USING ERRCODE = '55000',
      HINT = 'Their pickup time has passed. Pick someone else.';
  END IF;
  IF v_item.status <> 'live' OR v_item.current_price_cents <> 0 THEN
    RAISE EXCEPTION 'item_not_available' USING ERRCODE = '55000';
  END IF;
  IF public.are_users_blocked(v_uid, v_req.requester_id) OR public.declutter_member_out(v_req.requester_id) THEN
    RAISE EXCEPTION 'requester_unavailable' USING ERRCODE = '55000', HINT = 'That person can''t take items right now. Pick someone else.';
  END IF;
  -- Close the asks first, so the item-left-live trigger finds none open.
  UPDATE public.declutter_free_requests SET status = 'picked', closed_at = now() WHERE id = p_request_id;
  FOR r IN
    UPDATE public.declutter_free_requests SET status = 'not_picked', closed_at = now()
     WHERE item_id = v_item.id AND status = 'open'
    RETURNING requester_id
  LOOP
    PERFORM public.declutter_notify(r.requester_id, 'declutter_offers', 'It went to someone else',
      format('"%s" went to someone else. Thanks for asking.', v_item.title),
      '/declutter/item/' || v_item.id::text, v_uid);
  END LOOP;

  -- ── Owner 11-01: the asked time becomes the confirmed pickup, when it still can (header). ──
  IF v_req.pickup_at IS NOT NULL
     AND v_req.pickup_at > now()
     AND v_req.pickup_at + interval '30 minutes' <= now() + interval '7 days'
     AND (EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = v_req.requester_id AND ur.role = 'admin')
          OR public.identity_check_exempt(v_req.requester_id)
          OR public.is_identity_verified(v_req.requester_id))
     AND NOT EXISTS (SELECT 1 FROM public.declutter_orders o
                      WHERE o.buyer_id = v_req.requester_id AND o.seller_id = v_uid AND o.status = 'awaiting_payment')
     AND NOT EXISTS (SELECT 1 FROM public.declutter_items i
                      WHERE i.id = v_item.id AND i.is_seed AND public.seed_hidden_for(v_req.requester_id))
  THEN
    v_local := v_req.pickup_at AT TIME ZONE 'America/Chicago';
    v_has_places := EXISTS (SELECT 1 FROM public.declutter_porch_places pl WHERE pl.seller_id = v_uid);
    IF v_has_places THEN
      -- The picked person's saved place first, else the first place by position; only a place open at that time.
      SELECT pl.* INTO v_place
        FROM public.declutter_porch_places pl
        LEFT JOIN public.declutter_porch_place_choices ch
          ON ch.place_id = pl.id AND ch.buyer_id = v_req.requester_id AND ch.seller_id = v_uid
       WHERE pl.seller_id = v_uid
         AND EXISTS (
           SELECT 1 FROM jsonb_array_elements(
                    coalesce(pl.windows, public.declutter_place_windows_fill(NULL, pl.seller_id, pl.weekdays))) e
            WHERE (e ->> 'weekday')::int = extract(dow FROM v_local)::int
              AND v_local::time >= (e ->> 'starts')::time
              AND (e ->> 'ends')::time >= (e ->> 'starts')::time + interval '30 minutes'
              AND v_local::time <= (e ->> 'ends')::time - interval '30 minutes')
       ORDER BY (ch.place_id IS NULL), pl.position
       LIMIT 1
       FOR SHARE OF pl;
    END IF;
    -- A way this item allows, by declutter_handover_refused's rule for one line (its ticks; an older item with none,
    -- every way but porch when porch_ok is off): porch when it takes porch pickup, else the giver's home.
    -- A giver with no places keeps porch pickups to their porch days (declutter_order_slot_in_windows' rule).
    SELECT CASE WHEN i.porch_ok AND (i.handovers IS NULL OR 'porch' = ANY (i.handovers))
                     AND (v_has_places OR COALESCE(public.declutter_is_porch_day(v_uid, extract(dow FROM v_local)::smallint), false))
                  THEN 'porch'
                WHEN i.handovers IS NULL OR 'pickup_home' = ANY (i.handovers) THEN 'pickup_home'
           END INTO v_handover
      FROM public.declutter_items i WHERE i.id = v_item.id;
    IF NOT ((v_has_places AND v_place.id IS NOT NULL)
            OR (NOT v_has_places AND public.declutter_slot_in_windows(v_uid, v_req.pickup_at))) THEN
      v_handover := NULL;
    END IF;
    IF v_handover IS NOT NULL THEN
    BEGIN
      -- The item set aside for them, as declutter_take_item does for a free claim, without its 48-hour notices.
      UPDATE public.declutter_items SET status = 'reserved', updated_at = now()
       WHERE id = v_item.id AND status = 'live'
      RETURNING title INTO v_title;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'item_not_available' USING ERRCODE = '55000', HINT = 'Someone else got this item first.';
      END IF;
      INSERT INTO public.declutter_cart_items (item_id, buyer_id, seller_id, price_cents, source, offer_id, checkout_by)
      VALUES (v_item.id, v_req.requester_id, v_uid, 0, 'buy', NULL, now() + public.declutter_hold_length(0, 'buy'))
      RETURNING id INTO v_line;
      FOR r IN
        UPDATE public.declutter_offers
           SET status = 'voided', closed_at = now(), updated_at = now(), voided_by_line = v_line
         WHERE item_id = v_item.id AND status = 'open'
        RETURNING id
      LOOP
        INSERT INTO public.declutter_offer_events (offer_id, actor_side, action) VALUES (r.id, 'system', 'void');
      END LOOP;
      -- The order, exactly as declutter_checkout_free makes it: $0 everywhere, paid_with 'free', paid at once.
      INSERT INTO public.declutter_orders (buyer_id, seller_id, handover, items_cents, premium_cents, tax_cents,
                                           delivery_cents, total_cents, setup_fee_cents, paid_with)
      VALUES (v_req.requester_id, v_uid, v_handover, 0, 0, 0, 0, 0, 0, 'free')
      RETURNING id INTO v_order;
      UPDATE public.declutter_cart_items c SET order_id = v_order WHERE c.id = v_line;
      IF v_place.id IS NOT NULL THEN
        INSERT INTO public.declutter_order_porch_places (order_id, seller_id, place_id, label, address, area, lat, lng, weekdays)
        VALUES (v_order, v_uid, v_place.id, v_place.label, v_place.address, v_place.area, v_place.lat, v_place.lng, v_place.weekdays);
      END IF;
      -- The time must pass the order's own check, as declutter_book_pickup would make the picked person pass it;
      -- when it does not, everything since BEGIN is undone and the old path runs.
      IF NOT public.declutter_order_slot_in_windows(v_order, v_uid, v_req.pickup_at) THEN
        RAISE EXCEPTION 'free_pick_time_unusable' USING ERRCODE = 'LHFP1';
      END IF;
      UPDATE public.declutter_orders SET status = 'paid', paid_at = now(), card_fee_cents = 0
       WHERE id = v_order AND status = 'awaiting_payment';
      UPDATE public.declutter_cart_items c SET status = 'paid', closed_at = now()
       WHERE c.id = v_line AND c.status = 'in_cart';
      UPDATE public.declutter_items SET status = 'sold', updated_at = now() WHERE id = v_item.id AND status = 'reserved';
      -- The booking, as declutter_book_pickup's first booking makes it.
      INSERT INTO public.declutter_bookings (order_id, buyer_id, seller_id, slot_start, slot_end)
      VALUES (v_order, v_req.requester_id, v_uid, v_req.pickup_at, v_req.pickup_at + interval '30 minutes');
      INSERT INTO public.declutter_handovers (order_id, code) VALUES (v_order, public.declutter_new_handover_code())
      ON CONFLICT (order_id) DO NOTHING;
      PERFORM public.declutter_notify(v_req.requester_id, 'payment', 'It''s yours',
        format('"%s" is yours. Pickup is %s; the address is in your order. Nothing is charged.', v_title,
               to_char(v_req.pickup_at AT TIME ZONE 'America/Chicago', 'Dy Mon FMDD at FMHH12:MI AM')),
        '/declutter?view=cart', v_uid);
      RETURN v_line;
    EXCEPTION WHEN SQLSTATE 'LHFP1' THEN
      v_line := NULL;
    END;
    END IF;
  END IF;

  v_line := public.declutter_take_item(v_item.id, v_req.requester_id, 0, 'buy', NULL);
  RETURN v_line;
END;
$function$;

REVOKE ALL ON FUNCTION public.declutter_pick_free_request(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_pick_free_request(uuid) TO authenticated, service_role;

-- declutter_record_ai_check: restated from 20261031152545_declutter_check_after_post.sql.
CREATE OR REPLACE FUNCTION public.declutter_record_ai_check(p_item_id uuid, p_seller_id uuid, p_judged_photo_ids uuid[], p_judged_title text, p_judged_description text, p_judged_category text, p_flag_reason text)
 RETURNS timestamp with time zone
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_item public.declutter_items%ROWTYPE;
  v_current uuid[];
  v_at timestamptz := now();
  v_flag text := NULLIF(left(btrim(COALESCE(p_flag_reason, '')), 300), '');
  r record;
  v_line record;
BEGIN
  -- A draft (before publishing), or a listing an edit sent back for this check:
  -- it was live before (live_at set) and its result was cleared by the edit. A
  -- listing already judged (flagged, waiting for an admin) is never re-judged,
  -- so a flag cannot be washed off by asking again.
  SELECT i.* INTO v_item FROM public.declutter_items i
   WHERE i.id = p_item_id AND i.seller_id = p_seller_id
     AND (i.status = 'draft'
          -- LEAD-POST-SLOW: the check that runs right after Post, on a live listing not judged yet, or one a buyer
          -- reserved or paid for before it landed (review of 41771724f3). Never one an admin approved since it
          -- went live: the admin's decision stands.
          OR (i.status IN ('live', 'reserved', 'sold') AND i.live_at IS NOT NULL
              AND (i.admin_approved_at IS NULL OR i.admin_approved_at < i.live_at)
              AND EXISTS (SELECT 1 FROM public.declutter_item_private pv
                           WHERE pv.item_id = i.id AND pv.ai_checked_at IS NULL))
          OR (i.status = 'pending_review' AND i.live_at IS NOT NULL
              AND EXISTS (SELECT 1 FROM public.declutter_item_private pv
                           WHERE pv.item_id = i.id AND pv.ai_checked_at IS NULL)))
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'PT404';
  END IF;
  SELECT COALESCE(array_agg(id ORDER BY id), ARRAY[]::uuid[]) INTO v_current
    FROM public.declutter_item_photos WHERE item_id = p_item_id;
  IF v_current IS DISTINCT FROM (SELECT COALESCE(array_agg(x ORDER BY x), ARRAY[]::uuid[]) FROM unnest(p_judged_photo_ids) AS x)
     OR v_item.title IS DISTINCT FROM p_judged_title
     OR v_item.description IS DISTINCT FROM p_judged_description
     OR v_item.category IS DISTINCT FROM p_judged_category THEN
    RAISE EXCEPTION 'ai_check_stale' USING ERRCODE = '40001';
  END IF;
  UPDATE public.declutter_item_private
     SET ai_checked_at = v_at,
         ai_flag_reason = v_flag,
         updated_at = v_at
   WHERE item_id = p_item_id;

  -- LEAD-POST-SLOW: a listing that went live at Post and is flagged now comes down at once: held for an admin, its
  -- open offers closed (buyers told, nothing charged), and the seller told why.
  IF v_item.status = 'live' AND v_flag IS NOT NULL THEN
    UPDATE public.declutter_items
       SET status = 'pending_review', updated_at = v_at
     WHERE id = p_item_id AND status = 'live';
    FOR r IN
      UPDATE public.declutter_offers
         SET status = 'voided', closed_at = v_at, updated_at = v_at
       WHERE item_id = p_item_id AND status = 'open'
      RETURNING id, buyer_id
    LOOP
      INSERT INTO public.declutter_offer_events (offer_id, actor_side, action) VALUES (r.id, 'system', 'void');
      PERFORM public.declutter_notify(r.buyer_id, 'declutter_offers', 'Listing changed',
        format('"%s" was taken down for a check, so your offer is closed. Nothing was charged.', v_item.title),
        '/declutter?tab=buying', v_item.seller_id);
    END LOOP;
    PERFORM public.declutter_notify(v_item.seller_id, 'declutter_listings', 'Your listing is waiting for a check',
      format('Our automatic check flagged "%s" (%s). Someone from Louisiana Helpr will look at it. Buyers can''t see it until then.', v_item.title, v_flag),
      '/declutter?tab=selling', NULL);
  END IF;

  -- Review of 41771724f3 (2): flagged after a buyer reserved or paid for it.
  IF v_item.status IN ('reserved', 'sold') AND v_flag IS NOT NULL THEN
    -- Lock order as everywhere in Declutter: items (above) -> orders -> lines.
    SELECT c.id, c.status, c.buyer_id, c.order_id, o.status AS order_status INTO v_line
      FROM public.declutter_cart_items c LEFT JOIN public.declutter_orders o ON o.id = c.order_id
     WHERE c.item_id = p_item_id AND c.status IN ('in_cart', 'paid')
     ORDER BY c.created_at DESC LIMIT 1;
    IF v_line.order_id IS NOT NULL THEN
      PERFORM 1 FROM public.declutter_orders o WHERE o.id = v_line.order_id FOR UPDATE;
    END IF;
    IF v_line.id IS NOT NULL AND v_line.status = 'in_cart' AND COALESCE(v_line.order_status, 'awaiting_payment') = 'awaiting_payment' THEN
      -- Not paid: let the line go with no strike, held for an admin.
      UPDATE public.declutter_cart_items SET status = 'removed', closed_at = v_at
       WHERE id = v_line.id AND status = 'in_cart';
      IF v_line.order_id IS NOT NULL THEN
        -- 'not_payable', never 'superseded' (= the buyer restarted checkout, card fee kept): a payment that still
        -- lands on this checkout is refunded in full, the card fee ours, as the buyer's notice below promises.
        UPDATE public.declutter_orders SET status = 'superseded', close_reason = 'not_payable', closed_at = v_at
         WHERE id = v_line.order_id AND status = 'awaiting_payment';
        UPDATE public.declutter_cart_items SET order_id = NULL
         WHERE order_id = v_line.order_id AND status = 'in_cart';
      END IF;
      UPDATE public.declutter_items SET status = 'pending_review', updated_at = v_at
       WHERE id = p_item_id AND status = 'reserved';
      PERFORM public.declutter_notify(v_line.buyer_id, 'declutter_offers', 'Listing changed',
        format('"%s" was taken down for a check, so it left your cart. Nothing was charged.', v_item.title),
        '/declutter?tab=buying', v_item.seller_id);
      PERFORM public.declutter_notify(v_item.seller_id, 'declutter_listings', 'Your listing is waiting for a check',
        format('Our automatic check flagged "%s" (%s). Someone from Louisiana Helpr will look at it. Buyers can''t see it until then.', v_item.title, v_flag),
        '/declutter?tab=selling', NULL);
    ELSE
      -- Paid (or the order is past paying): the sale stands until an admin decides; the seller's payouts wait.
      INSERT INTO public.payout_holds (helper_id, reason, held_by, held_at)
      VALUES (v_item.seller_id,
              left(format('Declutter: the automatic check flagged "%s" (%s) after it sold (order %s). Lift this hold to pay the seller, or refund the buyer.',
                          v_item.title, v_flag, COALESCE(v_line.order_id::text, 'none')), 1000),
              NULL, v_at)
      ON CONFLICT (helper_id) DO NOTHING;
      -- Every admin, never for a test account (owner 2026-10-30).
      IF NOT public.is_test_subject(v_item.seller_id) THEN
        INSERT INTO public.notifications (user_id, title, message, type, link)
        SELECT ur.user_id,
               'A sold Declutter listing failed its check',
               left(format('"%s" was flagged (%s) after a buyer paid. The seller''s payouts are on hold: lift the hold to pay them, or refund the buyer.', v_item.title, v_flag), 1000),
               'admin_alert',
               '/admin?view=payouts'
          FROM public.user_roles ur
         WHERE ur.role = 'admin';
      END IF;
      PERFORM public.declutter_notify(v_item.seller_id, 'declutter_listings', 'Your sale is waiting for a check',
        format('Our automatic check flagged "%s" (%s). Someone from Louisiana Helpr will look at it before you''re paid.', v_item.title, v_flag),
        '/declutter?tab=selling', NULL);
    END IF;
  END IF;

  IF v_item.status = 'pending_review' THEN
    IF v_flag IS NULL
       AND NOT EXISTS (SELECT 1 FROM public.profiles pr
                        WHERE pr.user_id = v_item.seller_id
                          AND pr.ban_status IN ('banned', 'temp_banned', 'permanently_banned')
                          AND (pr.ban_status <> 'temp_banned' OR pr.auto_suspended_until IS NULL OR pr.auto_suspended_until > now()))
       AND public.declutter_active_strike_count(v_item.seller_id) < 3
       AND NOT public.member_under_18(v_item.seller_id) THEN
      -- Clean: back in front of buyers, its open offers still open.
      UPDATE public.declutter_items
         SET status = 'live', updated_at = v_at
       WHERE id = p_item_id AND status = 'pending_review';
    ELSIF v_flag IS NOT NULL THEN
      -- Flagged: held for an admin, and its open offers close (buyers told, nothing charged).
      FOR r IN
        UPDATE public.declutter_offers
           SET status = 'voided', closed_at = v_at, updated_at = v_at
         WHERE item_id = p_item_id AND status = 'open'
        RETURNING id, buyer_id
      LOOP
        INSERT INTO public.declutter_offer_events (offer_id, actor_side, action) VALUES (r.id, 'system', 'void');
        PERFORM public.declutter_notify(r.buyer_id, 'declutter_offers', 'Listing changed',
          format('The seller changed "%s", so your offer is closed. Nothing was charged.', v_item.title),
          '/declutter?tab=buying', v_item.seller_id);
      END LOOP;
    END IF;
  END IF;
  RETURN v_at;
END;
$function$;

REVOKE ALL ON FUNCTION public.declutter_record_ai_check(uuid, uuid, uuid[], text, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_record_ai_check(uuid, uuid, uuid[], text, text, text, text) TO service_role;

-- declutter_checkout_free: restated from 20261031211922_free_claim_fee_then_id_restated.sql.
CREATE OR REPLACE FUNCTION public.declutter_checkout_free(p_seller_id uuid, p_handover text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid;
  v_taker text;
  v_n integer;
  v_items integer;
  v_lines uuid[];
  v_existing record;
  v_order uuid;
  r record;
  v_place public.declutter_porch_places%ROWTYPE;
BEGIN
  -- Row 62: no require_feature (a claim is a sale already agreed), the same as declutter_start_checkout.
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  v_uid := public.declutter_assert_member(true);
  -- Free pickups at launch: at the seller's home or from the porch. Delivery costs money, so not for a $0 order.
  IF p_handover IS NULL OR p_handover NOT IN ('pickup_home', 'porch') THEN
    RAISE EXCEPTION 'handover_unavailable' USING ERRCODE = '22023',
      HINT = 'Free items are picked up: from the porch or at the seller''s home.';
  END IF;
  -- Lock order as checkout: items -> orders -> lines.
  PERFORM 1 FROM public.declutter_items i
   WHERE i.id IN (SELECT c.item_id FROM public.declutter_cart_items c
                   WHERE c.buyer_id = v_uid AND c.seller_id = p_seller_id AND c.status = 'in_cart')
   ORDER BY i.id FOR UPDATE;
  SELECT o.id, o.stripe_checkout_session_id INTO v_existing
    FROM public.declutter_orders o
   WHERE o.buyer_id = v_uid AND o.seller_id = p_seller_id AND o.status = 'awaiting_payment'
   FOR UPDATE;
  PERFORM 1 FROM public.declutter_cart_items c
   WHERE c.buyer_id = v_uid AND c.seller_id = p_seller_id AND c.status = 'in_cart'
   ORDER BY c.item_id FOR UPDATE;
  SELECT count(*), COALESCE(sum(c.price_cents), 0), ARRAY(SELECT c2.id FROM public.declutter_cart_items c2
           WHERE c2.buyer_id = v_uid AND c2.seller_id = p_seller_id AND c2.status = 'in_cart'
             AND c2.checkout_by > now() ORDER BY c2.id)
    INTO v_n, v_items, v_lines
    FROM public.declutter_cart_items c
   WHERE c.buyer_id = v_uid AND c.seller_id = p_seller_id AND c.status = 'in_cart'
     AND c.checkout_by > now();
  IF v_n = 0 THEN
    RAISE EXCEPTION 'cart_empty' USING ERRCODE = '55000', HINT = 'Nothing from this seller is waiting for checkout.';
  END IF;
  IF v_items <> 0 THEN
    RAISE EXCEPTION 'not_free_order' USING ERRCODE = '22023', HINT = 'Some of these items have a price. Check out to pay for them.';
  END IF;
  IF public.declutter_seller_out(p_seller_id) OR public.are_users_blocked(p_seller_id, v_uid) THEN
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'PT404';
  END IF;
  -- Owner 2026-10-30: a first-timer the giver picked pays the one-time fee, then verifies, before the address opens.
  PERFORM public.declutter_free_claim_gate(v_uid);
  IF p_handover = 'porch' AND EXISTS (
       SELECT 1 FROM public.declutter_cart_items c JOIN public.declutter_items i ON i.id = c.item_id
        WHERE c.id = ANY (v_lines) AND NOT i.porch_ok) THEN
    RAISE EXCEPTION 'porch_unavailable' USING ERRCODE = '22023',
      HINT = 'The seller asked to meet at their home for this item. Choose pickup at the seller''s home.';
  END IF;
  -- Owner 2026-10-28: the seller ticks which ways buyers may get each item (declutter_items.handovers,
  -- declutter_set_handovers); the ways checkout takes are those EVERY line here allows (an item listed before the
  -- choice, handovers NULL, allows every way). No fallback to the seller's door (owner 2026-10-28, Q2462 #3730:
  -- "let them chat to figure it out"): when no way works, the buyer and seller talk it through in a private
  -- Declutter chat and the missed-checkout strike waits (20261028235249_declutter_handover_talk).
  IF public.declutter_handover_refused(v_lines, p_handover) THEN
    RAISE EXCEPTION 'handover_not_offered' USING ERRCODE = '22023',
      HINT = 'The seller doesn''t offer that for one of these items. Choose another way to get it.';
  END IF;
  -- D-NEW14 (20261030164712): a free porch pickup from a seller with saved places is at the place the buyer picked.
  IF p_handover IN ('porch', 'pickup_home')
     AND EXISTS (SELECT 1 FROM public.declutter_porch_places pl WHERE pl.seller_id = p_seller_id) THEN
    SELECT pl.* INTO v_place
      FROM public.declutter_porch_place_choices ch
      JOIN public.declutter_porch_places pl ON pl.id = ch.place_id
     WHERE ch.buyer_id = v_uid AND ch.seller_id = p_seller_id AND pl.seller_id = p_seller_id
       FOR SHARE OF pl;
    IF v_place.id IS NULL THEN
      RAISE EXCEPTION 'porch_place_needed' USING ERRCODE = '22023',
        HINT = 'Pick which of the seller''s pickup places you''ll use.';
    END IF;
  END IF;
  -- An order still open on a payment page (the cart once held a paid line) is never replaced here:
  -- that page could still be paid. The buyer finishes or leaves it first (it closes in 31 minutes).
  IF v_existing.id IS NOT NULL AND v_existing.stripe_checkout_session_id IS NOT NULL THEN
    RAISE EXCEPTION 'checkout_page_open' USING ERRCODE = '55000',
      HINT = 'A payment page for this seller is still open. Close it, then try again in a few minutes.';
  END IF;
  IF v_existing.id IS NOT NULL THEN
    UPDATE public.declutter_orders SET status = 'superseded', close_reason = 'superseded', closed_at = now()
     WHERE id = v_existing.id AND status = 'awaiting_payment';
  END IF;
  -- The order: $0 everywhere, paid_with 'free' (fee rule 'free' from the trigger), never a Stripe page,
  -- no setup fee. It is paid-equivalent at once: the existing handover RPCs take it from here.
  INSERT INTO public.declutter_orders (buyer_id, seller_id, handover, items_cents, premium_cents, tax_cents,
                                       delivery_cents, total_cents, setup_fee_cents, paid_with)
  VALUES (v_uid, p_seller_id, p_handover, 0, 0, 0, 0, 0, 0, 'free')
  RETURNING id INTO v_order;
  UPDATE public.declutter_cart_items c SET order_id = v_order WHERE c.id = ANY (v_lines);
  IF v_place.id IS NOT NULL THEN
    INSERT INTO public.declutter_order_porch_places (order_id, seller_id, place_id, label, address, area, lat, lng, weekdays)
    VALUES (v_order, p_seller_id, v_place.id, v_place.label, v_place.address, v_place.area, v_place.lat, v_place.lng, v_place.weekdays);
  END IF;
  UPDATE public.declutter_orders SET status = 'paid', paid_at = now(), card_fee_cents = 0
   WHERE id = v_order AND status = 'awaiting_payment';
  FOR r IN
    UPDATE public.declutter_cart_items c SET status = 'paid', closed_at = now()
     WHERE c.order_id = v_order AND c.status = 'in_cart'
    RETURNING c.item_id
  LOOP
    UPDATE public.declutter_items SET status = 'sold', updated_at = now() WHERE id = r.item_id AND status = 'reserved';
  END LOOP;
  PERFORM public.declutter_notify(v_uid, 'payment', 'It''s yours',
    'Your free item is set. Next: choose when to pick it up. Nothing was charged.',
    '/declutter?view=cart', p_seller_id);
  SELECT public.member_display_name(p.full_name, 'Someone') INTO v_taker FROM public.profiles p WHERE p.user_id = v_uid;
  PERFORM public.declutter_notify(p_seller_id, 'payment', 'Free item claimed',
    COALESCE(v_taker, 'Someone') || ' is picking up your free item. Nothing to pay and nothing to set up.',
    '/declutter?tab=selling', v_uid);
  RETURN v_order;
END;
$fn$;

REVOKE ALL ON FUNCTION public.declutter_checkout_free(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_checkout_free(uuid, text) TO authenticated, service_role;

-- declutter_start_checkout: restated from 20261101201500_shipping_s3_checkout_claim.sql.
CREATE OR REPLACE FUNCTION public.declutter_start_checkout(p_seller_id uuid, p_handover text, p_slot_start timestamptz DEFAULT NULL,
  p_handoff text DEFAULT NULL, p_quote_id uuid DEFAULT NULL)
RETURNS TABLE (order_id uuid, items_cents integer, premium_cents integer, tax_cents integer,
               total_cents integer, superseded_session_id text, checkout_session_id text, delivery_cents integer,
               shipping_cents integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid;
  v_items integer;
  v_premium integer;
  v_order uuid;
  v_old_session text;
  v_n integer;
  v_lines uuid[];
  v_existing record;
  v_delivery integer := 0;
  v_setup integer := 0;
  v_dropoff_key text;
  q record;
  sd record;
  v_sd_dropoff text;
  v_rules jsonb := public.declutter_seller_delivery_rules();
  v_spot public.declutter_meetup_spots%ROWTYPE;
  v_bundle_off integer := 0;
  v_place public.declutter_porch_places%ROWTYPE;
  v_pickup_end timestamptz;
  v_shipping integer := 0;
  v_quote public.shipping_quotes%ROWTYPE;
BEGIN
  -- Row 62 (B44): no require_feature here. Nothing NEW can start without the
  -- switch (offer, Buy and accept all require it); a line already in the cart
  -- is a sale already agreed, and checkout below needs one.
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  v_uid := public.declutter_assert_member(true);
  IF p_handover IS NULL OR p_handover NOT IN ('pickup_home', 'porch', 'delivery', 'seller_delivery', 'meetup', 'ship') THEN
    RAISE EXCEPTION 'handover_unavailable' USING ERRCODE = '22023',
      HINT = 'Choose porch pickup, pickup at the seller''s home, a safe meeting spot, delivery by the seller, or Helpr delivery.';
  END IF;
  -- Q2425: a safe meeting spot is new work for the seller, so it needs the switch (row 62's rule).
  IF p_handover = 'meetup' THEN
    PERFORM public.require_feature('declutter');
  END IF;
  -- Slice 5: delivery is new work for a Helpr, so it needs the switch (row 62:
  -- a member the switch is off for can still finish with a pickup).
  IF p_handover = 'delivery' THEN
    PERFORM public.require_feature('declutter');
  END IF;
  -- Seller delivery is new work for the seller: both switches. The buyer says
  -- how they want it: left at the door or handed to them (owner 2026-10-22).
  IF p_handover = 'seller_delivery' THEN
    PERFORM public.require_feature('declutter');
    PERFORM public.require_feature('declutter_seller_delivery');
    IF p_handoff IS NULL OR p_handoff NOT IN ('leave', 'hand') THEN
      RAISE EXCEPTION 'invalid_handoff' USING ERRCODE = '22023',
        HINT = 'Choose "Leave it at my door" or "Hand it to me".';
    END IF;
  ELSIF p_handover = 'ship' THEN
    -- Shipping S3 (Q2259): new work for the seller, so both switches (row 62's rule); the buyer's quote is required.
    PERFORM public.require_feature('declutter');
    PERFORM public.require_feature('declutter_shipping');
    IF p_quote_id IS NULL THEN
      RAISE EXCEPTION 'shipping_quote_needed' USING ERRCODE = '22023', HINT = 'Get a shipping price for your address first.';
    END IF;
    p_slot_start := NULL;
    p_handoff := NULL;
  ELSIF p_handover IN ('porch', 'pickup_home', 'meetup') THEN
    -- B110 (owner 11-01): the buyer picks the pickup day and time BEFORE paying. Optional (NULL: an older app, or a
    -- seller with no times; the buyer books after paying as before). Checked here for the future and the 7-day
    -- pickup deadline; inside the seller's hours below, once the order (and its frozen place) exists.
    p_handoff := NULL;
    IF p_slot_start IS NOT NULL
       AND (p_slot_start <= now() OR p_slot_start + interval '30 minutes' > now() + interval '7 days') THEN
      RAISE EXCEPTION 'invalid_slot' USING ERRCODE = '22023',
        HINT = 'Pick a pickup time in the future, within the next 7 days.';
    END IF;
  ELSE
    p_slot_start := NULL;
    p_handoff := NULL;
  END IF;

  IF p_handover <> 'ship' THEN
    p_quote_id := NULL;
  END IF;

  -- Lock order: items -> orders -> lines.
  PERFORM 1 FROM public.declutter_items i
   WHERE i.id IN (SELECT c.item_id FROM public.declutter_cart_items c
                   WHERE c.buyer_id = v_uid AND c.seller_id = p_seller_id AND c.status = 'in_cart')
   ORDER BY i.id FOR UPDATE;
  SELECT o.id, o.handover, o.stripe_checkout_session_id, o.items_cents, o.premium_cents, o.tax_cents, o.total_cents,
         o.delivery_cents, o.setup_fee_cents,
         (SELECT od.dropoff_address || '|' || od.road_miles FROM public.declutter_order_deliveries od WHERE od.order_id = o.id) AS dropoff_key,
         (SELECT x.slot_start FROM public.declutter_seller_deliveries x
           WHERE x.order_id = o.id AND x.status = 'held' AND x.held_until > now()) AS held_slot,
         (SELECT x.dropoff_address FROM public.declutter_seller_deliveries x WHERE x.order_id = o.id) AS sd_dropoff,
         (SELECT m.spot_id FROM public.declutter_order_meetups m WHERE m.order_id = o.id) AS meetup_spot,
         -- Review 2026-10-31 (low): and the place's hours (20261031145652), so edited hours never reuse a stale order.
         (SELECT pp.place_id::text || '|' || pp.address || '|' || pp.lat || '|' || pp.lng || '|' || pp.weekdays::text
                 || '|' || coalesce(pp.windows::text, '')
            FROM public.declutter_order_porch_places pp WHERE pp.order_id = o.id) AS porch_key,
         ARRAY(SELECT c.id FROM public.declutter_cart_items c WHERE c.order_id = o.id AND c.status = 'in_cart' ORDER BY c.id) AS lines,
         o.pickup_slot_start,
         o.shipping_cents, o.shipping_quote_id
    INTO v_existing
    FROM public.declutter_orders o
   WHERE o.buyer_id = v_uid AND o.seller_id = p_seller_id AND o.status = 'awaiting_payment'
   FOR UPDATE;
  PERFORM 1 FROM public.declutter_cart_items c
   WHERE c.buyer_id = v_uid AND c.seller_id = p_seller_id AND c.status = 'in_cart'
   ORDER BY c.item_id FOR UPDATE;
  SELECT count(*), COALESCE(sum(c.price_cents), 0), ARRAY(SELECT c2.id FROM public.declutter_cart_items c2
           WHERE c2.buyer_id = v_uid AND c2.seller_id = p_seller_id AND c2.status = 'in_cart'
             AND c2.checkout_by > now()
             -- BUY-1 follow-up (lh-money-escrow): no new page once the line's own hold plus 10 min is over.
             AND now() <= c2.created_at + public.declutter_hold_length(c2.price_cents, c2.source) + interval '10 minutes'
           ORDER BY c2.id)
    INTO v_n, v_items, v_lines
    FROM public.declutter_cart_items c
   WHERE c.buyer_id = v_uid AND c.seller_id = p_seller_id AND c.status = 'in_cart'
     AND c.checkout_by > now()
     -- BUY-1 follow-up: the same limit as the line list above.
     AND now() <= c.created_at + public.declutter_hold_length(c.price_cents, c.source) + interval '10 minutes';
  -- The caller's own cart first: an empty cart says nothing about the seller
  -- (no ban / strike / tax-flag oracle on an arbitrary id).
  IF v_n = 0 THEN
    RAISE EXCEPTION 'cart_empty' USING ERRCODE = '55000', HINT = 'Nothing from this seller is waiting for checkout.';
  END IF;
  -- Q2427: the seller's bundle discount on the paid lines (2 or more), from each line's ORIGINAL price every time,
  -- never below the item's floor (declutter_bundle_targets). The lines are locked above. Free lines never change.
  UPDATE public.declutter_cart_items c
     SET price_cents = t.target_cents,
         list_price_cents = CASE WHEN t.target_cents < t.base_cents THEN t.base_cents END
    FROM public.declutter_bundle_targets(p_seller_id, v_lines) t
   WHERE c.id = t.line_id
     AND (c.price_cents IS DISTINCT FROM t.target_cents
          OR c.list_price_cents IS DISTINCT FROM CASE WHEN t.target_cents < t.base_cents THEN t.base_cents END);
  SELECT COALESCE(sum(c.price_cents), 0)::integer,
         COALESCE(sum(COALESCE(c.list_price_cents, c.price_cents) - c.price_cents), 0)::integer
    INTO v_items, v_bundle_off
    FROM public.declutter_cart_items c WHERE c.id = ANY (v_lines);
  -- Only free items (20261027170717): nothing to pay, so never a payment page (no fee, no setup fee).
  -- declutter_checkout_free takes it. A cart mixing free and paid lines checks out here as usual:
  -- the free lines are $0 and the fee is on the paid total.
  IF v_items = 0 THEN
    RAISE EXCEPTION 'free_order' USING ERRCODE = '22023', HINT = 'These items are free. Choose a pickup and tap Get it free.';
  END IF;
  -- B33 tax hook: a business-like seller's sale is never taken untaxed.
  IF EXISTS (SELECT 1 FROM public.declutter_seller_flags f
              WHERE f.user_id = p_seller_id AND f.business_like) THEN
    RAISE EXCEPTION 'seller_tax_not_ready' USING ERRCODE = '55000',
      HINT = 'Checkout for this seller is not available yet.';
  END IF;
  IF public.declutter_seller_out(p_seller_id) OR public.are_users_blocked(p_seller_id, v_uid) THEN
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'PT404';
  END IF;
  -- Row 101: porch only when EVERY line's item allows it. Read from the lines
  -- this checkout groups (v_lines), under the item locks taken above. Before the
  -- idempotent return, so no open porch order is handed back either.
  IF p_handover = 'porch' AND EXISTS (
       SELECT 1 FROM public.declutter_cart_items c
         JOIN public.declutter_items i ON i.id = c.item_id
        WHERE c.id = ANY (v_lines) AND NOT i.porch_ok) THEN
    RAISE EXCEPTION 'porch_unavailable' USING ERRCODE = '22023',
      HINT = 'The seller asked buyers to meet at their home for this item. Choose pickup at the seller''s home.';
  END IF;
  -- Owner 2026-10-28: the seller ticks which ways buyers may get each item (declutter_items.handovers,
  -- declutter_set_handovers); the ways checkout takes are those EVERY line here allows (an item listed before the
  -- choice, handovers NULL, allows every way). No fallback to the seller's door (owner 2026-10-28, Q2462 #3730:
  -- "let them chat to figure it out"): when no way works, the buyer and seller talk it through in a private
  -- Declutter chat and the missed-checkout strike waits (20261028235249_declutter_handover_talk).
  -- Shipping S3: an item ships only when its seller picked a parcel for it ("Ship it": declutter_items.ship_preset,
  -- small items only by its CHECK); the handovers ticks do not name 'ship'.
  IF p_handover = 'ship' AND EXISTS (
       SELECT 1 FROM public.declutter_cart_items c
         JOIN public.declutter_items i ON i.id = c.item_id
        WHERE c.id = ANY (v_lines) AND i.ship_preset IS NULL) THEN
    RAISE EXCEPTION 'handover_not_offered' USING ERRCODE = '22023',
      HINT = 'The seller doesn''t ship one of these items. Choose another way to get it.';
  END IF;
  IF p_handover <> 'ship' AND public.declutter_handover_refused(v_lines, p_handover) THEN
    RAISE EXCEPTION 'handover_not_offered' USING ERRCODE = '22023',
      HINT = 'The seller doesn''t offer that for one of these items. Choose another way to get it.';
  END IF;
  -- D-NEW14 (owner-approved 2026-10-29, 20261030164712): a seller with saved porch places hands over at the ONE the
  -- buyer picked (declutter_set_porch_place), for a porch pickup and for Helpr delivery alike. Read under a share
  -- lock so the seller cannot edit it mid-checkout; it is frozen on the order below. A seller with no places: as before.
  IF p_handover IN ('porch', 'pickup_home', 'delivery')
     AND EXISTS (SELECT 1 FROM public.declutter_porch_places pl WHERE pl.seller_id = p_seller_id) THEN
    SELECT pl.* INTO v_place
      FROM public.declutter_porch_place_choices ch
      JOIN public.declutter_porch_places pl ON pl.id = ch.place_id
     WHERE ch.buyer_id = v_uid AND ch.seller_id = p_seller_id AND pl.seller_id = p_seller_id
       FOR SHARE OF pl;
    IF v_place.id IS NULL THEN
      RAISE EXCEPTION 'porch_place_needed' USING ERRCODE = '22023',
        HINT = 'Pick which of the seller''s pickup places you''ll use.';
    END IF;
  END IF;
  -- Slice 5: the delivery for exactly these lines, from server data only.
  IF p_handover = 'delivery' THEN
    SELECT * INTO q FROM public.declutter_delivery_compute(v_uid, p_seller_id, v_lines);
    v_delivery := q.delivery_cents;
    v_dropoff_key := q.dropoff_address || '|' || q.road_miles;
  END IF;
  -- Seller delivery: under the seller's setting-row lock (held to the end of
  -- this transaction), taken BEFORE the setting is read (lh-money-escrow review
  -- of the free-delivery change #1): a seller saving a new price or turning
  -- delivery off mid-checkout is either seen here or waits, so the order never
  -- freezes terms the seller already changed. Then the setting, items, address,
  -- range and the rate; then the slot.
  IF p_handover = 'seller_delivery' THEN
    PERFORM 1 FROM public.declutter_seller_delivery s WHERE s.seller_id = p_seller_id FOR UPDATE;
    SELECT * INTO sd FROM public.declutter_seller_delivery_check(v_uid, p_seller_id, v_lines);
    IF sd.reason = 'address_needed' THEN
      RAISE EXCEPTION 'delivery_address_needed' USING ERRCODE = '22023', HINT = 'Enter the address to deliver to.';
    ELSIF sd.reason = 'out_of_range' THEN
      RAISE EXCEPTION 'delivery_out_of_range' USING ERRCODE = '22023',
        HINT = 'This seller doesn''t deliver that far. Choose pickup or another delivery.';
    ELSIF sd.reason IS NOT NULL THEN
      RAISE EXCEPTION 'seller_delivery_unavailable' USING ERRCODE = '22023',
        HINT = 'This seller can''t deliver these items. Choose another way to get them.';
    END IF;
    IF p_slot_start IS NULL OR NOT EXISTS (
         SELECT 1 FROM public.declutter_delivery_open_slots(p_seller_id, v_existing.id) s WHERE s = p_slot_start) THEN
      RAISE EXCEPTION 'slot_unavailable' USING ERRCODE = '22023',
        HINT = 'That delivery time was just taken or is no longer open. Pick another time.';
    END IF;
    -- Q2427 (lh-money-escrow follow-up review #1): the rate from THIS checkout's items total (v_items, from the
    -- lines it locked and priced above), never the check's own re-computation: the check reads the bundle rule
    -- and floors in a later snapshot (after the setting-row wait), so a rule saved in between could otherwise
    -- price the delivery on one total and the items on another. The seller's rate and free-over amount are the
    -- locked setting row's (sd.base_rate_cents, sd.free_over_cents).
    v_delivery := public.declutter_seller_delivery_rate_cents(sd.base_rate_cents, sd.free_over_cents, v_items);
    v_sd_dropoff := sd.dropoff_address;
  END IF;

  -- Shipping S3: the price is the buyer's own stored quote (ship-rates), never a number from the client: for this
  -- buyer and seller, still fresh, and for exactly the lines this checkout groups (one parcel, decision 10). A quote
  -- for other lines (one added, one expired) is stale: the app asks ship-rates again.
  IF p_handover = 'ship' THEN
    SELECT q2.* INTO v_quote FROM public.shipping_quotes q2
     WHERE q2.id = p_quote_id AND q2.buyer_id = v_uid AND q2.seller_id = p_seller_id;
    IF v_quote.id IS NULL OR v_quote.expires_at <= now()
       OR ARRAY(SELECT x FROM unnest(v_quote.cart_item_ids) x ORDER BY x) IS DISTINCT FROM v_lines THEN
      RAISE EXCEPTION 'shipping_quote_stale' USING ERRCODE = '22023',
        HINT = 'That shipping price ran out. Get a new one for your address.';
    END IF;
    v_shipping := v_quote.rate_cents;
  END IF;

  -- Q2425: a safe meeting spot is the one the buyer chose for this seller (declutter_set_meetup_spot), still
  -- active and still near these items. Never the seller's home: the address is not shared for a meetup.
  IF p_handover = 'meetup' THEN
    SELECT s.* INTO v_spot
      FROM public.declutter_meetup_choices mc
      JOIN public.declutter_meetup_spots s ON s.id = mc.spot_id
     WHERE mc.buyer_id = v_uid AND mc.seller_id = p_seller_id AND s.active
       AND public.declutter_meetup_spot_near_lines(s.id, v_lines);
    IF v_spot.id IS NULL THEN
      RAISE EXCEPTION 'meetup_spot_needed' USING ERRCODE = '22023',
        HINT = 'Pick a safe meeting spot near the seller.';
    END IF;
  END IF;

  -- Q2352 (owner 2026-10-22, terms #9): the one-time account setup fee rides
  -- the buyer's first Declutter purchase when the account never paid it. It is
  -- frozen on the order OUTSIDE total_cents (the sale's own amount, which every
  -- refund is computed from), so a refund of the sale never returns it.
  v_setup := public.declutter_setup_fee_due_cents(v_uid);

  -- Idempotent (money review #3): the same lines and the same handover return
  -- the order already open, and its Stripe session for the app to reuse.
  -- Slice 5: and the same delivery (fee and drop-off). Seller delivery: and
  -- the same slot, still held, to the same address.
  IF v_existing.id IS NOT NULL AND v_existing.handover = p_handover AND v_existing.lines = v_lines
     AND v_existing.delivery_cents = v_delivery
     AND v_existing.dropoff_key IS NOT DISTINCT FROM v_dropoff_key
     -- Q2352: and the same setup fee (paid elsewhere since: a fresh order without it).
     AND v_existing.setup_fee_cents = v_setup
     -- Q2427: and the items total the bundle rule gives now (a changed or removed rule opens a new order).
     AND v_existing.items_cents = v_items
     AND (p_handover <> 'seller_delivery'
          OR (v_existing.held_slot = p_slot_start AND v_existing.sd_dropoff IS NOT DISTINCT FROM v_sd_dropoff))
     -- D-NEW14: and the same porch place, as it is now (an edited or changed place opens a new order).
     AND v_existing.porch_key IS NOT DISTINCT FROM
         (v_place.id::text || '|' || v_place.address || '|' || v_place.lat || '|' || v_place.lng || '|' || v_place.weekdays::text
          || '|' || coalesce(v_place.windows::text, ''))
     -- Q2425: and the same meeting spot.
     AND (p_handover <> 'meetup' OR v_existing.meetup_spot IS NOT DISTINCT FROM v_spot.id)
     -- B110: and the same pickup time (a changed time opens a new order; the app closes the old page first).
     AND (p_handover NOT IN ('porch', 'pickup_home', 'meetup')
          OR v_existing.pickup_slot_start IS NOT DISTINCT FROM p_slot_start)
     -- Shipping S3: and the same quote (a new price or address opens a new order).
     AND v_existing.shipping_quote_id IS NOT DISTINCT FROM p_quote_id
     AND v_existing.shipping_cents = v_shipping THEN
    -- lh-money-escrow review #1: an order handed back with NO page yet (the
    -- last try failed before Stripe attached one) gets a new page that lives
    -- 31 min from now, so its hold is re-armed from now too (the setting row
    -- is locked above). An order with a page keeps its hold: the page dies first.
    IF p_handover = 'seller_delivery' AND v_existing.stripe_checkout_session_id IS NULL THEN
      UPDATE public.declutter_seller_deliveries x
         SET held_until = now() + make_interval(mins => (v_rules ->> 'hold_minutes')::integer), updated_at = now()
       WHERE x.order_id = v_existing.id AND x.status = 'held' AND x.held_until > now();
    END IF;
    -- A changed door choice moves no money: it is updated on the order already open.
    IF p_handover = 'seller_delivery' THEN
      UPDATE public.declutter_seller_deliveries x SET handoff = p_handoff, updated_at = now()
       WHERE x.order_id = v_existing.id AND x.handoff IS DISTINCT FROM p_handoff;
    END IF;
    RETURN QUERY SELECT v_existing.id, v_existing.items_cents, v_existing.premium_cents, v_existing.tax_cents,
                        v_existing.total_cents, NULL::text, v_existing.stripe_checkout_session_id, v_existing.delivery_cents,
                        v_existing.shipping_cents;
    RETURN;
  END IF;
  IF v_existing.id IS NOT NULL THEN
    UPDATE public.declutter_orders SET status = 'superseded', close_reason = 'superseded', closed_at = now()
     WHERE id = v_existing.id AND status = 'awaiting_payment';
    v_old_session := v_existing.stripe_checkout_session_id;
  END IF;

  -- F1: 5% of the item total + 70c, once per checkout (card cost inside it).
  -- The Helpr delivery fee is not part of the item total (row 29 prices it
  -- alone); the seller's delivery rate is (owner 2026-10-22, the shipping rule).
  v_premium := CASE WHEN p_handover = 'seller_delivery'
                    THEN public.declutter_buyer_fee_cents_seller_delivery(v_items, v_delivery)
                    -- Shipping S3 (decision 2): 5% of items + shipping + 70c, so the card fee is always covered.
                    WHEN p_handover = 'ship' THEN public.declutter_buyer_fee_cents_ship(v_items, v_shipping)
                    ELSE public.declutter_buyer_fee_cents(v_items) END;
  INSERT INTO public.declutter_orders (buyer_id, seller_id, handover, items_cents, premium_cents, tax_cents,
                                       delivery_cents, total_cents, setup_fee_cents, bundle_discount_cents,
                                       shipping_cents, shipping_quote_id)
  VALUES (v_uid, p_seller_id, p_handover, v_items, v_premium, 0, v_delivery, v_items + v_premium + v_delivery + v_shipping,
          v_setup, v_bundle_off, v_shipping, p_quote_id)
  RETURNING id INTO v_order;
  UPDATE public.declutter_cart_items c SET order_id = v_order
   WHERE c.id = ANY (v_lines);
  IF p_handover = 'delivery' THEN
    INSERT INTO public.declutter_order_deliveries (order_id, dropoff_address, dropoff_area, dropoff_lat, dropoff_lng,
                                                   road_miles, size, delivery_cents)
    VALUES (v_order, q.dropoff_address, q.dropoff_area, q.dropoff_lat, q.dropoff_lng, q.road_miles, q.size, v_delivery);
  END IF;
  IF p_handover = 'seller_delivery' THEN
    INSERT INTO public.declutter_seller_deliveries (order_id, buyer_id, seller_id, status, slot_start, slot_end, held_until,
                                                    dropoff_address, dropoff_area, dropoff_lat, dropoff_lng, handoff)
    VALUES (v_order, v_uid, p_seller_id, 'held', p_slot_start,
            p_slot_start + make_interval(mins => (v_rules ->> 'slot_minutes')::integer),
            now() + make_interval(mins => (v_rules ->> 'hold_minutes')::integer),
            sd.dropoff_address, sd.dropoff_area, sd.dropoff_lat, sd.dropoff_lng, p_handoff);
  END IF;

  -- D-NEW14: the chosen porch place, frozen: the seller editing or deleting it later never moves this sale.
  IF v_place.id IS NOT NULL THEN
    INSERT INTO public.declutter_order_porch_places (order_id, seller_id, place_id, label, address, area, lat, lng, weekdays)
    VALUES (v_order, p_seller_id, v_place.id, v_place.label, v_place.address, v_place.area, v_place.lat, v_place.lng, v_place.weekdays);
  END IF;

  IF p_handover = 'meetup' THEN
    -- A snapshot: an admin editing or retiring the spot later never moves a meeting already agreed.
    INSERT INTO public.declutter_order_meetups (order_id, spot_id, spot_name, spot_address, spot_lat, spot_lng)
    VALUES (v_order, v_spot.id, v_spot.name, v_spot.address, v_spot.lat, v_spot.lng);
  END IF;

  -- B110: the chosen pickup time, inside the seller's hours for THIS order (its frozen place's hours, else the
  -- seller's usual times; a porch order keeps to the porch days): declutter_book_pickup's own check. A porch pickup
  -- is a 2-hour window (lead 11-01: the seller leaves it out); a door pickup or a meetup is the 30-minute time.
  -- A refusal rolls back the whole checkout (the order above included).
  IF p_handover IN ('porch', 'pickup_home', 'meetup') AND p_slot_start IS NOT NULL THEN
    v_pickup_end := public.declutter_checkout_pickup_end(v_order, p_seller_id, p_handover, p_slot_start);
    IF v_pickup_end IS NULL THEN
      RAISE EXCEPTION 'invalid_slot' USING ERRCODE = '22023', HINT = 'Pick a time inside the seller''s pickup times.';
    END IF;
    UPDATE public.declutter_orders SET pickup_slot_start = p_slot_start, pickup_slot_end = v_pickup_end
     WHERE id = v_order;
  END IF;

  RETURN QUERY SELECT v_order, v_items, v_premium, 0, v_items + v_premium + v_delivery + v_shipping, v_old_session, NULL::text,
                      v_delivery, v_shipping;
END;
$fn$;

REVOKE ALL ON FUNCTION public.declutter_start_checkout(uuid, text, timestamptz, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_start_checkout(uuid, text, timestamptz, text, uuid) TO authenticated, service_role;
