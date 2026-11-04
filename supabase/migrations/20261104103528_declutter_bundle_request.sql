-- Q2268 (owner said BUILD, via the lead): a buyer asks ONE seller for several items in one request; the seller answers
-- "Accept all" or "Pick some"; each accepted item goes to the buyer's cart exactly like an accepted offer (the same
-- declutter_take_item path, the same 24-hour hold the owner set for an accepted offer on 10-31, BUY-1), so the existing
-- one checkout / one pickup / one fee / bundle discount (20261027211754, 20261028214524) carry them from there.
--
-- WHAT (all new; nothing existing is restated; the hourly sweep cron is at the end):
--   declutter_bundle_requests        one request: buyer, seller, status, respond_by (48 hours, the offer window).
--   declutter_bundle_request_items   its items, the price each was asked at, and what became of each.
--   declutter_request_bundle(item ids)            the buyer's ask: 2-20 live items of one seller, at today's prices.
--   declutter_answer_bundle(request, item ids)    the seller's answer: NULL = Accept all, a subset = Pick some,
--                                                 an empty list = decline. Accepted items are charged
--                                                 least(asked price, today's price): never above either.
--   declutter_withdraw_bundle(request)            the buyer takes it back while it is open.
--   declutter_bundle_sweep()                      open requests past respond_by expire (service_role, for the cron).
--
-- MONEY: nothing is charged here. Each accepted item becomes an in_cart line through declutter_take_item (source
-- 'offer', no offer id), which reserves the item, voids other open offers on it (their buyers told) and starts the hold;
-- the charge happens at the existing checkout. An item that sold meanwhile is marked 'unavailable', never charged.
-- AUTHZ: SECURITY DEFINER, auth.uid() only; the buyer must pass declutter_assert_member + declutter_lock_buyable_item
-- (card saved, not blocked, not own item, offers-mode sale, seed rules) for every item, at the ask and again at the
-- answer; only the request's seller may answer; parties read their own rows (RLS), nobody writes the tables directly.
-- Replay-safe: IF NOT EXISTS, CREATE OR REPLACE, DROP POLICY IF EXISTS. PROOF: src/test/pglite/declutterBundleRequest.pglite.mjs.
-- For verdict: lh-money-escrow + lh-authz-rls.

CREATE TABLE IF NOT EXISTS public.declutter_bundle_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  buyer_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  seller_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'answered', 'declined', 'expired', 'withdrawn')),
  respond_by timestamptz NOT NULL,
  is_seed boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz,
  CONSTRAINT declutter_bundle_requests_not_own CHECK (buyer_id <> seller_id)
);
CREATE INDEX IF NOT EXISTS declutter_bundle_requests_seller_idx ON public.declutter_bundle_requests (seller_id, status);
CREATE INDEX IF NOT EXISTS declutter_bundle_requests_buyer_idx ON public.declutter_bundle_requests (buyer_id, created_at);
CREATE INDEX IF NOT EXISTS declutter_bundle_requests_open_due_idx ON public.declutter_bundle_requests (respond_by) WHERE status = 'open';
-- One open request per buyer per seller.
CREATE UNIQUE INDEX IF NOT EXISTS declutter_bundle_requests_one_open
  ON public.declutter_bundle_requests (buyer_id, seller_id) WHERE status = 'open';

CREATE TABLE IF NOT EXISTS public.declutter_bundle_request_items (
  request_id uuid NOT NULL REFERENCES public.declutter_bundle_requests(id) ON DELETE CASCADE,
  item_id uuid NOT NULL REFERENCES public.declutter_items(id) ON DELETE CASCADE,
  price_cents integer NOT NULL CHECK (price_cents BETWEEN 100 AND 100000),
  outcome text CHECK (outcome IN ('accepted', 'not_picked', 'unavailable')),
  line_id uuid REFERENCES public.declutter_cart_items(id) ON DELETE SET NULL,
  PRIMARY KEY (request_id, item_id)
);
CREATE INDEX IF NOT EXISTS declutter_bundle_request_items_item_idx ON public.declutter_bundle_request_items (item_id);

ALTER TABLE public.declutter_bundle_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.declutter_bundle_request_items ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.declutter_bundle_requests FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.declutter_bundle_request_items FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.declutter_bundle_requests TO authenticated;
GRANT SELECT ON TABLE public.declutter_bundle_request_items TO authenticated;
GRANT ALL ON TABLE public.declutter_bundle_requests TO service_role;
GRANT ALL ON TABLE public.declutter_bundle_request_items TO service_role;
DROP POLICY IF EXISTS "declutter bundle requests: parties read" ON public.declutter_bundle_requests;
CREATE POLICY "declutter bundle requests: parties read" ON public.declutter_bundle_requests
  FOR SELECT TO authenticated
  USING (buyer_id = (SELECT auth.uid()) OR seller_id = (SELECT auth.uid()));
DROP POLICY IF EXISTS "declutter bundle request items: parties read" ON public.declutter_bundle_request_items;
CREATE POLICY "declutter bundle request items: parties read" ON public.declutter_bundle_request_items
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.declutter_bundle_requests r
                  WHERE r.id = request_id
                    AND (r.buyer_id = (SELECT auth.uid()) OR r.seller_id = (SELECT auth.uid()))));

CREATE OR REPLACE FUNCTION public.declutter_request_bundle(p_item_ids uuid[])
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid;
  v_ids uuid[];
  v_item_id uuid;
  v_item record;
  v_seller uuid;
  v_id uuid;
  v_seed boolean := false;
  v_total integer := 0;
BEGIN
  PERFORM public.require_feature('declutter');
  v_uid := public.declutter_assert_member(false);
  -- Review 11-04 (blocker): the first-purchase ID check is the buyer's, so it runs at the ask. At the answer the
  -- seller is the caller and the gate (rightly) skips a row for someone else, so without this an unverified buyer
  -- could have up to 20 items held for them.
  PERFORM public.declutter_identity_gate(v_uid, 'identity_required_to_buy');
  SELECT array_agg(DISTINCT x ORDER BY x) INTO v_ids FROM unnest(p_item_ids) x WHERE x IS NOT NULL;
  IF coalesce(cardinality(v_ids), 0) < 2 OR cardinality(v_ids) > 20 THEN
    RAISE EXCEPTION 'bundle_size' USING ERRCODE = '22023', HINT = 'Pick 2 to 20 items from one seller.';
  END IF;

  -- Locked in id order, so two requests over the same items never deadlock.
  FOREACH v_item_id IN ARRAY v_ids LOOP
    SELECT * INTO v_item FROM public.declutter_lock_buyable_item(v_item_id, v_uid);
    IF v_seller IS NULL THEN
      v_seller := v_item.o_seller_id;
    ELSIF v_seller <> v_item.o_seller_id THEN
      RAISE EXCEPTION 'bundle_one_seller' USING ERRCODE = '22023', HINT = 'A bundle request is for one seller''s items.';
    END IF;
    IF v_item.o_price_cents IS NULL OR v_item.o_price_cents < 100 THEN
      RAISE EXCEPTION 'bundle_free_item' USING ERRCODE = '22023', HINT = 'Free items are claimed on their own.';
    END IF;
  END LOOP;

  -- A request past its 48 hours is closed here too, so an unswept one never blocks a new ask.
  UPDATE public.declutter_bundle_requests SET status = 'expired', closed_at = now()
   WHERE buyer_id = v_uid AND seller_id = v_seller AND status = 'open' AND respond_by <= now();
  IF EXISTS (SELECT 1 FROM public.declutter_bundle_requests r
              WHERE r.buyer_id = v_uid AND r.seller_id = v_seller AND r.status = 'open') THEN
    RAISE EXCEPTION 'bundle_already_open'
      USING ERRCODE = '55000', HINT = 'You already asked this seller. Wait for their answer or take it back.';
  END IF;
  IF (SELECT count(*) FROM public.declutter_bundle_requests r
       WHERE r.buyer_id = v_uid AND r.seller_id = v_seller AND r.created_at > now() - interval '24 hours') >= 3 THEN
    RAISE EXCEPTION 'bundle_rate_limited' USING ERRCODE = '54000', HINT = 'You can ask one seller 3 times a day.';
  END IF;

  SELECT bool_or(i.is_seed), sum(i.current_price_cents) INTO v_seed, v_total
    FROM public.declutter_items i WHERE i.id = ANY (v_ids);

  INSERT INTO public.declutter_bundle_requests (buyer_id, seller_id, respond_by, is_seed)
  VALUES (v_uid, v_seller, now() + interval '48 hours', coalesce(v_seed, false))
  RETURNING id INTO v_id;
  INSERT INTO public.declutter_bundle_request_items (request_id, item_id, price_cents)
  SELECT v_id, i.id, i.current_price_cents FROM public.declutter_items i WHERE i.id = ANY (v_ids);

  PERFORM public.declutter_notify(v_seller, 'new_offers', 'Bundle request',
    format('A buyer wants %s of your items ($%s in all). Accept all or pick some within 48 hours.',
           cardinality(v_ids), to_char(v_total / 100.0, 'FM999990.00')),
    '/declutter?tab=selling', v_uid);
  RETURN v_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.declutter_answer_bundle(p_request_id uuid, p_accept_item_ids uuid[])
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid;
  v_req record;
  v_all boolean := p_accept_item_ids IS NULL;
  v_row record;
  v_item record;
  v_line uuid;
  v_accepted integer := 0;
  v_gone integer := 0;
BEGIN
  PERFORM public.require_feature('declutter');
  v_uid := public.declutter_assert_member(true);
  SELECT * INTO v_req FROM public.declutter_bundle_requests r WHERE r.id = p_request_id FOR UPDATE;
  IF NOT FOUND OR v_req.seller_id <> v_uid THEN
    RAISE EXCEPTION 'bundle_not_found' USING ERRCODE = 'PT404';
  END IF;
  IF v_req.status <> 'open' OR v_req.respond_by <= now() THEN
    RAISE EXCEPTION 'bundle_not_open' USING ERRCODE = '55000', HINT = 'This request is already closed.';
  END IF;
  IF NOT v_all AND EXISTS (SELECT 1 FROM unnest(p_accept_item_ids) x
                            WHERE x IS NULL OR NOT EXISTS (SELECT 1 FROM public.declutter_bundle_request_items bi
                                                             WHERE bi.request_id = p_request_id AND bi.item_id = x)) THEN
    RAISE EXCEPTION 'bundle_item_not_in_request' USING ERRCODE = '22023';
  END IF;

  IF NOT v_all AND cardinality(p_accept_item_ids) = 0 THEN
    UPDATE public.declutter_bundle_requests SET status = 'declined', closed_at = now() WHERE id = p_request_id;
    UPDATE public.declutter_bundle_request_items SET outcome = 'not_picked' WHERE request_id = p_request_id;
    PERFORM public.declutter_notify(v_req.buyer_id, 'new_offers', 'Bundle request declined',
      'The seller said no to your bundle request this time. Nothing was charged.', '/declutter?tab=buying', v_uid);
    RETURN 0;
  END IF;

  IF public.member_under_18(v_req.buyer_id) THEN
    RAISE EXCEPTION 'other_side_unavailable' USING ERRCODE = '55000';
  END IF;
  -- Review 11-04: the buyer's saved card once, before anything is held. A buyer who removed it is asked to save one,
  -- and the request stays open so the seller can answer again: nothing held, nothing charged. -1 tells the seller.
  IF NOT EXISTS (SELECT 1 FROM public.declutter_buyer_cards c WHERE c.user_id = v_req.buyer_id) THEN
    PERFORM public.declutter_notify(v_req.buyer_id, 'payment', 'Save a card to get your bundle',
      'The seller wants to accept your bundle request. Save a card in Declutter so they can; it is charged only when you check out.',
      '/declutter?tab=buying', v_uid);
    RETURN -1;
  END IF;

  FOR v_row IN
    SELECT bi.item_id, bi.price_cents FROM public.declutter_bundle_request_items bi
     WHERE bi.request_id = p_request_id ORDER BY bi.item_id
  LOOP
    IF NOT v_all AND NOT (v_row.item_id = ANY (p_accept_item_ids)) THEN
      UPDATE public.declutter_bundle_request_items SET outcome = 'not_picked'
       WHERE request_id = p_request_id AND item_id = v_row.item_id;
      CONTINUE;
    END IF;
    BEGIN
      -- The buyer's checks again (card, blocks, seed rules, still live), as the buyer.
      SELECT * INTO v_item FROM public.declutter_lock_buyable_item(v_row.item_id, v_req.buyer_id);
      -- Review 11-04: a price under $1 today (made free meanwhile) is never taken through the bundle.
      IF v_item.o_seller_id <> v_uid OR least(v_row.price_cents, v_item.o_price_cents) < 100 THEN
        RAISE EXCEPTION 'item_not_available' USING ERRCODE = '55000';
      END IF;
      v_line := public.declutter_take_item(v_row.item_id, v_req.buyer_id, least(v_row.price_cents, v_item.o_price_cents),
                                           'offer', NULL);
      UPDATE public.declutter_bundle_request_items SET outcome = 'accepted', line_id = v_line
       WHERE request_id = p_request_id AND item_id = v_row.item_id;
      v_accepted := v_accepted + 1;
    EXCEPTION WHEN SQLSTATE '55000' OR SQLSTATE 'PT404' OR SQLSTATE 'P0002' OR SQLSTATE '22023' THEN
      -- Sold, held for someone else, hidden, blocked, or no longer an offers-mode sale (22023, review 11-04)
      -- meanwhile: never charged; the rest of the bundle goes on.
      UPDATE public.declutter_bundle_request_items SET outcome = 'unavailable'
       WHERE request_id = p_request_id AND item_id = v_row.item_id;
      v_gone := v_gone + 1;
    END;
  END LOOP;

  UPDATE public.declutter_bundle_requests
     SET status = CASE WHEN v_accepted > 0 THEN 'answered' ELSE 'declined' END, closed_at = now()
   WHERE id = p_request_id;
  PERFORM public.declutter_notice_ref(p_request_id); -- Q2659
  IF v_accepted > 0 THEN
    PERFORM public.declutter_notify(v_req.buyer_id, 'payment', 'Bundle accepted: pay within 24 hours',
      format('The seller accepted %s of your items%s. They are in your cart; pay within 24 hours or they go back on sale.',
             v_accepted, CASE WHEN v_gone > 0 THEN format(' (%s sold meanwhile)', v_gone) ELSE '' END),
      '/declutter?tab=buying', v_uid);
  ELSE
    PERFORM public.declutter_notify(v_req.buyer_id, 'new_offers', 'Bundle request closed',
      'The items you asked for are no longer available. Nothing was charged.', '/declutter?tab=buying', v_uid);
  END IF;
  RETURN v_accepted;
END;
$function$;

CREATE OR REPLACE FUNCTION public.declutter_withdraw_bundle(p_request_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := (SELECT auth.uid());
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  UPDATE public.declutter_bundle_requests SET status = 'withdrawn', closed_at = now()
   WHERE id = p_request_id AND buyer_id = v_uid AND status = 'open';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'bundle_not_found' USING ERRCODE = 'PT404';
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.declutter_bundle_sweep()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  r record;
  v_n integer := 0;
BEGIN
  FOR r IN
    UPDATE public.declutter_bundle_requests SET status = 'expired', closed_at = now()
     WHERE status = 'open' AND respond_by <= now()
    RETURNING id, buyer_id, seller_id
  LOOP
    PERFORM public.declutter_notify(r.buyer_id, 'new_offers', 'Bundle request expired',
      'The seller did not answer your bundle request in 48 hours. Nothing was charged.', '/declutter?tab=buying', r.seller_id);
    v_n := v_n + 1;
  END LOOP;
  RETURN v_n;
END;
$function$;

REVOKE ALL ON FUNCTION public.declutter_request_bundle(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_request_bundle(uuid[]) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.declutter_answer_bundle(uuid, uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_answer_bundle(uuid, uuid[]) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.declutter_withdraw_bundle(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_withdraw_bundle(uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.declutter_bundle_sweep() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_bundle_sweep() TO service_role;

-- The expiry sweep (Q2268): hourly. Until it runs, the next ask by the same buyer closes an expired request inline,
-- and answer_bundle refuses one past respond_by, so a late sweep never lets a seller answer an expired ask.
DO $do$
BEGIN
  IF to_regclass('public.cron_work_expectations') IS NOT NULL THEN
    INSERT INTO public.cron_work_expectations (jobname, expected_max_gap, note, work_visibility, work_exempt_reason)
    VALUES ('declutter-bundle-sweep', interval '3 hours',
            'Declutter bundle requests: hourly at :43, expires open requests past their 48-hour answer window and tells the buyer.',
            'exempt',
            'While no bundle request is past its 48 hours, a run that expires nothing is the healthy state.')
    ON CONFLICT (jobname) DO UPDATE SET expected_max_gap = EXCLUDED.expected_max_gap, note = EXCLUDED.note,
      work_visibility = EXCLUDED.work_visibility, work_exempt_reason = EXCLUDED.work_exempt_reason;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    PERFORM cron.schedule('declutter-bundle-sweep', '43 * * * *',
      $c$SELECT public.cron_record_work('declutter-bundle-sweep', to_jsonb(public.declutter_bundle_sweep()));$c$);
  END IF;
END
$do$;

