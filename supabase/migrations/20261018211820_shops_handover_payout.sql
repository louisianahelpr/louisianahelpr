-- Shops M2: the handover and the shop's payout (docs/specs/local-shops-prep.md
-- L23, L40; plan ~/.lh-wt/handoffs-1017/shops-s3-plan.md, WHOLE SHOPS PRODUCT M2).
--
-- HANDOVER (owner pop-up via the lead, 2026-10-18: THE SHOP'S CHOICE, NO codes
-- anywhere, NO QR). shops.handover_mode, set by shops_set_handover_mode, frozen
-- on each order at insert (trigger), default for a shop 'in_person':
--   'porch'     "Left out": the shop marks the order ready WITH a required
--               photo (shops_mark_ready); the buyer taps "I got it"
--               (shops_confirm_pickup); else the automatic finish, which needs
--               that photo.
--   'in_person' "Pick up in person" at the shop: the buyer taps "I got it";
--               else the automatic finish. A ready tap (photo optional) tells
--               the buyer.
--   THE BUYER MUST CONFIRM (owner pop-up via the lead, 2026-10-18 ~21:00Z):
--   an order completes ONLY by the buyer's "I got it" (shops_confirm_pickup),
--   the automatic finish below, or an admin. The SHOP can never complete its
--   own order: there is no shop "Picked up" RPC, and shop_complete_handover
--   refuses any method but 'buyer', 'auto' and 'admin'
--   (src/test/pglite/shopsHandoverPayout.pglite.mjs proves no member RPC lets
--   the shop finish it).
--   shop_handover_sweep (declutter-money, every 10 minutes) finishes an order
--   24 hours after the end of its ready date (Louisiana time), or after the
--   ready tap if later. A porch order without its ready photo never finishes
--   on its own: the photo is the evidence.
--   shops_report_not_received (AS THE BUYER) stops the automatic finish and
--   the payout until Louisiana Helpr decides (the decision and its refund are
--   M3/M4, Q2156); every admin is told. It is open from the ready date (or
--   the shop's ready tap) until the handover.
--   FREE CANCEL under the "cancel any time before pickup" preset
--   ('until_handover') closes when the ready date begins or at the shop's
--   ready tap, whichever is first, never at the handover (owner pop-up
--   2026-10-18 ~22:30Z, Q2155): shop_order_free_cancel_until, section 7.
--
-- PAYOUT (L40, owner F1: the shop keeps 100% of its prices; the buyer's fee
-- and the sales tax are not the shop's): ONE shop_payouts row per order, ever
-- (UNIQUE order_id), written at the handover by shop_complete_handover:
-- amount = items - the seller's card-fee debt (declutter_consume_fee_debt,
-- ONE ledger per seller across Declutter and Shops, payout_ref
-- 'shop_order_<id>', idempotent). A row is written even when the debt took
-- everything ('nothing_due'). declutter-money sends it (shop_payouts_due ->
-- Stripe transfer from the order's own charge, transfer_group
-- 'shop_order_<id>', the group shop-checkout set; payout holds, ban review and
-- the Stripe mode as for Declutter) and reports back with shop_payout_executed.
--
-- ONE TRANSITION: an order leaves 'accepted' for 'handed_over' exactly once,
-- under its row lock, with a status predicate; "I got it", the sweep and a
-- second tap can never both win, and the payout row is written at most once.
--
-- L91: none of these RPCs needs the 'shops' switch (an accepted order finishes).
--
-- No person column on the two new tables (the order carries the parties, and
-- export_my_data's shop_orders section already exports them), so Download My
-- Data is unchanged; there is no '*_by' column (dataExportInventory reads those
-- as people).
--
-- Replay-safe: IF NOT EXISTS / OR REPLACE / DROP ... IF EXISTS; constraint swaps
-- in DO blocks; ON CONFLICT on the bucket. Grants by role name; REVOKE ... FROM
-- PUBLIC, anon (and authenticated for the service steps). Applied 3x by the
-- PGlite proof src/test/pglite/shopsHandoverPayout.pglite.mjs.

-- ---------------------------------------------------------------------------
-- 0. The order: when it was handed over, and 'handed_over' as a close reason.
ALTER TABLE public.shop_orders ADD COLUMN IF NOT EXISTS handed_over_at timestamptz;
GRANT SELECT (handed_over_at) ON TABLE public.shop_orders TO authenticated;
DO $do$
BEGIN
  ALTER TABLE public.shop_orders DROP CONSTRAINT IF EXISTS shop_orders_close_reason_check;
  ALTER TABLE public.shop_orders ADD CONSTRAINT shop_orders_close_reason_check CHECK (close_reason IS NULL OR close_reason IN (
    'superseded', 'page_unpaid', 'no_answer', 'declined', 'buyer_cancelled', 'hold_lost',
    'capture_gave_up', 'order_closed', 'amount_mismatch', 'day_full',
    'handed_over'));
  -- A handed-over order was captured, and only a handed-over order has a handover time.
  ALTER TABLE public.shop_orders DROP CONSTRAINT IF EXISTS shop_orders_handed_over_captured;
  ALTER TABLE public.shop_orders ADD CONSTRAINT shop_orders_handed_over_captured CHECK (
    status <> 'handed_over' OR (captured_at IS NOT NULL AND handed_over_at IS NOT NULL));
END
$do$;

-- The shop's handover choice, and the order's frozen copy of it.
ALTER TABLE public.shops ADD COLUMN IF NOT EXISTS handover_mode text NOT NULL DEFAULT 'in_person';
ALTER TABLE public.shop_orders ADD COLUMN IF NOT EXISTS handover_mode text NOT NULL DEFAULT 'in_person';
DO $do$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'shops_handover_mode_check') THEN
    ALTER TABLE public.shops ADD CONSTRAINT shops_handover_mode_check CHECK (handover_mode IN ('porch', 'in_person'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'shop_orders_handover_mode_check') THEN
    ALTER TABLE public.shop_orders ADD CONSTRAINT shop_orders_handover_mode_check CHECK (handover_mode IN ('porch', 'in_person'));
  END IF;
END
$do$;
GRANT SELECT (handover_mode) ON TABLE public.shops TO authenticated;
GRANT SELECT (handover_mode) ON TABLE public.shop_orders TO authenticated;

-- Frozen at birth from the shop (whoever inserts: shops_request_order is not
-- restated), and never changed after: a later switch of the shop's setting
-- never moves an order already asked for.
CREATE OR REPLACE FUNCTION public.shop_orders_handover_mode_frozen()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $fn$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.handover_mode := COALESCE((SELECT s.handover_mode FROM public.shops s WHERE s.id = NEW.shop_id), 'in_person');
  ELSIF NEW.handover_mode IS DISTINCT FROM OLD.handover_mode THEN
    RAISE EXCEPTION 'handover_mode_frozen' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION public.shop_orders_handover_mode_frozen() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_shop_orders_handover_mode ON public.shop_orders;
CREATE TRIGGER trg_shop_orders_handover_mode BEFORE INSERT OR UPDATE OF handover_mode ON public.shop_orders
  FOR EACH ROW EXECUTE FUNCTION public.shop_orders_handover_mode_frozen();

-- The shop picks (as shops_set_cancel_policy).
CREATE OR REPLACE FUNCTION public.shops_set_handover_mode(p_mode text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid;
BEGIN
  PERFORM public.require_feature('shops');
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  v_uid := public.shops_assert_owner_eligible();
  IF p_mode IS NULL OR p_mode NOT IN ('porch', 'in_person') THEN
    RAISE EXCEPTION 'invalid_handover_mode' USING ERRCODE = '22023';
  END IF;
  UPDATE public.shops SET handover_mode = p_mode, updated_at = now() WHERE owner_id = v_uid;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'shop_not_found' USING ERRCODE = 'P0002';
  END IF;
  RETURN p_mode;
END;
$fn$;
REVOKE ALL ON FUNCTION public.shops_set_handover_mode(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.shops_set_handover_mode(text) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 1. A PRIVATE bucket for the ready photos (Declutter's lesson,
--    20261017055502: handover photos never go in a public bucket).
--    Path: <uid>/shops/handover/<order id>/<file>.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('shop-handover', 'shop-handover', false, 10 * 1024 * 1024, ARRAY['image/jpeg'])
ON CONFLICT (id) DO UPDATE SET
  public = false,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

CREATE OR REPLACE FUNCTION public.shop_handover_photo_access(p_name text, p_write boolean)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_order uuid;
BEGIN
  IF v_uid IS NULL OR p_name IS NULL OR p_write IS NULL
     -- Exactly <uid>/shops/handover/<order>/<file>: no extra or empty segments.
     OR array_length(string_to_array(p_name, '/'), 1) IS DISTINCT FROM 5
     OR split_part(p_name, '/', 2) IS DISTINCT FROM 'shops'
     OR split_part(p_name, '/', 3) IS DISTINCT FROM 'handover'
     OR split_part(p_name, '/', 4) !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     OR split_part(p_name, '/', 5) = '' THEN
    RETURN false;
  END IF;
  v_order := split_part(p_name, '/', 4)::uuid;
  IF p_write THEN
    -- Only the shop, into its own folder, for its own charged order not yet handed over.
    RETURN split_part(p_name, '/', 1) = v_uid::text
       AND EXISTS (SELECT 1 FROM public.shop_orders o
                    WHERE o.id = v_order AND o.seller_id = v_uid AND o.status = 'accepted' AND o.captured_at IS NOT NULL);
  END IF;
  RETURN public.has_role(v_uid, 'admin')
      OR EXISTS (SELECT 1 FROM public.shop_orders o
                  WHERE o.id = v_order AND (o.buyer_id = v_uid OR o.seller_id = v_uid));
END;
$fn$;
REVOKE ALL ON FUNCTION public.shop_handover_photo_access(text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.shop_handover_photo_access(text, boolean) TO authenticated, service_role;

DROP POLICY IF EXISTS "shop-handover: the shop uploads into its own folder" ON storage.objects;
CREATE POLICY "shop-handover: the shop uploads into its own folder" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'shop-handover' AND public.shop_handover_photo_access(name, true));
DROP POLICY IF EXISTS "shop-handover: the two sides and admins read" ON storage.objects;
CREATE POLICY "shop-handover: the two sides and admins read" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'shop-handover' AND public.shop_handover_photo_access(name, false));

-- ---------------------------------------------------------------------------
-- 2. Tables.
CREATE TABLE IF NOT EXISTS public.shop_handovers (
  order_id uuid PRIMARY KEY REFERENCES public.shop_orders(id) ON DELETE CASCADE,
  ready_photo_path text CHECK (ready_photo_path IS NULL OR char_length(ready_photo_path) <= 300),
  ready_at timestamptz,
  confirmed_at timestamptz,
  confirmed_how text CHECK (confirmed_how IS NULL OR confirmed_how IN ('buyer', 'auto', 'admin')),
  -- The buyer says they did not get it: no automatic finish, no payout, until decided (M3/M4).
  problem_at timestamptz,
  problem_note text CHECK (problem_note IS NULL OR char_length(problem_note) <= 500),
  is_seed boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT shop_handovers_confirmed CHECK ((confirmed_at IS NULL) = (confirmed_how IS NULL)),
  -- A photo means a ready tap; an in-person ready tap may come without one.
  CONSTRAINT shop_handovers_ready CHECK (ready_photo_path IS NULL OR ready_at IS NOT NULL),
  CONSTRAINT shop_handovers_problem CHECK ((problem_at IS NULL) = (problem_note IS NULL))
);
-- A database that applied an earlier draft of this migration (a preview or
-- branch database; never prod) may still allow 'shop': swap the CHECK so a
-- replay leaves only the buyer, the clock and an admin (authz review).
DO $do$
BEGIN
  ALTER TABLE public.shop_handovers DROP CONSTRAINT IF EXISTS shop_handovers_confirmed_how_check;
  ALTER TABLE public.shop_handovers ADD CONSTRAINT shop_handovers_confirmed_how_check
    CHECK (confirmed_how IS NULL OR confirmed_how IN ('buyer', 'auto', 'admin')) NOT VALID;
END
$do$;
ALTER TABLE public.shop_handovers ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.shop_handovers FROM PUBLIC, anon, authenticated;
GRANT SELECT (order_id, ready_photo_path, ready_at, confirmed_at, confirmed_how, problem_at, problem_note, created_at)
  ON TABLE public.shop_handovers TO authenticated;
GRANT ALL ON TABLE public.shop_handovers TO service_role;
DROP POLICY IF EXISTS "shop handovers: the two sides read" ON public.shop_handovers;
CREATE POLICY "shop handovers: the two sides read" ON public.shop_handovers
  FOR SELECT TO authenticated
  USING (public.has_role((SELECT auth.uid()), 'admin')
         OR EXISTS (SELECT 1 FROM public.shop_orders o WHERE o.id = shop_handovers.order_id
                  AND (o.buyer_id = (SELECT auth.uid()) OR o.seller_id = (SELECT auth.uid()))));

-- One per order, ever. amount = items - the card-fee debt taken from it.
CREATE TABLE IF NOT EXISTS public.shop_payouts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL UNIQUE REFERENCES public.shop_orders(id) ON DELETE RESTRICT,
  items_cents integer NOT NULL CHECK (items_cents > 0),
  debt_cents integer NOT NULL CHECK (debt_cents >= 0),
  amount_cents integer NOT NULL,
  status text NOT NULL CHECK (status IN ('pending', 'succeeded', 'failed', 'nothing_due')),
  stripe_transfer_id text UNIQUE CHECK (stripe_transfer_id IS NULL OR stripe_transfer_id ~ '^tr_'),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 100),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  last_error text,
  is_seed boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  executed_at timestamptz,
  CONSTRAINT shop_payouts_amount CHECK (amount_cents = items_cents - debt_cents AND amount_cents >= 0),
  CONSTRAINT shop_payouts_nothing_due CHECK ((status = 'nothing_due') = (amount_cents = 0)),
  CONSTRAINT shop_payouts_transfer CHECK (status <> 'succeeded' OR stripe_transfer_id IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS shop_payouts_due_idx ON public.shop_payouts (next_attempt_at) WHERE status IN ('pending', 'failed');
ALTER TABLE public.shop_payouts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.shop_payouts FROM PUBLIC, anon, authenticated;
GRANT SELECT (id, order_id, items_cents, debt_cents, amount_cents, status, created_at, executed_at)
  ON TABLE public.shop_payouts TO authenticated;
GRANT ALL ON TABLE public.shop_payouts TO service_role;
DROP POLICY IF EXISTS "shop payouts: the shop reads its own" ON public.shop_payouts;
CREATE POLICY "shop payouts: the shop reads its own" ON public.shop_payouts
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.shop_orders o WHERE o.id = shop_payouts.order_id AND o.seller_id = (SELECT auth.uid())));

-- Q807: every public table carries the unconfirmed-email statement gate.
DO $do$
BEGIN
  IF to_regprocedure('public.attach_unconfirmed_email_gate()') IS NOT NULL THEN
    PERFORM public.attach_unconfirmed_email_gate();
  END IF;
END
$do$;

-- is_seed from birth: the order's.
CREATE OR REPLACE FUNCTION public.shop_money_rows_seed()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $fn$
BEGIN
  NEW.is_seed := COALESCE((SELECT o.is_seed FROM public.shop_orders o WHERE o.id = NEW.order_id), false);
  RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION public.shop_money_rows_seed() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_shop_handovers_seed ON public.shop_handovers;
CREATE TRIGGER trg_shop_handovers_seed BEFORE INSERT ON public.shop_handovers
  FOR EACH ROW EXECUTE FUNCTION public.shop_money_rows_seed();
DROP TRIGGER IF EXISTS trg_shop_payouts_seed ON public.shop_payouts;
CREATE TRIGGER trg_shop_payouts_seed BEFORE INSERT ON public.shop_payouts
  FOR EACH ROW EXECUTE FUNCTION public.shop_money_rows_seed();

-- ---------------------------------------------------------------------------
-- 3. The one transition (service only; called by the RPCs below and the sweep).
CREATE OR REPLACE FUNCTION public.shop_complete_handover(p_order_id uuid, p_how text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  o public.shop_orders;
  v_debt integer;
  v_payout uuid;
BEGIN
  -- Never 'shop': the shop cannot complete its own order (owner 2026-10-18 ~21:00Z).
  IF p_how IS NULL OR p_how NOT IN ('buyer', 'auto', 'admin') THEN
    RAISE EXCEPTION 'invalid_method' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO o FROM public.shop_orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'order_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF o.status = 'handed_over' THEN
    RETURN jsonb_build_object('result', 'already_handed_over', 'order_id', o.id);
  END IF;
  IF o.status <> 'accepted' OR o.captured_at IS NULL THEN
    RAISE EXCEPTION 'order_not_charged_yet' USING ERRCODE = '55000',
      HINT = 'This order is not charged yet, so it cannot be handed over.';
  END IF;
  IF p_how <> 'admin' AND EXISTS (SELECT 1 FROM public.shop_handovers h WHERE h.order_id = o.id AND h.problem_at IS NOT NULL) THEN
    RAISE EXCEPTION 'problem_open' USING ERRCODE = '55000',
      HINT = 'A problem was reported on this order. Louisiana Helpr decides before anyone is paid.';
  END IF;
  INSERT INTO public.shop_handovers (order_id) VALUES (o.id) ON CONFLICT (order_id) DO NOTHING;
  UPDATE public.shop_handovers SET confirmed_at = now(), confirmed_how = p_how WHERE order_id = o.id AND confirmed_at IS NULL;
  UPDATE public.shop_orders
     SET status = 'handed_over', close_reason = 'handed_over', handed_over_at = now(), closed_at = now()
   WHERE id = o.id AND status = 'accepted';
  -- The seller's card-fee debt (Declutter and Shops share one ledger) comes out first.
  v_debt := public.declutter_consume_fee_debt(o.seller_id, 'shop_order_' || o.id::text, o.items_cents);
  INSERT INTO public.shop_payouts (order_id, items_cents, debt_cents, amount_cents, status, next_attempt_at)
  VALUES (o.id, o.items_cents, v_debt, o.items_cents - v_debt,
          CASE WHEN o.items_cents - v_debt = 0 THEN 'nothing_due' ELSE 'pending' END,
          now())
  ON CONFLICT (order_id) DO NOTHING
  RETURNING id INTO v_payout;
  -- The clock finishing an order is not a pickup anybody saw: say so (money review of 201265b4c).
  PERFORM public.declutter_notify(o.seller_id, 'payment', CASE WHEN p_how = 'buyer' THEN 'Order picked up' ELSE 'Order finished' END,
    CASE
      WHEN o.items_cents - v_debt = 0 THEN
        format('This order paid off the $%s card fee you owed, so there is nothing to send.', to_char(v_debt / 100.0, 'FM999990.00'))
      WHEN NOT EXISTS (SELECT 1 FROM public.profiles pr WHERE pr.user_id = o.seller_id AND pr.stripe_account_id IS NOT NULL) THEN
        format('Set up payouts in Settings to get your $%s. We send it as soon as you do.', to_char((o.items_cents - v_debt) / 100.0, 'FM999990.00'))
      WHEN v_debt > 0 THEN
        format('$%s is on its way to your payout account ($%s card fee you owed was taken out).',
               to_char((o.items_cents - v_debt) / 100.0, 'FM999990.00'), to_char(v_debt / 100.0, 'FM999990.00'))
      ELSE format('$%s is on its way to your payout account.', to_char((o.items_cents - v_debt) / 100.0, 'FM999990.00'))
    END,
    '/shops/dashboard', o.buyer_id);
  PERFORM public.declutter_notify(o.buyer_id, 'payment', CASE WHEN p_how = 'buyer' THEN 'Enjoy your order' ELSE 'Order finished' END,
    CASE p_how
      WHEN 'buyer' THEN 'The pickup is done and the order is final. Thank you for buying local.'
      WHEN 'auto' THEN 'Your order finished on its own 24 hours after the ready date, and the shop is paid.'
      ELSE 'Louisiana Helpr finished this order, and the shop is paid.'
    END,
    '/shops/orders', o.seller_id);
  RETURN jsonb_build_object('result', 'handed_over', 'order_id', o.id, 'payout_id', v_payout, 'by', p_how);
END;
$fn$;
REVOKE ALL ON FUNCTION public.shop_complete_handover(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.shop_complete_handover(uuid, text) TO service_role;

-- ---------------------------------------------------------------------------
-- 4. Member RPCs. Each names is_caller_banned() in its own body. No switch (L91).
-- The maker's "ready" photo. Re-taking it before the pickup replaces it.
CREATE OR REPLACE FUNCTION public.shops_mark_ready(p_order_id uuid, p_photo_path text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  o public.shop_orders;
  v_was_ready timestamptz;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO o FROM public.shop_orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND OR o.seller_id IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'order_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF o.status = 'handed_over' THEN
    RETURN jsonb_build_object('result', 'already_handed_over', 'order_id', o.id);
  END IF;
  IF o.status <> 'accepted' OR o.captured_at IS NULL THEN
    RAISE EXCEPTION 'order_not_charged_yet' USING ERRCODE = '55000',
      HINT = 'The buyer''s card is not charged yet. Mark the order ready once it is.';
  END IF;
  IF p_photo_path IS NULL AND o.handover_mode = 'in_person' THEN
    NULL;  -- in person: the photo is optional
  ELSIF p_photo_path IS NULL
     OR split_part(p_photo_path, '/', 1) IS DISTINCT FROM v_uid::text
     OR split_part(p_photo_path, '/', 2) IS DISTINCT FROM 'shops'
     OR split_part(p_photo_path, '/', 3) IS DISTINCT FROM 'handover'
     OR split_part(p_photo_path, '/', 4) IS DISTINCT FROM o.id::text
     OR split_part(p_photo_path, '/', 5) = ''
     OR split_part(p_photo_path, '/', 6) <> ''
     OR NOT EXISTS (SELECT 1 FROM storage.objects so WHERE so.bucket_id = 'shop-handover' AND so.name = p_photo_path) THEN
    RAISE EXCEPTION 'photo_not_uploaded' USING ERRCODE = '22023', HINT = 'Take a photo of the order first.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.shop_handovers h WHERE h.order_id = o.id AND h.problem_at IS NOT NULL) THEN
    RAISE EXCEPTION 'problem_open' USING ERRCODE = '55000',
      HINT = 'The buyer reported a problem with this order. Louisiana Helpr looks at it before anyone is paid.';
  END IF;
  SELECT h.ready_at INTO v_was_ready FROM public.shop_handovers h WHERE h.order_id = o.id;
  -- A retake replaces the photo but keeps the first ready time (the clock never moves later) and tells nobody again.
  INSERT INTO public.shop_handovers (order_id, ready_photo_path, ready_at) VALUES (o.id, p_photo_path, now())
  ON CONFLICT (order_id) DO UPDATE
    SET ready_photo_path = COALESCE(EXCLUDED.ready_photo_path, public.shop_handovers.ready_photo_path),
        ready_at = COALESCE(public.shop_handovers.ready_at, EXCLUDED.ready_at)
   WHERE public.shop_handovers.confirmed_at IS NULL;
  IF v_was_ready IS NOT NULL THEN
    RETURN jsonb_build_object('result', 'ready', 'order_id', o.id);
  END IF;
  PERFORM public.declutter_notify(o.buyer_id, 'payment', 'Your order is ready',
    CASE WHEN o.handover_mode = 'porch'
      THEN format('Your order for %s is left out for you. Tap "I got it" when you have it.', to_char(o.ready_date, 'FMMonth FMDD'))
      ELSE format('Your order for %s is ready to pick up at the shop. Tap "I got it" when you have it.', to_char(o.ready_date, 'FMMonth FMDD'))
    END,
    '/shops/orders', o.seller_id);
  RETURN jsonb_build_object('result', 'ready', 'order_id', o.id);
END;
$fn$;
REVOKE ALL ON FUNCTION public.shops_mark_ready(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.shops_mark_ready(uuid, text) TO authenticated, service_role;

-- The shop's own "Picked up" (an earlier draft) is gone: the shop never completes
-- its own order (owner 2026-10-18 ~21:00Z). Dropped for any database that had it.
DROP FUNCTION IF EXISTS public.shops_mark_picked_up(uuid);

-- The buyer's "I got it": the shop is owed right away.
CREATE OR REPLACE FUNCTION public.shops_confirm_pickup(p_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  o public.shop_orders;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO o FROM public.shop_orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND OR o.buyer_id IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'order_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF o.status = 'handed_over' THEN
    RETURN jsonb_build_object('result', 'already_handed_over', 'order_id', o.id);
  END IF;
  RETURN public.shop_complete_handover(o.id, 'buyer');
END;
$fn$;
REVOKE ALL ON FUNCTION public.shops_confirm_pickup(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.shops_confirm_pickup(uuid) TO authenticated, service_role;

-- The buyer did not get it: the money waits for Louisiana Helpr (M3/M4 decide).
CREATE OR REPLACE FUNCTION public.shops_report_not_received(p_order_id uuid, p_note text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  o public.shop_orders;
  h public.shop_handovers;
  a record;
  v_note text := btrim(COALESCE(p_note, ''));
  v_leak text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  IF char_length(v_note) NOT BETWEEN 1 AND 500 THEN
    RAISE EXCEPTION 'invalid_note' USING ERRCODE = '22023', HINT = 'Say what happened, in under 500 characters.';
  END IF;
  v_leak := public.contact_leak_reason(v_note);
  IF v_leak IS NOT NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'check_violation',
      MESSAGE = v_leak || ' in the note. Keep phone numbers, emails and websites out; Louisiana Helpr does not allow contact details in Shops.';
  END IF;
  SELECT * INTO o FROM public.shop_orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND OR o.buyer_id IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'order_not_found' USING ERRCODE = 'P0002';
  END IF;
  SELECT * INTO h FROM public.shop_handovers WHERE order_id = o.id FOR UPDATE;
  -- Open: a charged order not handed over yet, from its ready date (or the
  -- shop's ready tap). Once the buyer said "I got it" or the clock finished it,
  -- the order is final.
  IF (o.status = 'accepted' AND o.captured_at IS NOT NULL
      AND (public.shop_local_today() >= o.ready_date OR h.ready_at IS NOT NULL)) IS NOT TRUE THEN
    RAISE EXCEPTION 'order_not_open' USING ERRCODE = '55000',
      HINT = 'Only a paid order that is due and not picked up can be reported here.';
  END IF;
  INSERT INTO public.shop_handovers (order_id, problem_at, problem_note) VALUES (o.id, now(), v_note)
  ON CONFLICT (order_id) DO UPDATE SET problem_at = COALESCE(public.shop_handovers.problem_at, now()),
                                       problem_note = COALESCE(public.shop_handovers.problem_note, EXCLUDED.problem_note);
  PERFORM public.declutter_notify(o.seller_id, 'warning', 'Pickup problem reported',
    format('The buyer says they did not get the order for %s. Louisiana Helpr will look at it before anyone is paid.',
           to_char(o.ready_date, 'FMMonth FMDD')),
    '/shops/dashboard', o.buyer_id);
  -- Every admin is told (as Declutter's problem reports, 20261017055502): the money waits for them.
  FOR a IN SELECT DISTINCT ur.user_id FROM public.user_roles ur WHERE ur.role = 'admin' LOOP
    PERFORM public.declutter_notify(a.user_id, 'warning', 'Shops pickup problem reported',
      'A buyer says they did not get a paid Shops order. The shop''s payout is held until you decide it.', '/admin');
  END LOOP;
  RETURN jsonb_build_object('result', 'reported', 'order_id', o.id);
END;
$fn$;
REVOKE ALL ON FUNCTION public.shops_report_not_received(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.shops_report_not_received(uuid, text) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5. The automatic finish (service only; declutter-money every 10 minutes).
CREATE OR REPLACE FUNCTION public.shop_handover_sweep()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  r record;
  v_auto integer := 0;
BEGIN
  FOR r IN
    SELECT o.id FROM public.shop_orders o
      LEFT JOIN public.shop_handovers h ON h.order_id = o.id
     WHERE o.status = 'accepted' AND o.captured_at IS NOT NULL
       AND h.problem_at IS NULL AND h.confirmed_at IS NULL
       -- Left out: only with the shop's ready photo (the evidence).
       AND (o.handover_mode = 'in_person' OR h.ready_photo_path IS NOT NULL)
       AND greatest(COALESCE(h.ready_at, '-infinity'::timestamptz),
                    ((o.ready_date + 1)::timestamp AT TIME ZONE 'America/Chicago')) + interval '24 hours' <= now()
     ORDER BY o.ready_date, o.id LIMIT 200
  LOOP
    BEGIN
      -- shop_complete_handover re-reads the row under its lock and refuses an open problem.
      IF (public.shop_complete_handover(r.id, 'auto') ->> 'result') = 'handed_over' THEN
        v_auto := v_auto + 1;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      -- One bad order never stops the rest; it is logged and retried next run.
      PERFORM public.log_cron_defect('shop_handover_sweep', r.id::text, SQLERRM);
    END;
  END LOOP;
  RETURN jsonb_build_object('auto_handed_over', v_auto);
END;
$fn$;
REVOKE ALL ON FUNCTION public.shop_handover_sweep() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.shop_handover_sweep() TO service_role;

-- ---------------------------------------------------------------------------
-- 6. The payout queue (service only). The shop's payout account is read off
--    the order's seller; a problem reported before the handover (only an admin
--    can then hand it over, Q2156) holds the money.
CREATE OR REPLACE FUNCTION public.shop_payouts_due(p_limit integer)
RETURNS TABLE (payout_id uuid, order_id uuid, buyer_id uuid, seller_id uuid, amount_cents integer,
               stripe_account_id text, payment_intent_id text, livemode boolean, checkout_session_id text, attempts integer)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT p.id, p.order_id, o.buyer_id, o.seller_id, p.amount_cents, pr.stripe_account_id, o.stripe_payment_intent_id,
         o.payment_livemode, o.stripe_checkout_session_id, p.attempts
    FROM public.shop_payouts p
    JOIN public.shop_orders o ON o.id = p.order_id
    LEFT JOIN public.profiles pr ON pr.user_id = o.seller_id
   WHERE p.status IN ('pending', 'failed') AND p.next_attempt_at <= now() AND p.attempts < 12
     AND o.status = 'handed_over'
     AND NOT EXISTS (SELECT 1 FROM public.shop_handovers h WHERE h.order_id = p.order_id AND h.problem_at IS NOT NULL
                       AND h.confirmed_how IS DISTINCT FROM 'admin')
   ORDER BY p.next_attempt_at
   LIMIT least(greatest(COALESCE(p_limit, 20), 1), 100);
$fn$;
REVOKE ALL ON FUNCTION public.shop_payouts_due(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.shop_payouts_due(integer) TO service_role;

-- What Stripe did with a payout row: a succeeded row is final; a failure counts
-- an attempt and backs off (10 min doubling, at most a day; 12 tries, then the
-- edge function pages).
CREATE OR REPLACE FUNCTION public.shop_payout_executed(p_payout_id uuid, p_transfer_id text, p_succeeded boolean, p_error text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_status text;
BEGIN
  IF p_succeeded AND (p_transfer_id IS NULL OR p_transfer_id !~ '^tr_') THEN
    RAISE EXCEPTION 'invalid_transfer' USING ERRCODE = '22023';
  END IF;
  UPDATE public.shop_payouts
     SET status = CASE WHEN p_succeeded THEN 'succeeded' ELSE 'failed' END,
         stripe_transfer_id = CASE WHEN p_succeeded THEN p_transfer_id ELSE stripe_transfer_id END,
         executed_at = now(),
         last_error = CASE WHEN p_succeeded THEN NULL ELSE left(p_error, 500) END,
         attempts = CASE WHEN p_succeeded THEN attempts ELSE least(attempts + 1, 100) END,
         next_attempt_at = CASE WHEN p_succeeded THEN next_attempt_at
                                ELSE now() + least(interval '10 minutes' * power(2, least(attempts, 8)), interval '1 day') END
   WHERE id = p_payout_id AND status IN ('pending', 'failed')
  RETURNING status INTO v_status;
  IF NOT FOUND THEN
    SELECT status INTO v_status FROM public.shop_payouts WHERE id = p_payout_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'payout_not_found' USING ERRCODE = 'P0002';
    END IF;
  END IF;
  RETURN v_status;
END;
$fn$;
REVOKE ALL ON FUNCTION public.shop_payout_executed(uuid, text, boolean, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.shop_payout_executed(uuid, text, boolean, text) TO service_role;

-- ---------------------------------------------------------------------------
-- 7. When a buyer's cancel stops being free (O2; owner pop-up 2026-10-18
-- ~22:30Z, Q2155). The ONE answer M3's cancel of an accepted order reads.
--   until_accept            the shop's accept.
--   until_24h_before_ready  24 hours before the ready date begins (Louisiana time).
--   until_handover          ("cancel any time before pickup") the ready date
--                           begins, or the shop marks the order ready
--                           (shop_handovers.ready_at, in person or left out),
--                           whichever comes first. NOT the handover: with no
--                           shop "Picked up" (the buyer must confirm), a buyer
--                           could collect, never tap "I got it", and cancel.
-- Only an ACCEPTED order not yet handed over has a window: any other status
-- (handed over, by an early "I got it" too, or closed) is '-infinity', closed
-- (lh-money-escrow of 1edece85d #1: the shop is already owed). Before the
-- accept the hold just drops (shops_cancel_order_request), not this.
-- NULL (no such order, an unknown policy) means closed. Service only: the
-- buyer reads the preset's words, never this function.
CREATE OR REPLACE FUNCTION public.shop_order_free_cancel_until(p_order_id uuid)
RETURNS timestamptz
LANGUAGE sql
STABLE
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT CASE
           WHEN o.status IS DISTINCT FROM 'accepted' OR o.handed_over_at IS NOT NULL THEN '-infinity'::timestamptz
           ELSE CASE o.cancel_policy
                  WHEN 'until_accept' THEN o.accepted_at
                  WHEN 'until_24h_before_ready' THEN (o.ready_date::timestamp AT TIME ZONE 'America/Chicago') - interval '24 hours'
                  WHEN 'until_handover' THEN least((o.ready_date::timestamp AT TIME ZONE 'America/Chicago'),
                                                   COALESCE(h.ready_at, 'infinity'::timestamptz))
                END
         END
    FROM public.shop_orders o
    LEFT JOIN public.shop_handovers h ON h.order_id = o.id
   WHERE o.id = p_order_id
$fn$;
REVOKE ALL ON FUNCTION public.shop_order_free_cancel_until(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.shop_order_free_cancel_until(uuid) TO service_role;
