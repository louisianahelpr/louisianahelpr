-- A Helpr needs a car for ANY Declutter delivery (Q2452; owner decision 2026-10-28).
--
-- Before: helpr_vehicles held only "I have a truck" (+ "I can bring a second
-- person"), and helpr_task_vehicle_fits said a SMALL item fits every Helpr. So
-- a member with no car at all was listed, offered (Go online), suggested ("On
-- your way") and allowed to take a small delivery. And a Helpr could untick the
-- truck while holding an accepted large delivery: the delivery stayed theirs.
--
-- After:
--   1. helpr_vehicles.has_car (default false). A truck is a car: every row
--      with has_truck is set has_car = true here, and a CHECK keeps it so.
--   2. helpr_task_vehicle_fits(p_user, p_size) is false for EVERY size unless
--      the Helpr has a car; large still needs the truck, extra large the truck
--      and the second person. It is the one rule all five paths read:
--      helpr_tasks_open_near (listed), helpr_task_view (an open task's card),
--      helpr_task_offer_online (the Go online offer), helpr_route_suggestions
--      ("On your way") and helpr_task_accept (take). None of them changes here
--      except accept, below.
--   3. helpr_set_vehicle(p_has_car, p_has_truck, p_second_person, p_photo_path)
--      is the new save. Ticking the truck means a car. It refuses a change that
--      would leave a delivery the Helpr holds (accepted or picked up) no longer
--      fitting: 'vehicle_in_use'. The old three-argument save (app builds
--      already installed) keeps working through the new one: it keeps the
--      Helpr's car answer, and a truck still means a car.
--   4. helpr_task_accept: the live body (20261020044552) with two marked
--      edits: a Helpr with no car is told "Add your car under Your vehicle to
--      take deliveries." ('vehicle_needs_car') instead of the truck sentence,
--      and the Helpr's vehicle row is held FOR SHARE across the vehicle check,
--      so a save that drops the vehicle waits for the take (and then refuses).
--
-- Prod, read-only 2026-10-28: helpr_vehicles and helpr_tasks both hold 0 rows,
-- so no saved vehicle changes meaning and no held delivery is stranded.
--
-- Replay-safe: ADD COLUMN IF NOT EXISTS, an UPDATE that only sets true where a
-- truck is, the CHECK added only when missing, CREATE OR REPLACE. Grants by
-- role name (REVOKE ... FROM PUBLIC, anon). Proof (3x replay, the REAL
-- vehicle rule across all five paths): src/test/pglite/helprVehicleMatch.pglite.mjs.
-- Guard: src/test/deliveryVehicleMatch.test.ts.

ALTER TABLE public.helpr_vehicles ADD COLUMN IF NOT EXISTS has_car boolean NOT NULL DEFAULT false;
-- Owner 2026-10-28: an existing Helpr with a truck counts as having a car.
UPDATE public.helpr_vehicles SET has_car = true WHERE has_truck AND NOT has_car;
DO $do$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'helpr_vehicles_truck_needs_car' AND conrelid = 'public.helpr_vehicles'::regclass) THEN
    ALTER TABLE public.helpr_vehicles ADD CONSTRAINT helpr_vehicles_truck_needs_car CHECK (NOT has_truck OR has_car);
  END IF;
END
$do$;

-- Can this Helpr's vehicle carry this size? No car, no delivery of any size.
CREATE OR REPLACE FUNCTION public.helpr_task_vehicle_fits(p_user uuid, p_size text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
  -- NULL in, false out (an unknown Helpr or size never fits).
  SELECT COALESCE(p_user IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.helpr_vehicles v
     WHERE v.user_id = p_user
       AND v.has_car
       AND (p_size = 'small'
         OR (p_size = 'large' AND v.has_truck)
         OR (p_size = 'xl' AND v.has_truck AND v.second_person))), false);
$fn$;
REVOKE ALL ON FUNCTION public.helpr_task_vehicle_fits(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.helpr_task_vehicle_fits(uuid, text) TO service_role;

-- The three-argument save, kept for app builds already installed: the Helpr's
-- saved car answer stays, a truck still means a car, and every rule is the
-- four-argument save's.
CREATE OR REPLACE FUNCTION public.helpr_set_vehicle(p_has_truck boolean, p_second_person boolean, p_photo_path text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
BEGIN
  PERFORM public.require_feature('declutter');
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  RETURN public.helpr_set_vehicle(
    COALESCE((SELECT v.has_car FROM public.helpr_vehicles v WHERE v.user_id = v_uid), false) OR COALESCE(p_has_truck, false),
    p_has_truck, p_second_person, p_photo_path);
END;
$fn$;
REVOKE ALL ON FUNCTION public.helpr_set_vehicle(boolean, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.helpr_set_vehicle(boolean, boolean, text) TO authenticated, service_role;

-- Save the vehicle. A truck needs a photo in the private bucket; a truck is a car.
CREATE OR REPLACE FUNCTION public.helpr_set_vehicle(p_has_car boolean, p_has_truck boolean, p_second_person boolean, p_photo_path text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
BEGIN
  PERFORM public.require_feature('declutter');
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  IF p_has_car IS NULL OR p_has_truck IS NULL OR p_second_person IS NULL THEN
    RAISE EXCEPTION 'invalid_vehicle' USING ERRCODE = '22023';
  END IF;
  IF p_second_person AND NOT p_has_truck THEN
    RAISE EXCEPTION 'invalid_vehicle' USING ERRCODE = '22023', HINT = 'A second person is only asked for with a truck.';
  END IF;
  -- A truck is a car (owner 2026-10-28).
  p_has_car := p_has_car OR p_has_truck;
  p_photo_path := NULLIF(btrim(p_photo_path), '');
  IF p_has_truck THEN
    IF p_photo_path IS NULL
       OR split_part(p_photo_path, '/', 1) IS DISTINCT FROM v_uid::text
       OR split_part(p_photo_path, '/', 2) IS DISTINCT FROM 'vehicle'
       OR split_part(p_photo_path, '/', 3) = ''
       OR split_part(p_photo_path, '/', 4) <> ''
       OR NOT EXISTS (SELECT 1 FROM storage.objects so WHERE so.bucket_id = 'helpr-tasks' AND so.name = p_photo_path) THEN
      RAISE EXCEPTION 'vehicle_photo_required' USING ERRCODE = '22023',
        HINT = 'Add a photo of your truck.';
    END IF;
  ELSE
    p_photo_path := NULL;
  END IF;
  -- A delivery the Helpr holds must still fit the vehicle they save. The vehicle row is
  -- locked first, and helpr_task_accept takes it FOR SHARE before its vehicle check, so a
  -- take and a save at the same moment cannot both pass (lh-authz-rls review nit 1).
  PERFORM 1 FROM public.helpr_vehicles v WHERE v.user_id = v_uid FOR UPDATE;
  IF EXISTS (SELECT 1 FROM public.helpr_tasks t
              WHERE t.helpr_id = v_uid AND t.status IN ('accepted', 'picked_up')
                AND NOT (p_has_car AND (t.size = 'small'
                                     OR (t.size = 'large' AND p_has_truck)
                                     OR (t.size = 'xl' AND p_has_truck AND p_second_person)))) THEN
    RAISE EXCEPTION 'vehicle_in_use' USING ERRCODE = '55000',
      HINT = 'You have a delivery that needs this vehicle. Finish it or back out of it first.';
  END IF;
  INSERT INTO public.helpr_vehicles (user_id, has_car, has_truck, second_person, photo_path, updated_at)
  VALUES (v_uid, p_has_car, p_has_truck, p_second_person, p_photo_path, now())
  ON CONFLICT (user_id) DO UPDATE SET has_car = EXCLUDED.has_car, has_truck = EXCLUDED.has_truck,
    second_person = EXCLUDED.second_person, photo_path = EXCLUDED.photo_path, updated_at = now();
  RETURN jsonb_build_object('has_car', p_has_car, 'has_truck', p_has_truck, 'second_person', p_second_person);
END;
$fn$;
REVOKE ALL ON FUNCTION public.helpr_set_vehicle(boolean, boolean, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.helpr_set_vehicle(boolean, boolean, boolean, text) TO authenticated, service_role;

-- Take a delivery: the live body (20261020044552) with TWO edits, marked below.
CREATE OR REPLACE FUNCTION public.helpr_task_accept(p_task_id uuid, p_pickup_slot_start timestamptz)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid;
  t public.helpr_tasks;
  v_reason text;
BEGIN
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO t FROM public.helpr_tasks WHERE id = p_task_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'task_not_found' USING ERRCODE = 'P0002';
  END IF;
  PERFORM public.helpr_task_source_require_feature(t.source_kind);
  v_uid := public.helpr_task_assert_helpr();
  -- ID once (owner 2026-10-20): taking a delivery is the Helpr's accept, so it
  -- reads the one helper every accept reads. helpr_task_assert_helpr already
  -- refused an unready payout account, so what is left here is the ID.
  v_reason := public.helper_accept_block_reason(v_uid);
  IF v_reason = 'helper_identity_unverified' THEN
    RAISE EXCEPTION 'helper_identity_unverified' USING ERRCODE = '42501',
      HINT = 'Verify your ID to accept a delivery. You only do it once.';
  ELSIF v_reason IS NOT NULL THEN
    RAISE EXCEPTION 'payout_setup_incomplete' USING ERRCODE = '42501',
      HINT = 'Set up payouts in Settings before you take a delivery.';
  END IF;
  IF v_uid IN (t.customer_id, t.pickup_contact_id) THEN
    RAISE EXCEPTION 'own_task' USING ERRCODE = '42501', HINT = 'You cannot deliver your own sale.';
  END IF;
  IF public.are_users_blocked(v_uid, t.customer_id) OR public.are_users_blocked(v_uid, t.pickup_contact_id)
     OR NOT public.helpr_task_same_stripe_mode(v_uid, t.customer_id) THEN
    RAISE EXCEPTION 'task_not_found' USING ERRCODE = 'P0002';
  END IF;
  -- 20261028012406 (lh-authz-rls review nit 1): the vehicle row stays as read until this
  -- take commits, so helpr_set_vehicle cannot drop what this delivery needs meanwhile.
  PERFORM 1 FROM public.helpr_vehicles v WHERE v.user_id = v_uid FOR SHARE;
  IF NOT public.helpr_task_vehicle_fits(v_uid, t.size) THEN
    -- 20261028012406 (Q2452, owner 2026-10-28): every delivery needs a car.
    IF NOT EXISTS (SELECT 1 FROM public.helpr_vehicles v WHERE v.user_id = v_uid AND v.has_car) THEN
      RAISE EXCEPTION 'vehicle_needs_car' USING ERRCODE = '42501',
        HINT = 'Add your car under Your vehicle to take deliveries.';
    END IF;
    RAISE EXCEPTION 'vehicle_too_small' USING ERRCODE = '42501',
      HINT = 'This item needs a truck (and a second person for extra large). Add your truck under Your vehicle.';
  END IF;
  t := public.helpr_task_lock(p_task_id);
  IF t.status <> 'open' OR t.open_until <= now() THEN
    RAISE EXCEPTION 'task_taken' USING ERRCODE = '55000', HINT = 'Another Helpr took this delivery, or it closed.';
  END IF;
  -- Taking a delivery shows its pickup address, so taking and backing out must
  -- not be a way to collect addresses (lh-authz-rls review #4, 2026-10-16): a
  -- Helpr never takes back a delivery they backed out of or missed, and three
  -- back-outs or misses in 7 days pause taking new ones for the rest of that week.
  IF EXISTS (SELECT 1 FROM public.helpr_task_events e
              WHERE e.task_id = t.id AND e.actor_id = v_uid AND e.task_event IN ('released', 'helpr_no_show')) THEN
    RAISE EXCEPTION 'task_taken' USING ERRCODE = '55000', HINT = 'Another Helpr took this delivery, or it closed.';
  END IF;
  IF public.helpr_task_source_held(t.source_kind, t.source_id) THEN
    RAISE EXCEPTION 'problem_open' USING ERRCODE = '55000';
  END IF;
  -- At most 2 deliveries taken and not yet picked up at a time, so a Helpr
  -- cannot take every nearby delivery at once to read the addresses
  -- (lh-authz-rls re-review #1, 2026-10-16).
  IF (SELECT count(*) FROM public.helpr_tasks x WHERE x.helpr_id = v_uid AND x.status = 'accepted') >= 2 THEN
    RAISE EXCEPTION 'too_many_taken' USING ERRCODE = '55000',
      HINT = 'Pick up one of your deliveries before you take another.';
  END IF;
  IF (SELECT count(*) FROM public.helpr_task_events e
       WHERE e.actor_id = v_uid AND e.task_event IN ('released', 'helpr_no_show')
         AND e.created_at > now() - interval '7 days') >= 3 THEN
    RAISE EXCEPTION 'too_many_releases' USING ERRCODE = '55000',
      HINT = 'You backed out of or missed 3 deliveries this week. You can take new ones again in a few days.';
  END IF;
  IF p_pickup_slot_start IS NULL OR p_pickup_slot_start <= now()
     OR p_pickup_slot_start + interval '30 minutes' > t.latest_pickup_at
     OR NOT public.helpr_task_source_slot_ok(t.source_kind, t.source_id, p_pickup_slot_start) THEN
    RAISE EXCEPTION 'invalid_slot' USING ERRCODE = '22023',
      HINT = 'Pick a time in the future, inside the seller''s pickup times.';
  END IF;
  UPDATE public.helpr_tasks
     SET status = 'accepted', helpr_id = v_uid, accepted_at = now(), pickup_slot_start = p_pickup_slot_start, updated_at = now()
   WHERE id = t.id AND status = 'open';
  PERFORM public.helpr_task_log(t.id, 'accepted', v_uid, to_char(p_pickup_slot_start, 'YYYY-MM-DD"T"HH24:MI:SSOF'));
  PERFORM public.helpr_task_source_event(t.id, 'accepted', NULL);
  RETURN jsonb_build_object('result', 'accepted', 'pickup_slot_start', p_pickup_slot_start);
END;
$fn$;

REVOKE ALL ON FUNCTION public.helpr_task_accept(uuid, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.helpr_task_accept(uuid, timestamptz) TO authenticated, service_role;
