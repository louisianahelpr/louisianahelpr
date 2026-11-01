-- B110 (owner 11-01 1:00 PM): the checkout's meetup time chips are the SELLER SPOT's own days and times
-- (20261101194608 makes declutter_order_slot_in_windows keep a meetup at a seller spot to them). This read gives the
-- buyer the days and times of the spot THEY picked for this seller's cart (declutter_meetup_choices), only when it is
-- this seller's own active spot; NULL otherwise (an admin spot: the seller's usual times, as before).
-- AUTHZ: the caller's own choice only; a seller spot's hours are public by design (shown at checkout). MONEY: none.
-- REPLAY-SAFE: CREATE OR REPLACE. Proof: src/test/pglite/declutterSellerMeetupSpots.pglite.mjs (section 3).

CREATE OR REPLACE FUNCTION public.declutter_chosen_meetup_hours(p_seller_id uuid)
RETURNS jsonb
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
  RETURN (SELECT s.windows
            FROM public.declutter_meetup_choices mc
            JOIN public.declutter_meetup_spots s ON s.id = mc.spot_id
           WHERE mc.buyer_id = v_uid AND mc.seller_id = p_seller_id
             AND s.seller_id = p_seller_id AND s.active);
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_chosen_meetup_hours(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_chosen_meetup_hours(uuid) TO authenticated, service_role;
