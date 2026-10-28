-- Declutter: when none of the ways the seller ticked works for a buyer, the two
-- of them talk it through in a private chat, and nobody is struck for it
-- (owner 2026-10-28, Q2462 / issue #3730: "let them chat to figure it out").
--
-- Before: the seller ticks the ways buyers can get each item
-- (20261028235247_declutter_handover_choices). Checkout refuses any other way,
-- and there is no fallback to pickup at the seller's door. So a buyer whose
-- items share no way that works for them could not check out, and the
-- missed-checkout sweep would strike them after 48 hours.
--
-- What this adds:
--   1. declutter_handover_talks + declutter_handover_talk_messages: one private
--      chat per buyer and seller with an agreed sale (a line in the buyer's
--      cart). Only the two of them read it (RLS); nobody writes the tables
--      directly (no member grant); messages go through
--      declutter_send_handover_message, run the contact-leak filter
--      (contact_leak_reason, as listings and questions do), are rate limited
--      and notify the other side at most once per 15 minutes without quoting
--      the words (kind declutter_sales: the Declutter "Sales" switch). There is no address field: the seller's address stays
--      private unless the seller types it.
--   2. declutter_pair_shared_ways(buyer, seller): the ways every in-cart line
--      between them allows (the rule declutter_handover_refused uses; NULL when
--      no line was ticked). A "sure" way needs nothing else: porch pickup, or
--      pickup at the home on an item listed before the choice.
--   3. declutter_open_handover_talk(other): either side opens it, only while
--      they have an agreed sale with no sure way. It runs 72 hours, and the
--      buyer's checkout time for those lines moves to the end of it (the
--      missed-checkout strike waits).
--   4. declutter_add_handover(item, way): the seller may ADD a way (never take
--      one away) to a listed item. The buyer's checkout time for that item
--      becomes at least 24 hours from now, and the buyer is told. The table
--      guard (declutter_items_handovers_guard) now lets a listed item gain
--      ways, still never lose them.
--   5. declutter_deadline_sweep (restated from 20261014224914; prod's body,
--      md5 3f566aab read 2026-10-28): while a talk with no sure way is open,
--      no checkout reminder says "or you get a strike"; a line that runs out
--      after such a talk ends the sale with NO strike for anyone (the item goes
--      back on sale, both are told); talks past 72 hours close.
--
-- MONEY: no amount changes and no order is made here. Only checkout times move
-- (later, never earlier), and one missed-checkout outcome gives no strike.
--
-- REPLAY-SAFE: CREATE TABLE / INDEX IF NOT EXISTS, policies dropped then
-- created, CREATE OR REPLACE. Applied 3x in PGlite
-- (src/test/pglite/declutterHandoverChoices.pglite.mjs, after 20261028235247).

-- 1. The chat.
CREATE TABLE IF NOT EXISTS public.declutter_handover_talks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  buyer_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  seller_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  opened_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  opened_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  closed_at timestamptz,
  buyer_notified_at timestamptz,
  seller_notified_at timestamptz,
  CONSTRAINT declutter_handover_talks_two_people CHECK (buyer_id <> seller_id),
  CONSTRAINT declutter_handover_talks_opener CHECK (opened_by = buyer_id OR opened_by = seller_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS declutter_handover_talks_one_open
  ON public.declutter_handover_talks (buyer_id, seller_id) WHERE closed_at IS NULL;
CREATE INDEX IF NOT EXISTS declutter_handover_talks_seller_idx ON public.declutter_handover_talks (seller_id);
ALTER TABLE public.declutter_handover_talks ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.declutter_handover_talks FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.declutter_handover_talks TO authenticated;
GRANT ALL ON TABLE public.declutter_handover_talks TO service_role;
DROP POLICY IF EXISTS "declutter handover talks: the two people" ON public.declutter_handover_talks;
CREATE POLICY "declutter handover talks: the two people" ON public.declutter_handover_talks
  FOR SELECT TO authenticated
  USING ((SELECT auth.uid()) = buyer_id OR (SELECT auth.uid()) = seller_id);

CREATE TABLE IF NOT EXISTS public.declutter_handover_talk_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  talk_id uuid NOT NULL REFERENCES public.declutter_handover_talks(id) ON DELETE CASCADE,
  sender_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  body text NOT NULL CHECK (char_length(btrim(body)) BETWEEN 1 AND 1000),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS declutter_handover_talk_messages_talk_idx
  ON public.declutter_handover_talk_messages (talk_id, created_at);
CREATE INDEX IF NOT EXISTS declutter_handover_talk_messages_sender_idx
  ON public.declutter_handover_talk_messages (sender_id, created_at);
ALTER TABLE public.declutter_handover_talk_messages ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.declutter_handover_talk_messages FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.declutter_handover_talk_messages TO authenticated;
GRANT ALL ON TABLE public.declutter_handover_talk_messages TO service_role;
DROP POLICY IF EXISTS "declutter handover messages: the two people" ON public.declutter_handover_talk_messages;
CREATE POLICY "declutter handover messages: the two people" ON public.declutter_handover_talk_messages
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.declutter_handover_talks t
                  WHERE t.id = talk_id
                    AND ((SELECT auth.uid()) = t.buyer_id OR (SELECT auth.uid()) = t.seller_id)));

-- Q807: writes from an unconfirmed email are refused on every public table (the gate's own statement trigger).
DO $do$
BEGIN
  IF to_regprocedure('public.attach_unconfirmed_email_gate()') IS NOT NULL THEN
    PERFORM public.attach_unconfirmed_email_gate();
  END IF;
END
$do$;

-- The contact-leak filter, as on listings and questions (contact_leak_reason).
CREATE OR REPLACE FUNCTION public.reject_contact_leak_in_declutter_talk()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_reason text := public.contact_leak_reason(NEW.body);
BEGIN
  IF v_reason IS NOT NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = 'check_violation',
      MESSAGE = v_reason || ' in the message. Keep contact details and payment out of the chat; agree the handover here.';
  END IF;
  RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION public.reject_contact_leak_in_declutter_talk() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_reject_contact_leak_in_declutter_talk ON public.declutter_handover_talk_messages;
CREATE TRIGGER trg_reject_contact_leak_in_declutter_talk
  BEFORE INSERT OR UPDATE OF body ON public.declutter_handover_talk_messages
  FOR EACH ROW EXECUTE FUNCTION public.reject_contact_leak_in_declutter_talk();

-- 2. The ways every in-cart line between a buyer and a seller allows (declutter_handover_refused's rule).
--    NULL when no line was ticked (items listed before the choice: every way).
CREATE OR REPLACE FUNCTION public.declutter_pair_shared_ways(p_buyer uuid, p_seller uuid)
RETURNS text[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
  WITH lines AS (
    SELECT CASE WHEN i.handovers IS NOT NULL THEN i.handovers
                WHEN NOT i.porch_ok THEN ARRAY['pickup_home', 'seller_delivery', 'meetup', 'delivery']
           END AS ways,
           i.handovers IS NOT NULL AS ticked
      FROM public.declutter_cart_items c JOIN public.declutter_items i ON i.id = c.item_id
     WHERE c.buyer_id = p_buyer AND c.seller_id = p_seller AND c.status = 'in_cart'
  )
  SELECT CASE WHEN EXISTS (SELECT 1 FROM lines l WHERE l.ticked) THEN
    ARRAY(SELECT w FROM unnest(ARRAY['porch', 'pickup_home', 'seller_delivery', 'meetup', 'delivery']) AS w
           WHERE NOT EXISTS (SELECT 1 FROM lines l WHERE l.ways IS NOT NULL AND NOT (w = ANY (l.ways))))
  END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_pair_shared_ways(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_pair_shared_ways(uuid, uuid) TO service_role;

-- True when the pair has an agreed sale and no shared way that always works (porch pickup, or the home on an
-- item listed before the choice): then a talk may open, and while one is open the strike waits.
CREATE OR REPLACE FUNCTION public.declutter_pair_needs_talk(p_buyer uuid, p_seller uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT EXISTS (SELECT 1 FROM public.declutter_cart_items c
                  WHERE c.buyer_id = p_buyer AND c.seller_id = p_seller AND c.status = 'in_cart')
     AND COALESCE(NOT (public.declutter_pair_shared_ways(p_buyer, p_seller) && ARRAY['porch', 'pickup_home']), false);
$fn$;
REVOKE ALL ON FUNCTION public.declutter_pair_needs_talk(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_pair_needs_talk(uuid, uuid) TO service_role;

-- 3. Open the talk (either side). Returns the open talk's id (the same one if it is already open).
CREATE OR REPLACE FUNCTION public.declutter_open_handover_talk(p_other uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid;
  v_buyer uuid;
  v_seller uuid;
  v_talk public.declutter_handover_talks%ROWTYPE;
  v_title text;
BEGIN
  PERFORM public.require_feature('declutter');
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  v_uid := (SELECT auth.uid());
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF p_other IS NULL OR p_other = v_uid THEN
    RAISE EXCEPTION 'no_agreed_sale' USING ERRCODE = 'P0002';
  END IF;
  -- Which side the caller is on: there must be an agreed sale (a line in the buyer's cart) between them.
  IF EXISTS (SELECT 1 FROM public.declutter_cart_items c
              WHERE c.buyer_id = v_uid AND c.seller_id = p_other AND c.status = 'in_cart') THEN
    v_buyer := v_uid; v_seller := p_other;
  ELSIF EXISTS (SELECT 1 FROM public.declutter_cart_items c
                 WHERE c.buyer_id = p_other AND c.seller_id = v_uid AND c.status = 'in_cart') THEN
    v_buyer := p_other; v_seller := v_uid;
  ELSE
    RAISE EXCEPTION 'no_agreed_sale' USING ERRCODE = 'P0002';
  END IF;
  IF public.are_users_blocked(v_buyer, v_seller) THEN
    RAISE EXCEPTION 'talk_blocked' USING ERRCODE = '42501';
  END IF;
  -- One per pair at a time, serialised so two taps open one talk.
  PERFORM pg_advisory_xact_lock(hashtext('declutter_talk:' || v_buyer::text || ':' || v_seller::text));
  SELECT * INTO v_talk FROM public.declutter_handover_talks t
   WHERE t.buyer_id = v_buyer AND t.seller_id = v_seller AND t.closed_at IS NULL AND t.expires_at > now();
  IF FOUND THEN
    RETURN v_talk.id;
  END IF;
  -- Only when no way that always works is shared (otherwise the buyer can check out with it).
  IF NOT public.declutter_pair_needs_talk(v_buyer, v_seller) THEN
    RAISE EXCEPTION 'handover_way_open' USING ERRCODE = '22023',
      HINT = 'Porch pickup works for these items. Choose it at checkout.';
  END IF;
  -- One talk a week per pair, so the strike wait cannot be stretched by reopening.
  IF EXISTS (SELECT 1 FROM public.declutter_handover_talks t
              WHERE t.buyer_id = v_buyer AND t.seller_id = v_seller AND t.opened_at > now() - interval '7 days') THEN
    RAISE EXCEPTION 'talk_recently_closed' USING ERRCODE = '22023',
      HINT = 'You already talked about this sale this week.';
  END IF;
  UPDATE public.declutter_handover_talks SET closed_at = now()
   WHERE buyer_id = v_buyer AND seller_id = v_seller AND closed_at IS NULL;
  INSERT INTO public.declutter_handover_talks (buyer_id, seller_id, opened_by, expires_at)
  VALUES (v_buyer, v_seller, v_uid, now() + interval '72 hours')
  RETURNING * INTO v_talk;
  -- The strike waits: the buyer's checkout time for these lines runs to the end of the talk (never earlier).
  UPDATE public.declutter_cart_items c
     SET checkout_by = GREATEST(c.checkout_by, v_talk.expires_at), reminded_24h_at = NULL, reminded_2h_at = NULL
   WHERE c.buyer_id = v_buyer AND c.seller_id = v_seller AND c.status = 'in_cart' AND c.checkout_by > now();
  SELECT i.title INTO v_title
    FROM public.declutter_cart_items c JOIN public.declutter_items i ON i.id = c.item_id
   WHERE c.buyer_id = v_buyer AND c.seller_id = v_seller AND c.status = 'in_cart'
   ORDER BY c.created_at LIMIT 1;
  PERFORM public.declutter_notify(CASE WHEN v_uid = v_buyer THEN v_seller ELSE v_buyer END, 'declutter_sales',
    'Let''s agree the handover',
    format('%s wants to agree how "%s" gets handed over. Open the chat to sort it out.',
           CASE WHEN v_uid = v_buyer THEN 'The buyer' ELSE 'The seller' END, v_title),
    -- The recipient's own tab, with the chat open on it (DeclutterPage reads ?talk=).
    CASE WHEN v_uid = v_buyer THEN '/declutter?tab=selling&talk=' ELSE '/declutter?tab=buying&talk=' END || v_talk.id::text, v_uid);
  RETURN v_talk.id;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_open_handover_talk(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_open_handover_talk(uuid) TO authenticated, service_role;

-- A message in the talk.
CREATE OR REPLACE FUNCTION public.declutter_send_handover_message(p_talk_id uuid, p_body text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid;
  v_talk public.declutter_handover_talks%ROWTYPE;
  v_id uuid;
  v_to uuid;
  v_body text := btrim(COALESCE(p_body, ''));
BEGIN
  PERFORM public.require_feature('declutter');
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  v_uid := (SELECT auth.uid());
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_talk FROM public.declutter_handover_talks t
   WHERE t.id = p_talk_id AND (t.buyer_id = v_uid OR t.seller_id = v_uid)
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'talk_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_talk.closed_at IS NOT NULL OR v_talk.expires_at <= now() THEN
    RAISE EXCEPTION 'talk_closed' USING ERRCODE = '22023', HINT = 'This chat has ended.';
  END IF;
  IF public.are_users_blocked(v_talk.buyer_id, v_talk.seller_id) THEN
    RAISE EXCEPTION 'talk_blocked' USING ERRCODE = '42501';
  END IF;
  IF char_length(v_body) < 1 OR char_length(v_body) > 1000 THEN
    RAISE EXCEPTION 'invalid_message' USING ERRCODE = '22023', HINT = 'Write a message of up to 1,000 characters.';
  END IF;
  -- At most 30 messages an hour from one person in one talk.
  IF (SELECT count(*) FROM public.declutter_handover_talk_messages m
       WHERE m.talk_id = p_talk_id AND m.sender_id = v_uid AND m.created_at > now() - interval '1 hour') >= 30 THEN
    RAISE EXCEPTION 'message_rate_limited' USING ERRCODE = '42501', HINT = 'Slow down a little, then send again.';
  END IF;
  INSERT INTO public.declutter_handover_talk_messages (talk_id, sender_id, body)
  VALUES (p_talk_id, v_uid, v_body)
  RETURNING id INTO v_id;
  -- Tell the other side, at most once per 15 minutes, never with the words themselves.
  v_to := CASE WHEN v_uid = v_talk.buyer_id THEN v_talk.seller_id ELSE v_talk.buyer_id END;
  IF (v_to = v_talk.buyer_id AND (v_talk.buyer_notified_at IS NULL OR v_talk.buyer_notified_at < now() - interval '15 minutes'))
     OR (v_to = v_talk.seller_id AND (v_talk.seller_notified_at IS NULL OR v_talk.seller_notified_at < now() - interval '15 minutes')) THEN
    PERFORM public.declutter_notify(v_to, 'declutter_sales', 'New message about a handover',
      format('The %s sent you a message about how to hand over your Declutter sale.',
             CASE WHEN v_uid = v_talk.buyer_id THEN 'buyer' ELSE 'seller' END),
      CASE WHEN v_to = v_talk.buyer_id THEN '/declutter?tab=buying&talk=' ELSE '/declutter?tab=selling&talk=' END || p_talk_id::text, v_uid);
    UPDATE public.declutter_handover_talks
       SET buyer_notified_at = CASE WHEN v_to = buyer_id THEN now() ELSE buyer_notified_at END,
           seller_notified_at = CASE WHEN v_to = seller_id THEN now() ELSE seller_notified_at END
     WHERE id = p_talk_id;
  END IF;
  RETURN v_id;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_send_handover_message(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_send_handover_message(uuid, text) TO authenticated, service_role;

-- 4. The seller adds a way to a listed item (never takes one away).
CREATE OR REPLACE FUNCTION public.declutter_add_handover(p_item_id uuid, p_way text)
RETURNS text[]
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid;
  v_item public.declutter_items%ROWTYPE;
  v_ways text[];
  r record;
BEGIN
  PERFORM public.require_feature('declutter');
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  v_uid := public.declutter_assert_member(true);
  IF p_way IS NULL OR p_way NOT IN ('porch', 'seller_delivery', 'meetup', 'delivery') THEN
    RAISE EXCEPTION 'invalid_handovers' USING ERRCODE = '22023',
      HINT = 'Add porch pickup, you deliver, a safe meeting spot or Helpr delivery.';
  END IF;
  SELECT * INTO v_item FROM public.declutter_items WHERE id = p_item_id AND seller_id = v_uid FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_item.status NOT IN ('live', 'reserved', 'paused') OR v_item.handovers IS NULL THEN
    RAISE EXCEPTION 'item_not_editable' USING ERRCODE = '22023';
  END IF;
  -- A free item is claimed through the free checkout, which takes porch pickup only.
  IF v_item.price_cents = 0 AND p_way <> 'porch' THEN
    RAISE EXCEPTION 'invalid_handovers' USING ERRCODE = '22023', HINT = 'A free item is picked up from your porch.';
  END IF;
  IF p_way = ANY (v_item.handovers) THEN
    RETURN v_item.handovers;
  END IF;
  SELECT array_agg(DISTINCT w ORDER BY w) INTO v_ways FROM unnest(v_item.handovers || ARRAY[p_way]) AS w;
  UPDATE public.declutter_items
     SET handovers = v_ways, porch_ok = ('porch' = ANY (v_ways)), updated_at = now()
   WHERE id = p_item_id;
  -- The buyer gets at least a day to check out with the new way, and is told.
  FOR r IN
    UPDATE public.declutter_cart_items c
       SET checkout_by = GREATEST(c.checkout_by, now() + interval '24 hours'), reminded_24h_at = NULL, reminded_2h_at = NULL
     WHERE c.item_id = p_item_id AND c.status = 'in_cart'
    RETURNING c.buyer_id
  LOOP
    PERFORM public.declutter_notify(r.buyer_id, 'declutter_sales', 'The seller added a way to get it',
      format('The seller added %s for "%s". You have at least 24 hours to check out.',
             CASE p_way WHEN 'porch' THEN 'porch pickup' WHEN 'seller_delivery' THEN 'delivery by the seller'
                        WHEN 'meetup' THEN 'a safe meeting spot' ELSE 'Helpr delivery' END, v_item.title),
      '/declutter?view=cart', v_uid);
  END LOOP;
  RETURN v_ways;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_add_handover(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_add_handover(uuid, text) TO authenticated, service_role;

-- The table guard (restated from 20261028235247): a listed item may GAIN ways (declutter_add_handover), never
-- lose them; the porch_ok sync is unchanged.
CREATE OR REPLACE FUNCTION public.declutter_items_handovers_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $fn$
BEGIN
  IF NEW.handovers IS DISTINCT FROM OLD.handovers AND OLD.status <> 'draft'
     AND NOT (OLD.handovers IS NOT NULL AND NEW.handovers IS NOT NULL AND OLD.handovers <@ NEW.handovers) THEN
    RAISE EXCEPTION 'item_not_editable' USING ERRCODE = '22023',
      HINT = 'Once listed, you can add ways buyers can get it, not take them away.';
  END IF;
  IF NEW.porch_ok IS DISTINCT FROM OLD.porch_ok AND NEW.handovers IS NOT NULL
     AND NEW.handovers IS NOT DISTINCT FROM OLD.handovers THEN
    NEW.handovers := CASE WHEN NEW.porch_ok
      THEN (SELECT array_agg(DISTINCT w ORDER BY w) FROM unnest(NEW.handovers || ARRAY['porch']) AS w)
      ELSE array_remove(NEW.handovers, 'porch') END;
    IF cardinality(NEW.handovers) < 1 THEN
      RAISE EXCEPTION 'invalid_handovers' USING ERRCODE = '22023',
        HINT = 'Porch pickup is the only way buyers can get this item. Tick another way first.';
    END IF;
  END IF;
  RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_items_handovers_guard() FROM PUBLIC, anon, authenticated;

-- The porch freeze (restated from 20261017055504_declutter_porch_default.sql): a listed item may now turn porch
-- pickup ON (declutter_add_handover), never OFF, so an open porch order is never moved under.
CREATE OR REPLACE FUNCTION public.declutter_items_porch_frozen()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $fn$
BEGIN
  IF NEW.porch_ok IS DISTINCT FROM OLD.porch_ok AND OLD.status <> 'draft'
     AND NOT (OLD.porch_ok IS FALSE AND NEW.porch_ok IS TRUE) THEN
    RAISE EXCEPTION 'item_not_editable' USING ERRCODE = '22023',
      HINT = 'Porch pickup can only be turned off while the listing is a draft.';
  END IF;
  RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_items_porch_frozen() FROM PUBLIC, anon, authenticated;

-- 5. The deadline sweep (restated from 20261014224914_declutter_slice3b_payments.sql; the marked parts are new).
-- While the two are talking the handover through (an open talk, no sure way), no reminder threatens a strike.
CREATE OR REPLACE FUNCTION public.declutter_pair_talking(p_buyer uuid, p_seller uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT EXISTS (SELECT 1 FROM public.declutter_handover_talks t
                  WHERE t.buyer_id = p_buyer AND t.seller_id = p_seller AND t.closed_at IS NULL AND t.expires_at > now())
     AND public.declutter_pair_needs_talk(p_buyer, p_seller);
$fn$;
REVOKE ALL ON FUNCTION public.declutter_pair_talking(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_pair_talking(uuid, uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.declutter_deadline_sweep()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_expired integer := 0;
  v_r24 integer := 0;
  v_r2 integer := 0;
  v_missed integer := 0;
  v_unstruck integer := 0;
  v_talked integer := 0;
  r record;
  v_line record;
BEGIN
  FOR r IN
    UPDATE public.declutter_offers o
       SET status = 'expired', closed_at = now(), updated_at = now()
     WHERE o.status = 'open' AND o.respond_by <= now()
    RETURNING o.id, o.buyer_id, o.seller_id, o.awaiting, o.item_id
  LOOP
    v_expired := v_expired + 1;
    INSERT INTO public.declutter_offer_events (offer_id, actor_side, action) VALUES (r.id, 'system', 'expire');
    PERFORM public.declutter_notify(r.buyer_id, 'expired', 'Offer expired',
      CASE WHEN r.awaiting = 'seller' THEN 'The seller did not answer your offer within 48 hours, so it closed. Nothing was charged.'
           ELSE 'You did not answer the counteroffer within 48 hours, so it closed.' END,
      '/declutter/item/' || r.item_id::text, r.seller_id);
    PERFORM public.declutter_notify(r.seller_id, 'expired', 'Offer expired',
      CASE WHEN r.awaiting = 'seller' THEN 'You did not answer an offer within 48 hours, so it closed.'
           ELSE 'The buyer did not answer your counteroffer within 48 hours, so it closed.' END,
      '/declutter?tab=selling', r.buyer_id);
  END LOOP;

  FOR r IN
    UPDATE public.declutter_cart_items c SET reminded_24h_at = now()
     WHERE c.status = 'in_cart' AND c.reminded_24h_at IS NULL
       AND c.checkout_by > now() + interval '2 hours'
       AND c.checkout_by <= now() + interval '24 hours'
       -- 20261028235249: not while the buyer and seller are talking the handover through.
       AND NOT public.declutter_pair_talking(c.buyer_id, c.seller_id)
    RETURNING c.buyer_id
  LOOP
    v_r24 := v_r24 + 1;
    PERFORM public.declutter_notify(r.buyer_id, 'payment', 'Check out within 24 hours',
      'You have an item waiting in your cart. Check out within 24 hours or you get a strike.', '/declutter?view=cart');
  END LOOP;
  FOR r IN
    UPDATE public.declutter_cart_items c SET reminded_2h_at = now()
     WHERE c.status = 'in_cart' AND c.reminded_2h_at IS NULL
       AND c.checkout_by > now() AND c.checkout_by <= now() + interval '2 hours'
       -- 20261028235249: not while the buyer and seller are talking the handover through.
       AND NOT public.declutter_pair_talking(c.buyer_id, c.seller_id)
    RETURNING c.buyer_id
  LOOP
    v_r2 := v_r2 + 1;
    PERFORM public.declutter_notify(r.buyer_id, 'payment', '2 hours left to check out',
      'Check out in the next 2 hours or you get a strike and the item goes back up for sale.', '/declutter?view=cart');
  END LOOP;

  -- Missed checkouts. Lock order items -> orders -> lines, one line at a time.
  FOR r IN
    SELECT c.id, c.item_id
      FROM public.declutter_cart_items c
     WHERE c.status = 'in_cart' AND c.checkout_by <= now()
     ORDER BY c.item_id
  LOOP
    PERFORM 1 FROM public.declutter_items i WHERE i.id = r.item_id FOR UPDATE;
    SELECT c.*, i.title INTO v_line
      FROM public.declutter_cart_items c JOIN public.declutter_items i ON i.id = c.item_id
     WHERE c.id = r.id;
    IF v_line.status <> 'in_cart' THEN CONTINUE; END IF;
    -- Grace: a payable order gets 1 h past the deadline (its Stripe page lives
    -- at most 30 min, so by then it can no longer be paid; B45).
    IF v_line.order_id IS NOT NULL
       AND EXISTS (SELECT 1 FROM public.declutter_orders o
                    WHERE o.id = v_line.order_id AND o.status = 'awaiting_payment'
                      AND v_line.checkout_by > now() - interval '1 hour') THEN
      CONTINUE;
    END IF;
    BEGIN
      -- Who stopped this checkout? A seller who blocked the buyer backed out
      -- (row 19: seller strike); a seller who can no longer sell ends it with
      -- no strike for the buyer; otherwise the buyer missed it (rows 7, 59).
      -- user_blocks is read directly: are_users_blocked() answers only for
      -- parties or server context.
      IF EXISTS (SELECT 1 FROM public.user_blocks b
                  WHERE b.blocker_id = v_line.seller_id AND b.blocked_id = v_line.buyer_id) THEN
        UPDATE public.declutter_orders SET status = 'expired', close_reason = 'seller_blocked', closed_at = now()
         WHERE id = v_line.order_id AND status = 'awaiting_payment';
        UPDATE public.declutter_cart_items SET status = 'cancelled_by_seller', closed_at = now()
         WHERE id = r.id AND status = 'in_cart';
        UPDATE public.declutter_items SET status = 'withdrawn', updated_at = now()
         WHERE id = v_line.item_id AND status = 'reserved';
        PERFORM public.declutter_notify(v_line.buyer_id, 'payment', 'The seller cancelled',
          format('The seller cancelled the sale of "%s". You were not charged and you get no strike.', v_line.title),
          '/declutter?view=cart', v_line.seller_id);
        PERFORM public.declutter_give_strike(v_line.seller_id, 'seller', 'cancelled_after_offers', v_line.item_id,
          format('You blocked the buyer of "%s" after the sale, which cancels it.', v_line.title), v_line.id);
      ELSIF public.declutter_seller_out(v_line.seller_id) THEN
        UPDATE public.declutter_orders SET status = 'expired', close_reason = 'seller_out', closed_at = now()
         WHERE id = v_line.order_id AND status = 'awaiting_payment';
        UPDATE public.declutter_cart_items SET status = 'cancelled_by_seller', closed_at = now()
         WHERE id = r.id AND status = 'in_cart';
        UPDATE public.declutter_items SET status = 'ended', updated_at = now()
         WHERE id = v_line.item_id AND status = 'reserved';
        PERFORM public.declutter_notify(v_line.buyer_id, 'payment', 'This sale was cancelled',
          format('"%s" can''t be sold right now, so the sale is cancelled. You were not charged and you get no strike.', v_line.title),
          '/declutter?view=cart');
      -- 20261028235249 (owner 2026-10-28, Q2462 #3730): the two talked about the handover and no way that always
      -- works was shared, so the buyer could not check out: the sale ends with no strike for anyone.
      ELSIF public.declutter_pair_needs_talk(v_line.buyer_id, v_line.seller_id)
            AND EXISTS (SELECT 1 FROM public.declutter_handover_talks t
                         WHERE t.buyer_id = v_line.buyer_id AND t.seller_id = v_line.seller_id
                           AND t.opened_at >= v_line.created_at) THEN
        UPDATE public.declutter_orders SET status = 'expired', close_reason = 'not_payable', closed_at = now()
         WHERE id = v_line.order_id AND status = 'awaiting_payment';
        UPDATE public.declutter_cart_items SET status = 'missed', closed_at = now()
         WHERE id = r.id AND status = 'in_cart';
        IF FOUND THEN
          v_talked := v_talked + 1;
          UPDATE public.declutter_items SET status = 'live', updated_at = now()
           WHERE id = v_line.item_id AND status = 'reserved';
          PERFORM public.declutter_notify(v_line.buyer_id, 'declutter_sales', 'Sale ended, no strike',
            format('You and the seller didn''t find a way to hand over "%s", so the sale ended. You were not charged and nobody gets a strike.', v_line.title),
            '/declutter?view=cart', v_line.seller_id);
          PERFORM public.declutter_notify(v_line.seller_id, 'declutter_sales', 'Sale ended, no strike',
            format('You and the buyer didn''t find a way to hand over "%s", so the sale ended and it is back up for sale. Nobody gets a strike.', v_line.title),
            '/declutter?tab=selling', v_line.buyer_id);
        END IF;
      ELSE
        UPDATE public.declutter_orders SET status = 'expired', close_reason = 'missed_checkout', closed_at = now()
         WHERE id = v_line.order_id AND status = 'awaiting_payment';
        UPDATE public.declutter_cart_items SET status = 'missed', closed_at = now()
         WHERE id = r.id AND status = 'in_cart';
        IF FOUND THEN
          v_missed := v_missed + 1;
          -- Back on sale (rows 13/59).
          UPDATE public.declutter_items SET status = 'live', updated_at = now()
           WHERE id = v_line.item_id AND status = 'reserved';
          IF public.feature_enabled_for_user('declutter', v_line.buyer_id) THEN
            PERFORM public.declutter_give_strike(v_line.buyer_id, 'buyer', 'missed_checkout', v_line.item_id,
              format('You did not check out "%s" within 48 hours.', v_line.title), v_line.id);
          ELSE
            -- Row 62: the switch was turned off for this buyer mid-sale.
            v_unstruck := v_unstruck + 1;
            PERFORM public.declutter_notify(v_line.buyer_id, 'payment', 'Checkout closed',
              format('Checkout for "%s" closed. You were not charged and you get no strike.', v_line.title),
              '/declutter?view=cart', v_line.seller_id);
          END IF;
          PERFORM public.declutter_notify(v_line.seller_id, 'new_offers', 'Buyer did not check out',
            format('The buyer did not pay for "%s" in time, so it is back up for sale.', v_line.title), '/declutter?tab=selling', v_line.buyer_id);
        END IF;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      -- One bad line never stops every other missed checkout; it is retried
      -- on the next run (the line is still in_cart) and filed where ops reads it.
      PERFORM public.log_cron_defect('declutter_deadline_sweep', r.id::text, SQLERRM);
    END;
  END LOOP;

  -- 20261028235249: talks past their 72 hours close (after the lines above were judged with them).
  UPDATE public.declutter_handover_talks SET closed_at = now()
   WHERE closed_at IS NULL AND expires_at <= now();

  RETURN jsonb_build_object('offers_expired', v_expired, 'reminded_24h', v_r24,
                            'reminded_2h', v_r2, 'checkouts_missed', v_missed, 'missed_without_strike', v_unstruck,
                            'ended_after_talk', v_talked);
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_deadline_sweep() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_deadline_sweep() TO service_role;
