-- Declutter DELIVERY payouts to a Helpr are whole dollars, rounded DOWN; the
-- platform keeps the cents (owner 2026-10-21: "round the real payout ... applies
-- to Helpr payouts (Jobs + Declutter delivery)").
--
-- What was wrong: a Jobs payout already goes through roundPayoutDownCents
-- (supabase/functions/_shared/money.ts, Q236), but a delivery payout is written
-- in SQL as pay_cents - fee_cents to the exact cent (helpr_task_payouts, CHECK
-- helpr_task_payouts_amount) and declutter-money transfers that row's
-- amount_cents as is. So a $44 delivery paid the Helpr $41.10, and the screens
-- and the "Delivery done" notice said $41.10.
--
-- The fix, in one place for SQL: public.helpr_payout_round_down_cents mirrors
-- roundPayoutDownCents exactly (NULL -> 0, zero/negative unchanged, else down to
-- the whole dollar; src/test/pglite/declutterDelivery.pglite.mjs proves SQL ==
-- TS for every cent 0..100000). Every place a delivery take-home is written or
-- shown now goes through it:
--   - helpr_task_confirm: the payout row's amount_cents, its nothing_due status
--     and the "Delivery done" notice (now "$41", whole dollars like Jobs).
--   - helpr_task_view, helpr_tasks_open_near, helpr_my_tasks: take_home_cents.
--   - CHECK helpr_task_payouts_amount: amount = the rounded pay - fee, so no
--     writer can store an exact-cents amount again. VALIDATED, not NOT VALID:
--     Postgres re-checks a NOT VALID CHECK on every UPDATE of a row, so an
--     older exact-cents row could never be marked paid, failed or held again
--     (lh-money-escrow review). Prod had 0 helpr_task_payouts and 0
--     helpr_tasks rows on 2026-10-21 (read-only); if one exists when this
--     deploys, the ADD fails and db-deploy goes red, which is the loud outcome
--     we want over a payout frozen mid-send.
-- fee_cents stays the advertised flat 5% + 70c; the round-down remainder is
-- pay - fee - amount, never stored as fee (the Jobs earnings export keeps it
-- apart the same way, Q1520). declutter-money is unchanged: it already pays
-- the row's amount_cents (helpr_task_payouts_due), so the transfer is now the
-- whole-dollar amount. Seller proceeds and the delivery price are NOT rounded.
--
-- Restated from the NEWEST definitions on main, each changed only where named:
--   helpr_tasks_open_near(numeric, numeric, integer), helpr_my_tasks()  <- 20261017055505
--   helpr_task_view(uuid)                                               <- 20261021131322
--   helpr_task_confirm(uuid, text, uuid)                                <- 20261018184535
-- helpr_task_payouts_due is NOT restated (Q1929 restates it after this).
-- Replay-safe: CREATE OR REPLACE, DROP CONSTRAINT IF EXISTS then ADD.

CREATE OR REPLACE FUNCTION public.helpr_payout_round_down_cents(p_cents integer)
RETURNS integer
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT CASE WHEN p_cents IS NULL THEN 0
              WHEN p_cents <= 0 THEN p_cents
              ELSE (p_cents / 100) * 100 END;
$fn$;
COMMENT ON FUNCTION public.helpr_payout_round_down_cents(integer) IS
  'A Helpr payout in cents, rounded DOWN to the whole dollar (the platform keeps the cents). SQL twin of roundPayoutDownCents in supabase/functions/_shared/money.ts; parity proven in src/test/pglite/declutterDelivery.pglite.mjs.';
REVOKE ALL ON FUNCTION public.helpr_payout_round_down_cents(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.helpr_payout_round_down_cents(integer) TO authenticated, service_role;

ALTER TABLE public.helpr_task_payouts DROP CONSTRAINT IF EXISTS helpr_task_payouts_amount;
ALTER TABLE public.helpr_task_payouts ADD CONSTRAINT helpr_task_payouts_amount
  CHECK (amount_cents = public.helpr_payout_round_down_cents(pay_cents - fee_cents) AND amount_cents >= 0);

-- helpr_tasks_open_near: restated verbatim from 20261017055505_declutter_helpr_delivery.sql; take_home_cents is rounded down.
CREATE OR REPLACE FUNCTION public.helpr_tasks_open_near(p_lat numeric, p_lng numeric, p_limit integer)
RETURNS TABLE (task_id uuid, source_kind text, size text, title text, pickup_area text, dropoff_area text,
               trip_miles integer, miles_to_pickup integer, take_home_cents integer, open_until timestamptz,
               latest_pickup_at timestamptz)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid;
BEGIN
  PERFORM public.helpr_task_source_require_feature('declutter_delivery');
  v_uid := public.helpr_task_assert_helpr();
  IF p_lat IS NOT NULL AND (p_lat NOT BETWEEN -90 AND 90 OR p_lng IS NULL OR p_lng NOT BETWEEN -180 AND 180) THEN
    RAISE EXCEPTION 'invalid_location' USING ERRCODE = '22023';
  END IF;
  RETURN QUERY
  SELECT t.id, t.source_kind, t.size, t.title, t.pickup_area, t.dropoff_area, t.trip_miles,
         CASE WHEN p_lat IS NULL THEN NULL
              ELSE greatest(1, ceil(public.helpr_task_distance_m(p_lat, p_lng, round(t.pickup_lat, 2), round(t.pickup_lng, 2)) / 1609.344))::integer END,
         public.helpr_payout_round_down_cents(t.pay_cents - t.fee_cents), t.open_until, t.latest_pickup_at
    FROM public.helpr_tasks t
   WHERE t.status = 'open' AND t.open_until > now()
     AND v_uid IS DISTINCT FROM t.customer_id AND v_uid IS DISTINCT FROM t.pickup_contact_id
     AND public.helpr_task_vehicle_fits(v_uid, t.size)
     AND NOT public.are_users_blocked(v_uid, t.customer_id)
     AND NOT public.are_users_blocked(v_uid, t.pickup_contact_id)
     AND public.helpr_task_same_stripe_mode(v_uid, t.customer_id)
   ORDER BY CASE WHEN p_lat IS NULL THEN 0 ELSE public.helpr_task_distance_m(p_lat, p_lng, round(t.pickup_lat, 2), round(t.pickup_lng, 2)) END, t.open_until
   LIMIT least(greatest(COALESCE(p_limit, 50), 1), 100);
END;
$fn$;
REVOKE ALL ON FUNCTION public.helpr_tasks_open_near(numeric, numeric, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.helpr_tasks_open_near(numeric, numeric, integer) TO authenticated, service_role;

-- helpr_my_tasks: restated verbatim from 20261017055505_declutter_helpr_delivery.sql; take_home_cents is rounded down.
CREATE OR REPLACE FUNCTION public.helpr_my_tasks()
RETURNS TABLE (task_id uuid, status text, size text, title text, pickup_area text, dropoff_area text,
               trip_miles integer, take_home_cents integer, pickup_slot_start timestamptz, payout_status text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT t.id, t.status, t.size, t.title, t.pickup_area, t.dropoff_area, t.trip_miles, public.helpr_payout_round_down_cents(t.pay_cents - t.fee_cents),
         t.pickup_slot_start, p.status
    FROM public.helpr_tasks t
    LEFT JOIN public.helpr_task_payouts p ON p.task_id = t.id
   WHERE t.helpr_id = v_uid
     AND (t.status IN ('accepted', 'picked_up', 'delivered') OR t.updated_at > now() - interval '30 days')
   ORDER BY (t.status IN ('accepted', 'picked_up', 'delivered')) DESC, t.pickup_slot_start
   LIMIT 100;
END;
$fn$;
REVOKE ALL ON FUNCTION public.helpr_my_tasks() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.helpr_my_tasks() TO authenticated, service_role;

-- helpr_task_view: restated verbatim from 20261021131322_member_names_first_and_initial.sql; take_home_cents is rounded down.
CREATE OR REPLACE FUNCTION public.helpr_task_view(p_task_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  t public.helpr_tasks;
  v_role text;
  v_active boolean;
  v_helpr_name text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO t FROM public.helpr_tasks WHERE id = p_task_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'task_not_found' USING ERRCODE = 'P0002';
  END IF;
  v_role := CASE WHEN t.helpr_id = v_uid THEN 'helpr'
                 WHEN t.customer_id = v_uid THEN 'customer'
                 WHEN t.pickup_contact_id = v_uid THEN 'pickup_contact' END;
  IF v_role IS NULL THEN
    -- An open task is visible to a Helpr who could take it (area words only).
    PERFORM public.helpr_task_source_require_feature(t.source_kind);
    PERFORM public.helpr_task_assert_helpr();
    -- The same checks helpr_tasks_open_near applies (lh-authz-rls #8).
    IF t.status <> 'open' OR t.open_until <= now() OR NOT public.helpr_task_vehicle_fits(v_uid, t.size)
       OR public.are_users_blocked(v_uid, t.customer_id) OR public.are_users_blocked(v_uid, t.pickup_contact_id)
       OR NOT public.helpr_task_same_stripe_mode(v_uid, t.customer_id) THEN
      RAISE EXCEPTION 'task_not_found' USING ERRCODE = 'P0002';
    END IF;
    v_role := 'candidate';
  END IF;
  v_active := t.status IN ('accepted', 'picked_up', 'delivered');
  SELECT NULLIF(split_part(COALESCE(public.member_display_name(pr.full_name, NULL), ''), ' ', 1), '') INTO v_helpr_name
    FROM public.profiles pr WHERE pr.user_id = t.helpr_id;
  RETURN jsonb_build_object(
    'task_id', t.id, 'source_kind', t.source_kind, 'source_id', CASE WHEN v_role <> 'candidate' THEN t.source_id END,
    'role', v_role, 'status', t.status, 'size', t.size, 'title', t.title,
    'pickup_area', t.pickup_area, 'dropoff_area', t.dropoff_area, 'trip_miles', t.trip_miles,
    'take_home_cents', CASE WHEN v_role IN ('helpr', 'candidate') THEN public.helpr_payout_round_down_cents(t.pay_cents - t.fee_cents) END,
    'pay_cents', CASE WHEN v_role IN ('helpr', 'candidate') THEN t.pay_cents END,
    'fee_cents', CASE WHEN v_role IN ('helpr', 'candidate') THEN t.fee_cents END,
    'open_until', t.open_until, 'latest_pickup_at', t.latest_pickup_at,
    'pickup_slot_start', t.pickup_slot_start, 'accepted_at', t.accepted_at,
    'picked_up_at', t.picked_up_at, 'delivered_at', t.delivered_at, 'confirmed_at', t.confirmed_at,
    'confirmed_by', t.confirmed_by,
    'helpr_first_name', CASE WHEN v_role IN ('customer', 'pickup_contact') THEN v_helpr_name END,
    'pickup_address', CASE WHEN v_role = 'helpr' AND v_active THEN t.pickup_address END,
    'pickup_lat', CASE WHEN v_role = 'helpr' AND v_active THEN t.pickup_lat END,
    'pickup_lng', CASE WHEN v_role = 'helpr' AND v_active THEN t.pickup_lng END,
    'dropoff_address', CASE WHEN v_role = 'helpr' AND t.status IN ('picked_up', 'delivered') THEN t.dropoff_address END,
    'dropoff_lat', CASE WHEN v_role = 'helpr' AND t.status IN ('picked_up', 'delivered') THEN t.dropoff_lat END,
    'dropoff_lng', CASE WHEN v_role = 'helpr' AND t.status IN ('picked_up', 'delivered') THEN t.dropoff_lng END,
    'pickup_photo_path', CASE WHEN v_role <> 'candidate' THEN t.pickup_photo_path END,
    'dropoff_photo_path', CASE WHEN v_role <> 'candidate' THEN t.dropoff_photo_path END);
END;
$fn$;
REVOKE ALL ON FUNCTION public.helpr_task_view(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.helpr_task_view(uuid) TO authenticated, service_role;

-- helpr_task_confirm: restated verbatim from 20261018184535_declutter_delivery_no_dropoff_code.sql; the payout row, its status and the notice use the rounded amount.
CREATE OR REPLACE FUNCTION public.helpr_task_confirm(p_task uuid, p_by text, p_actor uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  t public.helpr_tasks;
  v_payout uuid;
  v_amount integer;
BEGIN
  SELECT * INTO t FROM public.helpr_tasks WHERE id = p_task;
  IF t.status = 'confirmed' THEN
    RETURN jsonb_build_object('result', 'already_confirmed');
  END IF;
  IF t.status NOT IN ('picked_up', 'delivered') THEN
    RAISE EXCEPTION 'delivery_not_done' USING ERRCODE = '55000',
      HINT = 'The Helpr has not picked the item up yet.';
  END IF;
  IF p_by IS NULL OR p_by NOT IN ('customer', 'auto', 'admin') THEN
    RAISE EXCEPTION 'invalid_method' USING ERRCODE = '22023';
  END IF;
  IF p_by <> 'admin' AND public.helpr_task_source_held(t.source_kind, t.source_id) THEN
    RAISE EXCEPTION 'problem_open' USING ERRCODE = '55000',
      HINT = 'A problem was reported. Louisiana Helpr decides before anyone is paid.';
  END IF;
  UPDATE public.helpr_tasks
     SET status = 'confirmed', confirmed_at = now(), confirmed_by = p_by, closed_at = now(), updated_at = now()
   WHERE id = t.id AND status IN ('picked_up', 'delivered');
  v_amount := public.helpr_payout_round_down_cents(t.pay_cents - t.fee_cents);
  INSERT INTO public.helpr_task_payouts (task_id, helpr_id, pay_cents, fee_cents, amount_cents, status)
  VALUES (t.id, t.helpr_id, t.pay_cents, t.fee_cents, v_amount,
          CASE WHEN v_amount = 0 THEN 'nothing_due' ELSE 'pending' END)
  ON CONFLICT (task_id) DO NOTHING
  RETURNING id INTO v_payout;
  PERFORM public.helpr_task_log(t.id, 'confirmed', p_actor, p_by);
  PERFORM public.declutter_notify(t.helpr_id, 'payment', 'Delivery done',
    CASE WHEN NOT EXISTS (SELECT 1 FROM public.profiles pr WHERE pr.user_id = t.helpr_id AND pr.stripe_account_id IS NOT NULL)
         THEN format('Set up payouts in Settings to get your $%s. We send it as soon as you do.',
                     (v_amount / 100)::text)
         ELSE format('$%s is on its way to your payout account.', (v_amount / 100)::text) END,
    '/declutter?view=deliver', t.customer_id);
  RETURN jsonb_build_object('result', 'confirmed', 'helpr_payout_id', v_payout, 'by', p_by);
END;
$fn$;
REVOKE ALL ON FUNCTION public.helpr_task_confirm(uuid, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.helpr_task_confirm(uuid, text, uuid) TO service_role;
