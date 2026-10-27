-- GO ONLINE FOR DELIVERIES (owner-approved add-on 2026-10-27, Q2440: a Spark-style "Online" switch).
--
-- Before: a Helpr learned about a new Declutter delivery only by opening Deliver for pay. Now a
-- Helpr who may deliver can flip "Online" (on the Deliver page; a pill in the header while it is on).
-- While online, a NEW open delivery near them is offered to them at once (bell + push, through the
-- notifications pipeline): "$X · N mi · pickup in <town>", opening Deliver for pay, where Accept goes
-- through the existing helpr_task_accept (first to accept gets it, as today). Offline Helprs get
-- nothing new; the Deliver list works as before.
--
-- - helpr_delivery_online: one row per Helpr (own-row read only; written only by the RPC). online_until
--   is the auto-off (default 4 hours, 1 to 12); "off" clears it. The point a Helpr is "near" is their
--   saved area (profiles.latitude / longitude) or, only if they shared it, the position the route
--   screen already has, ROUNDED to 2 decimals (~1 km) before it is stored. No background location:
--   nothing updates it but the Helpr's own tap.
-- - helpr_go_online(p_on, p_hours, p_lat, p_lng, p_radius_miles): behind the member switch, judged by
--   helpr_task_assert_helpr (the gate every delivery RPC uses).
-- - The offer: an AFTER INSERT trigger on helpr_tasks (status 'open') notifies every Helpr online
--   now, whose point is within their radius of the task's pickup point rounded to 2 decimals, who
--   could take it (not a party, vehicle fits, not blocked either way, same Stripe mode, not banned,
--   not under 18, under 3 Declutter strikes, the payout gate as helpr_task_assert_helpr reads it). At most 25 per task, nearest first. The notice names the
--   take-home pay, trip miles and the pickup AREA only: no address, no point.
--
-- Replay-safe: IF NOT EXISTS / CREATE OR REPLACE / DROP TRIGGER IF EXISTS; grants by role name.
-- Proof: src/test/pglite/helprGoOnline.pglite.mjs (3x replay). Guard: src/test/helprGoOnline.test.ts.

-- 1. The switch: one row per Helpr. Read: own row only. Written only by helpr_go_online.
CREATE TABLE IF NOT EXISTS public.helpr_delivery_online (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  online_until timestamptz,
  -- Stored only to ~1 km: the CHECK refuses a finer point, so no path can keep a live position here.
  near_lat numeric CHECK (near_lat IS NULL OR (near_lat BETWEEN -90 AND 90 AND near_lat = round(near_lat, 2))),
  near_lng numeric CHECK (near_lng IS NULL OR (near_lng BETWEEN -180 AND 180 AND near_lng = round(near_lng, 2))),
  radius_miles integer NOT NULL DEFAULT 15 CHECK (radius_miles BETWEEN 1 AND 50),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT helpr_delivery_online_point CHECK ((near_lat IS NULL) = (near_lng IS NULL))
);
CREATE INDEX IF NOT EXISTS helpr_delivery_online_until_idx ON public.helpr_delivery_online (online_until) WHERE online_until IS NOT NULL;
ALTER TABLE public.helpr_delivery_online ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.helpr_delivery_online FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.helpr_delivery_online TO authenticated;
GRANT ALL ON TABLE public.helpr_delivery_online TO service_role;
DROP POLICY IF EXISTS "helpr delivery online: owner reads own" ON public.helpr_delivery_online;
CREATE POLICY "helpr delivery online: owner reads own" ON public.helpr_delivery_online
  FOR SELECT TO authenticated USING (user_id = (SELECT auth.uid()));

-- 2. Go online (or off). p_hours 1..12 (NULL = 4). The point: the caller's shared position (the route
-- screen's, only if they shared it), else their saved area (profiles.latitude / longitude), rounded to
-- 2 decimals before it is stored; with neither, 'location_needed'. Off clears online_until and the point.
CREATE OR REPLACE FUNCTION public.helpr_go_online(p_on boolean, p_hours integer, p_lat numeric, p_lng numeric, p_radius_miles integer)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid;
  v_lat numeric;
  v_lng numeric;
  v_until timestamptz;
  r public.helpr_delivery_online;
BEGIN
  IF p_on IS NULL THEN
    RAISE EXCEPTION 'invalid_choice' USING ERRCODE = '22023';
  END IF;
  -- Going offline is always allowed, before the switch check too (lh-authz-rls review #2): a member
  -- the 'declutter' switch stops covering can still stop the offers. It also forgets the point, so no
  -- shared position outlives the session (review #4).
  IF NOT p_on THEN
    v_uid := (SELECT auth.uid());
    IF v_uid IS NULL THEN
      RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
    END IF;
    UPDATE public.helpr_delivery_online SET online_until = NULL, near_lat = NULL, near_lng = NULL, updated_at = now() WHERE user_id = v_uid;
    RETURN jsonb_build_object('online_until', NULL);
  END IF;
  PERFORM public.helpr_task_source_require_feature('declutter_delivery');
  -- Points left by an auto-off are erased here and on every new delivery (lh-authz-rls re-review #1):
  -- a shared position never outlives its online session by more than the next of either.
  UPDATE public.helpr_delivery_online SET near_lat = NULL, near_lng = NULL
   WHERE online_until <= now() AND near_lat IS NOT NULL;
  -- Going online: only a Helpr who may deliver (the gate every delivery RPC uses).
  v_uid := public.helpr_task_assert_helpr();
  IF p_hours IS NOT NULL AND p_hours NOT BETWEEN 1 AND 12 THEN
    RAISE EXCEPTION 'invalid_hours' USING ERRCODE = '22023', HINT = 'Choose 1 to 12 hours.';
  END IF;
  IF p_radius_miles IS NOT NULL AND p_radius_miles NOT BETWEEN 1 AND 50 THEN
    RAISE EXCEPTION 'invalid_radius' USING ERRCODE = '22023', HINT = 'Choose 1 to 50 miles.';
  END IF;
  IF p_lat IS NOT NULL OR p_lng IS NOT NULL THEN
    IF p_lat IS NULL OR p_lng IS NULL OR p_lat NOT BETWEEN -90 AND 90 OR p_lng NOT BETWEEN -180 AND 180 THEN
      RAISE EXCEPTION 'invalid_location' USING ERRCODE = '22023';
    END IF;
    v_lat := round(p_lat, 2);
    v_lng := round(p_lng, 2);
  ELSE
    SELECT round(pr.latitude::numeric, 2), round(pr.longitude::numeric, 2) INTO v_lat, v_lng
      FROM public.profiles pr WHERE pr.user_id = v_uid AND pr.latitude IS NOT NULL AND pr.longitude IS NOT NULL;
    IF v_lat IS NULL THEN
      -- Still online from a shared position: keep it (going offline forgets it).
      SELECT o.near_lat, o.near_lng INTO v_lat, v_lng FROM public.helpr_delivery_online o
       WHERE o.user_id = v_uid AND o.online_until > now();
    END IF;
  END IF;
  IF v_lat IS NULL OR v_lng IS NULL THEN
    RAISE EXCEPTION 'location_needed' USING ERRCODE = '22023',
      HINT = 'Add your area in your profile, or share your location, to go online.';
  END IF;
  v_until := now() + make_interval(hours => COALESCE(p_hours, 4));
  INSERT INTO public.helpr_delivery_online (user_id, online_until, near_lat, near_lng, radius_miles, updated_at)
  VALUES (v_uid, v_until, v_lat, v_lng, COALESCE(p_radius_miles, 15), now())
  ON CONFLICT (user_id) DO UPDATE SET online_until = EXCLUDED.online_until, near_lat = EXCLUDED.near_lat,
    near_lng = EXCLUDED.near_lng, radius_miles = COALESCE(p_radius_miles, public.helpr_delivery_online.radius_miles), updated_at = now()
  RETURNING * INTO r;
  RETURN jsonb_build_object('online_until', r.online_until, 'radius_miles', r.radius_miles);
END;
$fn$;
REVOKE ALL ON FUNCTION public.helpr_go_online(boolean, integer, numeric, numeric, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.helpr_go_online(boolean, integer, numeric, numeric, integer) TO authenticated, service_role;

-- 3. The offer: a new open task goes to every online, nearby Helpr who could take it (25 at most,
-- nearest first). Area words, trip miles and take-home pay only.
CREATE OR REPLACE FUNCTION public.helpr_task_offer_online()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  o record;
  v_pay integer;
BEGIN
  IF NEW.status <> 'open' OR NEW.open_until <= now() THEN
    RETURN NEW;
  END IF;
  v_pay := public.helpr_payout_round_down_cents(NEW.pay_cents - NEW.fee_cents);
  -- The offer is a courtesy on top of the Deliver list: it must never stop a paid order's delivery
  -- task from being created. Each Helpr's notice is its own sub-block (one failure loses one offer,
  -- not every offer: lh-authz-rls review #3); a failure is raised as a WARNING and the insert goes on.
  BEGIN
  UPDATE public.helpr_delivery_online SET near_lat = NULL, near_lng = NULL
   WHERE online_until <= now() AND near_lat IS NOT NULL;
  FOR o IN
    SELECT h.user_id
      FROM public.helpr_delivery_online h
     WHERE h.online_until > now() AND h.near_lat IS NOT NULL
       AND public.helpr_task_distance_m(h.near_lat, h.near_lng, round(NEW.pickup_lat, 2), round(NEW.pickup_lng, 2))
           <= h.radius_miles * 1609.344
       -- Could this Helpr take it right now? helpr_task_assert_helpr's and helpr_tasks_open_near's
       -- checks, for this member instead of the caller (they went online through the gate; this
       -- re-checks at offer time: a ban, strikes or a lapsed payout gate since then means no offer).
       AND h.user_id IS DISTINCT FROM NEW.customer_id AND h.user_id IS DISTINCT FROM NEW.pickup_contact_id
       AND EXISTS (SELECT 1 FROM public.profiles pr WHERE pr.user_id = h.user_id
                     AND COALESCE(pr.ban_status, 'active') NOT IN ('banned', 'temp_banned', 'permanently_banned')
                     AND pr.under_13_blocked_at IS NULL)
       AND NOT public.member_under_18(h.user_id)
       AND public.declutter_active_strike_count(h.user_id) < 3
       AND NOT ('unknown' = ANY (public.helper_accept_missing(h.user_id)) OR 'payout_setup' = ANY (public.helper_accept_missing(h.user_id)))
       AND public.helpr_task_vehicle_fits(h.user_id, NEW.size)
       AND NOT public.are_users_blocked(h.user_id, NEW.customer_id)
       AND NOT public.are_users_blocked(h.user_id, NEW.pickup_contact_id)
       AND public.helpr_task_same_stripe_mode(h.user_id, NEW.customer_id)
       -- The member switch, per Helpr: someone the 'declutter' switch stops covering gets no offers.
       AND public.feature_enabled_for_user('declutter', h.user_id)
     ORDER BY public.helpr_task_distance_m(h.near_lat, h.near_lng, round(NEW.pickup_lat, 2), round(NEW.pickup_lng, 2)), h.user_id
     LIMIT 25
  LOOP
    BEGIN
      PERFORM public.declutter_notify(o.user_id, 'job_match', 'New delivery near you',
        format('$%s · %s mi · pickup in %s', (v_pay / 100)::text, NEW.trip_miles, NEW.pickup_area),
        '/declutter?view=deliver', NEW.customer_id);
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'helpr_task_offer_online: offer of task % to % not sent: %', NEW.id, o.user_id, SQLERRM;
    END;
  END LOOP;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'helpr_task_offer_online: offers for task % not sent: %', NEW.id, SQLERRM;
  END;
  RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION public.helpr_task_offer_online() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_helpr_tasks_offer_online ON public.helpr_tasks;
CREATE TRIGGER trg_helpr_tasks_offer_online AFTER INSERT ON public.helpr_tasks
  FOR EACH ROW EXECUTE FUNCTION public.helpr_task_offer_online();
