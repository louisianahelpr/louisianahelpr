-- Delivery live map (owner 11-01 11:53 AM): the seller sees the Helpr coming for the pickup (after the Helpr taps
-- Start, until Picked up); the buyer sees the Helpr from Picked up until delivered, with an ETA. The position is
-- shared only while the Helpr is driving THAT delivery, then deleted: no history.
--
-- Before this, "Start" on the Helpr's route map (DeliveryRouteMap) was client only: the position never left the
-- phone, and helpr_tasks had no "started" state (accepted -> picked_up -> delivered).
--
-- 1. helpr_tasks.started_at: the delivery's "started" state, set the first time the Helpr shares a position for it
--    (that only happens after Start). Cleared when the delivery goes back to open (the Helpr let it go).
-- 2. helpr_task_live_positions: ONE row per delivery, overwritten on every share (no history): the Helpr's point, the
--    point they are heading to for THIS viewer's phase (the seller's own pickup point while accepted, the buyer's own
--    drop-off while picked up) and a rough ETA (road miles x 2 min, the same 30 mph helpr_my_route plans with).
--    Clients may only SELECT, and RLS lets through: the seller (pickup_contact_id) while the delivery is accepted and
--    started; the buyer (customer_id) while it is picked up; nobody else, and nothing older than 2 minutes.
-- 3. helpr_share_position(lat, lng): the caller's own deliveries in hand (accepted within 2 hours of the booked
--    pickup or handed over to them, or picked up). Writes only through this function.
-- 4. helpr_stop_sharing(): the Helpr tapped Stop or left the map: their rows are deleted.
-- 5. A trigger on helpr_tasks deletes the row on ANY status change (Picked up, delivered, released, cancelled), so
--    the buyer never sees a row written for the seller's phase (the seller's pickup point), and a delivered or
--    released delivery keeps nothing.
--
-- REPLAY-SAFETY: IF NOT EXISTS / CREATE OR REPLACE / DROP ... IF EXISTS throughout; safe 3x.

ALTER TABLE public.helpr_tasks ADD COLUMN IF NOT EXISTS started_at timestamptz;

CREATE TABLE IF NOT EXISTS public.helpr_task_live_positions (
  task_id uuid PRIMARY KEY REFERENCES public.helpr_tasks(id) ON DELETE CASCADE,
  lat numeric NOT NULL CHECK (lat BETWEEN -90 AND 90),
  lng numeric NOT NULL CHECK (lng BETWEEN -180 AND 180),
  dest_lat numeric NOT NULL CHECK (dest_lat BETWEEN -90 AND 90),
  dest_lng numeric NOT NULL CHECK (dest_lng BETWEEN -180 AND 180),
  eta_minutes integer NOT NULL CHECK (eta_minutes >= 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.helpr_task_live_positions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.helpr_task_live_positions FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.helpr_task_live_positions TO authenticated;
GRANT ALL ON TABLE public.helpr_task_live_positions TO service_role;

-- Q807: writes from an unconfirmed email are refused on every public table (the gate's own statement trigger).
DO $do$
BEGIN
  IF to_regprocedure('public.attach_unconfirmed_email_gate()') IS NOT NULL THEN
    PERFORM public.attach_unconfirmed_email_gate();
  END IF;
END
$do$;

-- Who may see a delivery's live position right now (helpr_tasks has no client privilege, so the policy asks this).
CREATE OR REPLACE FUNCTION public.helpr_task_position_viewer(p_task_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT EXISTS (
    SELECT 1 FROM public.helpr_tasks t
     WHERE t.id = p_task_id
       AND t.started_at IS NOT NULL
       AND (SELECT auth.uid()) IS NOT NULL
       AND ((t.status = 'accepted' AND t.pickup_contact_id = (SELECT auth.uid()))
         OR (t.status = 'picked_up' AND t.customer_id = (SELECT auth.uid()))));
$fn$;
REVOKE ALL ON FUNCTION public.helpr_task_position_viewer(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.helpr_task_position_viewer(uuid) TO authenticated, service_role;

DROP POLICY IF EXISTS helpr_task_live_positions_party_reads ON public.helpr_task_live_positions;
CREATE POLICY helpr_task_live_positions_party_reads ON public.helpr_task_live_positions
  FOR SELECT TO authenticated
  USING (updated_at > now() - interval '2 minutes' AND public.helpr_task_position_viewer(task_id));

CREATE OR REPLACE FUNCTION public.helpr_share_position(p_lat numeric, p_lng numeric)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_n integer;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  IF p_lat IS NULL OR p_lng IS NULL OR p_lat NOT BETWEEN -90 AND 90 OR p_lng NOT BETWEEN -180 AND 180 THEN
    RAISE EXCEPTION 'bad_position' USING ERRCODE = '22023';
  END IF;

  WITH mine AS (
    SELECT t.id,
           CASE WHEN t.status = 'accepted' THEN t.pickup_lat ELSE t.dropoff_lat END AS dlat,
           CASE WHEN t.status = 'accepted' THEN t.pickup_lng ELSE t.dropoff_lng END AS dlng
      FROM public.helpr_tasks t
     WHERE t.helpr_id = v_uid
       AND (t.status = 'picked_up'
         OR (t.status = 'accepted'
             AND (t.handed_over_to = v_uid OR now() >= t.pickup_slot_start - interval '2 hours')))
       FOR UPDATE OF t
  ), started AS (
    UPDATE public.helpr_tasks t SET started_at = now(), updated_at = now()
      FROM mine WHERE t.id = mine.id AND t.started_at IS NULL
  )
  INSERT INTO public.helpr_task_live_positions AS p (task_id, lat, lng, dest_lat, dest_lng, eta_minutes, updated_at)
  SELECT mine.id, p_lat, p_lng, mine.dlat, mine.dlng,
         COALESCE(public.declutter_road_miles(p_lat, p_lng, mine.dlat, mine.dlng), 0) * 2, now()
    FROM mine
  ON CONFLICT (task_id) DO UPDATE
    SET lat = EXCLUDED.lat, lng = EXCLUDED.lng, dest_lat = EXCLUDED.dest_lat, dest_lng = EXCLUDED.dest_lng,
        eta_minutes = EXCLUDED.eta_minutes, updated_at = EXCLUDED.updated_at;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$fn$;
REVOKE ALL ON FUNCTION public.helpr_share_position(numeric, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.helpr_share_position(numeric, numeric) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.helpr_stop_sharing()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_n integer;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  DELETE FROM public.helpr_task_live_positions p
   USING public.helpr_tasks t
   WHERE p.task_id = t.id AND t.helpr_id = v_uid;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$fn$;
REVOKE ALL ON FUNCTION public.helpr_stop_sharing() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.helpr_stop_sharing() TO authenticated, service_role;

-- Any status change deletes the live row; back to open also clears "started".
CREATE OR REPLACE FUNCTION public.helpr_task_live_position_cleanup()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status OR NEW.helpr_id IS DISTINCT FROM OLD.helpr_id THEN
    DELETE FROM public.helpr_task_live_positions WHERE task_id = NEW.id;
    IF NEW.status NOT IN ('accepted', 'picked_up') OR NEW.helpr_id IS DISTINCT FROM OLD.helpr_id THEN
      NEW.started_at := NULL;
    END IF;
  END IF;
  RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION public.helpr_task_live_position_cleanup() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS helpr_task_live_position_cleanup ON public.helpr_tasks;
CREATE TRIGGER helpr_task_live_position_cleanup BEFORE UPDATE OF status, helpr_id ON public.helpr_tasks
  FOR EACH ROW EXECUTE FUNCTION public.helpr_task_live_position_cleanup();
