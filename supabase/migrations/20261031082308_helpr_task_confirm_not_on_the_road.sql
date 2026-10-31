-- BUY-39 server half (buying audit 10-30 #39; lead verdict 10-31 03:25 "the server should refuse the buyer's
-- I got it on a Helpr delivery under the same rule the app now shows").
--
-- helpr_task_customer_confirm (newest CREATE 20261017055505_declutter_helpr_delivery.sql, B8) accepted
-- status 'picked_up', so the buyer's "I got it" finished the sale (Helpr and seller paid) while the item was
-- still in the Helpr's car. The app (3ef6eedbb0) now offers I got it only from the drop-off, or once the Helpr
-- has held the item 24 hours without marking it delivered (BUY-37: "If you have it, tap I got it";
-- src/lib/declutter/stillInHand.ts, the same 24 hours as helpr_task_sweep's first still-not-delivered nudge).
-- This restates the function verbatim from 20261017055505 with one change: 'picked_up' is accepted only once
-- picked_up_at is 24 hours or more ago; before that it raises delivery_on_the_way (55000).
-- The owner's 10-30 rule ("the buyer's I got it alone finishes the order") still holds once it is allowed.
-- Grants unchanged.

CREATE OR REPLACE FUNCTION public.helpr_task_customer_confirm(p_task_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  t public.helpr_tasks;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  t := public.helpr_task_lock(p_task_id);
  IF t.customer_id IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'task_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF t.status = 'confirmed' THEN
    RETURN jsonb_build_object('result', 'already_confirmed');
  END IF;
  IF t.status NOT IN ('picked_up', 'delivered') THEN
    RAISE EXCEPTION 'delivery_not_done' USING ERRCODE = '55000', HINT = 'The Helpr has not picked the item up yet.';
  END IF;
  -- BUY-39: on the road is not "I got it". From the drop-off, or after 24 h in the Helpr's hands.
  IF t.status = 'picked_up' AND (t.picked_up_at IS NULL OR t.picked_up_at > now() - interval '24 hours') THEN
    RAISE EXCEPTION 'delivery_on_the_way' USING ERRCODE = '55000', HINT = 'The Helpr is bringing it. Tap I got it once it is dropped off.';
  END IF;
  RETURN public.helpr_task_source_event(t.id, 'confirmed', 'customer');
END;
$fn$;
REVOKE ALL ON FUNCTION public.helpr_task_customer_confirm(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.helpr_task_customer_confirm(uuid) TO authenticated, service_role;
