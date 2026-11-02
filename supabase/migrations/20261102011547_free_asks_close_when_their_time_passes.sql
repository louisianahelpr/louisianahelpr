-- A3-57 (audit 7, 11-01; Medium GAP): a free ask whose pickup time passes stayed "open". The asker was not told and
-- kept an outdated time, the giver got no reminder before it, and a late pick fell back to the old 48-hour "choose a
-- pickup" path, which goes against the owner's 11-01 rule that the asked time is the confirmed time. Builder 125.
--
-- WHAT THIS ADDS / CHANGES:
--   1. declutter_free_requests.giver_reminded_at (timestamptz, NULL): set when the giver was reminded about this ask's
--      time. A trigger clears it when the asker moves their time (declutter_request_free_at updates pickup_at on the
--      same open ask), so a new time gets its own reminder.
--   2. sweep_declutter_free_asks(p_now) (service_role only):
--      a. CLOSE: every open ask whose pickup_at is at or before p_now becomes 'expired' (closed_at = p_now). The asker
--         is told "Your pickup time passed": the giver didn't pick before their time; ask again with a new time. The
--         giver is told once per item how many asks ended. An ask with no pickup_at (older app builds) is never
--         closed here. Test (is_seed) items close without a notice.
--      b. REMIND: about 2 hours before the earliest open asked time of a live free item, the giver is told "N people
--         asked for X; the first wants 9:00 AM. Next: pick someone by then." Once per ask (giver_reminded_at),
--         none while another open ask of the item was already reminded, none 8:50 PM-8 AM (needs_you_reminder_quiet,
--         20261102002011), never a test item. The claim rolls back with its notice (declutter_notify_strict) and a
--         failure is recorded (log_cron_defect), so the next run retries.
--   3. sweep_deadline_reminders restated from 20261102002011 with a third half, 'free_asks', in its own block. It rides
--      the existing 'declutter-book-by-reminders' job ('2-59/10 * * * *'), so an ask closes within 10 minutes of its time.
--   4. declutter_pick_free_request restated whole from 20261101181129, with ONE addition: an ask whose pickup_at has
--      passed is refused ('request_time_passed', 55000) instead of falling back to the 48-hour path. Everything else
--      (caller checks, ban gate, blocks, the confirmed-time path, grants) is verbatim.
--
-- MONEY: none. REPLAY-SAFE: ADD COLUMN IF NOT EXISTS, CREATE OR REPLACE, DROP TRIGGER IF EXISTS.
-- Proof: src/test/pglite/freeAskClosesWhenItsTimePasses.pglite.mjs (applied 3x, NEW_MIGRATION=skip fails, mutants).

ALTER TABLE public.declutter_free_requests ADD COLUMN IF NOT EXISTS giver_reminded_at timestamptz;

CREATE OR REPLACE FUNCTION public.declutter_free_request_time_moved()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $fn$
BEGIN
  IF NEW.pickup_at IS DISTINCT FROM OLD.pickup_at THEN
    NEW.giver_reminded_at := NULL;
  END IF;
  RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_free_request_time_moved() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS declutter_free_request_time_moved ON public.declutter_free_requests;
CREATE TRIGGER declutter_free_request_time_moved BEFORE UPDATE OF pickup_at ON public.declutter_free_requests
  FOR EACH ROW EXECUTE FUNCTION public.declutter_free_request_time_moved();

CREATE OR REPLACE FUNCTION public.sweep_declutter_free_asks(p_now timestamptz DEFAULT now())
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_ids uuid[];
  v_done integer := 0;
  r record;
  v_time text;
BEGIN
  -- a. CLOSE every open ask whose own time has passed.
  WITH closed AS (
    UPDATE public.declutter_free_requests q SET status = 'expired', closed_at = p_now
     WHERE q.status = 'open' AND q.pickup_at IS NOT NULL AND q.pickup_at <= p_now
    RETURNING q.id
  )
  SELECT array_agg(c.id) INTO v_ids FROM closed c;
  v_done := COALESCE(cardinality(v_ids), 0);
  IF v_done > 0 THEN
    FOR r IN
      SELECT q.requester_id, q.seller_id, q.item_id, COALESCE(NULLIF(btrim(i.title), ''), 'the free item') AS what
        FROM public.declutter_free_requests q
        JOIN public.declutter_items i ON i.id = q.item_id
       WHERE q.id = ANY (v_ids) AND COALESCE(i.is_seed, false) = false
    LOOP
      PERFORM public.declutter_notify(r.requester_id, 'declutter_offers', 'Your pickup time passed',
        format('The giver didn''t pick anyone for "%s" before your time. Ask again with a new time if it''s still up.', r.what),
        '/declutter/item/' || r.item_id::text, r.seller_id);
    END LOOP;
    FOR r IN
      SELECT q.seller_id, q.item_id, count(*)::int AS n, COALESCE(NULLIF(btrim(max(i.title)), ''), 'your free item') AS what
        FROM public.declutter_free_requests q
        JOIN public.declutter_items i ON i.id = q.item_id
       WHERE q.id = ANY (v_ids) AND COALESCE(i.is_seed, false) = false
       GROUP BY q.seller_id, q.item_id
    LOOP
      PERFORM public.declutter_notify(r.seller_id, 'declutter_offers', 'An ask ended',
        format('%s for "%s" ended: the pickup time passed before you picked. Anyone can ask again.',
               CASE WHEN r.n = 1 THEN '1 ask' ELSE r.n::text || ' asks' END, r.what),
        '/declutter/item/' || r.item_id::text, NULL);
    END LOOP;
  END IF;

  -- b. REMIND the giver about 2 hours before the earliest open asked time.
  IF public.needs_you_reminder_quiet(p_now) THEN
    RETURN v_done;
  END IF;
  FOR r IN
    SELECT DISTINCT ON (q.item_id) q.id, q.item_id, q.seller_id, q.pickup_at,
           COALESCE(NULLIF(btrim(i.title), ''), 'your free item') AS what,
           (SELECT count(*)::int FROM public.declutter_free_requests q2 WHERE q2.item_id = q.item_id AND q2.status = 'open') AS n
      FROM public.declutter_free_requests q
      JOIN public.declutter_items i ON i.id = q.item_id
     WHERE q.status = 'open' AND q.pickup_at > p_now AND q.pickup_at <= p_now + interval '2 hours'
       AND i.status = 'live' AND COALESCE(i.is_seed, false) = false
       AND NOT EXISTS (SELECT 1 FROM public.declutter_free_requests q3
                        WHERE q3.item_id = q.item_id AND q3.status = 'open' AND q3.giver_reminded_at IS NOT NULL)
     ORDER BY q.item_id, q.pickup_at, q.created_at
  LOOP
    v_time := to_char(r.pickup_at AT TIME ZONE 'America/Chicago', 'FMHH12:MI AM');
    BEGIN
      UPDATE public.declutter_free_requests SET giver_reminded_at = p_now WHERE id = r.id;
      PERFORM public.declutter_notify_strict(r.seller_id, 'declutter_offers', 'Pick who gets it',
        CASE WHEN r.n = 1
          THEN format('1 person asked for "%s" and wants %s. Next: pick them by then, or the ask ends.', r.what, v_time)
          ELSE format('%s people asked for "%s"; the first wants %s. Next: pick someone by then.', r.n, r.what, v_time) END,
        '/declutter/item/' || r.item_id::text, NULL);
      v_done := v_done + 1;
    EXCEPTION WHEN OTHERS THEN
      PERFORM public.log_cron_defect('sweep_declutter_free_asks', 'remind:' || r.id::text, SQLERRM,
        jsonb_build_object('request_id', r.id, 'item_id', r.item_id));
    END;
  END LOOP;
  RETURN v_done;
END;
$fn$;
REVOKE ALL ON FUNCTION public.sweep_declutter_free_asks(timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sweep_declutter_free_asks(timestamptz) TO service_role;

-- sweep_deadline_reminders restated from 20261102002011 with the third half (free_asks).
CREATE OR REPLACE FUNCTION public.sweep_deadline_reminders(p_now timestamptz DEFAULT now())
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_book_by integer;
  v_needs_you integer;
  v_free_asks integer;
  v_failed text[] := ARRAY[]::text[];
BEGIN
  BEGIN
    v_book_by := public.declutter_book_by_reminder_sweep(p_now);
  EXCEPTION WHEN OTHERS THEN
    v_failed := array_append(v_failed, 'book_by');
    PERFORM public.log_cron_defect('sweep_deadline_reminders', 'declutter_book_by_reminder_sweep', SQLERRM, NULL);
  END;
  BEGIN
    v_needs_you := public.sweep_needs_you_reminders(p_now);
  EXCEPTION WHEN OTHERS THEN
    v_failed := array_append(v_failed, 'needs_you');
    PERFORM public.log_cron_defect('sweep_deadline_reminders', 'sweep_needs_you_reminders', SQLERRM, NULL);
  END;
  -- A3-57: free asks whose time passed close with a notice; the giver is reminded before the earliest asked time.
  BEGIN
    v_free_asks := public.sweep_declutter_free_asks(p_now);
  EXCEPTION WHEN OTHERS THEN
    v_failed := array_append(v_failed, 'free_asks');
    PERFORM public.log_cron_defect('sweep_deadline_reminders', 'sweep_declutter_free_asks', SQLERRM, NULL);
  END;
  RETURN jsonb_build_object('book_by', v_book_by, 'needs_you', v_needs_you, 'free_asks', v_free_asks)
         || CASE WHEN cardinality(v_failed) > 0 THEN jsonb_build_object('failed', to_jsonb(v_failed)) ELSE '{}'::jsonb END;
END;
$fn$;
REVOKE ALL ON FUNCTION public.sweep_deadline_reminders(timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sweep_deadline_reminders(timestamptz) TO service_role;

-- declutter_pick_free_request restated from 20261101181129 with the A3-57 lines (marked).
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
    RAISE EXCEPTION 'request_not_found' USING ERRCODE = 'P0002';
  END IF;
  SELECT i.id, i.status, i.current_price_cents, i.title INTO v_item
    FROM public.declutter_items i WHERE i.id = v_req.item_id AND i.seller_id = v_uid FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'request_not_found' USING ERRCODE = 'P0002';
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
