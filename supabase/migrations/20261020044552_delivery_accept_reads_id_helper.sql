-- ID ONCE, AT THE DELIVERY ACCEPT (owner, 2026-10-20: a Helpr's ID is
-- "required but only once they are offered and accept a job", judged by ONE
-- helper everywhere; lead 2026-10-20: the Declutter delivery accept too, in
-- its own commit so it can be dropped on its own).
--
-- Measured live 2026-10-20 (pg_get_functiondef; md5(prosrc) of the body below
-- equals 20261017055505's): helpr_task_accept judged the Helpr through
-- helpr_task_assert_helpr, whose readiness read is helper_award_block_reason
-- (payout setup ONLY), so an unverified Helpr could take a delivery and be
-- shown the seller's pickup address. Taking a delivery is the Helpr's accept,
-- so it now also reads public.helper_accept_block_reason (payout setup and the
-- one identity rule, identity_is_verified). helpr_task_assert_helpr itself is
-- unchanged: it also guards the later steps of a delivery already taken.
-- Prod 2026-10-20: 0 helpr_tasks rows in 'accepted', so nobody live is affected.
--
-- The live body with only the marked edit. Replay-safe: CREATE OR REPLACE;
-- grants restated as on prod (authenticated, service_role; REVOKE FROM
-- PUBLIC, anon). Guard: src/test/everyAcceptReadsTheIdHelper.test.ts. Proof:
-- src/test/pglite/deliveryAcceptReadsIdHelper.pglite.mjs (3x replay).

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
  IF NOT public.helpr_task_vehicle_fits(v_uid, t.size) THEN
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
